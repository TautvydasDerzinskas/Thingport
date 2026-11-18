import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { Plate } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { createLogger } from "../logger";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload, thumbnailUpload } from "../uploadMiddleware";
import {
  addPlatesToPrint,
  refreshAutoPreparedMetadata,
  removePlate,
  renamePlate,
  renumberPlates,
  withPlateOrder,
  resolvePlateFilePath,
  type NewPlateInput,
} from "../services/printCreation";
import { plateThumbPath, plateThumbReplaceable, saveThumbFromBytes } from "../services/printService";
import { addGeneratedPreviewImageIfNone, generateCardRender } from "../services/previewImageService";
import { printOutById } from "../services/printLoader";
import { withGltfPacked } from "../services/uploadService";
import {
  generateModelPreviewGlb,
  modelPreviewGlbPath,
  modelPreviewState,
  modelImagePath,
  modelImageState,
  type ModelImageKind,
  canRenderModelImage,
} from "../services/modelPreviewCache";
import { getPreviewMode } from "../services/settingsService";
import { readablePrintWhere } from "../services/socialService";
import { isProfileProject, plateThumbEntry } from "../services/printProfileFile";
import { readZipEntry } from "../utils/zipReader";

const log = createLogger("plates");
const router = Router();
router.use(requireAuth);

router.post(
  "/print/:id/plates",
  modelUpload.array("files"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    let glbs: string[] = [];
    try {
      if (!files.length) throw new HttpError(400, "No files uploaded");
      const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!print) throw new HttpError(404, "Print not found");

      // A .gltf is one plate, a .glb packed with the files it points at that came with it, as an upload makes it.
      const packed = await withGltfPacked(files);
      glbs = packed.glbs;
      const plateInputs: NewPlateInput[] = packed.files.map((f) => {
        const safeName = sanitizeFilename(f.originalname);
        return { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path };
      });
      // All or none, the model read back for the answer included: a retry sends every file again, so those already
      // in would come back twice. A plate that can't be taken back is logged, as there's no more to do then.
      const added: Plate[] = [];
      let out: Awaited<ReturnType<typeof printOutById>>;
      try {
        for (const input of plateInputs) added.push(...(await addPlatesToPrint(req.userId!, print.id, [input])));
        out = await printOutById(req.userId!, print.id);
      } catch (err) {
        for (const plate of added) {
          await removePlate(print, plate.id).catch((failure: unknown) =>
            log.error("couldn't take back a plate of a batch that failed", { plate: plate.id, error: failure }),
          );
        }
        throw err;
      }
      // Which plates are these files', in their order: the model can gain others meanwhile, from another tab.
      // `plate_ids` has one per plate made; `uploaded`, one per file sent: the plate it became, or `packed` where a
      // .gltf sent with it took it in.
      let made = 0;
      const uploaded = files.map((f) =>
        packed.packedInto.has(f) ? { plate_id: null, packed: true } : { plate_id: added[made++].id, packed: false },
      );
      res.json({ print: out, plate_ids: added.map((plate) => plate.id), uploaded });
    } finally {
      for (const tempPath of [...files.map((f) => f.path), ...glbs]) {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
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
    await withPlateOrder(print.id, async () => {
      const plates = await prisma.plate.findMany({ where: { printId: print.id } });
      const byId = new Map(plates.map((p) => [p.id, p]));
      if (
        body.plate_ids.length !== plates.length ||
        new Set(body.plate_ids).size !== body.plate_ids.length ||
        body.plate_ids.some((id) => !byId.has(id))
      ) {
        throw new HttpError(400, "plate_ids must contain exactly the print's current plate ids");
      }
      const first = plates.toSorted((a, b) => a.position - b.position)[0]?.id;
      await renumberPlates(body.plate_ids);
      // Read for the first plate while it's still first: a reorder after this lock would leave a reading of another.
      if (first !== body.plate_ids[0]) await refreshAutoPreparedMetadata(print.id);
    });
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

const renameSchema = z.object({ filename: z.string().min(1) });
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
    if (!Number.isInteger(index) || index < 1 || index > 9999) throw new HttpError(404, "Not found");
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: await readablePrintWhere(req.userId!) },
    });
    if (!plate || !isProfileProject(plate.filename)) throw new HttpError(404, "Not found");
    const filePath = resolvePlateFilePath(plate);
    const png = filePath
      ? await readZipEntry(filePath, plateThumbEntry(index), PLATE_PICTURE_LIMIT).catch(() => null)
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
    if (await plateThumbReplaceable(plate.id)) {
      const ok = await saveThumbFromBytes(plate.id, file.buffer);
      if (!ok) throw new HttpError(400, "Invalid thumbnail image");
      await prisma.plate.update({ where: { id: plate.id }, data: { thumbGenerated: true } });
      // Only when no better preview (e.g. an imported cover) exists.
      await addGeneratedPreviewImageIfNone(plate.printId, file.buffer);
    }
    res.json({ print: await printOutById(req.userId!, plate.printId) });
  }),
);

export default router;
