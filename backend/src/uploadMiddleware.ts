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

// Browsers send multipart filenames as raw UTF-8 bytes, but multer decodes them as Latin-1 by
// default -- `哨子.3mf` would arrive as mojibake, and sanitizeFilename then strips the C1 bytes
// needed to recover it.
const defParamCharset = "utf8";

/** Disk-backed multer instance for model file uploads (never memoryStorage — files can be large). */
export const modelUpload = multer({ storage: diskStorage, limits: { fileSize: IMPORT_MAX_BYTES }, defParamCharset });

/** Small in-memory multer instance for the 8MB-capped client-rendered thumbnail upload. */
export const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 + 1 },
  defParamCharset,
});
