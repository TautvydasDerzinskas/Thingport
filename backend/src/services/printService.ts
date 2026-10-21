import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { HttpError } from "../utils/fileUtils";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import {
  adoptLegacyAsset,
  ASSET_SUBFOLDERS,
  ASSETS_FOLDER,
  assetExists,
  assetPath,
  assetTarget,
  descriptionImageFile,
  galleryImageFile,
  ownedAssetFiles,
  plateAssetHome,
  plateRenderFile,
  plateThumbFile,
  removeAsset,
  type AssetFile,
  type AssetHome,
} from "./modelAssets";
import type { Category, Plate, Prisma, Print } from "@prisma/client";

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
  template?: string | null,
): Promise<string> {
  const safeTemplate = validateStorageTemplate(template ?? (await getStorageTemplate()));
  const printValues = await printTemplateValues(print, safeTemplate);
  return freePlatePath(renderModelPath(print, safeTemplate, printValues, plateFilename, platePosition), print.id);
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
export async function renderPrintFileStoragePath(print: PrintLike, filename: string): Promise<string> {
  const template = validateStorageTemplate(await getStorageTemplate());
  const values = await printTemplateValues(print, template);
  return freePrintFilePath(renderModelPath(print, template, values, filename, null));
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

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
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

/** Auto-suffixes a plate's filename until it's unique among its print's other plates. */
export async function availablePlateFilename(
  printId: string,
  desiredFilename: string,
  excludePlateId?: string,
): Promise<string> {
  const siblings = await prisma.plate.findMany({
    where: { printId, ...(excludePlateId ? { id: { not: excludePlateId } } : {}) },
    select: { filename: true },
  });
  const taken = new Set(siblings.map((p) => p.filename.toLowerCase()));
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

/** Moves one file of a model; `save` records the new place, and the file goes back if that fails. */
async function moveStored(oldPath: string, newPath: string, save: () => Promise<unknown>): Promise<boolean> {
  return (await moveAllStored([[oldPath, newPath]], save)) > 0;
}

/** Moves files that one record finds, as moveStored; returns how many were there to move. */
async function moveAllStored(moves: [string, string][], save: () => Promise<unknown>): Promise<number> {
  const present = moves.filter(([oldPath]) => fsSync.existsSync(oldPath));
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
}

const samePath = (relative: string, other: string) => path.resolve(STORAGE, relative) === path.resolve(STORAGE, other);

/** The model's supporting and prepared files, beside its plates. Those saved before that are under bundles/ and
 *  come over here too. */
async function relocatePrintFiles(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
): Promise<number> {
  const files = await prisma.printFile.findMany({ where: { printId: print.id }, orderBy: { id: "asc" } });
  let moved = 0;
  for (const file of files) {
    const rendered = renderModelPath(print, template, printValues, file.filename, null);
    const newRelative = samePath(file.storagePath, rendered) ? rendered : await freePrintFilePath(rendered, file.id);
    if (samePath(file.storagePath, newRelative)) continue;
    const didMove = await moveStored(path.join(STORAGE, file.storagePath), path.join(STORAGE, newRelative), () =>
      prisma.printFile.update({ where: { id: file.id }, data: { storagePath: newRelative } }),
    );
    if (didMove) moved += 1;
  }
  return moved;
}

/** Every picture the model has: its gallery and description images, and each plate's thumbnail and render. */
async function modelAssetFiles(printId: string, plateIds: string[]): Promise<AssetFile[]> {
  const [images, descriptions] = await Promise.all([
    prisma.previewImage.findMany({ where: { printId }, select: { id: true } }),
    prisma.descriptionImage.findMany({ where: { printId }, select: { id: true, mime: true } }),
  ]);
  return [
    ...images.map((image) => galleryImageFile(image.id)),
    ...descriptions.map(descriptionImageFile),
    ...plateIds.flatMap((plateId) => [plateThumbFile(plateId), plateRenderFile(plateId)]),
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
  printValues: PrintTemplateValues,
  plateIds: string[],
): Promise<number> {
  const rendered = renderAssetsPath(print, template, printValues);
  const current = print.assetsPath;
  const home =
    current && samePath(current, rendered) ? rendered : await freePlatePath(rendered, print.id, { assetsOf: print.id });
  let moved = 0;
  if (!current) {
    // Saved before anything moves, so a picture moved below is found even if the move stops part-way.
    await prisma.print.update({ where: { id: print.id }, data: { assetsPath: home } });
  } else if (!samePath(current, home)) {
    const owned = await ownedAssetFiles(current, await assetOwnerIds(print.id));
    moved += await moveAllStored(
      owned.map((file) => [path.join(STORAGE, current, file), path.join(STORAGE, home, file)]),
      () => prisma.print.update({ where: { id: print.id }, data: { assetsPath: home } }),
    );
  } else if (current !== home) {
    await prisma.print.update({ where: { id: print.id }, data: { assetsPath: home } });
  }
  print.assetsPath = home;
  for (const file of await modelAssetFiles(print.id, plateIds)) {
    if (await adoptLegacyAsset(home, file)) moved += 1;
  }
  return moved;
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
  let moved = 0;
  for (const plate of plates) {
    const oldPath = managedPlatePath(plate);
    const rendered = renderModelPath(print, safeTemplate, printValues, plate.filename, plate.position);
    // Where it already is counts as free, so a plate moved aside by freePlatePath stays put.
    const newRelative =
      path.resolve(oldPath) === path.resolve(STORAGE, rendered)
        ? rendered
        : await freePlatePath(rendered, print.id, { plateId: plate.id });
    const newPath = path.join(STORAGE, newRelative);
    if (path.resolve(oldPath) === path.resolve(newPath)) {
      if (plate.storagePath !== newRelative) {
        await prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } });
      }
      continue;
    }
    const didMove = await moveStored(oldPath, newPath, () =>
      prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } }),
    );
    if (didMove) moved += 1;
  }
  moved += await relocatePrintFiles(print, safeTemplate, printValues);
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
    printValues,
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
      files: { select: { filename: true, storagePath: true } },
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
          renderModelPath(print, safeTemplate, values, plate.filename, plate.position),
          print.id,
        ),
    ).length;
    misplaced += print.files.filter((file) => {
      const target = renderModelPath(print, safeTemplate, values, file.filename, null);
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

async function saveThumbBuffer(plateId: string, input: Buffer): Promise<boolean> {
  let tmp: string | null = null;
  try {
    const file = plateThumbFile(plateId);
    const home = await ensurePlateAssetHome(plateId);
    const dest = assetTarget(home, file);
    tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await sharp(input)
      .flatten({ background: { r: 248, g: 250, b: 252 } })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(tmp);
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

export async function saveThumbFromBytes(plateId: string, data: Buffer): Promise<boolean> {
  return saveThumbBuffer(plateId, data);
}

const THUMBNAIL_ENTRY_PRIORITY: Record<string, number> = {
  "metadata/thumbnail.png": 0,
  "3d/thumbnail.png": 1,
  "thumbnail.png": 2,
};

/** Extracts an embedded thumbnail image from a .3mf archive's zip payload, if present. */
export async function extract3mfThumbnail(plateId: string, srcPath: string): Promise<boolean> {
  if (!srcPath.toLowerCase().endsWith(".3mf")) return false;
  try {
    const entries = await listZipEntries(srcPath);
    const imageNames = entries
      .filter((e) => !e.isDirectory)
      .filter((e) => /\.(png|jpe?g|webp)$/i.test(e.name) && /thumbnail/i.test(path.basename(e.name)))
      .filter((e) => e.size <= 16 * 1024 * 1024)
      .toSorted((a, b) => {
        const pa = THUMBNAIL_ENTRY_PRIORITY[a.name.toLowerCase().replace(/^\//, "")] ?? 10;
        const pb = THUMBNAIL_ENTRY_PRIORITY[b.name.toLowerCase().replace(/^\//, "")] ?? 10;
        return pa - pb || a.name.length - b.name.length;
      });
    for (const entry of imageNames) {
      const buf = await readZipEntry(srcPath, entry.name, 16 * 1024 * 1024);
      if (buf && (await saveThumbBuffer(plateId, buf))) return true;
    }
  } catch {
    return false;
  }
  return false;
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

/** A plate's thumbnail and render, once the plate is gone. */
export async function removePlatePictures(plateId: string, home: AssetHome): Promise<void> {
  await removeAsset(home, plateThumbFile(plateId));
  await removeAsset(home, plateRenderFile(plateId));
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
