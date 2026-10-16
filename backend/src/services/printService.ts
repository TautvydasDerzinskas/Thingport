import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { HttpError } from "../utils/fileUtils";
import { STORAGE, THUMBS } from "../config";
import { prisma } from "../db";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import type { Category, Plate, Print } from "@prisma/client";

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

function renderPlatePath(
  print: PrintLike,
  template: string,
  printValues: PrintTemplateValues,
  plateFilename: string,
  platePosition: number,
): string {
  const values = {
    ...printValues,
    filename: sanitizePathSegment(plateFilename, "file"),
    plate: String(platePosition + 1),
  };
  const rendered = renderTemplate(template, values).replace(/\\/g, "/");
  const parts = rendered
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part, "item"));
  if (!parts.length) throw new HttpError(400, "Storage template produced an empty path");
  const userSegment = sanitizePathSegment(`u-${print.userId}`, "user");
  return assertWithinStorage(path.join(userSegment, ...parts));
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
  return freePlatePath(renderPlatePath(print, safeTemplate, printValues, plateFilename, platePosition), print.id);
}

async function pathTaken(relative: string, plateId?: string): Promise<boolean> {
  const holder = await prisma.plate.findUnique({ where: { storagePath: relative }, select: { id: true } });
  if (holder) return holder.id !== plateId;
  return fsSync.existsSync(path.join(STORAGE, relative));
}

/** `relative`, unless another file has it: a template that doesn't tell two models apart (one saved before the
 *  rules), or names that only differ in characters a path can't hold. The file then goes in a folder named
 *  after its model's ID, beside where it would have been. */
async function freePlatePath(relative: string, printId: string, plateId?: string): Promise<string> {
  if (!(await pathTaken(relative, plateId))) return relative;
  const fallback = path.join(path.dirname(relative), printId, path.basename(relative));
  if (await pathTaken(fallback, plateId)) throw new HttpError(409, `Storage path already exists: ${relative}`);
  return fallback;
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
): Promise<string> {
  const base = sanitizePathSegment(requested, "Model");
  let candidate = base;
  let suffix = 2;
  // Small categories in practice; a loop of sequential existence checks is simple and correct.
  for (;;) {
    const existing = await prisma.print.findFirst({
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

/**
 * Moves every plate of a print after a change to anything its storage path is built from.
 * Supporting and prepared files live at a fixed bundles/ path and aren't touched.
 */
export async function relocatePrint(print: PrintLike, plates: Plate[], template?: string | null): Promise<void> {
  const safeTemplate = validateStorageTemplate(template ?? (await getStorageTemplate()));
  const printValues = await printTemplateValues(print, safeTemplate);
  for (const plate of plates) {
    const oldPath = managedPlatePath(plate);
    const rendered = renderPlatePath(print, safeTemplate, printValues, plate.filename, plate.position);
    // Where it already is counts as free, so a plate moved aside by freePlatePath stays put.
    const newRelative =
      path.resolve(oldPath) === path.resolve(STORAGE, rendered)
        ? rendered
        : await freePlatePath(rendered, print.id, plate.id);
    const newPath = path.join(STORAGE, newRelative);
    if (path.resolve(oldPath) === path.resolve(newPath)) {
      if (plate.storagePath !== newRelative) {
        await prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } });
      }
      continue;
    }
    const oldExists = fsSync.existsSync(oldPath);
    if (oldExists) {
      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);
      await pruneEmptyStorageDirs(path.dirname(oldPath));
    }
    await prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } });
  }
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
      const before = new Map(print.plates.map((p) => [p.id, p.storagePath]));
      await relocatePrint(print, print.plates, template);
      const after = await prisma.plate.findMany({ where: { printId: print.id } });
      for (const plate of after) {
        if (before.get(plate.id) !== plate.storagePath) moved += 1;
      }
    } catch {
      skipped += 1;
    }
    onProgress?.({ done: index + 1, total: prints.length, moved, skipped });
  }
  return { moved, skipped };
}

/** How many files, of how many models, aren't where `template` puts them: what saving it would move. A file put
 *  beside its place, in a folder named after its model because another file has that place (freePlatePath), counts
 *  as in place. */
export async function storageOutOfPlace(template: string): Promise<{ files: number; models: number }> {
  const safeTemplate = validateStorageTemplate(template);
  const prints = await prisma.print.findMany({ include: { plates: true } });
  const taken = new Set(prints.flatMap((print) => print.plates.map((plate) => plate.storagePath)));
  let files = 0;
  let models = 0;
  for (const print of prints) {
    if (!print.plates.length) continue;
    const values = await printTemplateValues(print, safeTemplate);
    const misplaced = print.plates.filter((plate) => {
      const target = renderPlatePath(print, safeTemplate, values, plate.filename, plate.position);
      if (plate.storagePath === target) return false;
      const aside = path.join(path.dirname(target), print.id, path.basename(target));
      return !(plate.storagePath === aside && taken.has(target));
    }).length;
    files += misplaced;
    if (misplaced) models += 1;
  }
  return { files, models };
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
  const dest = path.join(THUMBS, `${plateId}.jpg`);
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    await sharp(input)
      .flatten({ background: { r: 248, g: 250, b: 252 } })
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(tmp);
    await fs.rename(tmp, dest);
    // Any thumb but our own render; the generated-thumbnail route marks those after saving.
    await prisma.plate.updateMany({ where: { id: plateId, thumbGenerated: true }, data: { thumbGenerated: false } });
    return true;
  } catch {
    await fs.rm(tmp, { force: true });
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
  const existing = path.join(THUMBS, `${plateId}.jpg`);
  if (fsSync.existsSync(existing)) return true;
  return extract3mfThumbnail(plateId, srcPath);
}

export function plateThumbPath(plateId: string): string {
  return path.join(THUMBS, `${plateId}.jpg`);
}

export function plateThumbExists(plateId: string): boolean {
  return fsSync.existsSync(plateThumbPath(plateId));
}

/** True when the plate has no thumb or only our own 3D render, which an imported image beats. */
export async function plateThumbReplaceable(plateId: string): Promise<boolean> {
  if (!plateThumbExists(plateId)) return true;
  const plate = await prisma.plate.findUnique({ where: { id: plateId }, select: { thumbGenerated: true } });
  return plate?.thumbGenerated ?? false;
}
