import path from "node:path";
import type { Print } from "@prisma/client";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS } from "../config";
import { sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { createPrint, discardPrint, type NewPlateInput, type PrintMetaInput } from "./printCreation";
import { saveFileFromTemp } from "./printFileService";
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

/** Adds pictures to a model's gallery; the first that decodes becomes its cover in place of our render. Undecodable
 *  ones are skipped. Returns how many were added. */
export async function addUploadedPreviewImages(printId: string, buffers: Buffer[]): Promise<number> {
  const firstPlate = await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  let added = 0;
  for (const buffer of buffers) {
    if (!(await addPreviewImage(printId, buffer, { keepExif: true }))) continue;
    if (added === 0) await preferImageOverRenders(printId, firstPlate?.id, buffer, true);
    added++;
  }
  return added;
}
