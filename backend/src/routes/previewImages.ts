import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { PICTURE_UPLOAD_MAX_FILES, thumbnailUpload } from "../uploadMiddleware";
import {
  removePreviewImage,
  reorderPreviewImages,
  resumePreviewUploadCoverQuietly,
} from "../services/previewImageService";
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

/** The pictures of an upload, bounded before any is held in memory; past a bound the answer is 413. */
const pictureFiles: RequestHandler = (req, res, next) =>
  thumbnailUpload.array("files")(req, res, (err: unknown) =>
    next(
      err instanceof multer.MulterError
        ? new HttpError(
            413,
            err.code === "LIMIT_FILE_SIZE"
              ? "A picture is larger than 8 MB"
              : `At most ${PICTURE_UPLOAD_MAX_FILES} pictures go in one upload`,
          )
        : err,
    ),
  );

router.post("/print/:id/preview-images", pictureFiles, uploadPreviews(false));
router.post("/print/:id/preview-images/idempotent", pictureFiles, uploadPreviews(true));

router.post(
  "/print/:id/preview-images/upload-results",
  asyncHandler(async (req, res) => {
    const { upload_ids } = parseBody(z.object({ upload_ids: uploadIdsSchema }), req.body);
    const print = await ownerPrint(req);
    // The receipts are answered whether or not the cover work can finish now.
    await resumePreviewUploadCoverQuietly(print.id);
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
