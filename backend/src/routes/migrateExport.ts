import express, { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { exportTokenOf, markExportRead, storageFile, storageFolder, streamDump } from "../services/migrate/export";
import { getBackendVersion } from "../services/versionService";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";

// What another Thingport instance reads to copy this one online, with the token an admin here made
// (services/migrate/export.ts). Nothing else is reachable with it, and nothing here is without it. Mounted before the
// app's own body parser, so a request's body is read only once its token checks out.
const router = Router();

router.use(
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const token = await exportTokenOf(req.headers.authorization);
    if (!token) throw new HttpError(401, "This instance doesn't know that migration token.", "online_token");
    res.locals.exportToken = token;
    next();
  }),
);
router.use(express.json({ limit: "4mb" }));

router.get(
  "/info",
  asyncHandler(async (_req, res) => {
    const [people, models] = await Promise.all([prisma.user.count(), prisma.print.count({ where: { toolId: null } })]);
    res.json({ version: getBackendVersion(), people, models });
  }),
);

router.get(
  "/dump",
  asyncHandler(async (_req, res) => {
    await markExportRead(res.locals.exportToken);
    streamDump(res);
  }),
);

// One file by its path in storage, as the database gives it; HEAD says whether it's there.
router.get(
  "/file",
  asyncHandler(async (req, res) => {
    const file = await storageFile(typeof req.query.path === "string" ? req.query.path : "");
    if (!file) throw new HttpError(404, "No such file");
    res.sendFile(file, { dotfiles: "allow", headers: { "Cache-Control": "no-store" } });
  }),
);

const missingSchema = z.object({ paths: z.array(z.string().max(4096)).max(1000) });

// Which of these paths storage hasn't got, asked for many at once.
router.post(
  "/missing",
  asyncHandler(async (req, res) => {
    const { paths } = parseBody(missingSchema, req.body);
    const missing: string[] = [];
    for (const relative of paths) if (!(await storageFile(relative))) missing.push(relative);
    res.json({ missing });
  }),
);

// The files under a folder of storage, relative to it.
router.get(
  "/folder",
  asyncHandler(async (req, res) => {
    res.json({ files: await storageFolder(typeof req.query.path === "string" ? req.query.path : "") });
  }),
);

export default router;
