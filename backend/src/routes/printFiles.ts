import fs from "node:fs";
import { Router, type Response } from "express";
import type { PrintFile } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth } from "../auth";
import { attachmentDisposition, HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { sendStored } from "../utils/sendStored";
import { modelUpload } from "../uploadMiddleware";
import {
  deletePreparedFile,
  deleteSupportingFile,
  listSupportingFiles,
  managedPrintFilePath,
  printFileStillNames,
  saveFileFromTemp,
} from "../services/printFileService";
import { toPrintFileOut } from "../dto";
import { printOutById } from "../services/printLoader";
import { readablePrintWhere } from "../services/socialService";

const router = Router();
router.use(requireAuth);

function fileHeaders(res: Response, record: PrintFile): void {
  res.setHeader("Content-Type", record.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", attachmentDisposition(record.filename));
}

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
      await saveFileFromTemp(req.userId!, print.id, file.path, file.originalname || "supporting-file", file.mimetype);
      res.json({ print: await printOutById(req.userId!, print.id) });
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
    await sendStored(res, {
      filePath: managedPrintFilePath(record),
      site: "serve.supporting",
      stillNames: () => printFileStillNames(record),
      headers: () => fileHeaders(res, record),
    });
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
    await sendStored(res, {
      filePath: managedPrintFilePath(record),
      site: "serve.prepared",
      stillNames: () => printFileStillNames(record, { prepared: true }),
      headers: () => fileHeaders(res, record),
    });
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
