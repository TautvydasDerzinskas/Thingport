import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { create as contentDisposition } from "content-disposition";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { modelUpload } from "../uploadMiddleware";
import { z } from "zod";
import { parseBody } from "../utils/validate";
import {
  deletePreparedFile,
  deleteSupportingFile,
  inlineContentType,
  listSupportingFiles,
  managedPrintFilePath,
  renameSupportingFile,
  saveFileFromTemp,
} from "../services/printFileService";
import { toPrintFileOut } from "../dto";
import { printOutById } from "../services/printLoader";
import { readablePrintWhere } from "../services/socialService";

const router = Router();
router.use(requireAuth);

router.get(
  "/print/:id/files",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({
      where: { id: req.params.id, AND: [await readablePrintWhere(req.userId!)] },
    });
    if (!print) throw new HttpError(404, "Print not found");
    const files = await listSupportingFiles(print.id);
    res.json(files.map(toPrintFileOut));
  }),
);

router.post(
  "/print/:id/files",
  modelUpload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    try {
      if (!file) throw new HttpError(400, "No file uploaded");
      const print = await prisma.print.findFirst({ where: { id: req.params.id, userId: req.userId } });
      if (!print) throw new HttpError(404, "Print not found");
      // Which of the model's files this one is, for a client finding it among them: a name can be another's too.
      const stored: { id?: string; prepared?: boolean } = {};
      await saveFileFromTemp(req.userId!, print.id, file.path, file.originalname || "supporting-file", file.mimetype, {
        // keep_prepared=1: one of several sent in turn, which keeps the prepared print an earlier one took, as an
        // upload of them together does (batchFileSaver). `prepared` tells the client when one took it.
        leavePrepared: req.body?.keep_prepared === "1",
        onStored: (role, id) => {
          stored.id = id;
          stored.prepared = role === "PREPARED";
        },
      });
      res.json({ print: await printOutById(req.userId!, print.id), file_id: stored.id, prepared: stored.prepared });
    } finally {
      if (file && fs.existsSync(file.path)) fs.rmSync(file.path, { force: true });
    }
  }),
);

router.get(
  "/print/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({
      where: { id: req.params.id, AND: [await readablePrintWhere(req.userId!)] },
    });
    if (!print) throw new HttpError(404, "Not found");
    const record = await prisma.printFile.findUnique({ where: { id: req.params.fileId } });
    if (!record || record.printId !== print.id || record.role !== "SUPPORTING") {
      throw new HttpError(404, "Not found");
    }
    const filePath = managedPrintFilePath(record);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Not found");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // ?inline=1 shows it in the browser (the model page's viewer, a new tab) where its type is safe to; the rest still
    // download.
    const inlineType = req.query.inline === "1" ? inlineContentType(record.filename) : null;
    if (inlineType) {
      res.setHeader("Content-Type", inlineType);
      res.setHeader("Content-Disposition", contentDisposition(record.filename, { type: "inline" }));
      // A PDF needs the browser's own viewer, which a sandbox would turn away; text and pictures need nothing at all.
      if (inlineType !== "application/pdf") res.setHeader("Content-Security-Policy", "sandbox");
    } else {
      res.setHeader("Content-Type", record.mime || "application/octet-stream");
      // The name as it is (a name beyond ASCII also as filename*): percent-escaped, it was saved as "Parts%20list.csv".
      res.setHeader("Content-Disposition", contentDisposition(record.filename));
    }
    res.sendFile(path.resolve(filePath));
  }),
);

const renameSchema = z.object({ filename: z.string().min(1).max(255) });

router.patch(
  "/print/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const body = parseBody(renameSchema, req.body);
    await renameSupportingFile(req.userId!, req.params.id, req.params.fileId, body.filename);
    res.json({ print: await printOutById(req.userId!, req.params.id) });
  }),
);

router.delete(
  "/print/:id/files/:fileId",
  asyncHandler(async (req, res) => {
    const print = await deleteSupportingFile(req.userId!, req.params.id, req.params.fileId);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

router.get(
  "/print/:id/prepared-print",
  asyncHandler(async (req, res) => {
    const print = await prisma.print.findFirst({
      where: { id: req.params.id, AND: [await readablePrintWhere(req.userId!)] },
    });
    if (!print || !print.preparedFileId) throw new HttpError(404, "Not found");
    const record = await prisma.printFile.findUnique({ where: { id: print.preparedFileId } });
    if (!record || record.printId !== print.id || record.role !== "PREPARED") throw new HttpError(404, "Not found");
    const filePath = managedPrintFilePath(record);
    if (!fs.existsSync(filePath)) throw new HttpError(404, "Not found");
    res.setHeader("Content-Type", record.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", contentDisposition(record.filename));
    res.sendFile(path.resolve(filePath));
  }),
);

router.delete(
  "/print/:id/prepared-print",
  asyncHandler(async (req, res) => {
    const print = await deletePreparedFile(req.userId!, req.params.id);
    res.json({ print: await printOutById(req.userId!, print.id) });
  }),
);

export default router;
