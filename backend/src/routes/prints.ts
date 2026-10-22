import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload } from "../uploadMiddleware";
import { createPrint, deletePlateFiles, resolvePlateFilePath, type NewPlateInput } from "../services/printCreation";
import {
  plateThumbPath,
  relocatePrint,
  relocatePrintsForToken,
  removeAssetHome,
  assetOwnerIds,
  removePlatePictures,
  uniqueModelName,
} from "../services/printService";
import { setPrintCategory } from "../services/printCategoryService";
import { previewImagePath, deleteAllPreviewImages } from "../services/previewImageService";
import {
  deleteAllDescriptionImages,
  descriptionImagePath,
  localizeDescriptionImages,
  pruneDescriptionImages,
} from "../services/descriptionImageService";
import { deleteAuthorIfOrphaned } from "../services/authorService";
import { toPrintOut } from "../dto";
import { loadFullPrint, printOutById, printOutsByIds } from "../services/printLoader";
import { deleteAllPrintFiles, saveFileFromTemp } from "../services/printFileService";
import { RENDERABLE_MODEL_EXTS } from "../config";
import { estimateDownloadSize, resolvePrintsForDownload, sendPrintsZip } from "../services/downloadZip";
import { createLog } from "../services/auditLog";
import { recordActivity } from "../services/activityService";
import { notifyUpload } from "../services/modelNotifications";
import { fillSourceGaps } from "../services/fillGapsService";
import { forgetAiDescription } from "../services/aiDescriptionService";
import { isNormalizable3mf, normalize3mfStatus, normalized3mfFor } from "../services/normalized3mfCache";
import { listPrints, listTagsOf, parseSortMode, splitList, type PrintFilters } from "../services/printQuery";
import type { Prisma } from "@prisma/client";
import { printQuality, startPrintQualityCheck } from "../services/modelQualityService";

const router = Router();
router.use(requireAuth);

function isRenderableUpload(f: Express.Multer.File): boolean {
  return RENDERABLE_MODEL_EXTS.has(path.extname(f.originalname).toLowerCase());
}

/** GET /prints' and GET /tags' query string as listing filters. */
function printFiltersFromQuery(req: Request): PrintFilters {
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    q: str(req.query.q),
    categoryIds: splitList(req.query.category_id),
    collectionId: str(req.query.collection_id),
    authorId: str(req.query.author_id),
    tags: splitList(req.query.tags),
  };
}

router.post(
  "/upload",
  modelUpload.array("files"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const body = req.body as Record<string, string | undefined>;
    // A browser uploading a batch one request at a time sends notify=false, then one summary at the end.
    const notify = body.notify !== "false";
    // What made it in before any failure, so a partly failed request reports both halves truthfully.
    const created: { id: string; name: string }[] = [];
    const pending = new Set(files);
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
        categorySource: body.category_id ? ("MANUAL" as const) : null,
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
          created.push({ id: print.id, name: print.title || print.name });
          pending.delete(file);
          void recordActivity(req.userId!, "upload", print.id, print.name);
          void createLog({
            userId: req.userId!,
            action: "model_uploaded",
            targetId: print.id,
            details: { name: print.name },
          });
        }
      } else {
        // Non-renderable files become SUPPORTING files. If nothing is renderable, every file becomes a
        // plate so the print still has one.
        const renderableFiles = files.filter(isRenderableUpload);
        const supportingFiles = renderableFiles.length ? files.filter((f) => !isRenderableUpload(f)) : [];
        const plateFiles = renderableFiles.length ? renderableFiles : files;

        const plateInputs: NewPlateInput[] = plateFiles.map((f) => {
          const safeName = sanitizeFilename(f.originalname);
          return { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path };
        });
        const nameHint = path.parse(plateInputs[0].filename).name;
        const { print } = await createPrint(req.userId!, meta, nameHint, plateInputs);
        created.push({ id: print.id, name: print.title || print.name });
        for (const f of plateFiles) pending.delete(f);

        for (const f of supportingFiles) {
          await saveFileFromTemp(req.userId!, print.id, f.path, f.originalname, f.mimetype);
          pending.delete(f);
        }

        printsOut.push(await printOutById(req.userId!, print.id));
        void recordActivity(req.userId!, "upload", print.id, print.name);
        void createLog({
          userId: req.userId!,
          action: "model_uploaded",
          targetId: print.id,
          details: { name: print.name },
        });
      }
      if (notify) {
        await notifyUpload(req.userId!, created).catch((err) => console.error("Upload notification failed:", err));
      }
      res.json({ prints: printsOut });
    } catch (err) {
      if (notify && files.length) {
        await notifyUpload(req.userId!, created, {
          names: [...pending].map((f) => sanitizeFilename(f.originalname)),
          reason: err instanceof HttpError ? err.message : undefined,
        }).catch((e) => console.error("Upload notification failed:", e));
      }
      throw err;
    } finally {
      for (const f of files) {
        if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
      }
    }
  }),
);

// The end of a batch the browser uploaded one request at a time, each sent with notify=false.
const uploadSummarySchema = z.object({
  print_ids: z.array(z.string()).max(1000),
  failed: z.array(z.string().max(300)).max(1000).default([]),
});
router.post(
  "/upload/summary",
  asyncHandler(async (req, res) => {
    const body = parseBody(uploadSummarySchema, req.body);
    // Only the caller's own models, by their current names.
    const prints = await prisma.print.findMany({
      where: { id: { in: body.print_ids }, userId: req.userId! },
      select: { id: true, name: true, title: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    await notifyUpload(
      req.userId!,
      prints.map((p) => ({ id: p.id, name: p.title || p.name })),
      { names: body.failed },
    );
    res.json({ ok: true });
  }),
);

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

    const page = await listPrints(req.userId!, printFiltersFromQuery(req), {
      sort: parseSortMode(req.query.orderBy),
      limit,
      offset,
    });
    if (limit !== undefined) {
      res.setHeader("X-Has-More", page.hasMore ? "true" : "false");
      res.setHeader("X-Next-Offset", String(page.nextOffset));
      // Total across all pages, e.g. for a hover card's "N models".
      res.setHeader("X-Total-Count", String(page.total));
    }
    res.json(page.prints);
  }),
);

router.get(
  "/print/:id",
  asyncHandler(async (req, res) => {
    // Counts owner views too: lastViewedAt drives Browsing History.
    await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    res.json(await printOutById(req.userId!, req.params.id));
  }),
);

// Printability checks: the model page reads the state, starts a check for files not yet checked, and polls.
router.get(
  "/print/:id/quality",
  asyncHandler(async (req, res) => {
    const quality = await printQuality(req.userId!, req.params.id);
    if (!quality) throw new HttpError(404, "Print not found");
    res.json(quality);
  }),
);

router.post(
  "/print/:id/quality",
  asyncHandler(async (req, res) => {
    const quality = await startPrintQualityCheck(req.userId!, req.params.id);
    if (!quality) throw new HttpError(404, "Print not found");
    res.json(quality);
  }),
);

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

// Older clients send no body, which was always a download.
const recordUseSchema = z.object({ kind: z.enum(["download", "slicer"]).default("download") });
router.post(
  "/print/:id/download",
  asyncHandler(async (req, res) => {
    // Recorded explicitly by the detail page: the file/zip routes also serve the viewer, snapshots
    // and bulk zips, which aren't downloads of this model.
    const { kind } = parseBody(recordUseSchema, req.body ?? {});
    const result = await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { printCount: { increment: 1 } },
    });
    if (result.count === 0) throw new HttpError(404, "Print not found");
    const print = await printOutById(req.userId!, req.params.id);
    void recordActivity(req.userId!, kind, req.params.id, print.name);
    res.json(print);
  }),
);

router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    res.json(await listTagsOf(req.userId!, printFiltersFromQuery(req)));
  }),
);

// Filters combine with AND. /summary estimates count and size from stored columns without
// touching the filesystem.

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

    // Tag and collection downloads span categories, so they skip per-category subfolders.
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

router.get(
  "/print/:id/plate/:plateId/file/:filename",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, printId: req.params.id, print: { userId: req.userId } },
      include: { print: { select: { preparedMetadata: true } } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    let filePath = resolvePlateFilePath(plate);
    if (!filePath) throw new HttpError(404, "Not found");
    // Only "Open normalized in <slicer>" asks for it; a plate that is itself a sliced print is never touched.
    if (req.query.normalize === "1" && plate.print.preparedMetadata === null && isNormalizable3mf(plate.filename)) {
      filePath = (await normalized3mfFor(plate.id, filePath)) ?? filePath;
    }
    res.setHeader("Content-Type", plate.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(plate.filename)}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.resolve(filePath));
  }),
);

// Polled by "Open normalized in <slicer>" until the copy is ready, so no request outlasts a proxy timeout.
router.post(
  "/print/:id/plate/:plateId/normalize",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, printId: req.params.id, print: { userId: req.userId } },
      include: { print: { select: { preparedMetadata: true } } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    if (plate.print.preparedMetadata !== null || !isNormalizable3mf(plate.filename)) {
      throw new HttpError(400, "Only a plain 3MF project can be normalized.");
    }
    const filePath = resolvePlateFilePath(plate);
    if (!filePath) throw new HttpError(404, "Not found");
    res.json({ status: await normalize3mfStatus(plate.id, filePath) });
  }),
);

router.get(
  "/print/:id/thumb.jpg",
  asyncHandler(async (req, res) => {
    const plate0 = await prisma.plate.findFirst({
      where: { printId: req.params.id, print: { userId: req.userId } },
      orderBy: { position: "asc" },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!plate0) throw new HttpError(404, "Not found");
    const thumbPath = plateThumbPath(plate0.id, plate0.print.assetsPath);
    if (!fs.existsSync(thumbPath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(thumbPath));
  }),
);

router.get(
  "/description-image/:id",
  asyncHandler(async (req, res) => {
    const image = await prisma.descriptionImage.findFirst({
      where: { id: req.params.id, print: { userId: req.userId } },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!image) throw new HttpError(404, "Not found");
    const filePath = descriptionImagePath(image, image.print.assetsPath);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", image.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(filePath));
  }),
);

router.get(
  "/preview-image/:id/file.jpg",
  asyncHandler(async (req, res) => {
    const image = await prisma.previewImage.findFirst({
      where: { id: req.params.id, print: { userId: req.userId } },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!image) throw new HttpError(404, "Not found");
    const filePath = previewImagePath(image.id, image.print.assetsPath);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(filePath));
  }),
);

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
    void createLog({
      userId: req.userId!,
      action: "model_edited",
      targetId: print.id,
      details: { field: "tags", name: updated.name },
    });
  }),
);

const metaSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
  creator: z.string().optional(),
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

    const updated = await prisma.print.update({ where: { id: print.id }, data });
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    await relocatePrint(updated, plates);
    if (body.notes !== undefined) {
      if (body.notes !== (print.notes ?? "")) await forgetAiDescription(print.id);
      await pruneDescriptionImages(print.id);
      // Images pasted in by URL are fetched in the background: slow hosts mustn't hold up the save.
      void localizeDescriptionImages(print.id);
    }
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({
      userId: req.userId!,
      action: "model_edited",
      targetId: print.id,
      details: { field: "meta", name: updated.name },
    });
  }),
);

const categoryUpdateSchema = z.object({ category_id: z.string().nullable().optional() });
router.post(
  "/print/:id/category",
  asyncHandler(async (req, res) => {
    const body = parseBody(categoryUpdateSchema, req.body);
    const updated = await setPrintCategory(
      req.userId!,
      req.params.id,
      body.category_id || null,
      body.category_id ? "MANUAL" : null,
      {
        clearSuggestion: true,
      },
    );
    if (!updated) throw new HttpError(409, "Category changed concurrently");
    res.json({ print: await printOutById(req.userId!, updated.id) });
    void createLog({
      userId: req.userId!,
      action: "model_edited",
      targetId: updated.id,
      details: { field: "category", name: updated.name },
    });
  }),
);

// Resets author/source linkage so the print reads like the user's own upload, deleting the Author
// row if nothing else references it.
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
    await relocatePrintsForToken("creator", [print.id]);
    res.json({ print: await printOutById(req.userId!, print.id) });
    void createLog({
      userId: req.userId!,
      action: "model_edited",
      targetId: print.id,
      details: { field: "author_reset", name: print.name },
    });
  }),
);

async function deletePrint(userId: string, printId: string): Promise<void> {
  const full = await loadFullPrint(userId, printId);
  const assetOwners = await assetOwnerIds(printId);
  await deleteAllPrintFiles(printId);
  await deleteAllPreviewImages(printId);
  await deleteAllDescriptionImages(printId);
  await prisma.print.delete({ where: { id: printId } });
  for (const plate of full.plates) {
    await deletePlateFiles(plate);
    await removePlatePictures(plate.id, full.print.assetsPath);
  }
  await removeAssetHome(full.print.assetsPath, assetOwners);
  void recordActivity(userId, "delete", printId, full.print.name);
  void createLog({
    userId,
    action: "model_deleted",
    targetId: printId,
    details: { name: full.print.name },
  });
}

router.delete(
  "/print/:id",
  asyncHandler(async (req, res) => {
    await deletePrint(req.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

// The grids' multi-select. One at a time, so a model that fails doesn't take the rest with it.
const bulkPrintIdsSchema = z.object({ print_ids: z.array(z.string()).min(1).max(500) });
router.post(
  "/prints/delete",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkPrintIdsSchema, req.body);
    const deleted: string[] = [];
    let failed = 0;
    for (const printId of new Set(body.print_ids)) {
      try {
        await deletePrint(req.userId!, printId);
        deleted.push(printId);
      } catch {
        failed++;
      }
    }
    res.json({ deleted, failed });
  }),
);

const bulkFavoriteSchema = bulkPrintIdsSchema.extend({ favorite: z.boolean() });
router.post(
  "/prints/favorite",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkFavoriteSchema, req.body);
    // Only the ones changing, so an existing favourite keeps its date and its place in Favourites.
    await prisma.print.updateMany({
      where: {
        id: { in: body.print_ids },
        userId: req.userId,
        favoritedAt: body.favorite ? null : { not: null },
      },
      data: { favoritedAt: body.favorite ? new Date() : null },
    });
    const prints = await printOutsByIds(req.userId!, body.print_ids);
    res.json({ prints: body.print_ids.flatMap((id) => prints.get(id) ?? []) });
  }),
);

const bulkTagsSchema = bulkPrintIdsSchema.extend({ tags: z.array(z.string()).min(1).max(50) });
router.post(
  "/prints/tags",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkTagsSchema, req.body);
    const added = normalizeTags(body.tags);
    if (!added.length) throw new HttpError(400, "Tag is required");
    const prints = await prisma.print.findMany({
      where: { id: { in: body.print_ids }, userId: req.userId },
      select: { id: true, name: true, tags: true },
    });
    // Appended after the model's own, and only to the ones missing one, so the rest aren't touched.
    const changed = prints.flatMap((print) => {
      const tags = normalizeTags([...print.tags, ...added]);
      return tags.length === normalizeTags(print.tags).length ? [] : [{ ...print, tags }];
    });
    for (const print of changed) {
      await prisma.print.update({ where: { id: print.id }, data: { tags: print.tags } });
    }
    await relocatePrintsForToken(
      "tags",
      changed.map((print) => print.id),
    );
    const out = await printOutsByIds(req.userId!, body.print_ids);
    res.json({ prints: body.print_ids.flatMap((id) => out.get(id) ?? []), changed: changed.length });
    for (const print of changed) {
      void createLog({
        userId: req.userId!,
        action: "model_edited",
        targetId: print.id,
        details: { field: "tags", name: print.name },
      });
    }
  }),
);

/** Fills the model's empty details and images from its source; never overwrites, never adds files. */
async function fillGaps(req: Request, res: Response): Promise<void> {
  const result = await fillSourceGaps(req.userId!, req.params.id);
  res.json(result);
  void createLog({
    userId: req.userId!,
    action: "model_reimported",
    targetId: req.params.id,
    details: { source_url: result.source_url, filled: result.filled },
  });
}

router.post("/print/:id/fill-gaps", asyncHandler(fillGaps));
// Extension versions up to 1.3.0 call it by its old name.
router.post("/print/:id/reimport", asyncHandler(fillGaps));

export default router;
