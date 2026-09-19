import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload } from "../uploadMiddleware";
import { createPrint, deletePlateFiles, resolvePlateFilePath, type NewPlateInput } from "../services/printCreation";
import { plateThumbPath, relocatePrint, uniqueModelName } from "../services/printService";
import { previewImagePath, deleteAllPreviewImages } from "../services/previewImageService";
import { deleteAuthorIfOrphaned, getLinkedAuthorIds } from "../services/authorService";
import { toPrintOut } from "../dto";
import { loadFullPrint, printOutById } from "../services/printLoader";
import { deleteAllPrintFiles, saveFileFromTemp } from "../services/printFileService";
import { RENDERABLE_MODEL_EXTS } from "../config";
import { estimateDownloadSize, resolvePrintsForDownload, sendPrintsZip } from "../services/downloadZip";
import { systemCollectionKeyForId } from "../services/collectionService";
import { createLog } from "../services/auditLog";
import type { Prisma } from "@prisma/client";

const router = Router();
router.use(requireAuth);

// Sentinel `author_id` value the "My models" author page sends to mean "prints with no real
// author at all" (see buildPrintWhere below) -- never a value a real Author id could take.
const SELF_AUTHOR_ID = "self";

// Tag matching is case-insensitive (a print tagged "Fun" should still show up under "fun"), which
// Postgres array containment (`hasEvery`/`hasSome`) doesn't support natively -- so tags are left
// out of the DB where clause and matched in JS instead, via matchesTagList below. Every route that
// filters by tags already fetches full print rows before paginating in application code (see GET
// /prints), so this costs nothing extra.
function parseTagList(req: Request): string[] {
  const tagsParam = typeof req.query.tags === "string" ? req.query.tags : "";
  return tagsParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function matchesTagList(printTags: string[], tagList: string[]): boolean {
  if (!tagList.length) return true;
  const printTagsLower = new Set(printTags.map((t) => t.toLowerCase()));
  return tagList.every((t) => printTagsLower.has(t.toLowerCase()));
}

function isRenderableUpload(f: Express.Multer.File): boolean {
  return RENDERABLE_MODEL_EXTS.has(path.extname(f.originalname).toLowerCase());
}

async function buildPrintWhere(req: Request): Promise<Prisma.PrintWhereInput> {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const categoryIdParam = typeof req.query.category_id === "string" ? req.query.category_id : "";
  const categoryIds = categoryIdParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const collectionId = typeof req.query.collection_id === "string" ? req.query.collection_id.trim() : "";
  const authorId = typeof req.query.author_id === "string" ? req.query.author_id.trim() : "";

  const where: Prisma.PrintWhereInput = { userId: req.userId };
  // Composed as top-level AND clauses (rather than each assigning `where.OR` directly) since the
  // self-author case and the `q` search below each need their own OR group -- the second one
  // would otherwise silently clobber the first.
  const andClauses: Prisma.PrintWhereInput[] = [];
  if (categoryIds.length === 1) where.categoryId = categoryIds[0];
  else if (categoryIds.length > 1) where.categoryId = { in: categoryIds };
  if (authorId === SELF_AUTHOR_ID) {
    // The "My models" author page (see AuthorPage's self mode): "no real author at all" (no
    // Author row, no plain creator string, not resolved from a known import source -- exactly
    // what ModelCard/ModelSidePanel's showViewerAsAuthor fallback covers) OR one of the Author
    // rows this user has explicitly linked as themselves (the Author page's "It's me!" button --
    // see authorService.ts's getLinkedAuthorIds/linkAuthorToUser).
    const linkedAuthorIds = await getLinkedAuthorIds(req.userId!);
    andClauses.push({
      OR: [
        { authorId: null, creator: null, sourceProvider: null },
        ...(linkedAuthorIds.length ? [{ authorId: { in: linkedAuthorIds } }] : []),
      ],
    });
  } else if (authorId) {
    where.authorId = authorId;
  }
  if (collectionId) {
    const systemKey = systemCollectionKeyForId(collectionId);
    if (systemKey === "favorites") where.favoritedAt = { not: null };
    else if (systemKey === "history") where.lastViewedAt = { not: null };
    else where.collectionItems = { some: { collectionId } };
  }
  if (q) {
    andClauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { creator: { contains: q, mode: "insensitive" } },
        { collection: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (andClauses.length) where.AND = andClauses;
  return where;
}

// ---- POST /upload ---------------------------------------------------------------------------

router.post(
  "/upload",
  modelUpload.array("files"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const body = req.body as Record<string, string | undefined>;
    try {
      if (!files.length) throw new HttpError(400, "No files uploaded");
      const mode = body.mode === "multiplate" ? "multiplate" : "separate";
      if (files.length > 1 && body.mode !== "separate" && body.mode !== "multiplate") {
        throw new HttpError(400, "mode is required when uploading more than one file");
      }
      const tags = (body.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const meta = {
        title: body.title || null,
        notes: body.notes || null,
        tags,
        categoryId: body.category_id || null,
      };

      const printsOut = [];
      if (files.length === 1 || mode === "separate") {
        for (const file of files) {
          const safeName = sanitizeFilename(file.originalname);
          const mime = mimeFromContentType(file.mimetype, safeName);
          const { print, plates } = await createPrint(req.userId!, meta, path.parse(safeName).name, [
            { filename: safeName, mime, tempFilePath: file.path },
          ]);
          printsOut.push(toPrintOut(print, plates, [], null));
          void createLog({ userId: req.userId!, action: "model_uploaded", targetId: print.id, details: { name: print.name } });
        }
      } else {
        // Only files the 3D viewer can actually render become Plates -- anything else (e.g. a
        // bundled .f3d source) is attached as a SUPPORTING file below instead, so it doesn't show
        // up as an unviewable "plate" in the plate switcher. If nothing in the batch is
        // renderable, fall back to the old all-as-plates behavior so createPrint still gets at
        // least one plate.
        const renderableFiles = files.filter(isRenderableUpload);
        const supportingFiles = renderableFiles.length ? files.filter((f) => !isRenderableUpload(f)) : [];
        const plateFiles = renderableFiles.length ? renderableFiles : files;

        const plateInputs: NewPlateInput[] = plateFiles.map((f) => {
          const safeName = sanitizeFilename(f.originalname);
          return { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path };
        });
        const nameHint = path.parse(plateInputs[0].filename).name;
        const { print } = await createPrint(req.userId!, meta, nameHint, plateInputs);

        for (const f of supportingFiles) {
          await saveFileFromTemp(req.userId!, print.id, f.path, f.originalname, f.mimetype);
        }

        printsOut.push(await printOutById(req.userId!, print.id));
        void createLog({ userId: req.userId!, action: "model_uploaded", targetId: print.id, details: { name: print.name } });
      }
      res.json({ prints: printsOut });
    } finally {
      for (const f of files) {
        if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
      }
    }
  }),
);

// ---- GET /prints ------------------------------------------------------------------------------

type PrintSortMode = "newest" | "popular" | "downloads";

function parseSortMode(raw: unknown): PrintSortMode {
  if (raw === "popular" || raw === "downloads") return raw;
  return "newest";
}

router.get(
  "/prints",
  asyncHandler(async (req, res) => {
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    let limit: number | undefined;
    let offset: number | undefined;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (!Number.isFinite(limit) || limit < 1 || limit > 1000) throw new HttpError(400, "Invalid limit");
    }
    if (offsetRaw !== undefined) {
      offset = Number(offsetRaw);
      if (!Number.isFinite(offset) || offset < 0) throw new HttpError(400, "Invalid offset");
    }

    const where = await buildPrintWhere(req);
    const tagList = parseTagList(req);
    const allMatching = await prisma.print.findMany({
      where,
      include: {
        plates: { orderBy: { position: "asc" } },
        previewImages: { orderBy: { position: "asc" } },
        author: true,
      },
    });
    const prints = tagList.length ? allMatching.filter((p) => matchesTagList(p.tags, tagList)) : allMatching;
    const printIds = prints.map((p) => p.id);
    const files = printIds.length ? await prisma.printFile.findMany({ where: { printId: { in: printIds } } }) : [];
    const filesByPrint = new Map<string, typeof files>();
    for (const f of files) {
      const list = filesByPrint.get(f.printId) ?? [];
      list.push(f);
      filesByPrint.set(f.printId, list);
    }

    // The "Favourites"/"Browsing History" pseudo-collections default to most-recent-first (by
    // when they were favorited/last viewed) under the "newest" sort -- "popular"/"downloads"
    // still sort by their own metric even inside those collections, same as anywhere else.
    const collectionIdParam = typeof req.query.collection_id === "string" ? req.query.collection_id.trim() : "";
    const systemKey = systemCollectionKeyForId(collectionIdParam);
    const recencyField = systemKey === "favorites" ? "favoritedAt" : systemKey === "history" ? "lastViewedAt" : null;
    const sortMode = parseSortMode(req.query.orderBy);

    const sortValue = (p: (typeof prints)[number]): number => {
      if (sortMode === "popular") return p.viewCount;
      if (sortMode === "downloads") return p.printCount;
      if (recencyField) return p[recencyField]?.getTime() ?? 0;
      return p.createdAt.getTime();
    };

    const sorted = prints.toSorted((a, b) => {
      const diff = sortValue(b) - sortValue(a);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    });

    let paged = sorted;
    if (limit !== undefined) {
      const start = offset ?? 0;
      paged = sorted.slice(start, start + limit);
      const hasMore = sorted.length > start + paged.length;
      res.setHeader("X-Has-More", hasMore ? "true" : "false");
      res.setHeader("X-Next-Offset", String(start + paged.length));
    }

    const out = paged.map((p) => {
      const printFiles = filesByPrint.get(p.id) ?? [];
      const preparedFile = p.preparedFileId ? printFiles.find((f) => f.id === p.preparedFileId) ?? null : null;
      return toPrintOut(p, p.plates, printFiles, preparedFile, p.author, p.previewImages);
    });
    res.json(out);
  }),
);

// ---- GET /print/:id ----------------------------------------------------------------------------

router.get(
  "/print/:id",
  asyncHandler(async (req, res) => {
    // Opening a model's detail page always counts as a view, even for the print's own owner --
    // lastViewedAt is what the "Browsing History" pseudo-collection sorts/filters by.
    await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    res.json(await printOutById(req.userId!, req.params.id));
  }),
);

// ---- POST/DELETE /print/:id/favorite ---------------------------------------------------------

router.post(
  "/print/:id/favorite",
  asyncHandler(async (req, res) => {
    const result = await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { favoritedAt: new Date() },
    });
    if (result.count === 0) throw new HttpError(404, "Print not found");
    res.json(await printOutById(req.userId!, req.params.id));
  }),
);

router.delete(
  "/print/:id/favorite",
  asyncHandler(async (req, res) => {
    const result = await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { favoritedAt: null },
    });
    if (result.count === 0) throw new HttpError(404, "Print not found");
    res.json(await printOutById(req.userId!, req.params.id));
  }),
);

// ---- POST /print/:id/download --------------------------------------------------------------

router.post(
  "/print/:id/download",
  asyncHandler(async (req, res) => {
    // Recorded explicitly from the detail page's download actions (single-file, per-plate, or
    // "download all as zip"), rather than inside the plate-file/zip routes themselves -- those
    // are shared by the 3D viewer, snapshot generation, and bulk tag/category zips, none of which
    // are a user downloading *this* model.
    await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { printCount: { increment: 1 } },
    });
    res.json({ ok: true });
  }),
);

// ---- GET /tags ----------------------------------------------------------------------------

router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    const where = await buildPrintWhere(req);
    const tagList = parseTagList(req);
    const allRows = await prisma.print.findMany({ where, select: { tags: true } });
    const rows = tagList.length ? allRows.filter((r) => matchesTagList(r.tags, tagList)) : allRows;
    const found = new Set<string>();
    for (const row of rows) {
      for (const tag of row.tags) {
        const cleaned = tag.trim();
        if (cleaned) found.add(cleaned);
      }
    }
    res.json([...found].toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  }),
);

// ---- POST /download/zip[/summary] ----------------------------------------------------------
// Both routes accept the same filter (see DownloadZipFilter): print_ids, tag, category_id, and/or
// collection_id, combined with AND when more than one is given. /summary is the "are you sure?"
// confirmation step -- model count + an upper-bound size estimate, computed straight from stored
// Plate/PrintFile size columns with no filesystem access and no zip actually built (see
// estimateDownloadSize) -- called before the real download in DownloadZipConfirmDialog.

const downloadFilterSchema = z.object({
  print_ids: z.array(z.string()).optional(),
  tag: z.string().optional(),
  category_id: z.string().optional(),
  collection_id: z.string().optional(),
});
const downloadSchema = downloadFilterSchema.extend({ filename: z.string().optional() });

function assertDownloadFilterGiven(body: z.infer<typeof downloadFilterSchema>): void {
  if (!(body.print_ids?.length || body.tag || body.category_id || body.collection_id)) {
    throw new HttpError(400, "Provide print_ids, tag, category_id, or collection_id to download.");
  }
}

router.post(
  "/download/zip/summary",
  asyncHandler(async (req, res) => {
    const body = parseBody(downloadFilterSchema, req.body);
    assertDownloadFilterGiven(body);
    const prints = await resolvePrintsForDownload(req.userId!, body);
    res.json({ count: prints.length, size_bytes: await estimateDownloadSize(prints) });
  }),
);

router.post(
  "/download/zip",
  asyncHandler(async (req, res) => {
    const body = parseBody(downloadSchema, req.body);
    assertDownloadFilterGiven(body);
    const prints = await resolvePrintsForDownload(req.userId!, body);

    // A tag or collection download cuts across categories by nature, so its zip skips the usual
    // per-category subfolder (see buildZipEntries) -- a category download's entries all share one
    // category anyway, and a bare print_ids selection keeps its existing nested layout.
    const flatten = Boolean(body.tag || body.collection_id);

    let downloadName = body.filename || "thingport.zip";
    if (body.tag) {
      const safeTag = body.tag.replace(/ /g, "_").slice(0, 50) || "tag";
      downloadName = `${safeTag}.zip`;
    }
    if (body.category_id) {
      const category = prints.find((p) => p.category)?.category;
      if (category) {
        const safeName = category.name.replace(/ /g, "_").slice(0, 50) || "category";
        downloadName = `${safeName}.zip`;
      }
    }
    if (body.collection_id) {
      const collection = await prisma.collection.findFirst({ where: { id: body.collection_id, userId: req.userId } });
      if (collection) {
        const safeName = collection.name.replace(/ /g, "_").slice(0, 50) || "collection";
        downloadName = `${safeName}.zip`;
      }
    }
    await sendPrintsZip(res, prints, downloadName, { flatten });
  }),
);

// ---- Plate file streaming + print thumbnail -----------------------------------------------

router.get(
  "/print/:id/plate/:plateId/file/:filename",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, printId: req.params.id, print: { userId: req.userId } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    const filePath = resolvePlateFilePath(plate);
    if (!filePath) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", plate.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(plate.filename)}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.resolve(filePath));
  }),
);

router.get(
  "/print/:id/thumb.jpg",
  asyncHandler(async (req, res) => {
    const plate0 = await prisma.plate.findFirst({
      where: { printId: req.params.id, print: { userId: req.userId } },
      orderBy: { position: "asc" },
    });
    if (!plate0) throw new HttpError(404, "Not found");
    const thumbPath = plateThumbPath(plate0.id);
    if (!fs.existsSync(thumbPath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(thumbPath));
  }),
);

router.get(
  "/preview-image/:id/file.jpg",
  asyncHandler(async (req, res) => {
    const image = await prisma.previewImage.findFirst({
      where: { id: req.params.id, print: { userId: req.userId } },
    });
    if (!image) throw new HttpError(404, "Not found");
    const filePath = previewImagePath(image.id);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(filePath));
  }),
);

// ---- Print metadata mutation routes ---------------------------------------------------------

const tagsSchema = z.object({ tags: z.array(z.string()) });
router.post(
  "/print/:id/tags",
  asyncHandler(async (req, res) => {
    const body = parseBody(tagsSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const updated = await prisma.print.update({
      where: { id: print.id },
      data: { tags: normalizeTags(body.tags) },
    });
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    await relocatePrint(updated, plates);
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({ userId: req.userId!, action: "model_edited", targetId: print.id, details: { field: "tags", name: updated.name } });
  }),
);

const metaSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  creator: z.string().optional(),
  collection: z.string().optional(),
});
router.post(
  "/print/:id/meta",
  asyncHandler(async (req, res) => {
    const body = parseBody(metaSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");

    const data: Prisma.PrintUpdateInput = {};
    const requestedName = body.name !== undefined ? body.name : body.title;
    if (requestedName !== undefined) {
      const nextName = await uniqueModelName(req.userId!, requestedName, print.categoryId, print.id);
      if (nextName !== print.name) {
        data.name = nextName;
        data.nameNormalized = nextName.trim().toLowerCase();
        data.title = nextName;
      }
    }
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.creator !== undefined) data.creator = body.creator.trim() || null;
    if (body.collection !== undefined) data.collection = body.collection.trim() || null;

    const updated = await prisma.print.update({ where: { id: print.id }, data });
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    await relocatePrint(updated, plates);
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({ userId: req.userId!, action: "model_edited", targetId: print.id, details: { field: "meta", name: updated.name } });
  }),
);

const categoryUpdateSchema = z.object({ category_id: z.string().nullable().optional() });
router.post(
  "/print/:id/category",
  asyncHandler(async (req, res) => {
    const body = parseBody(categoryUpdateSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const categoryId = body.category_id || null;
    const data: Prisma.PrintUpdateInput = {};
    if (categoryId) {
      const category = await prisma.category.findFirst({ where: { id: categoryId, userId: req.userId } });
      if (!category) throw new HttpError(400, "Category not found");
      await uniqueModelName(req.userId!, print.name, category.id, print.id);
      data.category = { connect: { id: category.id } };
    } else {
      await uniqueModelName(req.userId!, print.name, null, print.id);
      data.category = { disconnect: true };
    }
    const updated = await prisma.print.update({ where: { id: print.id }, data });
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    await relocatePrint(updated, plates);
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({ userId: req.userId!, action: "model_edited", targetId: print.id, details: { field: "category", name: updated.name } });
  }),
);

// Clears the imported author/creator and import-source linkage, so the print reads exactly like
// one this user uploaded themselves (a plain upload never sets authorId/creator/sourceProvider/
// sourceExternalId -- see createPrint in printCreation.ts). Used by the Edit modal's "reset
// author" action. If that was the last print anywhere referencing this Author, the row itself is
// deleted too (see deleteAuthorIfOrphaned) rather than left behind with nothing pointing to it.
router.post(
  "/print/:id/author-reset",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await prisma.print.update({
      where: { id: print.id },
      data: { authorId: null, creator: null, sourceProvider: null, sourceExternalId: null },
    });
    if (print.authorId) await deleteAuthorIfOrphaned(print.authorId);
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({ userId: req.userId!, action: "model_edited", targetId: print.id, details: { field: "author_reset", name: print.name } });
  }),
);

router.delete(
  "/print/:id",
  asyncHandler(async (req, res) => {
    const full = await loadFullPrint(req.userId!, req.params.id);
    await deleteAllPrintFiles(req.params.id);
    await deleteAllPreviewImages(req.params.id);
    await prisma.print.delete({ where: { id: req.params.id } });
    for (const plate of full.plates) {
      await deletePlateFiles(plate);
      await fs.promises.rm(plateThumbPath(plate.id), { force: true }).catch(() => undefined);
    }
    res.json({ ok: true });
    void createLog({ userId: req.userId!, action: "model_deleted", targetId: req.params.id, details: { name: full.print.name } });
  }),
);

export default router;
