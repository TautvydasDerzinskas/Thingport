import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, mimeFromContentType } from "../utils/fileUtils";
import { normalizeFileName } from "../files/names";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload, thumbnailUpload } from "../uploadMiddleware";
import {
  addPlatesToPrint,
  refreshAutoPreparedMetadata,
  removePlate,
  renamePlate,
  renamePlates,
  reorderPlates,
  resolvePlateFilePath,
  type NewPlateInput,
} from "../services/printCreation";
import { plateThumbPath } from "../services/printService";
import {
  addGeneratedPreviewImageIfNone,
  generateCardRender,
  saveGeneratedPlateThumbnail,
} from "../services/previewImageService";
import { printOutById } from "../services/printLoader";
import { buildPlatePreview, getBuildPlateManifest } from "../services/buildPlatePreviewCache";
import {
  generateModelPreviewGlb,
  modelPreviewGlbPath,
  modelPreviewState,
  modelImagePath,
  modelImageState,
  type ModelImageKind,
  canRenderModelImage,
} from "../services/modelPreviewCache";
import { getPreviewMode, getSimplifyPreviews } from "../services/settingsService";
import { readablePrintWhere } from "../services/socialService";
import { isProfileProject, plateThumbEntry } from "../services/printProfileFile";
import { readZipEntry } from "../utils/zipReader";

const router = Router();
router.use(requireAuth);
const CLIENT_UPLOAD_ID_PREFIX =
  /^thingport-upload-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})-/i;

router.get(
  "/print/:id/plates/upload-idempotency",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    res.setHeader("Cache-Control", "no-store");
    res.json({ supported: true });
  }),
);

const uploadResultsSchema = z.object({ upload_ids: z.array(z.string().min(1).max(36)) });
router.post(
  "/print/:id/plates/upload-results",
  asyncHandler(async (req, res) => {
    const { upload_ids } = parseBody(uploadResultsSchema, req.body);
    const print = await prisma.print.findFirst({
      where: { id: req.params.id, userId: req.userId },
      select: { id: true },
    });
    if (!print) throw new HttpError(404, "Print not found");
    const completed = await prisma.plateUploadAttempt.findMany({
      where: { printId: print.id, status: "complete", clientUploadId: { in: upload_ids } },
      select: { clientUploadId: true, plateId: true },
    });
    res.json({
      print: await printOutById(req.userId!, print.id),
      upload_results: completed.map((attempt) => ({ upload_id: attempt.clientUploadId, plate_id: attempt.plateId })),
    });
  }),
);

router.post(
  "/print/:id/plates",
  modelUpload.array("files"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    try {
      if (!files.length) throw new HttpError(400, "No files uploaded");
      const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!print) throw new HttpError(404, "Print not found");

      const plateInputs: NewPlateInput[] = files.map((f) => {
        const safeName = normalizeFileName(f.originalname);
        // Read from the name as sent: the marker is the app's, and the name's cut can take its last character.
        const uploadId = (CLIENT_UPLOAD_ID_PREFIX.exec(f.originalname) ?? CLIENT_UPLOAD_ID_PREFIX.exec(safeName))?.[1];
        return {
          filename: safeName,
          clientUploadId: uploadId,
          mime: mimeFromContentType(f.mimetype, safeName),
          tempFilePath: f.path,
        };
      });
      const addedPlates = await addPlatesToPrint(req.userId!, print.id, plateInputs);
      res.json({
        print: await printOutById(req.userId!, print.id),
        added_plate_ids: addedPlates.map((plate) => plate.id),
      });
    } finally {
      for (const f of files) {
        if (fs.existsSync(f.path)) fs.rmSync(f.path, { force: true });
      }
    }
  }),
);

router.delete(
  "/print/:id/plates/:plateId",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await removePlate(print, req.params.plateId);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

const reorderSchema = z.object({ plate_ids: z.array(z.string()).min(1) });
router.post(
  "/print/:id/plates/reorder",
  asyncHandler(async (req, res) => {
    const body = parseBody(reorderSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    if (await reorderPlates(print.id, body.plate_ids)) await refreshAutoPreparedMetadata(print.id);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

const renameSchema = z.object({ filename: z.string().trim().min(1) });
const renameBatchSchema = z.object({
  renames: z
    .array(renameSchema.extend({ plate_id: z.string().min(1) }))
    .min(1)
    .refine(
      (renames) => new Set(renames.map((rename) => rename.plate_id)).size === renames.length,
      "Duplicate plate IDs",
    ),
});
router.post(
  "/print/:id/plates/rename",
  asyncHandler(async (req, res) => {
    const { renames } = parseBody(renameBatchSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    // Coded, so the app can tell these 404s from an older server's catch-all for a route it doesn't have.
    if (!print) throw new HttpError(404, "Print not found", "print_not_found");
    await renamePlates(print, renames);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

router.post(
  "/print/:id/plate/:plateId/rename",
  asyncHandler(async (req, res) => {
    const body = parseBody(renameSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await renamePlate(print, req.params.plateId, body.filename);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

router.get(
  "/plate/:plateId/thumb.jpg",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: await readablePrintWhere(req.userId!) },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    const thumbPath = plateThumbPath(plate.id, plate.print.assetsPath);
    if (!fs.existsSync(thumbPath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(thumbPath));
  }),
);

const PLATE_PICTURE_LIMIT = 8 * 1024 * 1024;

// A build plate's own picture out of a print profile's 3MF, read from the file each time rather than kept: the file
// already holds it, and it changes with the file.
router.get(
  "/plate/:plateId/profile-plate/:index.png",
  asyncHandler(async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isSafeInteger(index) || index < 0 || index > 9999) throw new HttpError(404, "Not found");
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: await readablePrintWhere(req.userId!) },
    });
    if (!plate || !isProfileProject(plate.filename)) throw new HttpError(404, "Not found");
    const filePath = resolvePlateFilePath(plate);
    const png = filePath
      ? ((await readZipEntry(filePath, plateThumbEntry(index), PLATE_PICTURE_LIMIT).catch(() => null)) ??
        (await readZipEntry(filePath, `Metadata/top_${index}.png`, PLATE_PICTURE_LIMIT).catch(() => null)))
      : null;
    if (!png) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", "image/png");
    // Versioned URLs change with the plate; the bare one is asked for again.
    res.setHeader("Cache-Control", req.query.v ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.send(png);
  }),
);

router.get(
  "/plate/:plateId/preview.glb",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: await readablePrintWhere(req.userId!) },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    if (req.query.plates === "1" || req.query.buildPlate !== undefined) {
      if (!isProfileProject(plate.filename) || (await getPreviewMode()) === "disabled")
        throw new HttpError(404, "Build plate previews are unavailable", "PREVIEW_UNSUPPORTED");
      const source = resolvePlateFilePath(plate);
      if (!source) throw new HttpError(404, "Model file is missing", "PREVIEW_FAILED");
      const simplify = await getSimplifyPreviews();
      const manifest = await getBuildPlateManifest(source, simplify);
      if (!manifest) throw new HttpError(404, "Build plate previews are unavailable", "PREVIEW_UNSUPPORTED");
      if (req.query.plates === "1") {
        res.setHeader("Cache-Control", "private, no-cache");
        res.json(manifest);
        return;
      }
      const buildPlate =
        typeof req.query.buildPlate === "string" && /^\d+$/.test(req.query.buildPlate)
          ? Number(req.query.buildPlate)
          : NaN;
      if (manifest.version !== req.query.projectVersion || !manifest.plates.some(({ index }) => index === buildPlate))
        throw new HttpError(404, "That build plate is unavailable", "PREVIEW_FAILED");
      const preview = buildPlatePreview(plate.id, source, manifest.version, buildPlate, simplify);
      if (preview.status !== "ready")
        throw new HttpError(
          404,
          preview.status === "generating"
            ? "Preview is being generated"
            : "This build plate preview couldn't be generated",
          preview.status === "generating" ? "PREVIEW_GENERATING" : "PREVIEW_FAILED",
        );
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.sendFile(path.resolve(preview.file));
      return;
    }
    const home = plate.print.assetsPath;
    const glbPath = modelPreviewGlbPath(plate.id, home);
    if (!fs.existsSync(glbPath)) {
      // The 404's code tells the viewer what to do: PREVIEW_DISABLED means parse in the browser;
      // otherwise generation is kicked off here and the viewer waits (PREVIEW_GENERATING) or gives up
      // (PREVIEW_FAILED), never parsing a file the server found too heavy.
      if (!plate.filename.toLowerCase().endsWith(".3mf")) throw new HttpError(404, "Not found");
      if ((await getPreviewMode()) === "disabled") {
        throw new HttpError(404, "Preview generation is disabled", "PREVIEW_DISABLED");
      }
      const srcPath = resolvePlateFilePath(plate);
      if (!srcPath) throw new HttpError(404, "Model file is missing", "PREVIEW_FAILED");
      void generateModelPreviewGlb(plate.id, srcPath, home);
      const state = modelPreviewState(plate.id, home);
      if (state === "unsupported") {
        throw new HttpError(404, "This 3MF's layout isn't supported by the server preview", "PREVIEW_UNSUPPORTED");
      }
      if (state === "failed") {
        throw new HttpError(404, "No preview could be generated for this model", "PREVIEW_FAILED");
      }
      throw new HttpError(404, "Preview is being generated", "PREVIEW_GENERATING");
    }
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(glbPath));
  }),
);

/** Serves one of the server's pictures of a plate. Built on first request for models from before that kind of picture
 *  existed; new uploads queue theirs straight away. */
function modelPictureHandler(kind: ModelImageKind) {
  return asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: await readablePrintWhere(req.userId!) },
      include: { print: { select: { assetsPath: true } } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    const imagePath = modelImagePath(plate.id, plate.print.assetsPath, kind);
    if (!fs.existsSync(imagePath)) {
      if (!canRenderModelImage(plate.filename))
        throw new HttpError(404, "No picture for this file type", "PREVIEW_UNSUPPORTED");
      if ((await getPreviewMode()) === "disabled") {
        throw new HttpError(404, "Preview generation is disabled", "PREVIEW_DISABLED");
      }
      const srcPath = resolvePlateFilePath(plate);
      if (!srcPath) throw new HttpError(404, "Model file is missing", "PREVIEW_FAILED");
      void generateCardRender(plate.id, srcPath, plate.filename);
      const state = modelImageState(plate.id, plate.print.assetsPath, kind);
      if (state === "unsupported") {
        throw new HttpError(404, "This file's layout can't be drawn by the server", "PREVIEW_UNSUPPORTED");
      }
      if (state === "failed") {
        throw new HttpError(404, "No picture could be made for this model", "PREVIEW_FAILED");
      }
      throw new HttpError(404, "Picture is being made", "PREVIEW_GENERATING");
    }
    res.setHeader("Content-Type", "image/png");
    // Versioned URLs never change; the bare one is how a missing picture gets asked for.
    res.setHeader("Cache-Control", req.query.v ? "private, max-age=31536000, immutable" : "private, no-cache");
    res.sendFile(path.resolve(imagePath));
  });
}

// The model in grey shading on transparent, which the browser tints with the render colour.
router.get("/plate/:plateId/render.png", modelPictureHandler("render"));

router.post(
  "/plate/:plateId/thumbnail-generated",
  thumbnailUpload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "No file uploaded");
    if (!["image/png", "image/jpeg", "image/webp"].includes((file.mimetype || "").toLowerCase())) {
      throw new HttpError(415, "Generated thumbnail must be PNG, JPEG, or WebP");
    }
    if (file.size > 8 * 1024 * 1024) throw new HttpError(413, "Generated thumbnail exceeds 8 MB");
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: { userId: req.userId } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    // A render that finishes after an import set the cover as the thumb mustn't replace it.
    const result = await saveGeneratedPlateThumbnail(plate.printId, plate.id, file.buffer);
    if (result === "invalid") throw new HttpError(400, "Invalid thumbnail image");
    if (result === "saved") {
      // Only when no better preview (e.g. an imported cover) exists.
      await addGeneratedPreviewImageIfNone(plate.printId, file.buffer);
    }
    res.json({ print: await printOutById(req.userId!, plate.printId) });
  }),
);

export default router;
