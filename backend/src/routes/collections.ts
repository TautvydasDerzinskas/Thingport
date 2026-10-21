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
import { toCollectionOut, type PrintOut } from "../dto";

const router = Router();
router.use(requireAuth);

const collectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string()).default([]),
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

router.get(
  "/collections",
  asyncHandler(async (req, res) => {
    const [systemCollections, collections, bookmarkedIds] = await Promise.all([
      listSystemCollectionOuts(req.userId!),
      prisma.collection.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { items: true } },
          items: { orderBy: { position: "asc" }, take: COVER_ITEM_LIMIT },
          sync: true,
        },
      }),
      listBookmarkedCollectionIdSet(req.userId!),
    ]);
    const coverPrintIds = collections.flatMap((c) => c.items.map((i) => i.printId));
    const printOuts = await printOutsByIds(req.userId!, coverPrintIds);
    res.json([
      ...systemCollections,
      ...collections.map((c) =>
        toCollectionOut(
          c,
          c._count.items,
          c.items.map((i) => printOuts.get(i.printId)).filter((p): p is PrintOut => Boolean(p)),
          bookmarkedIds.has(c.id),
          c.sync,
        ),
      ),
    ]);
  }),
);

router.post(
  "/collections",
  asyncHandler(async (req, res) => {
    const body = parseBody(collectionSchema, req.body);
    const collection = await createCollection(req.userId!, body);
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
    const [itemCount, covers, bookmarked, sync] = await Promise.all([
      prisma.collectionItem.count({ where: { collectionId: primary.id } }),
      coverPrints(req.userId!, primary.id),
      prisma.bookmark.findFirst({ where: { userId: req.userId, type: "COLLECTION", collectionId: primary.id } }),
      prisma.collectionSync.findUnique({ where: { collectionId: primary.id } }),
    ]);
    res.json({
      collection: toCollectionOut(primary, itemCount, covers, Boolean(bookmarked), sync),
      merged_ids: merged.map((c) => c.id),
      added,
    });
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
      include: { _count: { select: { items: true } }, sync: true },
    });
    if (!collection) throw new HttpError(404, "Collection not found");
    const bookmarked = Boolean(
      await prisma.bookmark.findFirst({
        where: { userId: req.userId, type: "COLLECTION", collectionId: collection.id },
      }),
    );
    res.json(
      toCollectionOut(
        collection,
        collection._count.items,
        await coverPrints(req.userId!, collection.id),
        bookmarked,
        collection.sync,
      ),
    );
  }),
);

router.patch(
  "/collection/:id",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be edited");
    }
    const body = parseBody(collectionSchema, req.body);
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    await assertCollectionNameAvailable(req.userId!, body.name, collection.id);
    const renamed = body.name !== collection.name;
    const updated = await prisma.collection.update({
      where: { id: collection.id },
      data: {
        name: body.name,
        nameNormalized: normalizeCollectionName(body.name),
        description: body.description?.trim() || null,
        tags: normalizeTags(body.tags),
      },
    });
    if (renamed) await relocatePrintsForToken("collection", await collectionPrintIds(updated.id));
    const [itemCount, covers, bookmarked, sync] = await Promise.all([
      prisma.collectionItem.count({ where: { collectionId: updated.id } }),
      coverPrints(req.userId!, updated.id),
      prisma.bookmark.findFirst({ where: { userId: req.userId, type: "COLLECTION", collectionId: updated.id } }),
      prisma.collectionSync.findUnique({ where: { collectionId: updated.id } }),
    ]);
    res.json(toCollectionOut(updated, itemCount, covers, Boolean(bookmarked), sync));
    void createLog({
      userId: req.userId!,
      action: "collection_edited",
      targetId: updated.id,
      details: { name: updated.name },
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
    await prisma.collection.delete({ where: { id: collection.id } });
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
    const print = await prisma.print.findFirst({ where: { id: req.params.printId, userId: req.userId } });
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
    const print = await prisma.print.findFirst({ where: { id: req.params.printId, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await addPrintsToCollection(collection.id, [print.id]);
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "collection_item_added",
      targetId: collection.id,
      details: { printId: print.id, name: print.name },
    });
  }),
);

const addItemsSchema = z.object({ print_ids: z.array(z.string()).max(10_000) });

// Many at once, e.g. Thingport Grab filing a provider collection's already-imported models.
router.post(
  "/collection/:id/items",
  asyncHandler(async (req, res) => {
    const body = parseBody(addItemsSchema, req.body);
    await addModelsToCollection(req.userId!, req.params.id, body.print_ids);
    res.json({ ok: true });
  }),
);

// Many at once, from a grid's multi-select. The prints themselves are untouched.
router.delete(
  "/collection/:id/items",
  asyncHandler(async (req, res) => {
    if (isSystemCollectionId(req.params.id)) {
      throw new HttpError(400, "This collection can't be edited");
    }
    const body = parseBody(addItemsSchema, req.body);
    const collection = await prisma.collection.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
    const prints = await prisma.print.findMany({
      where: { id: { in: body.print_ids }, userId: req.userId },
      select: { id: true },
    });
    const printIds = prints.map((p) => p.id);
    const { count } = await prisma.collectionItem.deleteMany({
      where: { collectionId: collection.id, printId: { in: printIds } },
    });
    await relocatePrintsForToken("collection", printIds);
    res.json({ removed: count });
    if (count) {
      void createLog({
        userId: req.userId!,
        action: "collection_item_removed",
        targetId: collection.id,
        details: { name: collection.name, count },
      });
    }
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

// Real collections only, flagged with whether `printId` is a member.
router.get(
  "/print/:id/collections",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const collections = await prisma.collection.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      include: { items: { where: { printId: print.id }, select: { id: true } } },
    });
    res.json(collections.map((c) => ({ id: c.id, name: c.name, in_collection: c.items.length > 0 })));
  }),
);

export default router;
