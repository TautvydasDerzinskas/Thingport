import type { Prisma, StudioDesign } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { applyCommand, CommandError, parseCommandArgs, studioCommand } from "../studio/commands.generated";
import { emptyDocument, topLevel, type StudioDocument } from "../studio/document.generated";

// Studio's designs: each user's own, changed only by the commands in frontend/src/studio/commands.ts, whether the page
// or an assistant runs them. Every change to the feature tree is kept as a revision, which is what undo and redo move
// between, and a record of who did what.

/** How many changes back undo reaches. */
const HISTORY_LIMIT = 100;
const DEFAULT_NAME = "Untitled design";

/** Who ran a command: the page, or an assistant connected with an API token. */
export type StudioActor = "user" | "mcp";

export type StudioDesignSummary = {
  id: string;
  name: string;
  feature_count: number;
  version: number;
  updated_at: Date;
};

export type StudioDesignOut = StudioDesignSummary & {
  document: StudioDocument;
  can_undo: boolean;
  can_redo: boolean;
  created_at: Date;
};

export type StudioCommandOut = { design: StudioDesignOut; summary: string; created: string[] };

const notFound = () => new HttpError(404, "Design not found", "studio_design_not_found");

function documentOf(design: StudioDesign): StudioDocument {
  return design.document as unknown as StudioDocument;
}

const json = (value: unknown) => value as Prisma.InputJsonValue;

function summary(design: StudioDesign): StudioDesignSummary {
  return {
    id: design.id,
    name: design.name,
    feature_count: topLevel(documentOf(design)).length,
    version: design.version,
    updated_at: design.updatedAt,
  };
}

async function out(tx: Prisma.TransactionClient, design: StudioDesign): Promise<StudioDesignOut> {
  const [before, after] = await Promise.all([
    tx.studioRevision.findFirst({
      where: { designId: design.id, position: { lt: design.position } },
      select: { id: true },
    }),
    tx.studioRevision.findFirst({
      where: { designId: design.id, position: { gt: design.position } },
      select: { id: true },
    }),
  ]);
  return {
    ...summary(design),
    document: documentOf(design),
    can_undo: Boolean(before),
    can_redo: Boolean(after),
    created_at: design.createdAt,
  };
}

async function owned(tx: Prisma.TransactionClient, userId: string, id: string): Promise<StudioDesign> {
  const design = await tx.studioDesign.findUnique({ where: { id } });
  if (!design || design.userId !== userId) throw notFound();
  return design;
}

export async function listStudioDesigns(userId: string): Promise<StudioDesignSummary[]> {
  const designs = await prisma.studioDesign.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return designs.map(summary);
}

export async function getStudioDesign(userId: string, id: string): Promise<StudioDesignOut> {
  return out(prisma, await owned(prisma, userId, id));
}

/** Just enough for an open page to tell the design changed under it, e.g. by an assistant. */
export async function getStudioDesignVersion(userId: string, id: string): Promise<number> {
  const design = await prisma.studioDesign.findUnique({ where: { id }, select: { userId: true, version: true } });
  if (!design || design.userId !== userId) throw notFound();
  return design.version;
}

/** The latest changes up to where undo has taken the design, newest first: what an assistant reads to know what the
 *  person did meanwhile. */
export async function studioDesignHistory(design: Pick<StudioDesignOut, "id">, limit: number) {
  const current = await prisma.studioDesign.findUnique({ where: { id: design.id }, select: { position: true } });
  const revisions = await prisma.studioRevision.findMany({
    where: { designId: design.id, command: { not: null }, position: { lte: current?.position ?? 0 } },
    orderBy: { position: "desc" },
    take: limit,
    select: { summary: true, actor: true, createdAt: true },
  });
  return revisions.map((revision) => ({ summary: revision.summary, by: revision.actor, at: revision.createdAt }));
}

export async function createStudioDesign(userId: string, name: string | undefined, actor: StudioActor) {
  const document = emptyDocument();
  const design = await prisma.studioDesign.create({
    data: {
      userId,
      name: name?.trim() || DEFAULT_NAME,
      document: json(document),
      revisions: { create: { position: 0, document: json(document), actor } },
    },
  });
  return out(prisma, design);
}

export async function deleteStudioDesign(userId: string, id: string): Promise<void> {
  await owned(prisma, userId, id);
  await prisma.studioDesign.delete({ where: { id } });
}

/**
 * Runs one command on a design. One at a time per design: a person and an assistant changing it together each build
 * on the other's change rather than overwriting it.
 */
export async function runStudioCommand(
  userId: string,
  id: string,
  name: string,
  args: unknown,
  actor: StudioActor,
): Promise<StudioCommandOut> {
  const definition = studioCommand(name);
  if (!definition) throw new HttpError(400, `There's no Studio command ${name}`, "studio_unknown_command");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StudioDesign" WHERE id = ${id} FOR UPDATE`;
      const design = await owned(tx, userId, id);
      const parsed = parseCommandArgs(definition, args);

      if (definition.kind === "design") {
        const renamed = String(parsed.name);
        const updated = await tx.studioDesign.update({
          where: { id },
          data: { name: renamed, version: { increment: 1 } },
        });
        return { design: await out(tx, updated), summary: `Renamed the design “${renamed}”`, created: [] };
      }

      if (definition.kind === "history") {
        const undo = name === "undo";
        const [current, target] = await Promise.all([
          tx.studioRevision.findUnique({ where: { designId_position: { designId: id, position: design.position } } }),
          tx.studioRevision.findUnique({
            where: { designId_position: { designId: id, position: design.position + (undo ? -1 : 1) } },
          }),
        ]);
        if (!target) throw new CommandError(undo ? "There's nothing to undo." : "There's nothing to redo.");
        const updated = await tx.studioDesign.update({
          where: { id },
          data: { document: json(target.document), position: target.position, version: { increment: 1 } },
        });
        const what = undo ? current?.summary : target.summary;
        return {
          design: await out(tx, updated),
          summary: `${undo ? "Undid" : "Redid"}${what ? `: ${what}` : ""}`,
          created: [],
        };
      }

      const outcome = applyCommand(documentOf(design), name, parsed);
      const position = design.position + 1;
      // A change after an undo leaves nothing to redo; past the limit, the oldest are let go.
      await tx.studioRevision.deleteMany({
        where: { designId: id, OR: [{ position: { gte: position } }, { position: { lte: position - HISTORY_LIMIT } }] },
      });
      await tx.studioRevision.create({
        data: {
          designId: id,
          position,
          document: json(outcome.document),
          command: name,
          args: json(parsed),
          summary: outcome.summary,
          actor,
        },
      });
      const updated = await tx.studioDesign.update({
        where: { id },
        data: { document: json(outcome.document), position, version: { increment: 1 } },
      });
      return { design: await out(tx, updated), summary: outcome.summary, created: outcome.created };
    });
  } catch (error) {
    if (error instanceof CommandError) throw new HttpError(400, error.message, "studio_command_refused");
    throw error;
  }
}
