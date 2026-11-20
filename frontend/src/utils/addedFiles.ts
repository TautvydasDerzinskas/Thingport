import { LIGHTBURN_EXTS, MODEL_EXTS } from "../constants/fileTypes";
import { keptExt, keptName } from "./fileExtensions";
import { gltfBundles, gltfFinder } from "./uploadTree";

// Where a file added to a model goes. Mirrors the backend's split of an upload (services/uploadService.ts): 3D files
// are the model's files, and anything else is kept beside them as a supporting file.

/** Pictures a model can be made of, as an upload takes them on their own (UPLOAD_EXTS): an image model's files, GIFs
 *  and SVGs among them. Not the gallery's narrower list. */
const PICTURE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "svg"]);

/** A sliced print: kept beside the model as its prepared print, never one of its files to slice. */
const PREPARED_SUFFIXES = [".gcode.3mf", ".gcode", ".gco", ".bgcode"];

export function isPreparedName(name: string): boolean {
  const lower = keptName(name).toLowerCase();
  return PREPARED_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * After the upload of `name` failed, whether the sliced prints after it in the same addition must wait: it may be the
 * model's prepared print now, or may not, and the next would then either replace it or be kept beside an older one.
 * Only a sliced print whose answer never came (`status` null) or came after the server failed (5xx) may be in: one the
 * server turned away (4xx) kept nothing. None waits once one before it is sure to be in (`preparedAdded`), as the
 * rest are kept beside that one whatever this one did.
 */
export function holdsBackSliced(name: string, status: number | null, preparedAdded: boolean): boolean {
  return !preparedAdded && isPreparedName(name) && (status === null || status >= 500);
}

/** A file the model is printed, cut or engraved from: a mesh, a CAD exchange file or a LightBurn project. */
export function isModelFileName(name: string): boolean {
  if (isPreparedName(name)) return false;
  const ext = keptExt(name);
  // A .gltf is packed into a .glb with the files it points at.
  return MODEL_EXTS.has(ext) || LIGHTBURN_EXTS.has(ext) || ext === "gltf";
}

export function isPictureName(name: string): boolean {
  return PICTURE_EXTS.has(keptExt(name));
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
 * under both, though `model` lists it once. Found as a folder upload finds them. `ambiguous`: the names a .gltf points
 * at that more than one file of the addition could be, which it then takes none of, as the server can't tell either.
 * `missing`: what a .gltf points at, as written in it, that it took no file of the addition for (gltfFilesFromOthers).
 */
export async function withGltfFiles<T>(
  sorted: { model: T[]; supporting: T[] },
  fileOf: (item: T) => File,
): Promise<{ model: T[]; supporting: T[]; packedWith: Map<T, T[]>; ambiguous: string[]; missing: Map<T, string[]> }> {
  const all = [...sorted.model, ...sorted.supporting];
  const packedWith = new Map<T, T[]>();
  const missing = new Map<T, string[]>();
  // By the name it's kept by, as the server packs it: "scene.gltf " is a scene too.
  if (!all.some((item) => keptExt(fileOf(item).name) === "gltf")) {
    return { ...sorted, packedWith, ambiguous: [], missing };
  }
  const entries = all.map((item) => ({ file: fileOf(item), relativePath: "" }));
  const unclear = new Map<(typeof entries)[number], string[]>();
  const unresolved = new Map<(typeof entries)[number], string[]>();
  for (const [gltf, found] of await gltfBundles(entries, unclear, unresolved)) {
    packedWith.set(
      all[entries.indexOf(gltf)],
      found.map((entry) => all[entries.indexOf(entry)]),
    );
  }
  for (const [gltf, uris] of unresolved) missing.set(all[entries.indexOf(gltf)], uris);
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
    ambiguous: [...new Set([...unclear.values()].flat())],
    missing,
  };
}

/** What gltfFilesFromOthers looks among, each file once: the picks (`item`, which a scene that takes one takes out of
 *  the lists), then the files already packed with a scene (no `item`: such a file stays with that scene too, as the
 *  server packs a file into each scene it's sent with). */
export function stagedFiles<T>(
  picks: T[],
  fileOf: (item: T) => File,
  packed: File[],
): { item: T | null; file: File }[] {
  const seen = new Set<File>();
  const staged: { item: T | null; file: File }[] = [];
  const stage = (item: T | null, file: File) => {
    if (seen.has(file)) return;
    seen.add(file);
    staged.push({ item, file });
  };
  for (const item of picks) stage(item, fileOf(item));
  for (const file of packed) stage(null, file);
  return staged;
}

/**
 * Scenes added apart from files they point at, given those files from the other additions staged beside them (Edit
 * model's picks): the server packs a .gltf only with what's sent in its own request. Only what a scene's own addition
 * didn't have (withGltfFiles' `missing`) is looked for, found by name as within one, so a file it found there stays its
 * own though another addition has one of that name. `took`: each scene's finds; `missing`: what each still lacks;
 * `ambiguous`: the names two staged files could be, which the scene takes neither of.
 */
export function gltfFilesFromOthers<S, T>(
  scenes: { scene: S; file: File; missing: string[] }[],
  staged: T[],
  fileOf: (item: T) => File,
): { took: Map<S, T[]>; missing: Map<S, string[]>; ambiguous: string[] } {
  const took = new Map<S, T[]>();
  const missing = new Map<S, string[]>();
  const ambiguous = new Set<string>();
  if (!scenes.length) return { took, missing, ambiguous: [] };
  const entries = staged.map((item) => ({ file: fileOf(item), relativePath: "" }));
  const find = gltfFinder(entries);
  for (const { scene, file, missing: wanted } of scenes) {
    const { found, unclear, left } = find({ file, relativePath: "" }, wanted);
    if (found.length)
      took.set(
        scene,
        found.map((entry) => staged[entries.indexOf(entry)]),
      );
    for (const name of unclear) ambiguous.add(name);
    missing.set(scene, left);
  }
  return { took, missing, ambiguous: [...ambiguous] };
}

/** The name a file added as a model file is stored by: a .gltf is packed into a .glb. */
export function storedModelFileName(name: string): string {
  return keptName(name).replace(/\.gltf$/i, ".glb");
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
        const other = open.byName.get(keptName(file.name).toLowerCase());
        return other !== undefined && other !== file;
      });
    if (!batch || clashes(batch)) {
      batch = { items: [], byName: new Map() };
      batches.push(batch);
    }
    batch.items.push(item);
    for (const file of files) batch.byName.set(keptName(file.name).toLowerCase(), file);
  }
  return batches.map((batch) => batch.items);
}
