import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Print } from "@prisma/client";
import { prisma } from "../db";
import { RENDERABLE_MODEL_EXTS, UPLOADABLE_EXTS } from "../config";
import { HttpError, sanitizeFilename, mimeFromContentType, trimFilename } from "../utils/fileUtils";
import { createPrint, discardPrint, withPlateBatch, type NewPlateInput, type PrintMetaInput } from "./printCreation";
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
  /** That folder as the upload named it, before it was cleaned up to be kept: what a .gltf's references are matched
   *  against, as two folders can be kept alike ("A B" and "A  B"). Null for the top of the upload; `folder` where it
   *  wasn't said. */
  sourceFolder?: string | null;
};

// Each told by the name it's kept by, as the app tells them (addedFiles' keptName): "part.stl " is a model file.
const extOf = (file: UploadedFile) => path.extname(trimFilename(file.originalname)).toLowerCase();

function isRenderable(file: UploadedFile): boolean {
  return RENDERABLE_MODEL_EXTS.has(extOf(file));
}

/** A file the model is printed from: a sliced 3MF beside them is its prepared print, not one of them. */
const isPlateFile = (file: UploadedFile) =>
  isRenderable(file) && !isPreparedPrintFilename(trimFilename(file.originalname));

const isUploadable = (file: UploadedFile) => UPLOADABLE_EXTS.has(extOf(file));

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
 *  used leave the list (`packedInto` names them), for the caller to clean up with the rest; the .glbs are new temp
 *  files. The rest keep their order, each .glb where its .gltf was. */
export async function withGltfPacked<T extends UploadedFile>(
  files: T[],
): Promise<{ files: T[]; glbs: string[]; packedInto: Set<T> }> {
  // A scene is told by the name it's kept by ("scene.gltf "), as is the .glb it becomes; the files it names are found
  // by their names as they came (gltfPacker's findReferenced).
  if (!files.some((f) => isGltfName(f.originalname))) return { files, glbs: [], packedInto: new Set() };
  // By its path in the upload, so a scene takes the .bin in its own folder, not one of that name in another's.
  const named = files.map((file) => {
    // Null is the top of the upload, though the file is kept in a folder; only one not said takes the kept one.
    const folder = file.sourceFolder !== undefined ? file.sourceFolder : file.folder;
    return { name: folder ? `${folder}/${file.originalname}` : file.originalname, path: file.path, file };
  });
  const { files: left, packed } = await packGltfFiles(
    named,
    () => path.join(os.tmpdir(), `thingport-glb-${crypto.randomBytes(8).toString("hex")}.glb`),
    (gltf, glbPath, glbName) => ({
      name: glbName,
      path: glbPath,
      file: {
        ...gltf.file,
        path: glbPath,
        originalname: trimFilename(gltf.file.originalname).replace(/\.gltf$/i, ".glb"),
        mimetype: "model/gltf-binary",
      },
    }),
  );
  const glbs = left.filter((f) => !files.includes(f.file)).map((f) => f.path);
  // The files a .gltf took in, as against the .gltfs themselves, which became their .glbs.
  const packedInto = new Set(packed.filter((f) => !isGltfName(f.name)).map((f) => f.file));
  return { files: left.map((f) => f.file), glbs, packedInto };
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
 *  takes the place of the model's own, and any more are kept as supporting files), unless `kind` says otherwise. When
 *  one can't be stored, what this added is taken back as far as it can be (the plates by withPlateBatch, the other files
 *  by addFilesTo) and the error is the caller's: one that couldn't be taken back stays, for the caller to look for
 *  before trying again. */
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

  // With the plate order held throughout, so the plates added are taken back, as far as they can be, if a later file
  // fails, with no other request's change to the model's plates in between (withPlateBatch).
  return withPlateBatch(userId, printId, async (add) => {
    let plates = 0;
    // The files this request saved, by the ids their saves gave: another tab's added meanwhile aren't ours to undo.
    const saved: { id: string; role: "SUPPORTING" | "PREPARED" }[] = [];
    try {
      for (const f of prepared ? [...files.filter((other) => other !== prepared), prepared] : files) {
        if (isPlate(f)) {
          const safeName = sanitizeFilename(f.originalname);
          await add([
            {
              filename: safeName,
              mime: mimeFromContentType(f.mimetype, safeName),
              tempFilePath: f.path,
              folder: f.folder ?? null,
            },
          ]);
          plates += 1;
        } else {
          // Asked for as a supporting file, a sliced print stays one rather than taking the prepared slot.
          await saveFileFromTemp(userId, printId, f.path, f.originalname, f.mimetype, {
            folder: f.folder ?? null,
            ...(f.kind === "supporting" ? { role: "SUPPORTING" as const } : {}),
            leavePrepared: f !== prepared,
            onStored: (role, id) => saved.push({ id, role }),
          });
        }
      }
    } catch (err) {
      for (const file of saved) {
        // The prepared print only while it's still this one: another upload may have replaced it since.
        const undo =
          file.role === "PREPARED"
            ? deletePreparedFile(userId, printId, file.id)
            : deleteSupportingFile(userId, printId, file.id);
        await undo.catch(() => undefined);
      }
      throw err;
    }
    return { plates, files: files.length - plates };
  });
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
    // The picture is stored by now: one that can't be made the cover is still answered with its id, so the app doesn't
    // send it again.
    if (!added) {
      await preferImageOverRenders(printId, firstPlate?.id, buffer, true).catch((err: unknown) =>
        console.warn(`Couldn't make an uploaded picture the cover of model ${printId}:`, err),
      );
    }
    added = true;
  }
  return each;
}
