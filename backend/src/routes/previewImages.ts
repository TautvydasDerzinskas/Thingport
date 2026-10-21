import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { thumbnailUpload } from "../uploadMiddleware";
import { addPreviewImage, preferImageOverRenders, removePreviewImageFile } from "../services/previewImageService";
import { printOutById } from "../services/printLoader";

const router = Router();
router.use(requireAuth);

router.post(
  "/print/:id/preview-images",
  thumbnailUpload.array("files"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) throw new HttpError(400, "No files uploaded");
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    // As with an import's gallery, the first image becomes the cover and card thumbnail in place of our render.
    const firstPlate = await prisma.plate.findFirst({ where: { printId: print.id }, orderBy: { position: "asc" } });
    let preferred = false;
    // Undecodable files are skipped rather than failing the batch.
    for (const file of files) {
      const added = await addPreviewImage(print.id, file.buffer);
      if (added && !preferred) {
        preferred = true;
        await preferImageOverRenders(print.id, firstPlate?.id, file.buffer);
      }
    }
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

router.delete(
  "/print/:id/preview-images/:imageId",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const images = await prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    const target = images.find((img) => img.id === req.params.imageId);
    if (!target) throw new HttpError(404, "Preview image not found");

    const remaining = images.filter((img) => img.id !== target.id);
    // Two-phase renumber, as in plates.ts, to avoid (printId, position) collisions.
    await prisma.previewImage.delete({ where: { id: target.id } });
    await prisma.$transaction(
      remaining.map((img, idx) =>
        prisma.previewImage.update({ where: { id: img.id }, data: { position: -(idx + 1) } }),
      ),
    );
    await prisma.$transaction(
      remaining.map((img, idx) => prisma.previewImage.update({ where: { id: img.id }, data: { position: idx } })),
    );
    await removePreviewImageFile(print.id, target.id);

    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

const reorderSchema = z.object({ image_ids: z.array(z.string()).min(1) });
router.post(
  "/print/:id/preview-images/reorder",
  asyncHandler(async (req, res) => {
    const body = parseBody(reorderSchema, req.body);
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const images = await prisma.previewImage.findMany({ where: { printId: print.id } });
    const byId = new Map(images.map((img) => [img.id, img]));
    if (body.image_ids.length !== images.length || body.image_ids.some((id) => !byId.has(id))) {
      throw new HttpError(400, "image_ids must contain exactly the print's current preview image ids");
    }

    await prisma.$transaction(
      body.image_ids.map((id, idx) => prisma.previewImage.update({ where: { id }, data: { position: -(idx + 1) } })),
    );
    await prisma.$transaction(
      body.image_ids.map((id, idx) => prisma.previewImage.update({ where: { id }, data: { position: idx } })),
    );
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

export default router;
