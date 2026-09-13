import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { validateParentCategory } from "../services/categoryService";
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
    const [parentId] = parentIds;
    const siblings = await prisma.category.findMany({ where: { userId: req.userId, parentId } });
    if (siblings.length !== body.category_ids.length) {
      throw new HttpError(400, "category_ids must contain exactly this category's current siblings");
    }
    await prisma.$transaction(
      body.category_ids.map((id, idx) => prisma.category.update({ where: { id }, data: { position: idx } })),
    );
    res.json({ ok: true });
  }),
);

router.post(
  "/categories",
  asyncHandler(async (req, res) => {
    const body = parseBody(categorySchema, req.body);
    const parentId = await validateParentCategory(req.userId!, body.parent_id ?? null);
    const category = await prisma.category.create({
      data: { userId: req.userId!, name: body.name, tags: normalizeTags(body.tags), parentId },
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
    await reorganizeManagedPrints(undefined, req.userId);
    res.json(toCategoryOut(updated));
  }),
);

const MAX_CAT_IDS = 50;

/** Parses the category manager's "800;71;1001"-style text field into the int array actually
 * stored on Category.*CatIds -- a category can list several ids per site (e.g. a parent category
 * plus a couple of its subcategories), matched by overlap at import time (see importService.ts's
 * resolveCategoryIdByCategory). Blank/whitespace-only input clears the field. Stray/duplicate
 * separators are tolerated (e.g. "800;;71;" or "800;800;71") since that's an easy typo to make
 * in a free-text field and there's nothing genuinely ambiguous about it; anything that isn't a
 * positive whole number is rejected with a message naming the exact bad token, so a typo doesn't
 * silently vanish instead of erroring. */
function parseCatIdsInput(raw: string | null | undefined): number[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  const tokens = trimmed.split(";").map((t) => t.trim()).filter(Boolean);
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

    await prisma.category.updateMany({
      where: { parentId: category.id, userId: req.userId },
      data: { parentId: null },
    });

    const prints = await prisma.print.findMany({ where: { categoryId: category.id, userId: req.userId } });
    for (const print of prints) {
      const nextName = await availableModelName(req.userId!, print.name, null, print.id);
      const data: Prisma.PrintUpdateInput = { category: { disconnect: true } };
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
