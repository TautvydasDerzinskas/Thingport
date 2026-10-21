import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { printOutsByIds } from "./printLoader";
import { relocatePrintsForToken } from "./printService";
import { moveCollectionBookmark } from "./bookmarkService";
import { toSystemCollectionOut, type CollectionOut, type SystemCollectionKey } from "../dto";
import { normalizeTags } from "../utils/tagNormalization";
import { createLog } from "./auditLog";
import type { Collection, Prisma } from "@prisma/client";

export function normalizeCollectionName(name: string): string {
  return name.trim().toLowerCase();
}

/** Checked first so the reserved-name message wins over "already exists". */
function assertCollectionNameNotReserved(name: string): void {
  const normalized = normalizeCollectionName(name);
  const reserved = Object.values(SYSTEM_COLLECTIONS).find((c) => normalizeCollectionName(c.name) === normalized);
  if (reserved) throw new HttpError(409, `"${reserved.name}" is reserved for the built-in collection`);
}

/** So a raw Prisma unique-constraint error never reaches the client. */
export async function assertCollectionNameAvailable(userId: string, name: string, excludeId?: string): Promise<void> {
  assertCollectionNameNotReserved(name);
  const existing = await prisma.collection.findFirst({
    where: {
      userId,
      nameNormalized: normalizeCollectionName(name),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) throw new HttpError(409, `A collection named "${name.trim()}" already exists`);
}

/** Case-insensitive, so re-importing a collection reuses the same row. Safe to call twice at once:
 *  the one that loses the race to create it gets the row the other made. */
export async function findOrCreateCollectionByName(userId: string, name: string): Promise<Collection> {
  const trimmed = name.trim();
  const nameNormalized = normalizeCollectionName(trimmed);
  const existing = await prisma.collection.findFirst({ where: { userId, nameNormalized } });
  if (existing) return existing;
  try {
    return await prisma.collection.create({ data: { userId, name: trimmed, nameNormalized } });
  } catch (err) {
    const raced = await prisma.collection.findFirst({ where: { userId, nameNormalized } });
    if (raced) return raced;
    throw err;
  }
}

/** Skips prints already present, then moves files if the storage template has a {collection}
 * folder. */
export async function addPrintsToCollection(collectionId: string, printIds: string[]): Promise<void> {
  if (!printIds.length) return;
  const last = await prisma.collectionItem.findFirst({
    where: { collectionId },
    orderBy: { position: "desc" },
  });
  let nextPosition = (last?.position ?? -1) + 1;
  await prisma.collectionItem.createMany({
    data: printIds.map((printId) => ({ collectionId, printId, position: nextPosition++ })),
    skipDuplicates: true,
  });
  await relocatePrintsForToken("collection", printIds);
}

/** A new, empty collection. Shared by POST /collections and the MCP create_collection tool. */
export async function createCollection(
  userId: string,
  input: { name: string; description?: string | null; tags?: string[] },
): Promise<Collection> {
  await assertCollectionNameAvailable(userId, input.name);
  const collection = await prisma.collection.create({
    data: {
      userId,
      name: input.name,
      nameNormalized: normalizeCollectionName(input.name),
      description: input.description?.trim() || null,
      tags: normalizeTags(input.tags ?? []),
    },
  });
  void createLog({ userId, action: "collection_created", targetId: collection.id, details: { name: collection.name } });
  return collection;
}

/** Files the user's own models into one of their collections. Ids that aren't the user's models are
 *  left out and reported, as are models already in it. */
export async function addModelsToCollection(
  userId: string,
  collectionId: string,
  printIds: string[],
): Promise<{ collection: Collection; added: string[]; alreadyIn: string[]; notFound: string[] }> {
  if (isSystemCollectionId(collectionId)) throw new HttpError(400, "This collection can't be edited");
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } });
  if (!collection) throw new HttpError(404, "Collection not found");
  const owned = new Set(
    (await prisma.print.findMany({ where: { id: { in: printIds }, userId }, select: { id: true } })).map((p) => p.id),
  );
  const present = new Set(
    (
      await prisma.collectionItem.findMany({
        where: { collectionId, printId: { in: [...owned] } },
        select: { printId: true },
      })
    ).map((item) => item.printId),
  );
  const unique = [...new Set(printIds)];
  const added = unique.filter((id) => owned.has(id) && !present.has(id));
  await addPrintsToCollection(collection.id, added);
  if (added.length) {
    void createLog({
      userId,
      action: "collection_item_added",
      targetId: collection.id,
      details: { name: collection.name, count: added.length },
    });
  }
  return {
    collection,
    added,
    alreadyIn: unique.filter((id) => present.has(id)),
    notFound: unique.filter((id) => !owned.has(id)),
  };
}

// Favourites and History aren't real rows: they're derived from Print.favoritedAt/lastViewedAt.
// Their ids are reserved.

const SYSTEM_COLLECTION_COVER_LIMIT = 4;

type SystemCollectionMeta = { id: string; name: string; field: "favoritedAt" | "lastViewedAt" };

export const SYSTEM_COLLECTIONS: Record<SystemCollectionKey, SystemCollectionMeta> = {
  favorites: { id: "favorites", name: "Favourites", field: "favoritedAt" },
  history: { id: "history", name: "Browsing History", field: "lastViewedAt" },
};

const SYSTEM_COLLECTION_IDS = new Map<string, SystemCollectionKey>(
  (Object.keys(SYSTEM_COLLECTIONS) as SystemCollectionKey[]).map((key) => [SYSTEM_COLLECTIONS[key].id, key]),
);

export function systemCollectionKeyForId(id: string): SystemCollectionKey | null {
  return SYSTEM_COLLECTION_IDS.get(id) ?? null;
}

export function isSystemCollectionId(id: string): boolean {
  return SYSTEM_COLLECTION_IDS.has(id);
}

function systemCollectionWhere(userId: string, field: "favoritedAt" | "lastViewedAt"): Prisma.PrintWhereInput {
  return field === "favoritedAt" ? { userId, favoritedAt: { not: null } } : { userId, lastViewedAt: { not: null } };
}

function systemCollectionOrderBy(field: "favoritedAt" | "lastViewedAt"): Prisma.PrintOrderByWithRelationInput {
  return field === "favoritedAt" ? { favoritedAt: "desc" } : { lastViewedAt: "desc" };
}

export async function loadSystemCollectionOut(userId: string, key: SystemCollectionKey): Promise<CollectionOut> {
  const meta = SYSTEM_COLLECTIONS[key];
  const where = systemCollectionWhere(userId, meta.field);
  const [itemCount, coverRows] = await Promise.all([
    prisma.print.count({ where }),
    prisma.print.findMany({
      where,
      orderBy: systemCollectionOrderBy(meta.field),
      take: SYSTEM_COLLECTION_COVER_LIMIT,
      select: { id: true },
    }),
  ]);
  const coverIds = coverRows.map((r) => r.id);
  const printOuts = await printOutsByIds(userId, coverIds);
  const coverPrints = coverIds.map((id) => printOuts.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  return toSystemCollectionOut(meta.id, key, meta.name, itemCount, coverPrints);
}

export async function listSystemCollectionOuts(userId: string): Promise<CollectionOut[]> {
  return Promise.all(
    (Object.keys(SYSTEM_COLLECTIONS) as SystemCollectionKey[]).map((key) => loadSystemCollectionOut(userId, key)),
  );
}

/** The user's own real collections with these ids, in the order given. A system or unknown id is an error, so a bulk
 *  action never quietly does less than asked. */
async function ownCollections(userId: string, ids: string[]): Promise<Collection[]> {
  if (ids.some(isSystemCollectionId)) throw new HttpError(400, "Built-in collections can't be merged or deleted");
  const unique = [...new Set(ids)];
  const rows = await prisma.collection.findMany({ where: { id: { in: unique }, userId } });
  if (rows.length !== unique.length) throw new HttpError(404, "Collection not found");
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.map((id) => byId.get(id)!);
}

/** How many models the merged collection would hold: every model in any of them, once. The same whichever one is
 *  kept, so the dialog can switch it without asking again. */
export async function previewCollectionMerge(userId: string, ids: string[]): Promise<{ models: number }> {
  const collections = await ownCollections(userId, ids);
  const rows = await prisma.collectionItem.findMany({
    where: { collectionId: { in: collections.map((c) => c.id) } },
    distinct: ["printId"],
    select: { printId: true },
  });
  return { models: rows.length };
}

/** Moves the others' models into `primaryId` after its own, in the others' order, then deletes the others with their
 *  syncs. The kept one keeps its name, description, tags and sync, and takes over a bookmark if it had none. */
export async function mergeCollections(
  userId: string,
  primaryId: string,
  ids: string[],
): Promise<{ primary: Collection; merged: Collection[]; added: number }> {
  const [primary, ...merged] = await ownCollections(userId, [primaryId, ...ids]);
  if (!merged.length) throw new HttpError(400, "Pick at least one other collection to merge");
  const mergedIds = merged.map((c) => c.id);
  const order = new Map(mergedIds.map((id, index) => [id, index]));
  const items = (
    await prisma.collectionItem.findMany({
      where: { collectionId: { in: mergedIds } },
      orderBy: { position: "asc" },
      select: { collectionId: true, printId: true },
    })
  ).toSorted((a, b) => order.get(a.collectionId)! - order.get(b.collectionId)!);
  const printIds = [...new Set(items.map((item) => item.printId))];

  const added = await prisma.$transaction(async (tx) => {
    const last = await tx.collectionItem.findFirst({
      where: { collectionId: primary.id },
      orderBy: { position: "desc" },
    });
    let position = (last?.position ?? -1) + 1;
    const { count } = await tx.collectionItem.createMany({
      data: printIds.map((printId) => ({ collectionId: primary.id, printId, position: position++ })),
      skipDuplicates: true,
    });
    await moveCollectionBookmark(userId, mergedIds, primary.id, tx);
    await tx.collection.deleteMany({ where: { id: { in: mergedIds } } });
    return count;
  });
  await relocatePrintsForToken("collection", printIds);
  return { primary, merged, added };
}

/** Deletes them together, so a model in several is moved on disk once. Their models stay. */
export async function deleteCollections(userId: string, ids: string[]): Promise<Collection[]> {
  const collections = await ownCollections(userId, ids);
  const collectionIds = collections.map((c) => c.id);
  const items = await prisma.collectionItem.findMany({
    where: { collectionId: { in: collectionIds } },
    distinct: ["printId"],
    select: { printId: true },
  });
  await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
  await relocatePrintsForToken(
    "collection",
    items.map((item) => item.printId),
  );
  return collections;
}
