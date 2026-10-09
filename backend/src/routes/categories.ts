import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { CATEGORY_KINDS, kindUnder, setSubtreeKind, validateParentCategory } from "../services/categoryService";
import { availableModelName, reorganizeManagedPrints } from "../services/printService";
import { toCategoryOut } from "../dto";
import { sendPrintsZip } from "../services/downloadZip";
import type { Prisma } from "@prisma/client";

const router = Router();
router.use(requireAuth);

const categorySchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
  parent_id: z.string().nullable().optional(),
  // Only for a top-level category; a subcategory always takes its parent's kind.
  kind: z.enum(CATEGORY_KINDS).optional(),
});

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { userId: req.userId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    res.json(categories.map(toCategoryOut));
  }),
);

const reorderSchema = z.object({ category_ids: z.array(z.string()).min(1) });

router.post(
  "/categories/reorder",
  asyncHandler(async (req, res) => {
    const body = parseBody(reorderSchema, req.body);
    const categories = await prisma.category.findMany({
      where: { id: { in: body.category_ids }, userId: req.userId },
    });
    if (categories.length !== body.category_ids.length) {
      throw new HttpError(400, "category_ids must reference existing categories");
    }
    const parentIds = new Set(categories.map((f) => f.parentId ?? null));
    if (parentIds.size > 1) {
      throw new HttpError(400, "category_ids must all share the same parent category");
    }
    const kinds = new Set(categories.map((f) => f.kind));
    if (kinds.size > 1) throw new HttpError(400, "category_ids must all be the same kind");
    const [parentId] = parentIds;
    const [kind] = kinds;
    // Categories and folders share the top level but are shown and ordered apart.
    const siblings = await prisma.category.findMany({ where: { userId: req.userId, parentId, kind } });
    if (siblings.length !== body.category_ids.length) {
      throw new HttpError(400, "category_ids must contain exactly this category's current siblings");
    }
    await prisma.$transaction(
      body.category_ids.map((id, idx) => prisma.category.update({ where: { id }, data: { position: idx } })),
    );
    res.json({ ok: true });
  }),
);

const moveSchema = z.object({
  parent_id: z.string().nullable(),
  // Index among the new siblings; past the end appends.
  position: z.number().int().min(0),
});

// Reparents and positions in one step, so dragging a subcategory into another category is one request.
router.post(
  "/category/:id/move",
  asyncHandler(async (req, res) => {
    const body = parseBody(moveSchema, req.body);
    const category = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!category) throw new HttpError(404, "Not found");
    const parentId = await validateParentCategory(req.userId!, body.parent_id, category.id);
    const siblingOrder: Prisma.CategoryOrderByWithRelationInput[] = [{ position: "asc" }, { name: "asc" }];
    const kind = await kindUnder(req.userId!, parentId, category.kind);

    const moved = await prisma.$transaction(async (tx) => {
      const renumber = async (ids: string[]) => {
        for (const [idx, id] of ids.entries()) {
          if (id !== category.id) await tx.category.update({ where: { id }, data: { position: idx } });
        }
      };

      if (category.parentId !== parentId) {
        // Close the gap left behind.
        const oldSiblings = await tx.category.findMany({
          where: { userId: req.userId, parentId: category.parentId, kind: category.kind, id: { not: category.id } },
          orderBy: siblingOrder,
          select: { id: true },
        });
        await renumber(oldSiblings.map((c) => c.id));
      }
      const siblings = await tx.category.findMany({
        where: { userId: req.userId, parentId, kind, id: { not: category.id } },
        orderBy: siblingOrder,
        select: { id: true },
      });
      const ids = siblings.map((c) => c.id);
      ids.splice(Math.min(body.position, ids.length), 0, category.id);
      await renumber(ids);
      return tx.category.update({
        where: { id: category.id },
        data: { parentId, position: ids.indexOf(category.id) },
      });
    });

    if (kind !== category.kind) await setSubtreeKind(req.userId!, category.id, kind);
    // Managed storage paths include the category path.
    if (category.parentId !== parentId) await reorganizeManagedPrints(undefined, req.userId);
    res.json(toCategoryOut({ ...moved, kind }));
  }),
);

router.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const body = parseBody(categorySchema, req.body);
    const parentId = await validateParentCategory(req.userId!, body.parent_id ?? null);
    const kind = await kindUnder(req.userId!, parentId, body.kind ?? "folder");
    const category = await prisma.category.create({
      data: { userId: req.userId!, name: body.name, tags: normalizeTags(body.tags), parentId, kind },
    });
    res.json(toCategoryOut(category));
  }),
);

router.patch(
  "/category/:id",
  asyncHandler(async (req, res) => {
    const body = parseBody(categorySchema, req.body);
    const category = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!category) throw new HttpError(404, "Not found");
    const parentId = await validateParentCategory(req.userId!, body.parent_id ?? null, category.id);
    const updated = await prisma.category.update({
      where: { id: category.id },
      data: { name: body.name, tags: normalizeTags(body.tags), parentId },
    });
    const kind = await kindUnder(req.userId!, parentId, category.kind);
    if (kind !== category.kind) await setSubtreeKind(req.userId!, category.id, kind);
    await reorganizeManagedPrints(undefined, req.userId);
    res.json(toCategoryOut(updated));
  }),
);

const MAX_CAT_IDS = 50;

/** Parses "800;71;1001" into ids. Blank clears; stray or duplicate separators are tolerated;
 * anything not a positive integer is rejected with a message naming it. */
function parseCatIdsInput(raw: string | null | undefined): number[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  const tokens = trimmed
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    if (!/^\d+$/.test(token) || token.length > 15) {
      throw new HttpError(400, `Invalid category id "${token}" -- use numbers separated by ";", e.g. 800;71;1001`);
    }
    const id = Number(token);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new HttpError(400, `Invalid category id "${token}" -- must be a positive whole number`);
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length > MAX_CAT_IDS) {
    throw new HttpError(400, `Too many category ids -- at most ${MAX_CAT_IDS} allowed`);
  }
  return ids;
}

const catIdsField = z.string().trim().max(1000).nullable().optional();
const categoryMetaSchema = z.object({
  meta_title: z.string().trim().max(200).nullable().optional(),
  meta_description: z.string().trim().max(2000).nullable().optional(),
  makerworld_cat_ids: catIdsField,
  thingiverse_cat_ids: catIdsField,
  printables_cat_ids: catIdsField,
});

router.patch(
  "/category/:id/meta",
  asyncHandler(async (req, res) => {
    const body = parseBody(categoryMetaSchema, req.body);
    const category = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!category) throw new HttpError(404, "Not found");
    const updated = await prisma.category.update({
      where: { id: category.id },
      data: {
        metaTitle: body.meta_title || null,
        metaDescription: body.meta_description || null,
        makerworldCatIds: parseCatIdsInput(body.makerworld_cat_ids),
        thingiverseCatIds: parseCatIdsInput(body.thingiverse_cat_ids),
        printablesCatIds: parseCatIdsInput(body.printables_cat_ids),
      },
    });
    res.json(toCategoryOut(updated));
  }),
);

router.delete(
  "/category/:id",
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!category) throw new HttpError(404, "Not found");

    // Subcategories move up one level, after the deleted category's former siblings.
    const children = await prisma.category.findMany({
      where: { parentId: category.id, userId: req.userId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    if (children.length) {
      const last = await prisma.category.findFirst({
        where: { userId: req.userId, parentId: category.parentId, id: { not: category.id } },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const start = (last?.position ?? -1) + 1;
      await prisma.$transaction(
        children.map((child, idx) =>
          prisma.category.update({
            where: { id: child.id },
            data: { parentId: category.parentId, position: start + idx },
          }),
        ),
      );
    }

    const prints = await prisma.print.findMany({ where: { categoryId: category.id, userId: req.userId } });
    for (const print of prints) {
      const nextName = await availableModelName(req.userId!, print.name, null, print.id);
      const data: Prisma.PrintUpdateInput = { category: { disconnect: true }, categorySource: null };
      if (nextName !== print.name) {
        data.name = nextName;
        data.nameNormalized = nextName.trim().toLowerCase();
        data.title = nextName;
      }
      await prisma.print.update({ where: { id: print.id }, data });
    }

    await prisma.category.delete({ where: { id: category.id } });
    await reorganizeManagedPrints(undefined, req.userId);
    res.json({ ok: true });
  }),
);

router.get(
  "/category/:id/download",
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!category) throw new HttpError(404, "Category not found");
    const prints = await prisma.print.findMany({
      where: { categoryId: category.id, userId: req.userId },
      include: { plates: { orderBy: { position: "asc" } }, category: true },
    });
    const downloadName = `${(category.name || "category").replace(/ /g, "_").slice(0, 50) || "category"}.zip`;
    await sendPrintsZip(res, prints, downloadName);
  }),
);

export default router;
