import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { thumbnailUpload } from "../uploadMiddleware";
import { removePreviewImage, reorderPreviewImages } from "../services/previewImageService";
import { addUploadedPreviewImages } from "../services/uploadService";
import { printOutById } from "../services/printLoader";

const router = Router();
router.use(requireAuth);

const uploadIdsSchema = z
  .array(z.string().regex(/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/))
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate preview upload IDs");

async function ownerPrint(req: Request) {
  const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!print) throw new HttpError(404, "Print not found");
  return print;
}

function uploadPreviews(keyed: boolean) {
  return asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) throw new HttpError(400, "No files uploaded");
    const print = await ownerPrint(req);
    const field: unknown = req.body?.upload_ids;
    const uploadIds = keyed ? parseBody(uploadIdsSchema, Array.isArray(field) ? field : [field]) : undefined;
    if (uploadIds && uploadIds.length !== files.length) throw new HttpError(400, "Give one upload ID per image");
    const addedImageIds: (string | null)[] = [];
    await addUploadedPreviewImages(
      print.id,
      files.map((file) => file.buffer),
      { uploadIds, onImageResult: (id) => addedImageIds.push(id) },
    );
    res.json({ print: await printOutById(req.userId!, print.id), added_image_ids: addedImageIds });
  });
}

router.post("/print/:id/preview-images", thumbnailUpload.array("files"), uploadPreviews(false));
router.post("/print/:id/preview-images/idempotent", thumbnailUpload.array("files"), uploadPreviews(true));

router.post(
  "/print/:id/preview-images/upload-results",
  asyncHandler(async (req, res) => {
    const { upload_ids } = parseBody(z.object({ upload_ids: uploadIdsSchema }), req.body);
    const print = await ownerPrint(req);
    const receipts = await prisma.previewImageUpload.findMany({
      where: { printId: print.id, uploadId: { in: upload_ids } },
    });
    res.json({
      print: await printOutById(req.userId!, print.id),
      upload_results: receipts.map((receipt) => ({ upload_id: receipt.uploadId, image_id: receipt.imageId })),
    });
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
