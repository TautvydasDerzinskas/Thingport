// What a tool keeps for a user that the tool's other users may read, such as a print queue the household shares.
// Each entry is its writer's alone to change, and who reads it follows the writer's audience: everyone who can use
// the tool, or only the people they picked. An entry may be about a model, so that model's page shows it, and so do
// everyone else's copies of the model, recognised by their first original or the page they were imported from.

import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { UserCardOut } from "../dto";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { readablePrintWhere, userCards } from "./socialService";
import { matchingSharedPreviews } from "./toolSharedPreviews";
import { STORAGE_KEY, toolUsers, usableTool, type ToolUser } from "./toolsService";

const SHARED_VALUE_MAX_BYTES = 256 * 1024;
const SHARED_MAX_BYTES = 5 * 1024 * 1024;
const SHARED_MAX_KEYS = 5000;
const LIST_MAX = 5000;
const AUDIENCE_MAX = 100;
// Each statement sees what's committed, so what's counted after the lock is all of it, whatever the default.
const COUNTED_AFTER_LOCK = { isolationLevel: "ReadCommitted" } as const;

export const sharedSetSchema = z.object({
  value: z.unknown(),
  /** The model it's about: one the writer can read. */
  model: z.string().min(1).max(100).nullable().optional(),
});

export const audienceSchema = z.object({
  everyone: z.boolean(),
  userIds: z.array(z.string().min(1)).max(AUDIENCE_MAX).default([]),
});

type ModelKeys = { originKey: string; sourceKey: string | null };

/** How a model is known in anyone's library: its first original, and the page it was imported from. */
export function modelKeysOf(print: {
  id: string;
  originalId: string | null;
  sourceProvider: string | null;
  sourceExternalId: string | null;
}): ModelKeys {
  return {
    originKey: `orig:${print.originalId ?? print.id}`,
    sourceKey:
      print.sourceProvider && print.sourceExternalId ? `src:${print.sourceProvider}:${print.sourceExternalId}` : null,
  };
}

/** Entries about the same model, by either key. */
const sameModel = (keys: ModelKeys): Prisma.ToolSharedDataWhereInput => ({
  OR: [{ originKey: keys.originKey }, ...(keys.sourceKey ? [{ sourceKey: keys.sourceKey }] : [])],
});

/** A model the user may read: theirs, or one shared with them. */
async function readableModel(user: ToolUser, printId: string): Promise<ModelKeys & { id: string }> {
  const print = await prisma.print.findFirst({
    where: { AND: [{ id: printId }, await readablePrintWhere(user.id)] },
    select: { id: true, originalId: true, sourceProvider: true, sourceExternalId: true },
  });
  if (!print) throw new HttpError(404, "No such model");
  return { id: print.id, ...modelKeysOf(print) };
}

function assertKey(key: string): void {
  if (!STORAGE_KEY.test(key))
    throw new HttpError(400, "A key is 1-200 letters, digits, dots, dashes, colons and underscores, and not . or ..");
}

/**
 * Leaves out the entries of the writers in these tools who keep theirs from `readerId` (those whose audience leaves
 * them out), in the query itself, so their entries don't use up the rows a read takes.
 */
async function visibleTo(
  db: Prisma.TransactionClient,
  toolIds: string[],
  readerId: string,
): Promise<Prisma.ToolSharedDataWhereInput> {
  const hidden = await db.toolAudience.findMany({
    where: { toolId: { in: toolIds }, userId: { not: readerId }, NOT: { userIds: { has: readerId } } },
    select: { toolId: true, userId: true },
  });
  return hidden.length ? { NOT: hidden.map(({ toolId, userId }) => ({ toolId, userId })) } : {};
}

export type SharedEntryOut = {
  key: string;
  value: unknown;
  /** Who wrote it. */
  user: UserCardOut | null;
  mine: boolean;
  /** The model it's about, as its writer has it. */
  model_id: string | null;
  preview_match?: boolean;
  updated_at: string;
  /** Where it is in the order, for reading the entries after it. */
  cursor: string;
};

const cursorOf = (row: { updatedAt: Date; id: string }) =>
  Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString("base64url");

/** The entries after an entry's `cursor`, in the order a read gives them: older, or as old with a smaller id. */
function afterCursor(cursor: string): Prisma.ToolSharedDataWhereInput {
  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const updatedAt = new Date(at ?? "");
  if (!id || Number.isNaN(updatedAt.getTime())) throw new HttpError(400, "That isn't a cursor a read gave");
  return { OR: [{ updatedAt: { lt: updatedAt } }, { updatedAt, id: { lt: id } }] };
}

/** The entries the user may read, newest first: their own and everyone else's that reach them, 5,000 a read; `before`,
 *  the last one's `cursor`, reads the next ones. */
export async function listSharedData(
  user: ToolUser,
  toolId: string,
  options: { prefix?: string; model?: string; before?: string; preview?: string },
): Promise<SharedEntryOut[]> {
  const tool = await usableTool(user, toolId);
  const keys = options.model ? await readableModel(user, options.model) : null;
  // Who keeps theirs from the user, and the entries, read in one snapshot: an entry written just after its writer
  // narrowed whom theirs reach is never read under what reached the user before.
  const rows = await prisma.$transaction(
    async (tx) =>
      tx.toolSharedData.findMany({
        where: {
          AND: [
            { toolId: tool.id },
            options.prefix ? { key: { startsWith: options.prefix } } : {},
            keys ? sameModel(keys) : {},
            options.before ? afterCursor(options.before) : {},
            await visibleTo(tx, [tool.id], user.id),
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: LIST_MAX,
      }),
    { isolationLevel: "RepeatableRead" },
  );
  const [cards, matches] = await Promise.all([
    userCards(rows.map((row) => row.userId)),
    keys && options.prefix !== undefined && options.preview
      ? matchingSharedPreviews(keys.id, options.preview, options.prefix, rows)
      : null,
  ]);
  return rows.map((row, index) => {
    const entry: SharedEntryOut = {
      key: row.key,
      value: row.value,
      user: cards.get(row.userId) ?? null,
      mine: row.userId === user.id,
      model_id: row.printId,
      updated_at: row.updatedAt.toISOString(),
      cursor: cursorOf(row),
    };
    if (matches) entry.preview_match = matches[index];
    return entry;
  });
}

/** Keeps one of the user's entries, replacing what was under the key. */
export async function setSharedData(
  user: ToolUser,
  toolId: string,
  key: string,
  input: z.infer<typeof sharedSetSchema>,
): Promise<void> {
  assertKey(key);
  if (input.value === undefined) throw new HttpError(400, "There's no value to keep");
  const tool = await usableTool(user, toolId);
  const size = Buffer.byteLength(JSON.stringify(input.value));
  if (size > SHARED_VALUE_MAX_BYTES) throw new HttpError(413, "A shared value is at most 256 KB as JSON");
  const model = input.model ? await readableModel(user, input.model) : null;
  const where = { toolId: tool.id, userId: user.id };
  const data = {
    value: input.value as Prisma.InputJsonValue,
    size,
    printId: model?.id ?? null,
    originKey: model?.originKey ?? null,
    sourceKey: model?.sourceKey ?? null,
  };
  await prisma.$transaction(async (tx) => {
    // One write at a time per writer in a tool, so two at once can't both take the room that's left.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tool-shared'), hashtext(${`${tool.id}:${user.id}`}))`;
    const used = await tx.toolSharedData.aggregate({ where: { ...where, key: { not: key } }, _sum: { size: true } });
    const count = await tx.toolSharedData.count({ where: { ...where, key: { not: key } } });
    const current = await tx.toolSharedData.findUnique({
      where: { toolId_userId_key: { ...where, key } },
      select: { id: true },
    });
    if ((used._sum.size ?? 0) + size > SHARED_MAX_BYTES)
      throw new HttpError(413, "This tool shares 5 MB at most for you; delete something first");
    if (!current && count >= SHARED_MAX_KEYS)
      throw new HttpError(413, `This tool shares ${SHARED_MAX_KEYS} entries at most for you`);
    await tx.toolSharedData.upsert({
      where: { toolId_userId_key: { ...where, key } },
      create: { ...where, key, ...data },
      update: data,
    });
  }, COUNTED_AFTER_LOCK);
}

export async function deleteSharedData(user: ToolUser, toolId: string, key: string): Promise<void> {
  assertKey(key);
  const tool = await usableTool(user, toolId);
  await prisma.toolSharedData.deleteMany({ where: { toolId: tool.id, userId: user.id, key } });
}

export type AudienceOut = { everyone: boolean; people: UserCardOut[] };

/** Whom the user's entries in the tool reach. */
export async function getAudience(user: ToolUser, toolId: string): Promise<AudienceOut> {
  const tool = await usableTool(user, toolId);
  const row = await prisma.toolAudience.findUnique({ where: { toolId_userId: { toolId: tool.id, userId: user.id } } });
  if (!row) return { everyone: true, people: [] };
  const cards = await userCards(row.userIds);
  return { everyone: false, people: row.userIds.flatMap((id) => cards.get(id) ?? []) };
}

/** Everyone who can use the tool, or only these people, who must be able to. */
export async function setAudience(
  user: ToolUser,
  toolId: string,
  input: z.infer<typeof audienceSchema>,
): Promise<AudienceOut> {
  const tool = await usableTool(user, toolId);
  const where = { toolId_userId: { toolId: tool.id, userId: user.id } };
  if (input.everyone) {
    await prisma.toolAudience.deleteMany({ where: { toolId: tool.id, userId: user.id } });
  } else {
    const users = new Set(await toolUsers());
    const userIds = [...new Set(input.userIds)].filter((id) => id !== user.id);
    if (userIds.some((id) => !users.has(id))) throw new HttpError(400, "Someone picked can't use tools");
    await prisma.toolAudience.upsert({
      where,
      create: { toolId: tool.id, userId: user.id, userIds },
      update: { userIds },
    });
  }
  return getAudience(user, toolId);
}

/** People the user may share the tool's entries with: the others who can use tools, by name. */
export async function shareablePeople(user: ToolUser, toolId: string, query: string): Promise<UserCardOut[]> {
  await usableTool(user, toolId);
  const ids = (await toolUsers()).filter((id) => id !== user.id);
  const found = await prisma.user.findMany({
    where: {
      id: { in: ids },
      // Any part of a name, or a whole email, as finding people does elsewhere; the email isn't sent back.
      ...(query.trim()
        ? {
            OR: [
              { displayName: { contains: query.trim(), mode: "insensitive" as const } },
              { email: { equals: query.trim(), mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: { id: true },
    orderBy: { displayName: "asc" },
    take: 20,
  });
  const cards = await userCards(found.map((row) => row.id));
  return found.flatMap((row) => cards.get(row.id) ?? []);
}
