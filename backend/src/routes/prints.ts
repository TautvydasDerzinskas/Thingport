import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload } from "../uploadMiddleware";
import { resolvePlateFilePath } from "../services/printCreation";
import { createUploadedModel } from "../services/uploadService";
import { plateThumbPath, relocatePrintsForToken } from "../services/printService";
import { setPrintCategory } from "../services/printCategoryService";
import { previewImagePath } from "../services/previewImageService";
import { descriptionImagePath } from "../services/descriptionImageService";
import { deleteAuthorIfOrphaned } from "../services/authorService";
import { printOutById, printOutsByIds } from "../services/printLoader";
import { estimateDownloadSize, resolvePrintsForDownload, sendPrintsZip } from "../services/downloadZip";
import { createLog } from "../services/auditLog";
import { recordActivity } from "../services/activityService";
import { notifyUpload, type UploadOrigin } from "../services/modelNotifications";
import { fillSourceGaps } from "../services/fillGapsService";
import { linkPrintToSource } from "../services/modelLinkService";
import { deletePrint, setPrintTags, updatePrintMeta } from "../services/printEditService";
import { isNormalizable3mf, normalize3mfStatus, normalized3mfFor } from "../services/normalized3mfCache";
import {
  listPrints,
  listPrintSources,
  listTagsOf,
  parseSortMode,
  splitList,
  type PrintFilters,
} from "../services/printQuery";
import { printQuality, startPrintQualityCheck } from "../services/modelQualityService";

const router = Router();
router.use(requireAuth);

/** GET /prints' and GET /tags' query string as listing filters. */
function printFiltersFromQuery(req: Request): PrintFilters {
  const str = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    q: str(req.query.q),
    categoryIds: splitList(req.query.category_id),
    collectionId: str(req.query.collection_id),
    authorId: str(req.query.author_id),
    tags: splitList(req.query.tags),
    generative: req.query.generative === "1" || req.query.generative === "true",
    excludeProviders: splitList(req.query.hide_providers),
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
    // What the model is, for the notification: the customizer and the tools say so, since nothing in the
    // request itself tells a generated model from a file someone picked.
    const origin: UploadOrigin = body.origin === "generated" || body.origin === "created" ? body.origin : "upload";
    // What made it in before any failure, so a partly failed request reports both halves truthfully.
    const created: { id: string; name: string }[] = [];
    const pending = new Set(files);
    const mode = body.mode === "multiplate" ? "multiplate" : "separate";
    try {
      if (!files.length) throw new HttpError(400, "No files uploaded");
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
      // One model per file, or one holding them all.
      const groups = files.length === 1 || mode === "separate" ? files.map((f) => [f]) : [files];
      for (const group of groups) {
        const print = await createUploadedModel(req.userId!, meta, group);
        for (const f of group) pending.delete(f);
        created.push({ id: print.id, name: print.title || print.name });
        printsOut.push(await printOutById(req.userId!, print.id));
      }
      if (notify) {
        await notifyUpload(req.userId!, created, { names: [] }, origin).catch((err) =>
          console.error("Upload notification failed:", err),
        );
      }
      res.json({ prints: printsOut });
    } catch (err) {
      if (notify && files.length) {
        const names = [...pending].map((f) => sanitizeFilename(f.originalname));
        await notifyUpload(
          req.userId!,
          created,
          {
            names,
            // Multiplate is one model holding every file, so a failure there lost one model however many of
            // its files are named -- the customizer's save sends a 3MF and the script that made it.
            count: mode === "multiplate" ? (names.length ? 1 : 0) : names.length,
            reason: err instanceof HttpError ? err.message : undefined,
          },
          origin,
        ).catch((e) => console.error("Upload notification failed:", e));
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

/** The sites the library's models came from, for the listing's source filter. */
router.get(
  "/prints/sources",
  asyncHandler(async (req, res) => {
    const sources = await listPrintSources(req.userId!);
    res.json(sources.map((s) => ({ provider: s.provider, model_count: s.modelCount })));
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
    const print = await setPrintTags(req.userId!, req.params.id, body.tags);
    res.json({ print: await printOutById(req.userId!, print.id) });
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
    const print = await updatePrintMeta(req.userId!, req.params.id, {
      name: body.name !== undefined ? body.name : body.title,
      notes: body.notes,
      creator: body.creator,
    });
    res.json({ print: await printOutById(req.userId!, print.id) });
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

const bulkTagsSchema = bulkPrintIdsSchema.extend({
  add: z.array(z.string()).max(50).default([]),
  remove: z.array(z.string()).max(50).default([]),
});
router.post(
  "/prints/tags",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkTagsSchema, req.body);
    const remove = new Set(normalizeTags(body.remove));
    const add = normalizeTags(body.add).filter((tag) => !remove.has(tag));
    if (!add.length && !remove.size) throw new HttpError(400, "Tag is required");
    const prints = await prisma.print.findMany({
      where: { id: { in: body.print_ids }, userId: req.userId },
      select: { id: true, name: true, tags: true },
    });
    // Added after the model's own, and only the models that change are written.
    const changed = prints.flatMap((print) => {
      const own = normalizeTags(print.tags);
      const tags = normalizeTags([...own.filter((tag) => !remove.has(tag)), ...add]);
      return tags.join("\n") === own.join("\n") ? [] : [{ ...print, tags }];
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

const linkSourceSchema = z.object({ url: z.string() });

router.post(
  "/print/:id/link-source",
  asyncHandler(async (req, res) => {
    const body = parseBody(linkSourceSchema, req.body);
    await linkPrintToSource(req.userId!, req.params.id, body.url);
    res.json({ print: await printOutById(req.userId!, req.params.id) });
  }),
);

export default router;
