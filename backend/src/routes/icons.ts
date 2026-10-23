import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { ICON_MAX_BYTES, deleteIcon, iconPath, listIcons, saveIcon } from "../services/iconService";

// Icons the user uploaded, to pick for a launcher link or a custom widget. Their files are public, by an id no one can
// guess, so an <img> shows them without a token, on the dashboard or in an app that reads it.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ICON_MAX_BYTES + 1 } });

router.get("/icons/:file", (req, res, next) => {
  const file = iconPath(String(req.params.file));
  if (!file) return next();
  res.setHeader("Content-Type", file.endsWith(".svg") ? "image/svg+xml" : "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // An SVG opened on its own stays a picture: no scripts, nothing loaded from elsewhere.
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ detail: "Not found" });
  });
});

router.get(
  "/icons",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ icons: await listIcons(req.userId!) });
  }),
);

router.post(
  "/icons",
  requireAuth,
  (req, res, next) =>
    upload.single("file")(req, res, (err: unknown) =>
      next(err instanceof multer.MulterError ? new HttpError(413, "The icon is larger than 1 MB") : err),
    ),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    res.json(await saveIcon(req.userId!, req.file));
  }),
);

router.delete(
  "/icons/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteIcon(req.userId!, String(req.params.id));
    res.status(204).end();
  }),
);

export default router;
