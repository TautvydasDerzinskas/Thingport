import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { thumbnailUpload } from "../uploadMiddleware";
import { removePreviewImage, reorderPreviewImages } from "../services/previewImageService";
import { addUploadedPreviewImagesEach } from "../services/uploadService";
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
    const added = await addUploadedPreviewImagesEach(
      print.id,
      files.map((f) => f.buffer),
    );
    // Which images are these files', in their order, null for one that wasn't a picture: the model can gain others
    // meanwhile, from another tab.
    res.json({ print: await printOutById(req.userId!, print.id), image_ids: added });
  }),
);

router.delete(
  "/print/:id/preview-images/:imageId",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await removePreviewImage(print.id, req.params.imageId);
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
    await reorderPreviewImages(print.id, body.image_ids);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

export default router;
