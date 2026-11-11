import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  addModelsToCollection,
  removeModelsFromCollection,
  addPrintsToCollection,
  createCollection,
  assertCollectionNameAvailable,
  deleteCollections,
  isSystemCollectionId,
  listSystemCollectionOuts,
  loadSystemCollectionOut,
  mergeCollections,
  normalizeCollectionName,
  previewCollectionMerge,
  systemCollectionKeyForId,
} from "../services/collectionService";
import {
  addCollectionBookmark,
  listBookmarkedCollectionIdSet,
  removeCollectionBookmark,
} from "../services/bookmarkService";
import { printOutsByIds } from "../services/printLoader";
import { relocatePrintsForToken } from "../services/printService";
import { createLog } from "../services/auditLog";
import { toCollectionOut, visibilityOut, type PrintOut } from "../dto";
import { tellGained, visibilityAsked, withSharedWith } from "../services/collectionSharing";
import { kickSharing, queueCollectionsGone, queueSharing } from "../federation/sharedCollections";
import { syncToolModelsSoon } from "../services/toolsService";
import { collectionOutsFor, libraryCopyIds, readableCollection, readablePrintWhere } from "../services/socialService";
import { copyPrintToLibrary } from "../services/modelCopyService";

const router = Router();

// A collection's sources, in the order they were linked.
const SYNCS_OLDEST_FIRST = { orderBy: { createdAt: "asc" as const } };
router.use(requireAuth);

const collectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string()).default([]),
  // Who besides its owner sees it: nobody, the people it's shared with (changed at /collections/:id/sharing), or
  // everyone. Left as it is when not sent. Kept while social features are off, and only shown to others while they're
  // on. `is_public` is how older clients ask; `visibility` wins when both are sent.
  visibility: z.enum(["private", "shared", "public"]).optional(),
  is_public: z.boolean().optional(),
});

const COVER_ITEM_LIMIT = 4;

/** The collection's first few models, as its card shows them. */
async function coverPrints(userId: string, collectionId: string): Promise<PrintOut[]> {
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { position: "asc" },
    take: COVER_ITEM_LIMIT,
    select: { printId: true },
  });
  const printOuts = await printOutsByIds(
    userId,
    items.map((i) => i.printId),
  );
  return items.map((i) => printOuts.get(i.printId)).filter((p): p is PrintOut => Boolean(p));
}

async function collectionPrintIds(collectionId: string): Promise<string[]> {
  const items = await prisma.collectionItem.findMany({ where: { collectionId }, select: { printId: true } });
  return items.map((item) => item.printId);
}

/** The user's own model for `printId`: it, or for another user's shared model (services/socialService.ts) the user's
 *  copy of it, which `copy` makes when there's none yet. Null when there's no such model, or no copy and no `copy`.
 *  What lets "Add to collection" work on a model that isn't the user's: it files their copy. */
async function ownModelFor(userId: string, printId: string, copy: boolean): Promise<string | null> {
  const own = await prisma.print.findFirst({ where: { id: printId, userId }, select: { id: true } });
  if (own) return own.id;
  const shared = await prisma.print.findFirst({
    where: { id: printId, AND: [await readablePrintWhere(userId)] },
    select: { id: true, originalId: true, sourceProvider: true, sourceExternalId: true },
  });
  if (!shared) return null;
  if (copy) return (await copyPrintToLibrary(userId, shared.id)).print.id;
  return (await libraryCopyIds(userId, [shared])).get(shared.id) ?? null;
}

/** ownModelFor for each, leaving out those with none. In order, as each copy is made one at a time. */
async function ownModelsFor(userId: string, printIds: string[], copy: boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const printId of new Set(printIds)) {
    const own = await ownModelFor(userId, printId, copy);
    if (own) out.set(printId, own);
  }
  return out;
}

router.get(
  "/collections",
  asyncHandler(async (req, res) => {
    // A tool installed since, or tools allowed since: their collections come along for next time.
    syncToolModelsSoon({ id: req.userId!, role: req.userRole! });
    const [systemCollections, collections, bookmarkedIds] = await Promise.all([
      listSystemCollectionOuts(req.userId!),
      prisma.collection.findMany({
        where: { userId: req.userId },
        // Tools' collections last, after the user's own.
        orderBy: [{ toolId: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
        include: {
          _count: { select: { items: true } },
          items: { orderBy: { position: "asc" }, take: COVER_ITEM_LIMIT },
          syncs: SYNCS_OLDEST_FIRST,
        },
      }),
      listBookmarkedCollectionIdSet(req.userId!),
    ]);
    const coverPrintIds = collections.flatMap((c) => c.items.map((i) => i.printId));
    const printOuts = await printOutsByIds(req.userId!, coverPrintIds);
    res.json([
      ...systemCollections,
      ...(await withSharedWith(
        req.userId!,
        collections.map((c) =>
          toCollectionOut(
            c,
            c._count.items,
            c.items.map((i) => printOuts.get(i.printId)).filter((p): p is PrintOut => Boolean(p)),
            bookmarkedIds.has(c.id),
            c.syncs,
          ),
        ),
      )),
    ]);
  }),
);

router.post(
  "/collections",
  asyncHandler(async (req, res) => {
    const body = parseBody(collectionSchema, req.body);
    const collection = await createCollection(req.userId!, { ...body, visibility: visibilityAsked(body, "PRIVATE") });
    res.json(toCollectionOut(collection, 0, [], false));
  }),
);

const idsSchema = z.object({ ids: z.array(z.string()).min(1).max(1000) });
const mergeSchema = z.object({ primary_id: z.string(), ids: z.array(z.string()).min(1).max(1000) });

router.post(
  "/collections/merge/preview",
  asyncHandler(async (req, res) => {
    const body = parseBody(idsSchema, req.body);
    res.json(await previewCollectionMerge(req.userId!, body.ids));
  }),
);

// `ids` are merged into `primary_id` and deleted; it may list `primary_id` too.
router.post(
  "/collections/merge",
  asyncHandler(async (req, res) => {
    const body = parseBody(mergeSchema, req.body);
    const { primary, merged, added } = await mergeCollections(req.userId!, body.primary_id, body.ids);
    const [itemCount, covers, bookmarked, syncs] = await Promise.all([
      prisma.collectionItem.count({ where: { collectionId: primary.id } }),
      coverPrints(req.userId!, primary.id),
      prisma.bookmark.findFirst({ where: { userId: req.userId, type: "COLLECTION", collectionId: primary.id } }),
      prisma.collectionSync.findMany({ where: { collectionId: primary.id }, ...SYNCS_OLDEST_FIRST }),
    ]);
    const [collection] = await withSharedWith(req.userId!, [
      toCollectionOut(primary, itemCount, covers, Boolean(bookmarked), syncs),
    ]);
    res.json({ collection, merged_ids: merged.map((c) => c.id), added });
    void createLog({
      userId: req.userId!,
      action: "collections_merged",
      targetId: primary.id,
      details: { name: primary.name, merged: merged.map((c) => c.name), added },
    });
  }),
);

router.post(
  "/collections/delete",
  asyncHandler(async (req, res) => {
    const body = parseBody(idsSchema, req.body);
    const deleted = await deleteCollections(req.userId!, body.ids);
    res.json({ deleted: deleted.map((c) => c.id) });
    for (const collection of deleted) {
      void createLog({
        userId: req.userId!,
        action: "collection_deleted",
        targetId: collection.id,
        details: { name: collection.name },
      });
    }
  }),
);

router.get(
  "/collection/:id",
  asyncHandler(async (req, res) => {
    const systemKey = systemCollectionKeyForId(req.params.id);
    if (systemKey) {
      res.json(await loadSystemCollectionOut(req.userId!, systemKey));
      return;
    }
    const collection = await prisma.collection.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { _count: { select: { items: true } }, syncs: SYNCS_OLDEST_FIRST },
    });
    if (!collection) {
      // Another user's public one, or one shared with the viewer, while social features are on.
      const shared = await readableCollection(req.userId!, req.params.id);
      if (!shared) throw new HttpError(404, "Collection not found");
      res.json((await collectionOutsFor(req.userId!, [shared]))[0]);
      return;
    }
    const bookmarked = Boolean(
      await prisma.bookmark.findFirst({
        where: { userId: req.userId, type: "COLLECTION", collectionId: collection.id },
      }),
    );
    const [out] = await withSharedWith(req.userId!, [
      toCollectionOut(
        collection,
        collection._count.items,
        await coverPrints(req.userId!, collection.id),
        bookmarked,
        collection.syncs,
      ),
    ]);
    res.json(out);
  }),
);

router.patch(
  "/collection/:id",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be edited");
    }
    const body = parseBody(collectionSchema, req.body);
    await assertCollectionNameAvailable(req.userId!, body.name, req.params.id);
    // Visibility is written only when it's asked for, so a save of the name alone can't put back what was read over a
    // change made meanwhile; and what it's compared with is read under the lock /sharing changes it under.
    const asked = body.visibility !== undefined || body.is_public !== undefined;
    const { collection, updated } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${req.params.id} FOR UPDATE`;
      const found = await tx.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!found) throw new HttpError(404, "Collection not found");
      // A tool's, whatever way the request came: the tool keeps it as it brought it.
      if (found.toolId) {
        throw new HttpError(403, `"${found.name}" belongs to a tool and can't be changed`, "TOOL_OWNED");
      }
      const saved = await tx.collection.update({
        where: { id: found.id },
        data: {
          name: body.name,
          nameNormalized: normalizeCollectionName(body.name),
          description: body.description?.trim() || null,
          tags: normalizeTags(body.tags),
          ...(asked ? { visibility: visibilityAsked(body, found.visibility) } : {}),
        },
      });
      // Partners with people on its list hear of a new name or visibility now, not at their next read: queued with
      // the change, sent once it's kept.
      if (saved.visibility !== found.visibility || saved.name !== found.name) await queueSharing(tx, saved.id);
      // Whoever can see it now and couldn't is told with the change (nobody while social features are off).
      if (saved.visibility !== found.visibility) await tellGained(tx, found, saved);
      return { collection: found, updated: saved };
    });
    kickSharing();
    const renamed = body.name !== collection.name;
    if (renamed) await relocatePrintsForToken("collection", await collectionPrintIds(updated.id));
    const [itemCount, covers, bookmarked, syncs] = await Promise.all([
      prisma.collectionItem.count({ where: { collectionId: updated.id } }),
      coverPrints(req.userId!, updated.id),
      prisma.bookmark.findFirst({ where: { userId: req.userId, type: "COLLECTION", collectionId: updated.id } }),
      prisma.collectionSync.findMany({ where: { collectionId: updated.id }, ...SYNCS_OLDEST_FIRST }),
    ]);
    const [out] = await withSharedWith(req.userId!, [
      toCollectionOut(updated, itemCount, covers, Boolean(bookmarked), syncs),
    ]);
    res.json(out);
    void createLog({
      userId: req.userId!,
      action: "collection_edited",
      targetId: updated.id,
      details: {
        name: updated.name,
        ...(updated.visibility !== collection.visibility ? { visibility: visibilityOut(updated.visibility) } : {}),
      },
    });
  }),
);

router.delete(
  "/collection/:id",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be deleted");
    }
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    const printIds = await collectionPrintIds(collection.id);
    await prisma.$transaction(async (tx) => {
      await queueCollectionsGone(tx, [collection.id]);
      await tx.collection.delete({ where: { id: collection.id } });
    });
    kickSharing();
    await relocatePrintsForToken("collection", printIds);
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "collection_deleted",
      targetId: collection.id,
      details: { name: collection.name },
    });
  }),
);

// Real collections only: Favourites/History membership comes from Print columns.
router.delete(
  "/collection/:id/items/:printId",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be edited");
    }
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    const ownId = await ownModelFor(req.userId!, req.params.printId, false);
    const print = ownId && (await prisma.print.findFirst({ where: { id: ownId, userId: req.userId } }));
    if (!print) throw new HttpError(404, "Print not found");
    await prisma.collectionItem.deleteMany({ where: { collectionId: collection.id, printId: print.id } });
    await relocatePrintsForToken("collection", [print.id]);
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "collection_item_removed",
      targetId: collection.id,
      details: { printId: print.id, name: print.name },
    });
  }),
);

router.post(
  "/collection/:id/items/:printId",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be edited");
    }
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    const ownId = await ownModelFor(req.userId!, req.params.printId, true);
    const print = ownId && (await prisma.print.findFirst({ where: { id: ownId, userId: req.userId } }));
    if (!print) throw new HttpError(404, "Print not found");
    await addPrintsToCollection(collection.id, [print.id]);
    // Where another user's model was given, the copy filed in its place.
    res.json({ ok: true, print_id: print.id });
    void createLog({
      userId: req.userId!,
      action: "collection_item_added",
      targetId: collection.id,
      details: { printId: print.id, name: print.name },
    });
  }),
);

const addItemsSchema = z.object({ print_ids: z.array(z.string()).max(10_000) });

// Many at once, e.g. Thingport Grab filing a provider collection's already-imported models. Another user's shared
// models among them are copied first, as for one.
router.post(
  "/collection/:id/items",
  asyncHandler(async (req, res) => {
    const body = parseBody(addItemsSchema, req.body);
    // Refused before anything is copied, rather than after: a copy made for nowhere would stay in the library.
    if (isSystemCollectionId(req.params.id)) throw new HttpError(400, "This collection can't be edited");
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    const own = await ownModelsFor(req.userId!, body.print_ids, true);
    const { notFound } = await addModelsToCollection(req.userId!, collection.id, [...own.values()]);
    // The ones that couldn't be filed, as they were asked for: gone, or another user's no longer shared.
    const missed = new Set(notFound);
    const notFiled = [...new Set(body.print_ids)].filter((id) => {
      const mine = own.get(id);
      return !mine || missed.has(mine);
    });
    res.json({ ok: true, not_found: notFiled });
  }),
);

// Many at once, from a grid's multi-select. The prints themselves are untouched.
router.delete(
  "/collection/:id/items",
  asyncHandler(async (req, res) => {
    const body = parseBody(addItemsSchema, req.body);
    const own = await ownModelsFor(req.userId!, body.print_ids, false);
    const { removed } = await removeModelsFromCollection(req.userId!, req.params.id, [...own.values()]);
    res.json({ removed: removed.length });
  }),
);

router.post(
  "/collection/:id/bookmark",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be bookmarked");
    }
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    await addCollectionBookmark(req.userId!, collection.id);
    res.json({ ok: true });
  }),
);

router.delete(
  "/collection/:id/bookmark",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be bookmarked");
    }
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    await removeCollectionBookmark(req.userId!, collection.id);
    res.json({ ok: true });
  }),
);

// Real collections only, flagged with whether `printId` is a member. For another user's shared model, whether the
// user's copy of it is.
router.get(
  "/print/:id/collections",
  asyncHandler(async (req, res) => {
    const readable = await prisma.print.findFirst({
      where: { id: req.params.id, AND: [await readablePrintWhere(req.userId!)] },
      select: { id: true },
    });
    if (!readable) throw new HttpError(404, "Print not found");
    // No copy yet: in none of them.
    const ownId = (await ownModelFor(req.userId!, readable.id, false)) ?? "";
    // Not a tool's: nothing can be put in or taken out of one.
    const collections = await prisma.collection.findMany({
      where: { userId: req.userId, toolId: null },
      orderBy: { createdAt: "desc" },
      include: { items: { where: { printId: ownId }, select: { id: true } } },
    });
    res.json(collections.map((c) => ({ id: c.id, name: c.name, in_collection: c.items.length > 0 })));
  }),
);

// The same for a grid's multi-select: how many of the models each real collection holds.
const membershipSchema = z.object({ print_ids: z.array(z.string()).min(1).max(500) });
router.post(
  "/prints/collections",
  asyncHandler(async (req, res) => {
    const body = parseBody(membershipSchema, req.body);
    const own = await ownModelsFor(req.userId!, body.print_ids, false);
    const [collections, items] = await Promise.all([
      prisma.collection.findMany({
        where: { userId: req.userId, toolId: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      }),
      prisma.collectionItem.findMany({
        where: { printId: { in: [...own.values()] }, print: { userId: req.userId } },
        select: { collectionId: true },
      }),
    ]);
    const countOf = new Map<string, number>();
    for (const item of items) countOf.set(item.collectionId, (countOf.get(item.collectionId) ?? 0) + 1);
    res.json(collections.map((c) => ({ id: c.id, name: c.name, count: countOf.get(c.id) ?? 0 })));
  }),
);

export default router;
