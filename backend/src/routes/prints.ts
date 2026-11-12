import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { normalizeFolder } from "../utils/fileFolder";
import { normalizeTags } from "../utils/tagNormalization";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload } from "../uploadMiddleware";
import { resolvePlateFilePath } from "../services/printCreation";
import { createUploadedModel } from "../services/uploadService";
import { plateThumbPath, relocatePrintsForToken } from "../services/printService";
import { assignCategory, setPrintCategory } from "../services/printCategoryService";
import { mergeModels } from "../services/modelMergeService";
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
import { adapt3mfStatus, adapted3mfFor, isAdaptable3mf } from "../services/adapted3mfCache";
import { ensurePlateFormat, fillPlateFormats } from "../services/threeMfFormat";
import { planAdaptation, slicerProfile, type AdaptPlan, type PrinterRecipe } from "../adapter";
import { printerTarget } from "../printers/targets";
import {
  listPrints,
  listPrintSources,
  listTagsOf,
  licenseAllowsFromQuery,
  parseSortMode,
  splitList,
  type PrintFilters,
} from "../services/printQuery";
import { printQuality, startPrintQualityCheck } from "../services/modelQualityService";
import { printProfilesOut, profileFillRunning, startProfileFill } from "../services/printProfileService";
import { licenseById, PICKABLE_LICENSE_IDS } from "../services/licenseCatalog";
import {
  afterLicenseChange,
  licensePending,
  printLicenseState,
  retryLicenseFill,
  startLicenseFill,
  type PrintLicenseState,
} from "../services/licenseService";
import { readableCollection, readablePrintOutById, readablePrintWhere, withOwners } from "../services/socialService";

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
    licenseAllows: licenseAllowsFromQuery(splitList(req.query.license_allows)),
    licensed: req.query.licensed === "1" || req.query.licensed === "true",
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

    const filters = printFiltersFromQuery(req);
    // Another user's public collection lists as its owner's, the models in it marked as theirs.
    const shared = filters.collectionId ? await readableCollection(req.userId!, filters.collectionId) : null;
    const listAs = shared && shared.userId !== req.userId ? shared.userId : req.userId!;
    const page = await listPrints(listAs, filters, {
      sort: parseSortMode(req.query.orderBy),
      limit,
      offset,
    });
    if (listAs !== req.userId) page.prints = await withOwners(req.userId!, page.prints);
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
    // Counts owner views too: lastViewedAt drives Browsing History. Another user's views of a shared model are theirs,
    // and nothing of the owner's.
    await prisma.print.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    // An older 3MF's kind, read once, so the page knows which slicers get an adapted copy of it.
    await fillPlateFormats(
      { printId: req.params.id, print: await readablePrintWhere(req.userId!) },
      resolvePlateFilePath,
    );
    res.json(await readablePrintOutById(req.userId!, req.params.id));
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

// Print profiles: the model page reads them, starts reading what an older import never kept, and polls.
async function readableProfiles(userId: string, printId: string) {
  const print = await prisma.print.findFirst({
    where: { id: printId, AND: [await readablePrintWhere(userId)] },
    select: { id: true, userId: true, sourceProvider: true },
  });
  if (!print) throw new HttpError(404, "Print not found");
  const plates = await prisma.plate.findMany({
    where: { printId, sourceInstanceId: { not: null } },
    select: { id: true, sourceInstanceId: true, profile: true, updatedAt: true, storagePath: true, sourcePath: true },
  });
  return { print, plates };
}

router.get(
  "/print/:id/profiles",
  asyncHandler(async (req, res) => {
    // Before what's stored is read: see printProfilesOut.
    const filling = profileFillRunning(req.params.id);
    const { print, plates } = await readableProfiles(req.userId!, req.params.id);
    res.json(await printProfilesOut(print, plates, filling));
  }),
);

// The owner's only: someone else's shared model shows what its owner's library has kept.
router.post(
  "/print/:id/profiles/fill",
  asyncHandler(async (req, res) => {
    const filling = profileFillRunning(req.params.id);
    const { print, plates } = await readableProfiles(req.userId!, req.params.id);
    if (print.userId !== req.userId) throw new HttpError(404, "Print not found");
    const before = await printProfilesOut(print, plates, filling);
    if (before.pending) startProfileFill(print.id);
    res.json({ ...before, filling: filling || profileFillRunning(print.id) });
  }),
);

// The licences an owner can pick for a model in Edit model.
router.get(
  "/licenses",
  asyncHandler(async (_req, res) => {
    res.json(
      PICKABLE_LICENSE_IDS.map((id) => {
        const license = licenseById(id)!;
        return {
          id: license.id,
          short: license.short,
          name: license.name,
          url: license.url,
          family: license.family,
          marks: license.marks,
          allows: license.allows,
          requires: { credit: license.requires.credit, same_license: license.requires.sameLicense },
        };
      }),
    );
  }),
);

async function readableLicense(userId: string, printId: string) {
  const print = await prisma.print.findFirst({
    where: { id: printId, AND: [await readablePrintWhere(userId)] },
    select: {
      id: true,
      userId: true,
      license: true,
      licenseReadAt: true,
      sourceProvider: true,
      sourceExternalId: true,
    },
  });
  if (!print) throw new HttpError(404, "Print not found");
  return print;
}

const licenseStateOut = (state: PrintLicenseState) => ({
  license: state.license,
  pending: state.pending,
  filling: state.filling,
  failed: state.failed,
});

router.get(
  "/print/:id/license",
  asyncHandler(async (req, res) => {
    res.json(licenseStateOut(printLicenseState(await readableLicense(req.userId!, req.params.id))));
  }),
);

// The owner's only, as with print profiles: someone else's shared model shows what its owner's library kept.
// `retry`: its owner asked again after a read failed, which is otherwise tried again only after a while.
const licenseFillSchema = z.object({ retry: z.boolean().optional() });
router.post(
  "/print/:id/license/fill",
  asyncHandler(async (req, res) => {
    const { retry } = parseBody(licenseFillSchema, req.body ?? {});
    const print = await readableLicense(req.userId!, req.params.id);
    if (print.userId !== req.userId) throw new HttpError(404, "Print not found");
    if (retry) retryLicenseFill(print);
    else if (licensePending(print)) startLicenseFill(print.id);
    res.json(licenseStateOut(printLicenseState(print)));
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
    // A shared model's counts and activity are its owner's, so another user's use of it records nothing.
    if (result.count === 0) {
      res.json(await readablePrintOutById(req.userId!, req.params.id));
      return;
    }
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
const downloadSchema = downloadFilterSchema.extend({
  filename: z.string().optional(),
  // Only the models' files in this folder and the folders in it (PlateOut.folder), as one folder of a model downloads.
  folder: z.string().max(1000).optional(),
});

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

    // Tag and collection downloads span categories, so they skip per-category subfolders; so do another user's models,
    // whose categories are theirs.
    const flatten = Boolean(body.tag || body.collection_id) || prints.some((print) => print.userId !== req.userId);

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
      const collection = await readableCollection(req.userId!, body.collection_id);
      if (collection) {
        const safeName = collection.name.replace(/ /g, "_").slice(0, 50) || "collection";
        downloadName = `${safeName}.zip`;
      }
    }
    // A folder that names none (".", "..") would otherwise mean every file.
    const folder = normalizeFolder(body.folder);
    if (body.folder && !folder) throw new HttpError(400, "That isn't a folder a model's files can be in");
    await sendPrintsZip(res, prints, downloadName, { flatten, folder });
  }),
);

async function readablePlate(req: Request) {
  const plate = await prisma.plate.findFirst({
    where: { id: req.params.plateId, printId: req.params.id, print: await readablePrintWhere(req.userId!) },
    include: { print: { select: { preparedMetadata: true } } },
  });
  if (!plate) throw new HttpError(404, "Not found");
  const filePath = resolvePlateFilePath(plate);
  if (!filePath) throw new HttpError(404, "Not found");
  return { plate, filePath };
}

type ReadablePlate = Awaited<ReturnType<typeof readablePlate>>["plate"];

/** Whether the plate is a 3MF a copy can be made of: never a sliced print, whose G-code would be dropped. */
function adaptable(plate: ReadablePlate): boolean {
  return plate.print.preparedMetadata === null && isAdaptable3mf(plate.filename);
}

type PrinterAsked = { id: string; nozzle: string } | null;
type Adaptation = { plan: AdaptPlan; printer: PrinterRecipe | null };

/** The copy of the plate to open in `slicer` (src/adapter/plan.ts), or null to open the plate itself. With a printer
 *  the slicer has a preset for, the copy is made for that printer. */
async function adaptPlanFor(
  plate: ReadablePlate,
  filePath: string,
  slicer: unknown,
  printer: PrinterAsked = null,
): Promise<Adaptation | null> {
  if (!adaptable(plate) || typeof slicer !== "string") return null;
  const target = printer ? printerTarget(slicer, printer.id, printer.nozzle) : null;
  const plan = planAdaptation(await ensurePlateFormat(plate, filePath), slicerProfile(slicer), target?.choice);
  if (!plan) return null;
  return { plan, printer: plan.output === "bambu" && plan.printer && target ? target.recipe : null };
}

const printerAskedSchema = z
  .object({ id: z.string().regex(/^[a-z0-9-]{1,120}$/), nozzle: z.string().regex(/^[A-Za-z]{0,3}\d+(\.\d+)?$/) })
  .strict();

// What a page loaded before "Open adapted" asked for with "Open normalized": the copy PrusaSlicer gets, nearest to
// it, for the same files (a Bambu layout project, never a print).
const NORMALIZED_FOR = "prusaslicer";

function sendPlateFile(res: Response, plate: ReadablePlate, filePath: string) {
  res.setHeader("Content-Type", plate.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(plate.filename)}"`);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(path.resolve(filePath));
}

router.get(
  "/print/:id/plate/:plateId/file/:filename",
  asyncHandler(async (req, res) => {
    const { plate, filePath } = await readablePlate(req);
    const adapt = req.query.normalize === "1" ? await adaptPlanFor(plate, filePath, NORMALIZED_FOR) : null;
    const adapted = adapt ? await adapted3mfFor(plate.id, filePath, adapt.plan) : null;
    sendPlateFile(res, plate, adapted ?? filePath);
  }),
);

async function sendAdapted(req: Request, res: Response, printer: PrinterAsked) {
  const { plate, filePath } = await readablePlate(req);
  const adapt = await adaptPlanFor(plate, filePath, req.params.slicer, printer);
  const adapted = adapt ? await adapted3mfFor(plate.id, filePath, adapt.plan, adapt.printer) : null;
  sendPlateFile(res, plate, adapted ?? filePath);
}

// The plate as `slicer` opens it best: the adapted copy, waited for if needed, or the plate itself when it needs none
// or one can't be made. The path, not a query, names the slicer: OrcaSlicer names the file after the URL's end.
router.get(
  "/print/:id/plate/:plateId/adapted/:slicer/:filename",
  asyncHandler((req, res) => sendAdapted(req, res, null)),
);

// The same, made for a printer from the printer catalogue with the given nozzle ("0.4"), where the slicer has a
// preset for it.
router.get(
  "/print/:id/plate/:plateId/adapted/:slicer/:printer/:nozzle/:filename",
  asyncHandler(async (req, res) => {
    const printer = printerAskedSchema.safeParse({ id: req.params.printer, nozzle: req.params.nozzle });
    if (!printer.success) throw new HttpError(404, "Not found");
    await sendAdapted(req, res, printer.data);
  }),
);

// Polled by "Open adapted in <slicer>" until the copy is ready, so no request outlasts a proxy timeout. "original"
// when the slicer opens the plate itself as well as it can. `printer`, as in the adapted link, makes it for a printer.
const adaptBodySchema = z.object({ slicer: z.unknown(), printer: printerAskedSchema.nullable().optional() });
router.post(
  "/print/:id/plate/:plateId/adapt",
  asyncHandler(async (req, res) => {
    const { plate, filePath } = await readablePlate(req);
    const body = parseBody(adaptBodySchema, req.body ?? {});
    const adapt = await adaptPlanFor(plate, filePath, body.slicer, body.printer ?? null);
    res.json({ status: adapt ? await adapt3mfStatus(plate.id, filePath, adapt.plan, adapt.printer) : "original" });
  }),
);

// The "Open normalized" status, for pages loaded before an upgrade.
router.post(
  "/print/:id/plate/:plateId/normalize",
  asyncHandler(async (req, res) => {
    const { plate, filePath } = await readablePlate(req);
    if (!adaptable(plate)) throw new HttpError(400, "Only a plain 3MF project can be normalized.");
    const adapt = await adaptPlanFor(plate, filePath, NORMALIZED_FOR);
    // Ready to open: the file itself, when it isn't a project a copy is made of.
    res.json({ status: adapt ? await adapt3mfStatus(plate.id, filePath, adapt.plan) : "ready" });
  }),
);

router.get(
  "/print/:id/thumb.jpg",
  asyncHandler(async (req, res) => {
    const plate0 = await prisma.plate.findFirst({
      where: { printId: req.params.id, print: await readablePrintWhere(req.userId!) },
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
      where: { id: req.params.id, print: await readablePrintWhere(req.userId!) },
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
      where: { id: req.params.id, print: await readablePrintWhere(req.userId!) },
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
  // A licence id (GET /licenses), "source" for what its source lists, or null for none on a model with no source.
  license: z.string().max(100).nullable().optional(),
});
router.post(
  "/print/:id/meta",
  asyncHandler(async (req, res) => {
    const body = parseBody(metaSchema, req.body);
    const print = await updatePrintMeta(req.userId!, req.params.id, {
      name: body.name !== undefined ? body.name : body.title,
      notes: body.notes,
      creator: body.creator,
      license: body.license,
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
    // LICENSE.txt names who made it and where it's from, whatever the storage structure uses.
    await afterLicenseChange(print.id);
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

const bulkCategorySchema = bulkPrintIdsSchema.extend({ category_id: z.string() });
router.post(
  "/prints/category",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkCategorySchema, req.body);
    const { assigned, skipped, failed } = await assignCategory(req.userId!, body.print_ids, body.category_id);
    for (const print of assigned) {
      void createLog({
        userId: req.userId!,
        action: "model_edited",
        targetId: print.id,
        details: { field: "category", name: print.name },
      });
    }
    const out = await printOutsByIds(
      req.userId!,
      assigned.map((print) => print.id),
    );
    res.json({ prints: assigned.flatMap((print) => out.get(print.id) ?? []), skipped, failed });
  }),
);

// `ids` are merged into `primary_id` and deleted; it may list `primary_id` too.
const mergeModelsSchema = z.object({ primary_id: z.string(), ids: z.array(z.string()).min(1).max(500) });
router.post(
  "/prints/merge",
  asyncHandler(async (req, res) => {
    const body = parseBody(mergeModelsSchema, req.body);
    const { primary, merged } = await mergeModels(req.userId!, body.primary_id, body.ids);
    void createLog({
      userId: req.userId!,
      action: "models_merged",
      targetId: primary.id,
      details: { name: primary.name, merged: merged.map((print) => print.name) },
    });
    // The others are gone by now, so an error here would offer a retry that can only answer 404.
    const print = await printOutById(req.userId!, primary.id).catch((error: unknown) => {
      console.error(`Couldn't read back merged model ${primary.id}:`, error);
      return null;
    });
    res.json({ print, merged_ids: merged.map((other) => other.id) });
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
