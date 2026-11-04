import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma, StudioDesign } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS, STUDIO_ASSETS } from "../config";
import { HttpError } from "../utils/fileUtils";
import {
  addMesh,
  addParts,
  addTrace,
  alignBody,
  alignMeasures,
  applyCommand,
  layFlat,
  layFlatTurn,
  CommandError,
  parseCommandArgs,
  separableBody,
  studioCommand,
  traceSettings,
  traceTarget,
  type Bounds,
  type CommandOutcome,
} from "../studio/commands.generated";
import type { Traced } from "../studio/trace.generated";
import { ASSET_ID, emptyDocument, topLevel, type StudioDocument, type Vec3 } from "../studio/document.generated";
import { resolvePlateFilePath } from "./printCreation";
import { listPrints } from "./printQuery";
import { loadFontsFor } from "./studioFonts";
import { importStudioMesh, measureStudioBounds, measureStudioParts, traceStudioPicture } from "./studioInspect";
import type { StudioWorkerResult } from "./studioWorker";

// Studio's designs: each user's own, changed only by the commands in frontend/src/studio/commands.ts, whether the page
// or an assistant runs them. Every change to the feature tree is kept as a revision, which is what undo and redo move
// between, and a record of who did what.

/** How many changes back undo reaches. */
const HISTORY_LIMIT = 100;
/** How many times separate_parts measures a body again when the design changed while it was being measured. */
const MEASURE_TRIES = 3;
const DEFAULT_NAME = "Untitled design";

/** Who ran a command: the page, an assistant connected with an API token, or Studio's own assistant. */
export type StudioActor = "user" | "mcp" | "assistant";

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
  await fs.rm(studioAssetDir(userId, id), { recursive: true, force: true });
}

/** Where a design keeps the meshes it imported. Under the user, so deleting the account takes them too. */
export function studioAssetDir(userId: string, designId: string): string {
  return path.join(STUDIO_ASSETS, `u-${userId}`, designId);
}

/** One of a design's imported meshes, for the page to draw; null when there's no such design or mesh. */
export async function studioAssetPath(userId: string, designId: string, assetId: string): Promise<string | null> {
  if (!ASSET_ID.test(assetId)) return null;
  await owned(prisma, userId, designId);
  const file = path.join(studioAssetDir(userId, designId), `${assetId}.tpsm`);
  return (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
}

/** A picture as a design keeps it: what the prompt sends an AI and what trace_picture reads. */
export type StudioPicture = { id: string; width: number; height: number };

// Kept no bigger than this along its longer side: more than an AI looks at, and plenty for tracing a shape.
const PICTURE_PX = 2048;
const PICTURE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"]);

/** Keeps a picture with a design, turned upright and no bigger than PICTURE_PX, as <id>.png beside its meshes. */
export async function addStudioPicture(userId: string, designId: string, bytes: Buffer): Promise<StudioPicture> {
  await owned(prisma, userId, designId);
  const image = sharp(bytes, { limitInputPixels: 100_000_000 });
  const meta = await image.metadata().catch(() => null);
  if (!meta?.format || !PICTURE_FORMATS.has(meta.format))
    throw new HttpError(
      415,
      "That isn't a picture Studio can read (PNG, JPEG, WebP, GIF or AVIF)",
      "studio_bad_picture",
    );
  const { data, info } = await image
    .autoOrient()
    .resize(PICTURE_PX, PICTURE_PX, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const id = crypto.randomBytes(12).toString("hex");
  const dir = studioAssetDir(userId, designId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.png`), data);
  return { id, width: info.width, height: info.height };
}

/** One of a design's pictures; null when there's no such design or picture. */
export async function studioPicturePath(userId: string, designId: string, pictureId: string): Promise<string | null> {
  if (!ASSET_ID.test(pictureId)) return null;
  await owned(prisma, userId, designId);
  const file = path.join(studioAssetDir(userId, designId), `${pictureId}.png`);
  return (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
}

const extOf = (filename: string) => path.extname(filename).toLowerCase();

/** The user's library models with a 3D file Studio can import, newest first or best match for `q`. */
export async function listStudioLibrary(userId: string, q: string | undefined, offset: number) {
  const page = await listPrints(
    userId,
    { q: q?.trim() || undefined },
    { sort: q?.trim() ? "relevance" : "newest", limit: 30, offset },
  );
  return {
    models: page.prints
      .map((print) => ({
        id: print.id,
        title: print.title || print.name,
        thumb_url: print.thumb_url,
        files: print.plates
          .filter((plate) => RENDERABLE_MODEL_EXTS.has(extOf(plate.filename)))
          .map((plate) => ({ id: plate.id, name: plate.filename, size: plate.size })),
      }))
      .filter((model) => model.files.length > 0),
    next_offset: page.hasMore ? page.nextOffset : null,
  };
}

/** Makes the design's own copy of a library model's 3D file, and says what it is. */
async function importLibraryFile(userId: string, designId: string, modelId: string, fileId: string | undefined) {
  const print = await prisma.print.findFirst({
    where: { id: modelId, userId },
    include: { plates: { orderBy: { position: "asc" } } },
  });
  if (!print) throw new HttpError(404, "Model not found", "studio_model_not_found");
  const plates = print.plates.filter((plate) => RENDERABLE_MODEL_EXTS.has(extOf(plate.filename)));
  const plate = fileId ? plates.find((each) => each.id === fileId) : plates[0];
  if (!plate)
    throw new HttpError(
      400,
      fileId
        ? "That isn't one of the model's 3D files Studio can import (STL, 3MF, STEP, OBJ or GLB)"
        : "The model has no 3D file Studio can import (STL, 3MF, STEP, OBJ or GLB)",
      "studio_no_importable_file",
    );
  const source = resolvePlateFilePath(plate);
  if (!source) throw new HttpError(404, `${plate.filename} is missing from storage`, "studio_file_missing");
  const assetId = crypto.randomBytes(12).toString("hex");
  const destination = path.join(studioAssetDir(userId, designId), `${assetId}.tpsm`);
  const result = await importStudioMesh(source, extOf(plate.filename), destination);
  if (result.status === "refused")
    throw new HttpError(422, `${plate.filename}: ${result.reason}`, "studio_import_refused");
  if (result.status !== "imported") {
    console.error(`[studio] importing ${plate.filename} failed`, result);
    throw new HttpError(422, `Couldn't read ${plate.filename}`, "studio_import_failed");
  }
  return {
    destination,
    mesh: {
      asset_id: assetId,
      solid: result.solid,
      triangles: result.triangles,
      size: result.size.map((n) => Number(n.toFixed(3))) as Vec3,
      parts: result.parts,
      source: {
        model_id: print.id,
        file_id: plate.id,
        file_name: plate.filename,
        model_title: print.title || print.name,
      },
    },
  };
}

/** trace_picture's picture, traced outside the design's lock; the command's own checks first, so nothing is traced for
 *  a sketch it couldn't go in. */
async function traceFor(userId: string, id: string, args: Record<string, unknown>): Promise<Traced> {
  const design = await owned(prisma, userId, id);
  traceTarget(documentOf(design), args);
  const file = await studioPicturePath(userId, id, String(args.picture_id));
  if (!file) throw new CommandError(`This design has no picture ${String(args.picture_id)}.`);
  const outcome = await traceStudioPicture(file, traceSettings(args));
  if (outcome.status === "traced") return outcome.traced;
  if (outcome.status === "refused") throw new CommandError(outcome.reason);
  console.error("[studio] tracing a picture failed", outcome);
  throw new HttpError(500, "Couldn't trace the picture", "studio_trace_failed");
}

/** A measurement's failure, said as the HTTP error or the command's refusal it is. */
function measureFailed(outcome: StudioWorkerResult, what: string): never {
  if (outcome.status === "refused") throw new CommandError(outcome.reason);
  if (outcome.status === "too-complex")
    throw new HttpError(
      422,
      `The design is too heavy to measure here (about ${outcome.triangles} triangles)`,
      "studio_too_complex",
    );
  console.error(`[studio] measuring ${what} failed`, outcome);
  throw new HttpError(500, `Couldn't measure ${what}`, "studio_measure_failed");
}

async function boundsIn(doc: StudioDocument, assetDir: string, ids: string[]): Promise<Record<string, Bounds>> {
  const outcome = await measureStudioBounds(doc, assetDir, ids);
  if (outcome.status === "bounds") return outcome.bounds;
  return measureFailed(outcome, "the bodies");
}

/**
 * What a "measure" command needs measured (a body's loose parts, bodies' extents), found as the design is now and
 * outside its lock, as a big body takes a while; and the change it then makes with it. The command's own checks come
 * first, so nothing is measured for a command that would be refused anyway.
 */
async function measuredFor(
  userId: string,
  id: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ version: number; apply: (doc: StudioDocument) => CommandOutcome }> {
  const design = await owned(prisma, userId, id);
  const doc = documentOf(design);
  const assetDir = studioAssetDir(userId, id);
  const featureId = String(args.feature_id);
  if (name === "align") {
    const given = args as Parameters<typeof alignBody>[1];
    const bounds = await boundsIn(doc, assetDir, alignMeasures(doc, given));
    return { version: design.version, apply: (now) => alignBody(now, given, bounds) };
  }
  if (name === "lay_flat") {
    const given = args as Parameters<typeof layFlat>[1];
    const bounds = await boundsIn(layFlatTurn(doc, given), assetDir, [featureId]);
    return { version: design.version, apply: (now) => layFlat(now, given, bounds[featureId]) };
  }
  separableBody(doc, featureId);
  const outcome = await measureStudioParts(doc, assetDir, featureId);
  if (outcome.status !== "measured") return measureFailed(outcome, "the body's parts");
  return { version: design.version, apply: (now) => addParts(now, { feature_id: featureId }, outcome.parts) };
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
  // An import reads the file first, outside the design's lock: a big one takes a while, and the design may change
  // meanwhile. Its mesh is then added to the design as it is by then.
  let imported: Awaited<ReturnType<typeof importLibraryFile>> | null = null;
  let traced: Traced | null = null;
  try {
    // A text is checked against its font as it's drawn: the font is read first.
    await loadFontsFor(args);
    if (definition.kind === "import") {
      const parsed = parseCommandArgs(definition, args);
      if (name === "trace_picture") traced = await traceFor(userId, id, parsed);
      else {
        await owned(prisma, userId, id);
        imported = await importLibraryFile(userId, id, String(parsed.model_id), parsed.file_id as string | undefined);
      }
    }
    // A measuring command measures outside the lock too, and again if the design changed before the lock was had.
    for (let tries = 1; ; tries++) {
      const measured =
        definition.kind === "measure" ? await measuredFor(userId, id, name, parseCommandArgs(definition, args)) : null;
      const done = await prisma.$transaction(async (tx): Promise<StudioCommandOut | null> => {
        await tx.$queryRaw`SELECT id FROM "StudioDesign" WHERE id = ${id} FOR UPDATE`;
        const design = await owned(tx, userId, id);
        const parsed = parseCommandArgs(definition, args);
        if (measured && design.version !== measured.version) return null;

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

        const outcome: CommandOutcome = measured
          ? measured.apply(documentOf(design))
          : imported
            ? addMesh(documentOf(design), imported.mesh, parsed)
            : traced
              ? addTrace(documentOf(design), parsed as Parameters<typeof addTrace>[1], traced)
              : applyCommand(documentOf(design), name, parsed);
        const position = design.position + 1;
        // A change after an undo leaves nothing to redo; past the limit, the oldest are let go.
        await tx.studioRevision.deleteMany({
          where: {
            designId: id,
            OR: [{ position: { gte: position } }, { position: { lte: position - HISTORY_LIMIT } }],
          },
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
      if (done) return done;
      if (tries >= MEASURE_TRIES)
        throw new HttpError(409, "The design kept changing while it was being measured: try again", "studio_busy");
    }
  } catch (error) {
    // An import that didn't make it into the design leaves no copy behind.
    if (imported) await fs.rm(imported.destination, { force: true });
    if (error instanceof CommandError) throw new HttpError(400, error.message, "studio_command_refused");
    throw error;
  }
}
