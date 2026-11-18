import fs from "node:fs/promises";
import { kindUnder } from "./categoryService";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db";
import { HttpError, sanitizeFilename, guessMimeFromPath, trimFilename } from "../utils/fileUtils";
import { IMPORT_MAX_BYTES, PARAMETRIC_SOURCE_EXTS, UPLOADABLE_EXTS } from "../config";
import { listZipEntries as listRawZipEntries, readZipEntry } from "../utils/zipReader";
import { validateParentCategory } from "./categoryService";
import { attachImportedPreviewImages, MULTI_FILE_PLATE_EXTS, PREVIEW_IMAGE_MAX_COUNT } from "./importService";
import { addPreviewImage, preferImageOverRenders } from "./previewImageService";
import { isSupportingImportFile, withoutModelsSharedTop } from "./supportingImports";
import { modelFolderUnits } from "./modelFolders";
import { localizeDescriptionImages } from "./descriptionImageService";
import { getPhotosPerModel } from "./settingsService";
import { createPrint, type NewPlateInput, type PrintMetaInput } from "./printCreation";
import { isPreparedPrintFilename } from "./preparedPrint";
import { isGltfName, packGltfFiles } from "./gltfPacker";
import type { Print, Plate, PreviewImage } from "@prisma/client";

export type ZipEntrySummary = { path: string; size: number };

/** Normalizes a raw zip entry name: backslashes -> slashes, strips leading slash, rejects
 * empty/directory/".."-containing paths. Returns null if the entry should be ignored. */
export function normalizeZipEntryPath(name: string): string | null {
  let cleaned = (name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.endsWith("/")) return null;
  const parts = cleaned.split("/").filter((p) => p.length > 0);
  if (!parts.length || parts.some((p) => p === "..")) return null;
  const filtered = parts.filter((p) => p !== ".");
  if (!filtered.length) return null;
  return filtered.join("/");
}

function sanitizeCategoryName(name: string): string {
  const cleaned = (name || "").replace(/\0/g, "").trim().replace(/\//g, "_").replace(/\\/g, "_");
  return cleaned || "category";
}

/** Lists every real (non-directory) entry in a zip archive, path-normalized and sorted. */
export async function listZipEntries(zipPath: string): Promise<ZipEntrySummary[]> {
  const raw = await listRawZipEntries(zipPath);
  const entries: ZipEntrySummary[] = [];
  for (const entry of raw) {
    if (entry.isDirectory) continue;
    const name = normalizeZipEntryPath(entry.name);
    if (!name) continue;
    entries.push({ path: name, size: entry.size });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

type CategoryCache = Map<string, string>;

async function getOrCreateCategory(
  userId: string,
  parentId: string | null,
  parentKey: string,
  name: string,
  cache: CategoryCache,
): Promise<string> {
  const key = `${parentKey}/${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  // At the top level only a folder is reused: a zip's folders shouldn't merge into a starter category.
  const kind = await kindUnder(userId, parentId, "folder");
  const existing = await prisma.category.findFirst({ where: { userId, parentId, name, kind } });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const category = await prisma.category.create({ data: { userId, name, parentId, kind, tags: [] } });
  cache.set(key, category.id);
  return category.id;
}

/** Recreates the zip's directory structure as nested Categories, returning the leaf category id
 * for one entry's path. */
export async function resolveZipCategoryId(
  userId: string,
  baseCategoryId: string | null,
  entryPath: string,
  cache: CategoryCache,
): Promise<string | null> {
  const segments = entryPath.split("/").slice(0, -1).filter(Boolean);
  if (!segments.length) return baseCategoryId;
  let targetId = baseCategoryId;
  let parentKey = baseCategoryId || "root";
  for (const segment of segments) {
    const safe = sanitizeCategoryName(segment);
    if (!safe) continue;
    targetId = await getOrCreateCategory(userId, targetId, parentKey, safe, cache);
    parentKey = `${parentKey}/${safe}`;
  }
  return targetId;
}

export type ZipExtractOptions = {
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  categoryId?: string | null;
  creator?: string | null;
  authorId?: string | null;
  previewImageUrl?: string | null;
  galleryImages?: { url: string; filename: string }[];
};

/**
 * Extracts selected zip entries into individual single-plate Prints (one per entry). Each
 * entry lands in a Category tree recreated from its path within the zip (nested under
 * options.categoryId, if any). Returns the created prints plus the list of entry names that
 * failed to extract (missing, a directory, or over the size cap).
 */
export async function extractZipEntriesToPrints(
  userId: string,
  zipPath: string,
  selections: string[],
  options: ZipExtractOptions,
  onProgress?: (processed: number, total: number, imported: number, failed: number) => void,
): Promise<{ prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[]; failed: string[] }> {
  const normalized = selections.map((s) => normalizeZipEntryPath(s));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const name of normalized) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    ordered.push(name);
  }
  if (!ordered.length) throw new HttpError(400, "No zip entries selected");

  if (options.categoryId) {
    await validateParentCategory(userId, options.categoryId);
  }

  // Normalized path -> the entry's own name in the zip, which readZipEntry matches exactly
  // ("./Benchy/benchy.stl" is listed as "Benchy/benchy.stl").
  const raw = await listRawZipEntries(zipPath);
  const entryMap = new Map<string, { isDirectory: boolean; size: number; rawName: string }>();
  for (const entry of raw) {
    const name = normalizeZipEntryPath(entry.name);
    if (!name) continue;
    // Two entries can normalize to one path ("a.stl" and "./a.stl"); the one named exactly that wins.
    if (entryMap.has(name) && entry.name !== name) continue;
    entryMap.set(name, { isDirectory: entry.isDirectory, size: entry.size, rawName: entry.name });
  }

  const prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[] = [];
  const failed: string[] = [];
  const categoryCache: CategoryCache = new Map();
  let processedCount = 0;

  for (const entryName of ordered) {
    const info = entryMap.get(entryName);
    // Its name as it's kept: "part.stl " is a part.stl.
    const filename = sanitizeFilename(path.basename(entryName));
    // A document can't be a model on its own: one per file makes models of what can be.
    if (!info || info.isDirectory || !UPLOADABLE_EXTS.has(path.extname(filename).toLowerCase())) {
      failed.push(entryName);
      onProgress?.(++processedCount, ordered.length, prints.length, failed.length);
      continue;
    }
    let tempPath: string | null = null;
    try {
      const targetCategoryId = await resolveZipCategoryId(userId, options.categoryId ?? null, entryName, categoryCache);
      const buffer = await readZipEntry(zipPath, info.rawName, IMPORT_MAX_BYTES);
      if (!buffer) throw new Error("Extracted file exceeds size limit or could not be read");

      tempPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}`);
      await fs.writeFile(tempPath, buffer);

      // A resolved page title (e.g. MakerWorld's design name) is the same for every entry in
      // the zip, so when more than one entry is being extracted into its own Print, keep them
      // distinguishable by tagging the entry's own filename onto it instead of overwriting it
      // outright the way a single-entry extraction does.
      const resolvedTitle =
        options.title && ordered.length > 1 ? `${options.title} (${path.parse(filename).name})` : options.title;
      const meta: PrintMetaInput = {
        title: resolvedTitle ?? null,
        notes: options.notes ?? null,
        tags: options.tags ?? [],
        categoryId: targetCategoryId,
        categorySource: targetCategoryId ? "MANUAL" : null,
        creator: options.creator ?? null,
        authorId: options.authorId ?? null,
      };
      const mime = guessMimeFromPath(filename);
      const { print, plates } = await createPrint(userId, meta, path.parse(filename).name, [
        { filename, mime, tempFilePath: tempPath },
      ]);
      tempPath = null;
      const previewImages = await picturedAfterStoring(print.id, () =>
        attachImportedPreviewImages(print.id, plates[0]?.id, options.previewImageUrl, options.galleryImages ?? []),
      );
      prints.push({ ...print, plates, previewImages });
    } catch {
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
      failed.push(entryName);
    }
    onProgress?.(++processedCount, ordered.length, prints.length, failed.length);
  }

  return { prints, failed };
}

/** How a zip from a link becomes models, as the app's dialog asks: all its picked files one model (the default, and
 *  what a client that doesn't ask gets), a model per folder that holds model files, or a model per file. */
export type ZipImportMode = "one" | "folders" | "separate";

// Pictures among a zip's files are a model's photos, as the consume folder takes them.
const PHOTO_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

type PickedEntry = { name: string; folder: string; filename: string; tempPath: string; size: number };

const isPhotoEntry = (entry: PickedEntry) =>
  PHOTO_EXTS.has(path.extname(entry.filename).toLowerCase()) && entry.size <= PHOTO_MAX_BYTES;

/** What a zip's picked entries may come to in all, written out before any model is made of them: a few times what the
 *  zip may be, as model files compress well, and never what a small archive of zeros unpacks to. */
const PICKED_MAX_BYTES = 4 * IMPORT_MAX_BYTES;

/** The picked entries of a zip, each read to a temp file with the folder it's in. The ones that couldn't be read, or
 *  didn't fit in PICKED_MAX_BYTES beside the others, are named in `failed`. */
async function readPickedEntries(
  zipPath: string,
  selections: string[],
): Promise<{ entries: PickedEntry[]; failed: string[] }> {
  const raw = new Map<string, string>();
  for (const entry of await listRawZipEntries(zipPath)) {
    const name = normalizeZipEntryPath(entry.name);
    if (name && !entry.isDirectory && (!raw.has(name) || entry.name === name)) raw.set(name, entry.name);
  }
  const entries: PickedEntry[] = [];
  const failed: string[] = [];
  let writing: string | null = null;
  let pickedBytes = 0;
  try {
    for (const name of new Set(selections.map((s) => normalizeZipEntryPath(s)).filter((s): s is string => !!s))) {
      const rawName = raw.get(name);
      // A zip inside never becomes part of a model, so it isn't written out only to be dropped.
      const usable = rawName && path.extname(name).toLowerCase() !== ".zip";
      const room = Math.min(IMPORT_MAX_BYTES, PICKED_MAX_BYTES - pickedBytes);
      const buffer = usable && room > 0 ? await readZipEntry(zipPath, rawName, room).catch(() => null) : null;
      if (!buffer) {
        failed.push(name);
        continue;
      }
      pickedBytes += buffer.length;
      const tempPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}`);
      writing = tempPath;
      await fs.writeFile(tempPath, buffer);
      writing = null;
      const parts = name.split("/");
      entries.push({
        name,
        folder: parts.slice(0, -1).join("/"),
        filename: sanitizeFilename(parts.at(-1)!),
        tempPath,
        size: buffer.length,
      });
    }
  } catch (err) {
    // The callers remove only what they're handed, and a failed write hands them nothing.
    const written = [...entries.map((entry) => entry.tempPath), ...(writing ? [writing] : [])];
    await Promise.all(written.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
    throw err;
  }
  return { entries, failed };
}

type ModelEntry = { entry: PickedEntry; folder: string | null };

/** One model of `picked`, each .gltf among them packed first with the files it points at (withScenesPacked). */
async function createModelOf(
  userId: string,
  picked: ModelEntry[],
  meta: PrintMetaInput,
  nameHint: string,
  options: ZipExtractOptions,
): Promise<Print & { plates: Plate[]; previewImages: PreviewImage[] }> {
  const { entries, glbs } = await withScenesPacked(picked);
  try {
    return await storeModelOf(userId, entries, meta, nameHint, options);
  } finally {
    // Moved into storage when the model was made; still here when it wasn't.
    await Promise.all(glbs.map((glb) => fs.rm(glb, { force: true }).catch(() => undefined)));
  }
}

/** `entries` with each .gltf packed, with the files it points at, into one .glb in its place, as an upload's is
 *  (uploadService's withGltfPacked): kept as it is, a scene would point at files its model doesn't have. They're found
 *  by their paths in the zip, so a scene takes the .bin in its own folder. One of `others`, picked files of another
 *  model's folder or none, is packed in too, and stays theirs: it's read, not taken. `glbs`, the temp files made, and
 *  `took`, the ones of `others` packed in. */
async function withScenesPacked(
  entries: ModelEntry[],
  others: PickedEntry[] = [],
): Promise<{ entries: ModelEntry[]; glbs: string[]; took: PickedEntry[] }> {
  if (!entries.some(({ entry }) => isGltfName(entry.filename))) return { entries, glbs: [], took: [] };
  // Never another folder's scene: packing takes every .gltf it's handed.
  const outside: ModelEntry[] = others
    .filter((entry) => !isGltfName(entry.filename) && !entries.some((own) => own.entry === entry))
    .map((entry) => ({ entry, folder: null }));
  const { files, packed } = await packGltfFiles(
    [...entries, ...outside].map((item) => ({ name: item.entry.name, path: item.entry.tempPath, item })),
    () => path.join(os.tmpdir(), `thingport-glb-${crypto.randomBytes(8).toString("hex")}.glb`),
    (gltf, glbPath, glbName) => ({
      name: glbName,
      path: glbPath,
      item: {
        ...gltf.item,
        entry: {
          ...gltf.item.entry,
          filename: trimFilename(gltf.item.entry.filename).replace(/\.gltf$/i, ".glb"),
          tempPath: glbPath,
        },
      },
    }),
  );
  const made = files.filter((file) => !entries.includes(file.item) && !outside.includes(file.item));
  return {
    entries: files.flatMap((file) => (outside.includes(file.item) ? [] : [file.item])),
    glbs: made.map((file) => file.path),
    took: packed.flatMap((file) => (outside.includes(file.item) ? [file.item.entry] : [])),
  };
}

/** One model of `entries`, its plates found as an upload finds them (uploadService's plateFilesOf): its model files
 *  that aren't sliced, a sliced 3MF beside them kept as a supporting file; else its sliced 3MFs, printed from all the
 *  same; else what can be a model on its own, such as a picture, an SVG or a GIF. A script goes along with any of
 *  them, pictures beside model files are its photos, and the rest are supporting files, each in its folder below the
 *  folders the model's own files share. With none of those, there's no model to make. */
async function storeModelOf(
  userId: string,
  entries: ModelEntry[],
  meta: PrintMetaInput,
  nameHint: string,
  options: ZipExtractOptions,
): Promise<Print & { plates: Plate[]; previewImages: PreviewImage[] }> {
  const extOf = (entry: PickedEntry) => path.extname(entry.filename).toLowerCase();
  const modelFile = (entry: PickedEntry) => MULTI_FILE_PLATE_EXTS.has(extOf(entry));
  const tiers: ((entry: PickedEntry) => boolean)[] = [
    (entry) => modelFile(entry) && !isPreparedPrintFilename(entry.filename),
    modelFile,
    (entry) => UPLOADABLE_EXTS.has(extOf(entry)),
  ];
  const isPlate = tiers.find((tier) => entries.some(({ entry }) => tier(entry))) ?? (() => false);
  // A model file, not a script: one with only a script and pictures is a model of its pictures, the script beside them.
  const hasModel = entries.some(({ entry }) => modelFile(entry));
  const photos = hasModel ? entries.filter(({ entry }) => isPhotoEntry(entry)) : [];
  const inputs: NewPlateInput[] = entries.flatMap(({ entry, folder }): NewPlateInput[] => {
    if (photos.some((photo) => photo.entry === entry)) return [];
    const mime = guessMimeFromPath(entry.filename);
    const input = { filename: entry.filename, mime, tempFilePath: entry.tempPath, folder };
    if (isPlate(entry) || PARAMETRIC_SOURCE_EXTS.has(extOf(entry))) return [input];
    // A sliced 3MF beside the model files is kept beside them, sliced for the designer's printer (keepSupportingFiles):
    // a model file, so the site's-files rule turns it down.
    return modelFile(entry) || isSupportingImportFile(entry.filename) ? [{ ...input, supporting: true }] : [];
  });
  if (!inputs.some((input) => !input.supporting)) {
    throw new HttpError(400, "None of the picked files can be a model: pick a model file (STL, 3MF, STEP…) too.");
  }
  const { print, plates } = await createPrint(userId, meta, nameHint, withoutModelsSharedTop(inputs));
  const previewImages = await picturedAfterStoring(print.id, () =>
    addPicturesOf(print.id, plates[0]?.id, photos, options),
  );
  return { ...print, plates, previewImages };
}

/** The pictures of a model just stored, `addPictures` first, then the description's, and read back for the answer.
 *  The model stands by now, and these only add to it: a step that fails is logged, so an import never says it failed
 *  for a model it made. */
async function picturedAfterStoring(printId: string, addPictures: () => Promise<unknown>): Promise<PreviewImage[]> {
  const didNot = (step: string) => (err: unknown) =>
    console.warn(`Zip import: couldn't ${step} of model ${printId}:`, err);
  await addPictures().catch(didNot("add the pictures"));
  await localizeDescriptionImages(printId).catch(didNot("keep the description's pictures"));
  return prisma.previewImage
    .findMany({ where: { printId }, orderBy: { position: "asc" } })
    .catch((err: unknown): PreviewImage[] => {
      didNot("read back the pictures")(err);
      return [];
    });
}

/** A new model's pictures: the page's, then the zip's photos, as many as an import keeps. */
async function addPicturesOf(
  printId: string,
  plateId: string | undefined,
  photos: ModelEntry[],
  options: ZipExtractOptions,
): Promise<void> {
  const fromPage = await attachImportedPreviewImages(
    printId,
    plateId,
    options.previewImageUrl,
    options.galleryImages ?? [],
  );
  let preferred = fromPage > 0;
  // Administration → Storage's "Photos kept per model", the page's counted first, as this is an import.
  const keep = (await getPhotosPerModel()) ?? PREVIEW_IMAGE_MAX_COUNT;
  let stored = fromPage;
  for (const { entry } of photos) {
    if (stored >= keep) break;
    const buffer = await fs.readFile(entry.tempPath).catch(() => null);
    if (!buffer || !(await addPreviewImage(printId, buffer, { keepExif: true }))) continue;
    stored++;
    // The page's own pictures come first; a zip's stand in for none.
    if (!preferred) {
      preferred = true;
      await preferImageOverRenders(printId, plateId, buffer, true);
    }
  }
}

function metaFor(options: ZipExtractOptions, title: string | null, categoryId: string | null): PrintMetaInput {
  return {
    title,
    notes: options.notes ?? null,
    tags: options.tags ?? [],
    categoryId,
    categorySource: categoryId ? "MANUAL" : null,
    creator: options.creator ?? null,
    authorId: options.authorId ?? null,
  };
}

/** All of a zip's picked entries as one model, named as the page names it, or after the zip (`zipName`). Its folders
 *  stay inside the model, below the ones its model files all share. */
export async function extractZipEntriesToOneModel(
  userId: string,
  zipPath: string,
  zipName: string,
  selections: string[],
  options: ZipExtractOptions,
): Promise<{ prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[]; failed: string[] }> {
  if (options.categoryId) await validateParentCategory(userId, options.categoryId);
  const { entries, failed } = await readPickedEntries(zipPath, selections);
  try {
    if (!entries.length) throw new HttpError(400, "No zip entries selected");
    const stem = path.parse(zipName).name;
    const print = await createModelOf(
      userId,
      entries.map((entry) => ({ entry, folder: entry.folder || null })),
      metaFor(options, options.title ?? stem, options.categoryId ?? null),
      stem,
      options,
    );
    return { prints: [print], failed };
  } finally {
    await Promise.all(entries.map((entry) => fs.rm(entry.tempPath, { force: true }).catch(() => undefined)));
  }
}

/** A zip's picked entries as "Each folder is a model" takes a folder tree (modelFolders.ts), the rules the consume
 *  folder goes by: each folder holding model files one model, named after it, in the categories of the folders above
 *  it, with the subfolders holding none attached; the other files a model each, as a model per file makes them, but
 *  for a glTF scene, which is packed with what it points at as a model folder's is. */
export async function extractZipEntriesToFolderModels(
  userId: string,
  zipPath: string,
  selections: string[],
  options: ZipExtractOptions,
  onProgress?: (processed: number, total: number, imported: number, failed: number) => void,
): Promise<{ prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[]; failed: string[] }> {
  if (options.categoryId) await validateParentCategory(userId, options.categoryId);
  const { entries, failed } = await readPickedEntries(zipPath, selections);
  const prints: (Print & { plates: Plate[]; previewImages: PreviewImage[] })[] = [];
  const loose: string[] = [];
  const glbs: string[] = [];
  const categoryCache: CategoryCache = new Map();
  let total = 0;
  let processed = 0;
  try {
    // A script holds no shape, so a folder of nothing but scripts is attached to the model above it, not one itself. A
    // glTF scene is a model's, packed with the files it points at into a .glb (withScenesPacked).
    const units = modelFolderUnits(
      entries,
      (entry) => entry.folder,
      (entry) => MULTI_FILE_PLATE_EXTS.has(path.extname(entry.filename).toLowerCase()) || isGltfName(entry.filename),
    );
    // Each model folder and each file on its own counts once, as the job reports them, and so does each picked file
    // that couldn't be read, which is done with already.
    total = units.length + failed.length;
    processed = failed.length;
    if (processed) onProgress?.(processed, total, 0, failed.length);
    // Every model's scenes are packed before any model is stored, as storing one takes its files: a scene may point at
    // a picked file outside its folder ("../../Shared/mesh.bin"), one a model stored before it holds among them. A
    // scene at the top is a model of its own, packed as one in a folder is, and a file on its own that a scene packed
    // in goes with it, rather than being a model, or a failure, of its own.
    const packed = new Map<(typeof units)[number], { entries: ModelEntry[] } | { failure: unknown }>();
    const taken = new Set<PickedEntry>();
    for (const unit of units) {
      if (unit.kind === "file" && !isGltfName(unit.item.filename)) continue;
      const own =
        unit.kind === "model"
          ? [
              ...unit.files.map((entry) => ({ entry, folder: null })),
              ...unit.attached.map(({ item, folder }) => ({ entry: item, folder })),
            ]
          : [{ entry: unit.item, folder: null }];
      try {
        const scenes = await withScenesPacked(own, entries);
        glbs.push(...scenes.glbs);
        for (const entry of scenes.took) taken.add(entry);
        packed.set(unit, { entries: scenes.entries });
      } catch (failure) {
        packed.set(unit, { failure });
      }
    }
    for (const unit of units) {
      const own = packed.get(unit);
      if (!own) {
        if (unit.kind === "file") {
          if (taken.has(unit.item)) onProgress?.(++processed, total, prints.length, failed.length);
          else loose.push(unit.item.name);
        }
        continue;
      }
      const where = unit.kind === "model" ? unit.folder : unit.item.name;
      try {
        if ("failure" in own) throw own.failure;
        // The folders above the model's own, which is the model: Kit/A makes model A in category Kit.
        const categoryId = await resolveZipCategoryId(userId, options.categoryId ?? null, where, categoryCache);
        const name = unit.kind === "model" ? unit.folder.split("/").at(-1)! : path.parse(unit.item.filename).name;
        prints.push(await storeModelOf(userId, own.entries, metaFor(options, name, categoryId), name, options));
      } catch (err) {
        console.warn("Zip import: couldn't make a model of", where, err);
        failed.push(where);
      }
      onProgress?.(++processed, total, prints.length, failed.length);
    }
  } finally {
    // The .glbs went into storage with their models, and are still here for one that wasn't made.
    const temps = [...entries.map((entry) => entry.tempPath), ...glbs];
    await Promise.all(temps.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
  }
  if (loose.length) {
    const [before, failedBefore] = [prints.length, failed.length];
    const rest = await extractZipEntriesToPrints(userId, zipPath, loose, options, (done, _all, imported, failing) =>
      onProgress?.(processed + done, total, before + imported, failedBefore + failing),
    );
    prints.push(...rest.prints);
    failed.push(...rest.failed);
  }
  return { prints, failed };
}
