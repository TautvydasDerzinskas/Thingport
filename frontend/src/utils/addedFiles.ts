import { LIGHTBURN_EXTS, MODEL_EXTS } from "../constants/fileTypes";
import { extOf } from "./fileExtensions";
import { gltfBundles } from "./uploadTree";
import { printsApi } from "../api/prints";

// Where a file added to a model goes. Mirrors the backend's split of an upload (services/uploadService.ts): 3D files
// are the model's files, and anything else is kept beside them as a supporting file.

/** Pictures a model's gallery takes, as the folder upload picks them (utils/uploadTree.ts). */
const PICTURE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);

/** A sliced print: kept beside the model as its prepared print, never one of its files to slice. */
const PREPARED_SUFFIXES = [".gcode.3mf", ".gcode", ".gco", ".bgcode"];

export function isPreparedName(name: string): boolean {
  const lower = name.toLowerCase();
  return PREPARED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * After the upload of `name` failed, whether it may be the model's prepared print all the same: a sliced print whose
 * answer never came (a dropped connection) or that failed after it was saved may be in. `status` is the server's
 * answer, null for none; one it turned away (4xx) kept nothing.
 */
export function mayHoldPrepared(name: string, status: number | null): boolean {
  return isPreparedName(name) && !(status !== null && status >= 400 && status < 500);
}

/**
 * After the upload of sliced print `name` to model `printId` failed, whether it is the model's prepared print now: none
 * where the server turned it away, else as the model says when read again. One the model can't be read for is taken
 * as in, so the next is kept beside it rather than put over a print that may be there.
 */
export async function preparedAfterFailure(printId: string, name: string, status: number | null): Promise<boolean> {
  if (!mayHoldPrepared(name, status)) return false;
  try {
    const model = await printsApi.get(printId);
    return Boolean(model.prepared_print?.removable) && model.slicer_filename === name;
  } catch {
    return true;
  }
}

/** A file the model is printed, cut or engraved from: a mesh, a CAD exchange file or a LightBurn project. */
export function isModelFileName(name: string): boolean {
  if (isPreparedName(name)) return false;
  const ext = extOf(name);
  // A .gltf is packed into a .glb with the files it points at.
  return MODEL_EXTS.has(ext) || LIGHTBURN_EXTS.has(ext) || ext === "gltf";
}

export function isPictureName(name: string): boolean {
  return PICTURE_EXTS.has(extOf(name));
}

/**
 * The files added from one list sorted into where they belong: a document added among the model files is a supporting
 * file, a 3D file added among the supporting files is a model file. A picture stays where it was added, as an image
 * model's files are pictures too.
 */
export function sortAddedFiles<T extends { name: string }>(
  files: T[],
  addedTo: "model" | "supporting",
): { model: T[]; supporting: T[] } {
  const model: T[] = [];
  const supporting: T[] = [];
  for (const file of files) {
    const belongsWithModel = isModelFileName(file.name) || (addedTo === "model" && isPictureName(file.name));
    (belongsWithModel ? model : supporting).push(file);
  }
  return { model, supporting };
}

/**
 * `sorted` with each .gltf among the model files followed by the files of the same addition it points at -- its .bin
 * and textures -- wherever they were sorted to: the server packs them with it into one .glb, so they go up with it in
 * one request, never as files of their own. `packedWith` has every file each .gltf points at, one two scenes share
 * under both, though `model` lists it once. Found as a folder upload finds them.
 */
export async function withGltfFiles<T>(
  sorted: { model: T[]; supporting: T[] },
  fileOf: (item: T) => File,
): Promise<{ model: T[]; supporting: T[]; packedWith: Map<T, T[]> }> {
  const all = [...sorted.model, ...sorted.supporting];
  const packedWith = new Map<T, T[]>();
  if (!all.some((item) => extOf(fileOf(item).name) === "gltf")) return { ...sorted, packedWith };
  const entries = all.map((item) => ({ file: fileOf(item), relativePath: "" }));
  for (const [gltf, found] of await gltfBundles(entries)) {
    packedWith.set(
      all[entries.indexOf(gltf)],
      found.map((entry) => all[entries.indexOf(entry)]),
    );
  }
  const packed = new Set([...packedWith.values()].flat());
  // A file two scenes share goes up once, after the first: the server packs it into both.
  const sent = new Set<T>();
  const once = (items: T[]) =>
    items.filter((item) => {
      if (sent.has(item)) return false;
      sent.add(item);
      return true;
    });
  return {
    model: sorted.model.flatMap((item) => (packed.has(item) ? [] : once([item, ...(packedWith.get(item) ?? [])]))),
    supporting: sorted.supporting.filter((item) => !packed.has(item)),
    packedWith,
  };
}

/** The name a file added as a model file is stored by: a .gltf is packed into a .glb. */
export function storedModelFileName(name: string): string {
  return name.replace(/\.gltf$/i, ".glb");
}

/**
 * `items` in the order given, split into groups to send a request each: one group never holds two different files of
 * one name, which the server would take for each other where it packs a .gltf with the files it points at, by name.
 * A file two items share is one file, so it doesn't split them.
 */
export function batchesByName<T>(items: T[], filesOf: (item: T) => File[]): T[][] {
  const batches: { items: T[]; byName: Map<string, File> }[] = [];
  for (const item of items) {
    const files = filesOf(item);
    let batch = batches.at(-1);
    const clashes = (open: { byName: Map<string, File> }) =>
      files.some((file) => {
        const other = open.byName.get(file.name.toLowerCase());
        return other !== undefined && other !== file;
      });
    if (!batch || clashes(batch)) {
      batch = { items: [], byName: new Map() };
      batches.push(batch);
    }
    batch.items.push(item);
    for (const file of files) batch.byName.set(file.name.toLowerCase(), file);
  }
  return batches.map((batch) => batch.items);
}
