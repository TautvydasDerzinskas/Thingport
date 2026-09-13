import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  addPrintsToCollection,
  assertCollectionNameAvailable,
  isSystemCollectionId,
  listSystemCollectionOuts,
  loadSystemCollectionOut,
  normalizeCollectionName,
  systemCollectionKeyForId,
} from "../services/collectionService";
import { printOutsByIds } from "../services/printLoader";
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

router.get(
  "/collections",
  asyncHandler(async (req, res) => {
    const [systemCollections, collections] = await Promise.all([
      listSystemCollectionOuts(req.userId!),
      prisma.collection.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { items: true } },
          items: { orderBy: { position: "asc" }, take: COVER_ITEM_LIMIT },
        },
      }),
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
        ),
      ),
    ]);
  }),
);

router.post(
  "/collections",
  asyncHandler(async (req, res) => {
    const body = parseBody(collectionSchema, req.body);
    await assertCollectionNameAvailable(req.userId!, body.name);
    const collection = await prisma.collection.create({
      data: {
        userId: req.userId!,
        name: body.name,
        nameNormalized: normalizeCollectionName(body.name),
        description: body.description?.trim() || null,
        tags: normalizeTags(body.tags),
      },
    });
    res.json(toCollectionOut(collection, 0, []));
    void createLog({
      userId: req.userId!,
      action: "collection_created",
      targetId: collection.id,
      details: { name: collection.name },
    });
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
      include: { _count: { select: { items: true } } },
    });
    if (!collection) throw new HttpError(404, "Collection not found");
    res.json(toCollectionOut(collection, collection._count.items, []));
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
    const updated = await prisma.collection.update({
      where: { id: collection.id },
      data: {
        name: body.name,
        nameNormalized: normalizeCollectionName(body.name),
        description: body.description?.trim() || null,
        tags: normalizeTags(body.tags),
      },
    });
    const itemCount = await prisma.collectionItem.count({ where: { collectionId: updated.id } });
    res.json(toCollectionOut(updated, itemCount, []));
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
    await prisma.collection.delete({ where: { id: collection.id } });
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "collection_deleted",
      targetId: collection.id,
      details: { name: collection.name },
    });
  }),
);

// Drops one print's membership -- the print itself, and every other collection it's in, are
// untouched. Only meaningful for a real collection: the built-in Favourites/Browsing History
// pseudo-collections have no CollectionItem rows to remove (their membership is Print.favoritedAt
// / Print.lastViewedAt) -- the frontend routes "remove" there through unfavorite instead.
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
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "collection_item_removed",
      targetId: collection.id,
      details: { printId: print.id, name: print.name },
    });
  }),
);

// The reverse of the DELETE above -- adds one print to a real collection. Same system-collection
// restriction: Favourites/Browsing History membership comes from Print.favoritedAt/lastViewedAt,
// not CollectionItem rows, so the frontend never offers this for them.
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

// Every real (non-system) collection this user owns, flagged with whether `printId` is currently
// a member -- backs the "Add to collection" picker opened from ModelActionsMenu. System
// pseudo-collections are omitted since they can't be toggled this way (see the POST/DELETE above).
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
