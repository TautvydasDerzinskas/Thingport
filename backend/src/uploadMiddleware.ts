import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import { IMPORT_MAX_BYTES } from "./config";

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    cb(null, `thingport-upload-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

// Browsers send UTF-8 filenames but multer defaults to Latin-1.
const defParamCharset = "utf8";

/** Disk-backed, since model files can be large. */
export const modelUpload = multer({ storage: diskStorage, limits: { fileSize: IMPORT_MAX_BYTES }, defParamCharset });

/** At most this many pictures in one request, as they're held in memory until it's handled; the app sends more in
 *  batches. */
export const PICTURE_UPLOAD_MAX_FILES = 20;

export const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  // Each picture may come with its upload ID, and a few other fields besides.
  limits: { fileSize: 8 * 1024 * 1024 + 1, files: PICTURE_UPLOAD_MAX_FILES, parts: PICTURE_UPLOAD_MAX_FILES * 2 + 8 },
  defParamCharset,
});
