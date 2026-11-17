import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Print } from "@prisma/client";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS, UPLOADABLE_EXTS } from "../config";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import {
  addPlatesToPrint,
  createPrint,
  discardPrint,
  removePlate,
  type NewPlateInput,
  type PrintMetaInput,
} from "./printCreation";
import { batchFileSaver, deletePreparedFile, deleteSupportingFile, saveFileFromTemp } from "./printFileService";
import { isPreparedPrintFilename } from "./preparedPrint";
import { addPreviewImage, preferImageOverRenders } from "./previewImageService";
import { recordActivity } from "./activityService";
import { createLog } from "./auditLog";
import { isGltfName, packGltfFiles } from "./gltfPacker";

// A model made from the user's own files, as + Add > Upload makes it. Shared by POST /upload and the MCP
// upload_model tool, so both build the same model and leave the same trail.

export type UploadedFile = {
  /** A temp file, moved into storage. */
  path: string;
  /** Untrusted; sanitized here. */
  originalname: string;
  mimetype?: string | null;
  /** The folder it came from within the upload ("docs"), kept on the model's file; none for a flat pick. */
  folder?: string | null;
};

function isRenderable(file: UploadedFile): boolean {
  return RENDERABLE_MODEL_EXTS.has(path.extname(file.originalname).toLowerCase());
}

/** A file the model is printed from: a sliced 3MF beside them is its prepared print, not one of them. */
const isPlateFile = (file: UploadedFile) => isRenderable(file) && !isPreparedPrintFilename(file.originalname);

const isUploadable = (file: UploadedFile) => UPLOADABLE_EXTS.has(path.extname(file.originalname).toLowerCase());

/** The files a model of `files` is made of: its model files; else a sliced 3MF, printed from all the same; else what
 *  can be a model on its own, such as a picture or a design; else every file, so the model still has one. */
function plateFilesOf(files: UploadedFile[]): UploadedFile[] {
  for (const isPlate of [isPlateFile, isRenderable, isUploadable]) {
    const found = files.filter(isPlate);
    if (found.length) return found;
  }
  return files;
}

/** `files` with each .gltf packed, with the files it points at, into one .glb that takes its place. The files it
 *  used leave the list, for the caller to clean up with the rest; the .glbs are new temp files. */
async function withGltfPacked<T extends UploadedFile>(files: T[]): Promise<{ files: T[]; glbs: string[] }> {
  if (!files.some((f) => isGltfName(f.originalname))) return { files, glbs: [] };
  // By its path in the upload, so a scene takes the .bin in its own folder, not one of that name in another's.
  const named = files.map((file) => ({
    name: file.folder ? `${file.folder}/${file.originalname}` : file.originalname,
    path: file.path,
    file,
  }));
  const { files: left } = await packGltfFiles(
    named,
    () => path.join(os.tmpdir(), `thingport-glb-${crypto.randomBytes(8).toString("hex")}.glb`),
    (gltf, glbPath, glbName) => ({
      name: glbName,
      path: glbPath,
      file: {
        ...gltf.file,
        path: glbPath,
        originalname: gltf.file.originalname.replace(/\.gltf$/i, ".glb"),
        mimetype: "model/gltf-binary",
      },
    }),
  );
  const glbs = left.filter((f) => !files.includes(f.file)).map((f) => f.path);
  return { files: left.map((f) => f.file), glbs };
}

const removeAll = (paths: string[]) => Promise.all(paths.map((p) => fs.rm(p, { force: true }).catch(() => undefined)));

/** One model from `files`: its model files become its plates and the rest supporting files (`plateFilesOf` says
 *  what the plates are when there are no model files). All or nothing: a file that can't be stored takes the model
 *  with it. */
export async function createUploadedModel(
  userId: string,
  meta: PrintMetaInput,
  uploaded: UploadedFile[],
): Promise<Print> {
  const { files, glbs } = await withGltfPacked(uploaded);
  try {
    return await createModelFrom(userId, meta, files);
  } finally {
    // Moved into storage when the model was made; still here when it wasn't.
    await removeAll(glbs);
  }
}

async function createModelFrom(userId: string, meta: PrintMetaInput, files: UploadedFile[]): Promise<Print> {
  const plateFiles = plateFilesOf(files);
  const supporting = files.filter((f) => !plateFiles.includes(f));

  const plateInputs: NewPlateInput[] = plateFiles.map((f) => {
    const safeName = sanitizeFilename(f.originalname);
    return {
      filename: safeName,
      mime: mimeFromContentType(f.mimetype, safeName),
      tempFilePath: f.path,
      folder: f.folder ?? null,
    };
  });
  const nameHint = path.parse(plateInputs[0].filename).name;
  const { print } = await createPrint(userId, meta, nameHint, plateInputs);
  try {
    const save = batchFileSaver(userId, print.id);
    for (const f of supporting) await save(f.path, f.originalname, f.mimetype, { folder: f.folder ?? null });
  } catch (err) {
    await discardPrint(print.id);
    throw err;
  }

  void recordActivity(userId, "upload", print.id, print.name);
  void createLog({ userId, action: "model_uploaded", targetId: print.id, details: { name: print.name } });
  return print;
}

export type FileKind = "plate" | "supporting";

/** Adds files to one of the user's models: 3D files become plates, the rest supporting files (the first sliced print
 *  takes the place of the model's own, and any more are kept as supporting files), unless `kind` says otherwise. All
 *  or nothing. */
export async function addUploadedFiles(
  userId: string,
  printId: string,
  uploaded: (UploadedFile & { kind?: FileKind })[],
): Promise<{ plates: number; files: number }> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const { files, glbs } = await withGltfPacked(uploaded);
  try {
    return await addFilesTo(userId, print, files);
  } finally {
    await removeAll(glbs);
  }
}

async function addFilesTo(
  userId: string,
  print: Print,
  files: (UploadedFile & { kind?: FileKind })[],
): Promise<{ plates: number; files: number }> {
  const printId = print.id;
  const isPlate = (f: (typeof files)[number]) => (f.kind ? f.kind === "plate" : isPlateFile(f));
  // Last, since the print it replaces is gone once it's in: a file that fails before it leaves the model as it was.
  const prepared = files.find((f) => !f.kind && isPreparedPrintFilename(sanitizeFilename(f.originalname)));

  const plateIds: string[] = [];
  const before = new Set(
    (await prisma.printFile.findMany({ where: { printId }, select: { id: true } })).map((f) => f.id),
  );
  try {
    for (const f of prepared ? [...files.filter((other) => other !== prepared), prepared] : files) {
      if (isPlate(f)) {
        const safeName = sanitizeFilename(f.originalname);
        const [plate] = await addPlatesToPrint(userId, printId, [
          {
            filename: safeName,
            mime: mimeFromContentType(f.mimetype, safeName),
            tempFilePath: f.path,
            folder: f.folder ?? null,
          },
        ]);
        plateIds.push(plate.id);
      } else {
        // Asked for as a supporting file, a sliced print stays one rather than taking the prepared slot.
        await saveFileFromTemp(userId, printId, f.path, f.originalname, f.mimetype, {
          folder: f.folder ?? null,
          ...(f.kind === "supporting" ? { role: "SUPPORTING" as const } : {}),
          leavePrepared: f !== prepared,
        });
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
 *  ones are skipped. Returns the added ones' ids. An async iterable is read one picture at a time. */
export async function addUploadedPreviewImages(
  printId: string,
  buffers: Iterable<Buffer> | AsyncIterable<Buffer>,
): Promise<string[]> {
  return (await addUploadedPreviewImagesEach(printId, buffers)).filter((id): id is string => id !== null);
}

/** As addUploadedPreviewImages, with each picture's id in its place, null for one that was skipped: which images are
 *  whose, where the model can gain others at the same time. */
export async function addUploadedPreviewImagesEach(
  printId: string,
  buffers: Iterable<Buffer> | AsyncIterable<Buffer>,
): Promise<(string | null)[]> {
  const firstPlate = await prisma.plate.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  const each: (string | null)[] = [];
  let added = false;
  for await (const buffer of buffers) {
    const image = await addPreviewImage(printId, buffer, { keepExif: true });
    each.push(image?.id ?? null);
    if (!image) continue;
    if (!added) await preferImageOverRenders(printId, firstPlate?.id, buffer, true);
    added = true;
  }
  return each;
}
