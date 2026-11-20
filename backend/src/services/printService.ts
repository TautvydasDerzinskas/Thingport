import fs from "node:fs/promises";
import { withStorageLock } from "../utils/storageLock";
import fsSync from "node:fs";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";
import { folderLevels } from "../utils/fileFolder";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import { imageFormat, writePhotoJpeg } from "./imageProcessing";
import {
  adoptLegacyAsset,
  ASSET_SUBFOLDERS,
  ASSETS_FOLDER,
  assetExists,
  assetPath,
  assetTarget,
  descriptionImageFile,
  galleryImageFile,
  galleryThumbFile,
  ownedAssetFiles,
  plateAssetHome,
  plateGlbFile,
  plateRenderFile,
  COLOR_RENDER_FILE_TAG,
  plateThumbFile,
  removeAsset,
  removePlateAssets,
  type AssetFile,
  type AssetHome,
} from "./modelAssets";
import type { Category, Plate, Prisma, Print, PrintFile } from "@prisma/client";
import { isUnsettled } from "./printFileSaves";

export const STORAGE_TEMPLATE_TOKENS = [
  "category-or-folder",
  "collection",
  "tags",
  "creator",
  "model",
  "filename",
  "id",
  "plate",
] as const;

// Older names still accepted in a saved template, and rewritten to the current one whenever the
// template is validated -- so the admin page shows (and the next save stores) the new name.
// {name} was always the same value as {model}; {category} became {category-or-folder} when folders
// were split out of categories.
const LEGACY_TOKEN_ALIASES: Record<string, (typeof STORAGE_TEMPLATE_TOKENS)[number]> = {
  name: "model",
  category: "category-or-folder",
};

/** The {collection} folder for a model in no collection, and for one in more than one. */
export const NO_COLLECTION_FOLDER = "Uncollected";
export const MULTIPLE_COLLECTIONS_FOLDER = "Multiple collections";

export const DEFAULT_STORAGE_TEMPLATE = "{category-or-folder}/{model}/{filename}";

const TOKEN_RE = /\{([a-z_-]+)\}/g;
// oxlint-disable-next-line no-control-regex -- stripping control chars is the point here.
const INVALID_SEGMENT_RE = /[<>:"|?*\x00-\x1f]/g;

export function sanitizePathSegment(value: string | null | undefined, fallback: string): string {
  let cleaned = (value || "").trim().replace(INVALID_SEGMENT_RE, "_");
  cleaned = cleaned
    .replace(/\//g, "_")
    .replace(/\\/g, "_")
    .replace(/^[ .]+|[ .]+$/g, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") cleaned = fallback;
  return cleaned.slice(0, 120);
}

/** Trimmed, with "/" separators and current token names; not yet checked. */
export function normalizeStorageTemplate(template: string | null | undefined): string {
  return (template || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(TOKEN_RE, (match, token: string) =>
      token in LEGACY_TOKEN_ALIASES ? `{${LEGACY_TOKEN_ALIASES[token]}}` : match,
    );
}

export function validateStorageTemplate(template: string | null | undefined): string {
  const normalized = normalizeStorageTemplate(template);
  if (!normalized) throw new HttpError(400, "Storage template cannot be empty");
  const tokens = [...normalized.matchAll(TOKEN_RE)].map((m) => m[1]);
  const unknown = tokens.filter((t) => !(STORAGE_TEMPLATE_TOKENS as readonly string[]).includes(t));
  if (unknown.length) throw new HttpError(400, `Unknown storage token: {${unknown[0]}}`);
  const filenameCount = (normalized.match(/\{filename\}/g) || []).length;
  if (filenameCount !== 1) throw new HttpError(400, "Storage template must contain {filename} exactly once");
  const finalSegment = normalized.split("/").pop() || "";
  if (!finalSegment.includes("{filename}")) {
    throw new HttpError(400, "{filename} must be in the final path segment");
  }
  const stripped = normalized.replace(TOKEN_RE, "");
  if (stripped.includes("{") || stripped.includes("}")) {
    throw new HttpError(400, "Storage template contains an invalid token");
  }
  if (normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new HttpError(400, "Storage template contains an unsafe path segment");
  }
  return normalized;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN_RE, (_match, token: string) => {
    if (!(token in values)) throw new HttpError(400, `Unknown storage token: {${token}}`);
    return values[token];
  });
}

export async function categorySegments(userId: string, categoryId: string | null | undefined): Promise<string[]> {
  if (!categoryId) return ["Unassigned"];
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: Category | null = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    segments.unshift(sanitizePathSegment(current.name, "Category"));
    current = current.parentId ? await prisma.category.findFirst({ where: { id: current.parentId, userId } }) : null;
  }
  return segments.length ? segments : ["Unassigned"];
}

function assertWithinStorage(relative: string): string {
  const candidate = path.resolve(STORAGE, relative);
  const root = path.resolve(STORAGE);
  if (candidate === root || !candidate.startsWith(root + path.sep)) {
    throw new HttpError(400, "Storage template resolved outside the storage directory");
  }
  return relative;
}

type PrintLike = Pick<
  Print,
  "id" | "name" | "creator" | "tags" | "categoryId" | "userId" | "authorId" | "sourceProvider"
>;

function templateUses(template: string, token: (typeof STORAGE_TEMPLATE_TOKENS)[number]): boolean {
  return template.includes(`{${token}}`);
}

/** {creator}: the author the model page shows (ModelSidePanel): the imported Author's name or handle, else
 *  the plain-text creator an import stored, else -- for the owner's own upload, which has no
 *  source -- the owner. */
async function creatorLabel(print: PrintLike): Promise<string | null> {
  if (print.authorId) {
    const author = await prisma.author.findUnique({
      where: { id: print.authorId },
      select: { name: true, handle: true },
    });
    if (author?.name || author?.handle) return author.name || author.handle;
  }
  if (print.creator) return print.creator;
  if (print.sourceProvider) return null;
  const owner = await prisma.user.findUnique({ where: { id: print.userId }, select: { displayName: true } });
  return owner?.displayName ?? null;
}

/** A model can be in any number of collections; a folder can only hold it once. */
async function collectionLabel(printId: string): Promise<string> {
  const items = await prisma.collectionItem.findMany({
    where: { printId },
    select: { collection: { select: { name: true } } },
    take: 2,
  });
  if (items.length === 0) return NO_COLLECTION_FOLDER;
  if (items.length > 1) return MULTIPLE_COLLECTIONS_FOLDER;
  return items[0].collection.name;
}

type PrintTemplateValues = Record<string, string>;

/** Every token's value for one print, other than the per-plate {filename}/{plate}. Tokens that
 *  need their own query are only looked up when the template uses them. */
async function printTemplateValues(print: PrintLike, template: string): Promise<PrintTemplateValues> {
  const tagLabel =
    (print.tags || [])
      .map((t) => t.trim())
      .filter(Boolean)
      .join(" + ") || "Untagged";
  return {
    "category-or-folder": templateUses(template, "category-or-folder")
      ? (await categorySegments(print.userId, print.categoryId)).join("/")
      : "",
    collection: templateUses(template, "collection")
      ? sanitizePathSegment(await collectionLabel(print.id), NO_COLLECTION_FOLDER)
      : "",
    tags: sanitizePathSegment(tagLabel, "Untagged"),
    creator: templateUses(template, "creator") ? sanitizePathSegment(await creatorLabel(print), "Unknown creator") : "",
    model: sanitizePathSegment(print.name, "Model"),
    id: print.id,
  };
}

/** {plate} with the separator next to it taken out, for the files that aren't plates: "{model}-{plate}-{filename}"
 *  gives "{model}-{filename}". A folder per plate ("Plate {plate}/") goes whole, so they sit beside the plates'
 *  folders. */
function withoutPlateToken(template: string): string {
  const segments = template.split("/");
  return segments
    .map((segment, index) =>
      index < segments.length - 1 && segment.includes("{plate}")
        ? ""
        : segment.replace(/([ _.-]*)\{plate\}([ _.-]*)/g, (match, before: string, after: string, offset: number) =>
            offset === 0 || offset + match.length === segment.length ? "" : before || after,
          ),
    )
    .join("/");
}

/** `plate` is the plate's number, or null for any other file of the model. */
function renderModelPath(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  filename: string,
  plate: number | null,
): string {
  const values = {
    ...printValues,
    filename: sanitizePathSegment(filename, "file"),
    plate: plate === null ? "" : String(plate + 1),
  };
  const rendered = renderTemplate(plate === null ? withoutPlateToken(template) : template, values).replace(/\\/g, "/");
  const parts = rendered
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part, "item"));
  if (!parts.length) throw new HttpError(400, "Storage template produced an empty path");
  const userSegment = sanitizePathSegment(`u-${print.userId}`, "user");
  return assertWithinStorage(path.join(userSegment, ...parts));
}

/** A file of the model in one of its folders: in a folder where the template would put a file named like the folder's
 *  first level, as the pictures' Images folder is placed, so a template that gives each model a folder of its own nests
 *  it there ("Props/Gadget/Plugs/Plug.stl") and one that keeps models side by side gives it a folder beside the model's
 *  files ("Props/Gadget - Plugs/Gadget - Plug.stl"). A source's folder named like the pictures' goes beside them. */
function renderFilePath(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  filename: string,
  plate: number | null,
  folder: string | null | undefined,
): string {
  const flat = renderModelPath(print, template, printValues, filename, plate);
  const levels = folderLevels(folder).map((level) => sanitizePathSegment(level, "Folder"));
  if (!levels.length) return flat;
  if (levels[0].toLowerCase() === ASSETS_FOLDER.toLowerCase()) levels[0] = `${levels[0]} (files)`;
  const home = renderModelPath(print, template, printValues, levels[0], null);
  return assertWithinStorage(path.join(home, ...levels.slice(1), path.basename(flat)));
}

/** The model's pictures folder: where the template would put a file named "Images", so it sits beside the model's
 *  files -- "Props/Gadget/Images", or "Props/Gadget - Images" under a template that keeps models side by side. */
function renderAssetsPath(print: PrintLike, template: string, printValues: PrintTemplateValues): string {
  return renderModelPath(print, template, printValues, ASSETS_FOLDER, null);
}

/** Renders the on-disk relative path for one plate of a print using the storage template.
 * Every user's files live under their own u-<userId> segment beneath the (instance-wide)
 * rendered template, invisibly -- the template's own tokens/UX are unaware of it. */
export async function renderPlateStoragePath(
  print: PrintLike,
  plateFilename: string,
  platePosition: number,
  folder?: string | null,
  template?: string | null,
): Promise<string> {
  const safeTemplate = validateStorageTemplate(template ?? (await getStorageTemplate()));
  const printValues = await printTemplateValues(print, safeTemplate);
  return freePlatePath(
    renderFilePath(print, safeTemplate, printValues, plateFilename, platePosition, folder),
    print.id,
  );
}

/** What already holds a path, so it counts as free for that one: it's where it is. */
type PathOwner = { plateId?: string; printFileId?: string; assetsOf?: string };

async function pathTaken(relative: string, owner: PathOwner = {}): Promise<boolean> {
  const plate = await prisma.plate.findUnique({ where: { storagePath: relative }, select: { id: true } });
  if (plate) return plate.id !== owner.plateId;
  const file = await prisma.printFile.findUnique({ where: { storagePath: relative }, select: { id: true } });
  if (file) return file.id !== owner.printFileId;
  const assets = await prisma.print.findUnique({ where: { assetsPath: relative }, select: { id: true } });
  if (assets) return assets.id !== owner.assetsOf;
  return fsSync.existsSync(path.join(STORAGE, relative));
}

/** Whether the file `printFileId` could move to `relative`: no other file, row or folder has it. */
export async function printFilePathFree(relative: string, printFileId: string): Promise<boolean> {
  return !(await pathTaken(relative, { printFileId }));
}

/** `relative`, unless another file has it: a template that doesn't tell two models apart (one saved before the
 *  rules), or names that only differ in characters a path can't hold. The file then goes in a folder named
 *  after its model's ID, beside where it would have been. */
async function freePlatePath(relative: string, printId: string, owner: PathOwner = {}): Promise<string> {
  if (!(await pathTaken(relative, owner))) return relative;
  const fallback = path.join(path.dirname(relative), printId, path.basename(relative));
  if (await pathTaken(fallback, owner)) throw new HttpError(409, `Storage path already exists: ${relative}`);
  return fallback;
}

/** A supporting or prepared file's place: beside the plates, numbered like "Notes (2).pdf" when one of the model's
 *  files already has its name. */
async function freePrintFilePath(relative: string, printFileId?: string): Promise<string> {
  const ext = path.extname(relative);
  const stem = relative.slice(0, relative.length - ext.length);
  let candidate = relative;
  for (let suffix = 2; await pathTaken(candidate, { printFileId }); suffix++) {
    if (suffix > 1000) throw new HttpError(409, `Storage path already exists: ${relative}`);
    candidate = `${stem} (${suffix})${ext}`;
  }
  return candidate;
}

/** Where a new supporting or prepared file goes. */
export async function renderPrintFileStoragePath(
  print: PrintLike,
  filename: string,
  folder?: string | null,
): Promise<string> {
  const template = validateStorageTemplate(await getStorageTemplate());
  const values = await printTemplateValues(print, template);
  return freePrintFilePath(renderFilePath(print, template, values, filename, null, folder));
}

/** The model's pictures folder, chosen now if it has none yet: a model from before gets one the first time a
 *  picture of it is saved, and its older pictures follow when the storage move reaches it. */
export async function ensureAssetHome(printId: string): Promise<string> {
  const print = await prisma.print.findUnique({ where: { id: printId } });
  if (!print) throw new HttpError(404, "Print not found");
  if (print.assetsPath) return print.assetsPath;
  const template = validateStorageTemplate(await getStorageTemplate());
  const values = await printTemplateValues(print, template);
  const chosen = await freePlatePath(renderAssetsPath(print, template, values), print.id, { assetsOf: print.id });
  try {
    await prisma.print.updateMany({ where: { id: printId, assetsPath: null }, data: { assetsPath: chosen } });
  } catch {
    // Another model took it in the meantime; the next picture tries again.
    throw new HttpError(409, "Couldn't choose a folder for the model's pictures; try again");
  }
  // Another picture saved at the same moment may have chosen first.
  const saved = await prisma.print.findUnique({ where: { id: printId }, select: { assetsPath: true } });
  return saved?.assetsPath ?? chosen;
}

async function ensurePlateAssetHome(plateId: string): Promise<string> {
  const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { printId: true } });
  if (!plate) throw new HttpError(404, "Plate not found");
  return ensureAssetHome(plate.printId);
}

export function samplePlateStoragePaths(template: string): [string, string] {
  const safeTemplate = validateStorageTemplate(template);
  const base = {
    "category-or-folder": "Props/Workshop",
    collection: "Tabletop",
    tags: "Print in place + Useful",
    creator: "Example creator",
    model: "Multi-part gadget",
    id: "a1b2c3d4",
  };
  const first = renderTemplate(safeTemplate, { ...base, filename: "Base.3mf", plate: "1" });
  const second = renderTemplate(safeTemplate, { ...base, filename: "Lid.3mf", plate: "2" });
  return [first, second];
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Neither imported nor a tool's: what merging and bulk assigning a category work on. */
export function isOwnUpload(print: Pick<Print, "sourceProvider" | "toolId">): boolean {
  return !print.sourceProvider && !print.toolId;
}

/** Throws 409 if `requested` is already taken in this category (for this user). Used for
 * explicit renames. */
export async function uniqueModelName(
  userId: string,
  requested: string,
  categoryId: string | null,
  excludeId?: string,
): Promise<string> {
  const base = sanitizePathSegment(requested, "Model");
  const existing = await prisma.print.findFirst({
    where: {
      userId,
      categoryId: categoryId ?? null,
      nameNormalized: normalizeName(base),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) throw new HttpError(409, `A print named "${base}" already exists in this category`);
  return base;
}

/** Auto-suffixes `requested` until it's free in this category (for this user). Used for
 * creation/reassignment. */
export async function availableModelName(
  userId: string,
  requested: string,
  categoryId: string | null,
  excludeId?: string,
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const base = sanitizePathSegment(requested, "Model");
  let candidate = base;
  let suffix = 2;
  // Small categories in practice; a loop of sequential existence checks is simple and correct.
  for (;;) {
    const existing = await db.print.findFirst({
      where: {
        userId,
        categoryId: categoryId ?? null,
        nameNormalized: normalizeName(candidate),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (!existing) return candidate;
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
}

/** `desiredFilename`, or one numbered apart from the model's other plates in the same folder: a name only has to be
 *  unique within its folder, as on disk. */
export async function availablePlateFilename(
  printId: string,
  desiredFilename: string,
  excludePlateId?: string,
  folder?: string | null,
): Promise<string> {
  const siblings = await prisma.plate.findMany({
    where: { printId, folder: folder ?? null, ...(excludePlateId ? { id: { not: excludePlateId } } : {}) },
    select: { filename: true },
  });
  return freePlateFilename(desiredFilename, new Set(siblings.map((p) => p.filename.toLowerCase())));
}

/** `desiredFilename`, or "name (2).ext" and on where it's in `taken`, which holds lowercased names. */
export function freePlateFilename(desiredFilename: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desiredFilename.toLowerCase())) return desiredFilename;
  const ext = path.extname(desiredFilename);
  const stem = path.basename(desiredFilename, ext);
  let suffix = 2;
  for (;;) {
    const candidate = `${stem} (${suffix})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    suffix += 1;
  }
}

export function managedPlatePath(plate: Pick<Plate, "storagePath">): string {
  return path.join(STORAGE, plate.storagePath);
}

export async function pruneEmptyStorageDirs(start: string): Promise<void> {
  const root = path.resolve(STORAGE);
  let current = start;
  while (fsSync.existsSync(current) && path.resolve(current) !== root && path.resolve(current).startsWith(root)) {
    try {
      await fs.rmdir(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

/** Moves one file of a model; `save` records where it went, and the file goes back if that fails. `pick` says, under
 *  the lock, where its record finds it now (`from`) and where it belongs (`to`), both within storage, or null to leave
 *  it. Picked there, from the record as it is then: picked before, the place could be one another move has filled
 *  since, or one for a name the file no longer has. */
async function moveStored(
  pick: () => Promise<{ from: string; to: string } | null>,
  save: (to: string) => Promise<unknown>,
): Promise<boolean> {
  let to: string | null = null;
  const listMove = async (): Promise<[string, string][]> => {
    const picked = await pick();
    if (!picked || picked.from === picked.to) return [];
    to = picked.to;
    // The same place written another way: only the record changes.
    if (samePath(picked.from, picked.to)) return [];
    const newPath = path.join(STORAGE, picked.to);
    // Free of every record when picked; a file there none of them has still isn't this one's to replace.
    if (fsSync.existsSync(newPath)) throw new HttpError(409, `Storage path already exists: ${picked.to}`);
    return [[path.join(STORAGE, picked.from), newPath]];
  };
  const saveIfPicked = async () => {
    if (to !== null) await save(to);
  };
  return (await moveAllStored(listMove, saveIfPicked)) > 0;
}

/** Moves files that one record finds, as moveStored; returns how many were there to move. They're listed under the
 *  lock, so a list can't miss what a merge holding it is adding, nor where a move ahead of it left them: the record
 *  saved afterwards would then point at a place they never reached. */
async function moveAllStored(
  listMoves: () => Promise<[string, string][]>,
  save: () => Promise<unknown>,
): Promise<number> {
  // Under the storage lock, so the file reuse backfill never swaps one of these files for a clone in the middle of it.
  return withStorageLock(async () => {
    const present = (await listMoves()).filter(([oldPath]) => fsSync.existsSync(oldPath));
    const done: [string, string][] = [];
    try {
      for (const [oldPath, newPath] of present) {
        await fs.mkdir(path.dirname(newPath), { recursive: true });
        await fs.rename(oldPath, newPath);
        done.push([oldPath, newPath]);
      }
      await save();
    } catch (err) {
      // Put them back, so the stored path still finds them.
      for (const [oldPath, newPath] of done.toReversed()) {
        await fs.mkdir(path.dirname(oldPath), { recursive: true });
        await fs.rename(newPath, oldPath);
        await pruneEmptyStorageDirs(path.dirname(newPath));
      }
      throw err;
    }
    for (const [oldPath] of present) await pruneEmptyStorageDirs(path.dirname(oldPath));
    return present.length;
  });
}

const samePath = (relative: string, other: string) => path.resolve(STORAGE, relative) === path.resolve(STORAGE, other);

/** The model and its template values as they are, read under the lock for each move (relocatePrint), or null once it's
 *  gone. */
type Placing = () => Promise<{ print: PrintLike; values: PrintTemplateValues } | null>;

/** The model's supporting and prepared files, beside its plates. Those saved before that are under bundles/ and
 *  come over here too. */
async function relocatePrintFiles(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  placing: Placing,
): Promise<number> {
  const files = await prisma.printFile.findMany({ where: { printId: print.id }, orderBy: { id: "asc" } });
  let moved = 0;
  for (const file of files) {
    // In place by this read: a change since that moves it runs a move of its own. One whose save wasn't done is read
    // again under the lock, as the save may be done by then.
    const rendered = renderFilePath(print, template, printValues, file.filename, null, file.folder);
    if (!isUnsettled(file) && file.storagePath === rendered) continue;
    if (await movePrintFile(print.id, template, placing, file.id)) moved += 1;
  }
  return moved;
}

/** Moves one of a model's supporting or prepared files to where its model's files go, its place picked from its row and
 *  the model as they are under the lock. One whose save isn't done is left: the save puts it there once it is
 *  (relocatePrintFile). */
function movePrintFile(printId: string, template: string, placing: Placing, fileId: string): Promise<boolean> {
  return moveStored(
    async () => {
      const now = await prisma.printFile.findUnique({ where: { id: fileId } });
      // Another model's by now, as a plate a merge took is (relocatePrint).
      if (!now || isUnsettled(now) || now.printId !== printId) return null;
      const at = await placing();
      if (!at) return null;
      const place = renderFilePath(at.print, template, at.values, now.filename, null, now.folder);
      // Where it already is counts as free, so a file numbered apart from another ("Notes (2).pdf") stays put.
      return {
        from: now.storagePath,
        to: samePath(now.storagePath, place) ? place : await freePrintFilePath(place, now.id),
      };
    },
    (to) => prisma.printFile.update({ where: { id: fileId }, data: { storagePath: to } }),
  );
}

/** Moves a file whose save has just finished to where its model's files are now: a move of them while it was on its way
 *  in left it where its save first put it. The model is read again under the lock for where that is: a rename of it
 *  whose move got there first has already taken the file along, and the model as read before would send it back. */
export async function relocatePrintFile(fileId: string): Promise<boolean> {
  // The storage structure too, read each time: one saved in between moved the file by itself already.
  const placeOf = async (row: Pick<PrintFile, "printId" | "filename" | "folder">) => {
    const print = await prisma.print.findUnique({ where: { id: row.printId } });
    if (!print) return null;
    const template = validateStorageTemplate(await getStorageTemplate());
    const values = await printTemplateValues(print, template);
    return renderFilePath(print, template, values, row.filename, null, row.folder);
  };
  const row = await prisma.printFile.findUnique({ where: { id: fileId } });
  // In place by this read, which comes after the save was done: a change since then moves it with the rest.
  if (!row || row.storagePath === (await placeOf(row))) return false;
  return moveStored(
    async () => {
      const now = await prisma.printFile.findUnique({ where: { id: fileId } });
      const place = now && !isUnsettled(now) ? await placeOf(now) : null;
      if (!now || !place) return null;
      return {
        from: now.storagePath,
        to: samePath(now.storagePath, place) ? place : await freePrintFilePath(place, now.id),
      };
    },
    (to) => prisma.printFile.update({ where: { id: fileId }, data: { storagePath: to } }),
  );
}

/** Moves a plate just stored to where its model's files are now, as relocatePrintFile does a supporting file: one placed
 *  by the model as read before a rename is passed by the rename's move when that listed the plates before this one had
 *  a row. The model is read again under the lock for where that is. Its row as it is then when it moved, else null. */
export async function relocatePlate(plateId: string): Promise<Plate | null> {
  // The storage structure too, read each time: one saved in between moved the plate by itself already.
  const placeOf = async (row: Pick<Plate, "printId" | "filename" | "position" | "folder">) => {
    const print = await prisma.print.findUnique({ where: { id: row.printId } });
    if (!print) return null;
    const template = validateStorageTemplate(await getStorageTemplate());
    const values = await printTemplateValues(print, template);
    return renderFilePath(print, template, values, row.filename, row.position, row.folder);
  };
  const row = await prisma.plate.findUnique({ where: { id: plateId } });
  // In place by this read, which comes after its row was made: a change since then moves it with the rest.
  if (!row || row.storagePath === (await placeOf(row))) return null;
  let moved: Plate | null = null;
  await moveStored(
    async () => {
      const now = await prisma.plate.findUnique({ where: { id: plateId } });
      const place = now && (await placeOf(now));
      if (!now || !place) return null;
      // Where it already is counts as free, so a plate put aside by freePlatePath stays put.
      return {
        from: now.storagePath,
        to: samePath(now.storagePath, place) ? place : await freePlatePath(place, now.printId, { plateId: now.id }),
      };
    },
    async (to) => {
      moved = await prisma.plate.update({ where: { id: plateId }, data: { storagePath: to } });
    },
  );
  return moved;
}

/** Every picture the model has: its gallery images and their card-sized copies, its description images, and each
 *  plate's thumbnail, render and 3D preview. Slicer copies aren't brought over from the old shared folder: they're
 *  made again when next needed. */
async function modelAssetFiles(printId: string, plateIds: string[]): Promise<AssetFile[]> {
  const [images, descriptions] = await Promise.all([
    prisma.previewImage.findMany({ where: { printId }, select: { id: true } }),
    prisma.descriptionImage.findMany({ where: { printId }, select: { id: true, mime: true } }),
  ]);
  return [
    ...images.flatMap((image) => [galleryImageFile(image.id), galleryThumbFile(image.id)]),
    ...descriptions.map(descriptionImageFile),
    ...plateIds.flatMap((plateId) => [
      plateThumbFile(plateId),
      plateRenderFile(plateId),
      plateRenderFile(plateId, COLOR_RENDER_FILE_TAG),
      plateGlbFile(plateId),
    ]),
  ];
}

/** The ids a model's pictures are named by: its plates' and its gallery and description images'. */
export async function assetOwnerIds(printId: string): Promise<string[]> {
  const [plates, images, descriptions] = await Promise.all([
    prisma.plate.findMany({ where: { printId }, select: { id: true } }),
    prisma.previewImage.findMany({ where: { printId }, select: { id: true } }),
    prisma.descriptionImage.findMany({ where: { printId }, select: { id: true } }),
  ]);
  return [...plates, ...images, ...descriptions].map((row) => row.id);
}

/** The model's pictures moved to where the template now puts its folder, with any still in the old shared folders
 *  brought in. Only its own files go: another model's can be in there too. */
async function relocateAssets(
  print: PrintLike & { assetsPath: string | null },
  template: string,
  placing: Placing,
  plateIds: string[],
): Promise<number> {
  // Picked under the lock, from where the pictures are then and the model as it is then, as a file's place is
  // (moveStored): picked before, the folder could be one another model's pictures have taken since.
  const chosen = { found: false, from: null as string | null, home: null as string | null };
  let moved = await moveAllStored(
    async () => {
      const [now, at] = await Promise.all([
        prisma.print.findUnique({ where: { id: print.id }, select: { assetsPath: true } }),
        placing(),
      ]);
      chosen.found = Boolean(now && at);
      chosen.from = now?.assetsPath ?? null;
      if (!at) return [];
      const rendered = renderAssetsPath(at.print, template, at.values);
      const from = chosen.from;
      const home =
        from && samePath(from, rendered) ? rendered : await freePlatePath(rendered, print.id, { assetsOf: print.id });
      chosen.home = home;
      if (!from || samePath(from, home)) return [];
      return (await ownedAssetFiles(from, await assetOwnerIds(print.id))).map((file): [string, string] => [
        path.join(STORAGE, from, file),
        path.join(STORAGE, home, file),
      ]);
    },
    // A model from before, with none yet, has it saved before the pictures below are brought in, so one brought in is
    // found even if that stops part-way.
    async () => {
      if (chosen.found && chosen.home && chosen.from !== chosen.home) {
        await prisma.print.update({ where: { id: print.id }, data: { assetsPath: chosen.home } });
      }
    },
  );
  // Those still in the old shared folders brought to where the model's pictures are as the lock is held, read again
  // there: another move of them since the one above may have chosen another folder, which these would then miss.
  const adopted = await withStorageLock(async () => {
    const now = await prisma.print.findUnique({ where: { id: print.id }, select: { assetsPath: true } });
    if (!now?.assetsPath) return { home: chosen.home, moved: 0 };
    let count = 0;
    for (const file of await modelAssetFiles(print.id, plateIds)) {
      if (await adoptLegacyAsset(now.assetsPath, file)) count += 1;
    }
    return { home: now.assetsPath, moved: count };
  });
  if (adopted.home) print.assetsPath = adopted.home;
  return moved + adopted.moved;
}

/**
 * Moves everything of a print -- plates, supporting and prepared files, pictures -- after a change to anything its
 * storage path is built from. Returns how many files moved.
 */
export async function relocatePrint(
  print: PrintLike & { assetsPath?: string | null },
  plates: Plate[],
  template?: string | null,
): Promise<number> {
  const safeTemplate = validateStorageTemplate(template ?? (await getStorageTemplate()));
  const printValues = await printTemplateValues(print, safeTemplate);
  const mine = ++movesBegun;
  latestMove.set(print.id, mine);
  // Where each file goes: by the model as given, until a later move of it begins, which is one for a change saved
  // after this began: then by the model as saved, read once for each later move. That move may have got there first
  // and taken the files where it puts them, and the model as given would send them back. The template's values are
  // read again only then, rather than for every file, as each read takes the lock's time.
  let seen = latestMove.get(print.id);
  let at: { print: PrintLike; values: PrintTemplateValues } | null = { print, values: printValues };
  const placing: Placing = async () => {
    const latest = latestMove.get(print.id);
    if (latest !== seen) {
      seen = latest;
      const now = await prisma.print.findUnique({ where: { id: print.id } });
      at = now ? { print: now, values: await printTemplateValues(now, safeTemplate) } : null;
    }
    return at;
  };
  try {
    return await relocatePrintWith(print, plates, safeTemplate, printValues, placing);
  } finally {
    if (latestMove.get(print.id) === mine) latestMove.delete(print.id);
  }
}

// Every model move begun so far, and each model's latest: a move that finds a later one began for its model knows a
// change of it was saved after it began, as every save that moves a model's files starts a move of them (relocatePrint).
let movesBegun = 0;
const latestMove = new Map<string, number>();

/** relocatePrint's moves of the plates, files and pictures, each placed as `placing` says then. */
async function relocatePrintWith(
  print: PrintLike & { assetsPath?: string | null },
  plates: Plate[],
  safeTemplate: string,
  printValues: PrintTemplateValues,
  placing: Placing,
): Promise<number> {
  let moved = 0;
  for (const plate of plates) {
    // In place by the caller's read: a change since that moves it runs a move of its own.
    if (
      plate.storagePath ===
      renderFilePath(print, safeTemplate, printValues, plate.filename, plate.position, plate.folder)
    )
      continue;
    const didMove = await moveStored(
      async () => {
        const now = await prisma.plate.findUnique({ where: { id: plate.id } });
        // Another model's by now, which a merge made it: that model's move takes it where its files go.
        if (!now || now.printId !== print.id) return null;
        const at = await placing();
        if (!at) return null;
        const place = renderFilePath(at.print, safeTemplate, at.values, now.filename, now.position, now.folder);
        // Where it already is counts as free, so a plate moved aside by freePlatePath stays put.
        const to = samePath(now.storagePath, place) ? place : await freePlatePath(place, print.id, { plateId: now.id });
        return { from: now.storagePath, to };
      },
      (to) => prisma.plate.update({ where: { id: plate.id }, data: { storagePath: to } }),
    );
    if (didMove) moved += 1;
  }
  moved += await relocatePrintFiles(print, safeTemplate, printValues, placing);
  // A caller that only had some of the plates still moves every plate's pictures.
  const [current, allPlates] = await Promise.all([
    print.assetsPath === undefined
      ? prisma.print.findUnique({ where: { id: print.id }, select: { assetsPath: true } })
      : { assetsPath: print.assetsPath },
    prisma.plate.findMany({ where: { printId: print.id }, select: { id: true } }),
  ]);
  if (!current) return moved;
  moved += await relocateAssets(
    { ...print, assetsPath: current.assetsPath },
    safeTemplate,
    placing,
    allPlates.map((plate) => plate.id),
  );
  return moved;
}

/** Moves the given prints' files after a change that only matters when the storage template
 * uses `token` -- a collection membership change, say, moves nothing under the default
 * {category-or-folder}/{model}/{filename}. Best-effort per print, like reorganizeManagedPrints: the change
 * itself has already been saved, and one print's file collision shouldn't undo it or block the
 * others. */
export async function relocatePrintsForToken(
  token: (typeof STORAGE_TEMPLATE_TOKENS)[number],
  printIds: string[],
): Promise<void> {
  if (!printIds.length) return;
  const template = validateStorageTemplate(await getStorageTemplate());
  if (!templateUses(template, token)) return;
  const prints = await prisma.print.findMany({ where: { id: { in: printIds } }, include: { plates: true } });
  for (const print of prints) {
    try {
      await relocatePrint(print, print.plates, template);
    } catch (err) {
      console.error(`Couldn't move the files of print ${print.id} after a {${token}} change`, err);
    }
  }
}

/** Re-lays-out managed print storage. Pass `userId` for a category rename/delete affecting only
 * that user's own prints; omit it for an instance-wide storage-template change (admin-only --
 * see requireAdmin on POST /settings/storage), which needs to touch every user's files. */
export type ReorganizeProgress = { done: number; total: number; moved: number; skipped: number };

export async function reorganizeManagedPrints(
  template?: string | null,
  userId?: string,
  onProgress?: (progress: ReorganizeProgress) => void,
): Promise<{ moved: number; skipped: number }> {
  let moved = 0;
  let skipped = 0;
  const prints = await prisma.print.findMany({
    where: userId ? { userId } : undefined,
    include: { plates: true },
    orderBy: { id: "asc" },
  });
  for (const [index, print] of prints.entries()) {
    try {
      moved += await relocatePrint(print, print.plates, template);
    } catch (err) {
      console.error(`Couldn't move the files of print ${print.id}`, err);
      skipped += 1;
    }
    onProgress?.({ done: index + 1, total: prints.length, moved, skipped });
  }
  return { moved, skipped };
}

/** How many files, of how many models, aren't where `template` puts them: what saving it would move. A file put
 *  beside its place, in a folder named after its model because another file has that place (freePlatePath), counts
 *  as in place, as does a supporting file numbered apart from another (freePrintFilePath). Pictures are counted by
 *  their images, from the database; thumbnails and renders, which have no rows, move along uncounted. */
export async function storageOutOfPlace(template: string): Promise<{ files: number; models: number }> {
  const safeTemplate = validateStorageTemplate(template);
  const prints = await prisma.print.findMany({
    include: {
      plates: true,
      files: { select: { filename: true, folder: true, storagePath: true, ready: true } },
      _count: { select: { previewImages: true, descriptionImages: true } },
    },
  });
  const taken = new Set(
    prints.flatMap((print) => [
      ...print.plates.map((plate) => plate.storagePath),
      ...print.files.map((file) => file.storagePath),
      ...(print.assetsPath ? [print.assetsPath] : []),
    ]),
  );
  const inPlace = (stored: string, target: string, printId: string) => {
    if (stored === target) return true;
    const aside = path.join(path.dirname(target), printId, path.basename(target));
    return stored === aside && taken.has(target);
  };
  let files = 0;
  let models = 0;
  for (const print of prints) {
    const values = await printTemplateValues(print, safeTemplate);
    let misplaced = print.plates.filter(
      (plate) =>
        !inPlace(
          plate.storagePath,
          renderFilePath(print, safeTemplate, values, plate.filename, plate.position, plate.folder),
          print.id,
        ),
    ).length;
    misplaced += print.files.filter((file) => {
      if (!file.ready) return false;
      const target = renderFilePath(print, safeTemplate, values, file.filename, null, file.folder);
      return file.storagePath !== target && withoutNumber(file.storagePath) !== target;
    }).length;
    const assetsTarget = renderAssetsPath(print, safeTemplate, values);
    const assetsMisplaced = !print.assetsPath || !inPlace(print.assetsPath, assetsTarget, print.id);
    if (assetsMisplaced) misplaced += print._count.previewImages + print._count.descriptionImages;
    files += misplaced;
    // A model with only thumbnails or renders still has a folder to move.
    if (misplaced || (assetsMisplaced && print.plates.length)) models += 1;
  }
  return { files, models };
}

/** "Notes (2).pdf" as "Notes.pdf". */
function withoutNumber(file: string): string {
  const ext = path.extname(file);
  return file.slice(0, file.length - ext.length).replace(/ \(\d+\)$/, "") + ext;
}

// -- Settings (storage template) -----------------------------------------

export async function getStorageTemplate(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: "storage_path_template" } });
  return typeof row?.value === "string" ? row.value : DEFAULT_STORAGE_TEMPLATE;
}

export async function setStorageTemplate(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: "storage_path_template" },
    create: { key: "storage_path_template", value },
    update: { value },
  });
}

// -- Thumbnails -------------------------------------------------------------

async function saveThumbBuffer(plateId: string, input: Buffer, keepExif = false): Promise<boolean> {
  let tmp: string | null = null;
  try {
    const file = plateThumbFile(plateId);
    const home = await ensurePlateAssetHome(plateId);
    const dest = assetTarget(home, file);
    tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await writePhotoJpeg(input, tmp, 512, 88, keepExif);
    await fs.rename(tmp, dest);
    // The one in the old shared folder is out of date now.
    await removeAsset(null, file);
    // Any thumb but our own render; the generated-thumbnail route marks those after saving.
    await prisma.plate.updateMany({ where: { id: plateId, thumbGenerated: true }, data: { thumbGenerated: false } });
    return true;
  } catch {
    if (tmp) await fs.rm(tmp, { force: true });
    return false;
  }
}

export async function saveThumbFromFile(plateId: string, srcPath: string): Promise<boolean> {
  try {
    const buf = await fs.readFile(srcPath);
    return await saveThumbBuffer(plateId, buf);
  } catch {
    return false;
  }
}

export async function saveThumbFromBytes(plateId: string, data: Buffer, keepExif = false): Promise<boolean> {
  return saveThumbBuffer(plateId, data, keepExif);
}

const THUMBNAIL_ENTRY_PRIORITY: Record<string, number> = {
  "metadata/thumbnail.png": 0,
  "3d/thumbnail.png": 1,
  "thumbnail.png": 2,
};

/** How large a .3mf's thumbnail picture may be, and how many of them, and how much in all, are held to choose from:
 *  all are read before one is tried, and an archive can name any number. */
const THUMBNAIL_ENTRY_MAX = 16 * 1024 * 1024;
const THUMBNAIL_CANDIDATES = 4;
const THUMBNAIL_CANDIDATES_MAX = 32 * 1024 * 1024;
// Pictures that won't read, or aren't pictures, before the rest are left: each read looks through the archive afresh,
// and it can name any number of them.
const THUMBNAIL_FAILURES_MAX = 8;

/** The pictures a .3mf's zip payload holds as its thumbnail, best first, as many as THUMBNAIL_CANDIDATES and
 *  THUMBNAIL_CANDIDATES_MAX allow, after as many that fail as THUMBNAIL_FAILURES_MAX; none when it holds none or
 *  can't be read. */
export async function read3mfThumbnails(srcPath: string): Promise<Buffer[]> {
  if (!srcPath.toLowerCase().endsWith(".3mf")) return [];
  try {
    const entries = await listZipEntries(srcPath);
    const imageNames = entries
      .filter((e) => !e.isDirectory)
      .filter((e) => /\.(png|jpe?g|webp)$/i.test(e.name) && /thumbnail/i.test(path.basename(e.name)))
      .filter((e) => e.size <= THUMBNAIL_ENTRY_MAX)
      .toSorted((a, b) => {
        const pa = THUMBNAIL_ENTRY_PRIORITY[a.name.toLowerCase().replace(/^\//, "")] ?? 10;
        const pb = THUMBNAIL_ENTRY_PRIORITY[b.name.toLowerCase().replace(/^\//, "")] ?? 10;
        return pa - pb || a.name.length - b.name.length;
      });
    const pictures: Buffer[] = [];
    let bytes = 0;
    let failed = 0;
    for (const entry of imageNames) {
      // Checked before each read, the read held to what's left: a size the archive lists can be wrong. One that doesn't
      // fit is passed over for a smaller one after it.
      const room = Math.min(THUMBNAIL_ENTRY_MAX, THUMBNAIL_CANDIDATES_MAX - bytes);
      if (pictures.length >= THUMBNAIL_CANDIDATES || failed >= THUMBNAIL_FAILURES_MAX) break;
      if (entry.size > room) continue;
      // One that can't be read, or isn't a picture by its header, is passed over, as one too large is, so it takes no
      // place a picture after it could have: those read already still count.
      const buf = await readZipEntry(srcPath, entry.name, room).catch(() => null);
      if (!buf || !(await imageFormat(buf).catch(() => undefined))) {
        failed += 1;
        continue;
      }
      pictures.push(buf);
      bytes += buf.length;
    }
    return pictures;
  } catch {
    return [];
  }
}

/** The plate's thumbnail made of the first of `pictures` that makes one. */
export async function saveThumbFromPictures(plateId: string, pictures: Buffer[]): Promise<boolean> {
  for (const picture of pictures) if (await saveThumbBuffer(plateId, picture)) return true;
  return false;
}

/** Extracts an embedded thumbnail image from a .3mf archive's zip payload, if present. */
export async function extract3mfThumbnail(plateId: string, srcPath: string): Promise<boolean> {
  return saveThumbFromPictures(plateId, await read3mfThumbnails(srcPath));
}

export async function ensurePlateThumbnail(plateId: string, srcPath: string): Promise<boolean> {
  if (plateThumbExists(plateId, await plateAssetHome(plateId))) return true;
  return extract3mfThumbnail(plateId, srcPath);
}

/** `home` is the plate's model's Print.assetsPath. */
export function plateThumbPath(plateId: string, home: AssetHome): string {
  return assetPath(home, plateThumbFile(plateId));
}

export function plateThumbExists(plateId: string, home: AssetHome): boolean {
  return assetExists(home, plateThumbFile(plateId));
}

/** Everything made of the plate, once it's gone or its file changed: its thumbnail, and its renders, 3D previews and
 *  slicer copies of any version. */
export async function removePlatePictures(plateId: string, home: AssetHome): Promise<void> {
  await removeAsset(home, plateThumbFile(plateId));
  for (const kind of ["render", "preview", "slicer"] as const) await removePlateAssets(home, kind, plateId);
}

/** True when the plate has no thumb or only our own 3D render, which an imported image beats. */
export async function plateThumbReplaceable(plateId: string): Promise<boolean> {
  if (!plateThumbExists(plateId, await plateAssetHome(plateId))) return true;
  const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { thumbGenerated: true } });
  return plate?.thumbGenerated ?? false;
}

/** What's left of the model's pictures once it's gone, and the folder with them. `ids` are its assetOwnerIds,
 *  taken before its rows went; only files named by them go, as another model's can be in the folder too. */
export async function removeAssetHome(home: AssetHome, ids: string[]): Promise<void> {
  if (!home) return;
  const abs = path.join(STORAGE, home);
  for (const file of await ownedAssetFiles(home, ids)) {
    await fs.rm(path.join(abs, file), { force: true }).catch(() => undefined);
  }
  for (const folder of Object.values(ASSET_SUBFOLDERS).filter(Boolean)) {
    await pruneEmptyStorageDirs(path.join(abs, folder));
  }
  await pruneEmptyStorageDirs(abs);
}
