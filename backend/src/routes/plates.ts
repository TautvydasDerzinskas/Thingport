import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload, thumbnailUpload } from "../uploadMiddleware";
import {
  addPlatesToPrint,
  deletePlateFiles,
  refreshAutoPreparedMetadata,
  resolvePlateFilePath,
  type NewPlateInput,
} from "../services/printCreation";
import {
  availablePlateFilename,
  plateThumbPath,
  plateThumbReplaceable,
  relocatePrint,
  removePlatePictures,
  saveThumbFromBytes,
} from "../services/printService";
import { addGeneratedPreviewImageIfNone, generateCardRender } from "../services/previewImageService";
import { printOutById } from "../services/printLoader";
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

const router = Router();
router.use(requireAuth);

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
        const safeName = sanitizeFilename(f.originalname);
        return { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path };
      });
      await addPlatesToPrint(req.userId!, print.id, plateInputs);
      res.json({ print: await printOutById(req.userId!, print.id) });
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
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    const target = plates.find((p) => p.id === req.params.plateId);
    if (!target) throw new HttpError(404, "Plate not found");
    if (plates.length <= 1) {
      throw new HttpError(409, "Cannot remove the only plate of a print; delete the print instead.");
    }

    const remaining = plates.filter((p) => p.id !== target.id);
    // Renumber in two phases (negative temp positions) to avoid (printId, position) collisions.
    await prisma.plate.delete({ where: { id: target.id } });
    await prisma.$transaction(
      remaining.map((p, idx) => prisma.plate.update({ where: { id: p.id }, data: { position: -(idx + 1) } })),
    );
    await prisma.$transaction(
      remaining.map((p, idx) => prisma.plate.update({ where: { id: p.id }, data: { position: idx } })),
    );
    await deletePlateFiles(target);
    await removePlatePictures(target.id, print.assetsPath);

    if (target.position === 0) {
      await refreshAutoPreparedMetadata(print.id);
    }
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
    const plates = await prisma.plate.findMany({ where: { printId: print.id } });
    const byId = new Map(plates.map((p) => [p.id, p]));
    if (body.plate_ids.length !== plates.length || body.plate_ids.some((id) => !byId.has(id))) {
      throw new HttpError(400, "plate_ids must contain exactly the print's current plate ids");
    }
    const previousFirst = plates.toSorted((a, b) => a.position - b.position)[0]?.id;

    await prisma.$transaction(
      body.plate_ids.map((id, idx) => prisma.plate.update({ where: { id }, data: { position: -(idx + 1) } })),
    );
    await prisma.$transaction(
      body.plate_ids.map((id, idx) => prisma.plate.update({ where: { id }, data: { position: idx } })),
    );

    if (previousFirst !== body.plate_ids[0]) {
      await refreshAutoPreparedMetadata(print.id);
    }
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
    const plate = await prisma.plate.findUnique({ where: { id: req.params.plateId } });
    if (!plate || plate.printId !== print.id) throw new HttpError(404, "Plate not found");

    const sanitized = sanitizeFilename(body.filename);
    const nextFilename = await availablePlateFilename(print.id, sanitized, plate.id);
    if (nextFilename !== plate.filename) {
      await prisma.plate.update({ where: { id: plate.id }, data: { filename: nextFilename } });
      await relocatePrint(print, [{ ...plate, filename: nextFilename }]);
      if (plate.position === 0) {
        await refreshAutoPreparedMetadata(print.id);
      }
    }
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

router.get(
  "/plate/:plateId/thumb.jpg",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: { userId: req.userId } },
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

router.get(
  "/plate/:plateId/preview.glb",
  asyncHandler(async (req, res) => {
    const plate = await prisma.plate.findFirst({
      where: { id: req.params.plateId, print: { userId: req.userId } },
    });
    if (!plate) throw new HttpError(404, "Not found");
    const glbPath = modelPreviewGlbPath(plate.id);
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
      void generateModelPreviewGlb(plate.id, srcPath);
      const state = modelPreviewState(plate.id);
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
      where: { id: req.params.plateId, print: { userId: req.userId } },
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
