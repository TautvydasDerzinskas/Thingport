import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type NextFunction, type Request, type RequestHandler, type Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { createExportToken, exportTokenState, revokeExportToken } from "../services/migrate/export";
import {
  changeFolder,
  getRun,
  listRuns,
  prepareFromDump,
  manyfoldOwner,
  prepareManyfold,
  prepareOnline,
  removeRun,
  startManyfold,
  startRun,
  UPLOADS,
} from "../services/migrate/runs";
import { MigrateHttpError } from "../services/migrate/errors";
import { migrateRoot } from "../services/migrate/sourceFiles";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";

// Administration > Migrate: mounted by admin.ts behind its admin-only guards, so an API token never reaches it.
const router = Router();

const dumpUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOADS, { recursive: true });
      cb(null, UPLOADS);
    },
    filename: (_req, _file, cb) => cb(null, `dump-${crypto.randomBytes(8).toString("hex")}`),
  }),
  // A big library's dump is big; the web server in front decides how big an upload may be.
  limits: { files: 1 },
  defParamCharset: "utf8",
});

/** The dump, as `dump`, or a 400 that says what went wrong. */
const oneDump: RequestHandler = (req, res, next) =>
  dumpUpload.single("dump")(req, res, (err: unknown) => {
    if (!(err instanceof multer.MulterError)) return next(err);
    next(new HttpError(400, "Send one database dump, as `dump`"));
  });

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ runs: await listRuns(), root: migrateRoot() });
  }),
);

// Letting another instance copy this one online: a token, shown once, that lets it read this instance for a day.
// Before /:id, which would take "export-token" for a migration's id.
router.get(
  "/export-token",
  asyncHandler(async (_req, res) => {
    res.json(await exportTokenState());
  }),
);

router.post(
  "/export-token",
  asyncHandler(async (req, res) => {
    res.json(await createExportToken(req.userId!));
  }),
);

router.delete(
  "/export-token",
  asyncHandler(async (req, res) => {
    await revokeExportToken(req.userId!);
    res.status(204).end();
  }),
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await getRun(String(req.params.id)));
  }),
);

// From another Thingport instance: its database dump, uploaded or as a path on this server, and its storage folder.
router.post(
  "/thingport",
  oneDump,
  asyncHandler(async (req, res) => {
    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (req.file) {
      res.status(202).json(
        await prepareFromDump(req.userId!, {
          file: req.file.path,
          name: req.file.originalname || "dump",
          uploaded: true,
          folder,
        }),
      );
      return;
    }
    const given = typeof req.body?.dump_path === "string" ? req.body.dump_path.trim() : "";
    if (!given || !path.isAbsolute(given)) {
      throw new HttpError(400, "Upload the dump, or give its full path on this server.", "dump_missing");
    }
    res
      .status(202)
      .json(await prepareFromDump(req.userId!, { file: given, name: path.basename(given), uploaded: false, folder }));
  }),
);

const onlineSchema = z.object({ address: z.string().min(1).max(2048), token: z.string().max(256) });

// From another Thingport instance online, with the token its admin made there.
router.post(
  "/thingport-online",
  asyncHandler(async (req, res) => {
    res.status(202).json(await prepareOnline(req.userId!, parseBody(onlineSchema, req.body)));
  }),
);

const manyfoldSchema = z.object({
  address: z.string().min(1).max(2048),
  clientId: z.string().min(1).max(512),
  clientSecret: z.string().min(1).max(512),
});

// From Manyfold, with an API key made there: checked at once, and ready to start.
router.post(
  "/manyfold",
  asyncHandler(async (req, res) => {
    res.json(await prepareManyfold(req.userId!, parseBody(manyfoldSchema, req.body)));
  }),
);

const ownerSchema = z.object({ username: z.string().min(1).max(256) });

// How many models someone owns on that Manyfold, by their username there.
router.post(
  "/:id/manyfold-owner",
  asyncHandler(async (req, res) => {
    res.json(await manyfoldOwner(String(req.params.id), parseBody(ownerSchema, req.body).username));
  }),
);

const manyfoldStartSchema = z.object({
  owners: z.array(z.object({ username: z.string().min(1).max(256), userId: z.string().min(1).max(64) })).max(1000),
  collections: z.boolean(),
});

router.post(
  "/:id/start-manyfold",
  asyncHandler(async (req, res) => {
    res
      .status(202)
      .json(await startManyfold(String(req.params.id), req.userId!, parseBody(manyfoldStartSchema, req.body)));
  }),
);

const startSchema = z.object({
  people: z.array(z.string().min(1).max(64)).max(10_000),
  collections: z.boolean(),
  studio: z.boolean(),
  widgets: z.boolean(),
  tools: z.boolean(),
  syncs: z.boolean(),
  signIns: z.boolean(),
  settings: z.boolean(),
  secrets: z.boolean(),
});

router.post(
  "/:id/start",
  asyncHandler(async (req, res) => {
    res.status(202).json(await startRun(String(req.params.id), req.userId!, parseBody(startSchema, req.body)));
  }),
);

const folderSchema = z.object({ folder: z.string().min(1).max(4096) });

// Another storage folder for a prepared migration, its files counted there again.
router.post(
  "/:id/folder",
  asyncHandler(async (req, res) => {
    res.json(await changeFolder(String(req.params.id), parseBody(folderSchema, req.body).folder));
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await removeRun(String(req.params.id));
    res.status(204).end();
  }),
);

// A migration's own reasons go out with the values their sentences need, as a folder's path.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!(err instanceof MigrateHttpError)) return next(err);
  res.status(err.status).json({ detail: err.message, code: err.code, values: err.values });
});

export default router;
