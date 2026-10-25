import path from "node:path";
import type { Print } from "@prisma/client";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS } from "../config";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import {
  addPlatesToPrint,
  createPrint,
  discardPrint,
  removePlate,
  type NewPlateInput,
  type PrintMetaInput,
} from "./printCreation";
import { deletePreparedFile, deleteSupportingFile, saveFileFromTemp } from "./printFileService";
import { isPreparedPrintFilename } from "./preparedPrint";
import { addPreviewImage, preferImageOverRenders } from "./previewImageService";
import { recordActivity } from "./activityService";
import { createLog } from "./auditLog";

// A model made from the user's own files, as + Add > Upload makes it. Shared by POST /upload and the MCP
// upload_model tool, so both build the same model and leave the same trail.

export type UploadedFile = {
  /** A temp file, moved into storage. */
  path: string;
  /** Untrusted; sanitized here. */
  originalname: string;
  mimetype?: string | null;
};

function isRenderable(file: UploadedFile): boolean {
  return RENDERABLE_MODEL_EXTS.has(path.extname(file.originalname).toLowerCase());
}

/** One model from `files`: the renderable ones become its plates and the rest supporting files. If nothing is
 *  renderable, every file becomes a plate so the model still has one. All or nothing: a file that can't be stored
 *  takes the model with it. */
export async function createUploadedModel(userId: string, meta: PrintMetaInput, files: UploadedFile[]): Promise<Print> {
  const renderable = files.filter(isRenderable);
  const supporting = renderable.length ? files.filter((f) => !isRenderable(f)) : [];
  const plateFiles = renderable.length ? renderable : files;

  const plateInputs: NewPlateInput[] = plateFiles.map((f) => {
    const safeName = sanitizeFilename(f.originalname);
    return { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path };
  });
  const nameHint = path.parse(plateInputs[0].filename).name;
  const { print } = await createPrint(userId, meta, nameHint, plateInputs);
  try {
    for (const f of supporting) await saveFileFromTemp(userId, print.id, f.path, f.originalname, f.mimetype);
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }

  void recordActivity(userId, "upload", print.id, print.name);
  void createLog({ userId, action: "model_uploaded", targetId: print.id, details: { name: print.name } });
  return print;
}

export type FileKind = "plate" | "supporting";

/** Adds files to one of the user's models: 3D files become plates, the rest supporting files (a sliced print takes
 *  the place of the model's own), unless `kind` says otherwise. All or nothing, bar a sliced print already replaced. */
export async function addUploadedFiles(
  userId: string,
  printId: string,
  files: (UploadedFile & { kind?: FileKind })[],
): Promise<{ plates: number; files: number }> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const isPlate = (f: (typeof files)[number]) =>
    f.kind ? f.kind === "plate" : isRenderable(f) && !isPreparedPrintFilename(f.originalname);

  const plateIds: string[] = [];
  const before = new Set(
    (await prisma.printFile.findMany({ where: { printId }, select: { id: true } })).map((f) => f.id),
  );
  try {
    for (const f of files) {
      if (isPlate(f)) {
        const safeName = sanitizeFilename(f.originalname);
        const [plate] = await addPlatesToPrint(userId, printId, [
          { filename: safeName, mime: mimeFromContentType(f.mimetype, safeName), tempFilePath: f.path },
        ]);
        plateIds.push(plate.id);
      } else {
        await saveFileFromTemp(userId, printId, f.path, f.originalname, f.mimetype);
      }
    }
  } catch (err) {
    for (const plateId of plateIds) await removePlate(print, plateId).catch(() => undefined);
    const added = await prisma.printFile.findMany({ where: { printId, id: { notIn: [...before] } } });
    for (const file of added) {
      const undo =
        file.role === "PREPARED" ? deletePreparedFile(userId, printId) : deleteSupportingFile(userId, printId, file.id);
      await undo.catch(() => undefined);
    }
    throw err;
  }
  return { plates: plateIds.length, files: files.length - plateIds.length };
}

/** Adds pictures to a model's gallery; the first that decodes becomes its cover in place of our render. Undecodable
 *  ones are skipped. Returns the added ones' ids. */
export async function addUploadedPreviewImages(printId: string, buffers: Buffer[]): Promise<string[]> {
  const firstPlate = await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  const added: string[] = [];
  for (const buffer of buffers) {
    const image = await addPreviewImage(printId, buffer, { keepExif: true });
    if (!image) continue;
    if (!added.length) await preferImageOverRenders(printId, firstPlate?.id, buffer, true);
    added.push(image.id);
  }
  return added;
}
