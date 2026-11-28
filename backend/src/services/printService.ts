import fs from "node:fs/promises";
import { withStorageLock } from "../utils/storageLock";
import fsSync from "node:fs";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";
import { normalizeFileName, numberedName } from "../files/names";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import { writePhotoJpeg } from "./imageProcessing";
import {
  adoptLegacyAsset,
  ASSET_SUBFOLDERS,
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
import type { Plate, Prisma, Print } from "@prisma/client";
import {
  DEFAULT_STORAGE_TEMPLATE,
  renderAssetsPath,
  renderFilePath,
  sanitizePathSegment,
  STORAGE_TEMPLATE_TOKENS,
  templateUses,
  validateStorageTemplate,
  type PrintLike,
  type PrintTemplateValues,
  PATH_SEGMENT_MAX,
} from "../modelFiles/template";
import { printTemplateValues } from "../modelFiles/templateValues";
import { fileState } from "../modelFiles/storageFs";

export {
  DEFAULT_STORAGE_TEMPLATE,
  normalizeStorageTemplate,
  samplePlateStoragePaths,
  sanitizePathSegment,
  STORAGE_TEMPLATE_TOKENS,
  validateStorageTemplate,
} from "../modelFiles/template";

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
  // Anything there is in the way, a folder too. A look that fails throws: nothing is saved over a file it couldn't see.
  return (await fileState(path.join(STORAGE, relative), "path.taken")).state !== "missing";
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
  const name = normalizeFileName(path.basename(relative));
  let candidate = relative;
  for (let suffix = 2; await pathTaken(candidate, { printFileId }); suffix++) {
    if (suffix > 1000) throw new HttpError(409, `Storage path already exists: ${relative}`);
    candidate = path.join(path.dirname(relative), numberedName(name, suffix, PATH_SEGMENT_MAX));
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
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const siblings = await db.plate.findMany({
    where: { printId, folder: folder ?? null, ...(excludePlateId ? { id: { not: excludePlateId } } : {}) },
    select: { filename: true },
  });
  return freePlateFilename(desiredFilename, new Set(siblings.map((p) => p.filename.toLowerCase())));
}

/** `desiredFilename`, or "name (2).ext" and on where it's in `taken`, which holds lowercased names. */
export function freePlateFilename(desiredFilename: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desiredFilename.toLowerCase())) return desiredFilename;
  const name = normalizeFileName(desiredFilename);
  for (let suffix = 2; ; suffix++) {
    const candidate = numberedName(name, suffix);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function managedPlatePath(plate: Pick<Plate, "storagePath">): string {
  return path.join(STORAGE, plate.storagePath);
}

/** Whether the plate's row, read again by id, still names the file it did: what a download asks once the file is
 *  open (utils/sendStored.ts). */
export async function plateStillNames(plate: Pick<Plate, "id" | "storagePath" | "sourcePath">): Promise<boolean> {
  const count = await prisma.plate.count({
    where: { id: plate.id, storagePath: plate.storagePath, sourcePath: plate.sourcePath },
  });
  return count > 0;
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

/** Moves one file of a model; `save` records the new place, and the file goes back if that fails. `stored` is where its
 *  record finds it now, read under the lock. */
async function moveStored(
  stored: () => Promise<string>,
  newPath: string,
  save: () => Promise<unknown>,
): Promise<boolean> {
  let listedFrom: string | undefined;
  const listMove = async (): Promise<[string, string][]> => {
    const oldPath = await stored();
    listedFrom = oldPath;
    // The place was free when it was picked, so only another move can have filled it since: renaming now would destroy
    // that file. Asked again, this one sees the place is taken and goes elsewhere. Free is nothing there; a look that
    // fails throws before anything is renamed.
    if (oldPath !== newPath && (await fileState(newPath, "move.target")).state !== "missing") {
      throw new HttpError(409, `Storage path already exists: ${path.relative(STORAGE, newPath)}`);
    }
    return [[oldPath, newPath]];
  };
  // After a failed save, where the record says the file is: the new place, the old one, or neither it can tell.
  const committed = async () => {
    const now = path.resolve(await stored());
    if (now === path.resolve(newPath)) return true;
    return listedFrom !== undefined && now === path.resolve(listedFrom) ? false : undefined;
  };
  return (await moveAllStored(listMove, save, committed)) > 0;
}

/** Moves files that one record finds, as moveStored; returns how many were there to move. They're listed under the
 *  lock, so a list can't miss what a merge holding it is adding, nor where a move ahead of it left them: the record
 *  saved afterwards would then point at a place they never reached. */
async function moveAllStored(
  listMoves: () => Promise<[string, string][]>,
  save: () => Promise<unknown>,
  committed?: () => Promise<boolean | undefined>,
): Promise<number> {
  // Under the storage lock, so the file reuse backfill never swaps one of these files for a clone in the middle of it.
  return withStorageLock(async () => {
    // Every one looked at before any is renamed: a look that fails stops them all, rather than leave that file behind
    // while its record is saved where it never went. Only a file moves, never a folder in its place.
    const present: [string, string][] = [];
    for (const move of await listMoves()) {
      if ((await fileState(move[0], "move.source")).state === "file") present.push(move);
    }
    const done: [string, string][] = [];
    try {
      for (const [oldPath, newPath] of present) {
        await fs.mkdir(path.dirname(newPath), { recursive: true });
        await fs.rename(oldPath, newPath);
        done.push([oldPath, newPath]);
      }
      await save();
    } catch (err) {
      // A save that failed may still have committed. Then the files stay where the record now says; and when the
      // record can't be read, they stay too, as the next move finds them gone from the old place and records the new.
      const outcome = done.length && committed ? await committed().catch(() => undefined) : false;
      if (outcome === true) {
        for (const [oldPath] of present) await pruneEmptyStorageDirs(path.dirname(oldPath));
        return present.length;
      }
      if (outcome === undefined) throw err;
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
    const rendered = renderFilePath(print, template, printValues, file.filename, null, file.folder);
    const newRelative = samePath(file.storagePath, rendered) ? rendered : await freePrintFilePath(rendered, file.id);
    if (samePath(file.storagePath, newRelative)) continue;
    const didMove = await moveStored(
      async () => {
        const { storagePath } = (await prisma.printFile.findUnique({ where: { id: file.id } })) ?? file;
        return path.join(STORAGE, storagePath);
      },
      path.join(STORAGE, newRelative),
      () => prisma.printFile.update({ where: { id: file.id }, data: { storagePath: newRelative } }),
    );
    if (didMove) moved += 1;
  }
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
    moved += await moveAllStored(
      async () => {
        const now = await prisma.print.findUnique({ where: { id: print.id }, select: { assetsPath: true } });
        const from = now?.assetsPath ?? current;
        return (await ownedAssetFiles(from, await assetOwnerIds(print.id))).map((file): [string, string] => [
          path.join(STORAGE, from, file),
          path.join(STORAGE, home, file),
        ]);
      },
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

/** Moves these plates' files to where their names and the template now put them. */
/** A plate a rename moved aside to wait for its target, in a folder of its own: `<folder>/<model id>/<plate id>/`. The
 *  fallback a taken name gets, `<folder>/<model id>/<name>`, isn't one. */
export function isWaitingAside(plate: Pick<Plate, "id" | "storagePath">, printId: string): boolean {
  const parts = plate.storagePath.split(/[\\/]/);
  return parts.length >= 3 && parts[parts.length - 2] === plate.id && parts[parts.length - 3] === printId;
}

async function relocatePlates(
  print: PrintLike & { assetsPath?: string | null },
  plates: Plate[],
  safeTemplate: string,
  printValues: Awaited<ReturnType<typeof printTemplateValues>>,
  leaving?: ReadonlySet<string>,
): Promise<number> {
  let moved = 0;
  for (const plate of plates) {
    // A tool's plate reads the tool's file, which isn't the model's to move.
    if (plate.sourcePath) continue;
    const oldPath = managedPlatePath(plate);
    const rendered = renderFilePath(print, safeTemplate, printValues, plate.filename, plate.position, plate.folder);
    // Where it already is counts as free, so a plate moved aside by freePlatePath stays put. A target another plate of
    // the same rename is about to leave is waited for at a path of this plate's own, not the fallback, which an
    // unrelated file may hold.
    const newRelative =
      path.resolve(oldPath) === path.resolve(STORAGE, rendered)
        ? rendered
        : leaving?.has(path.resolve(STORAGE, rendered))
          ? path.join(path.dirname(rendered), print.id, plate.id, path.basename(rendered))
          : // One waiting aside keeps waiting there while its target is still taken.
            isWaitingAside(plate, print.id) && (await pathTaken(rendered, { plateId: plate.id }))
            ? plate.storagePath
            : await freePlatePath(rendered, print.id, { plateId: plate.id });
    const newPath = path.join(STORAGE, newRelative);
    if (path.resolve(oldPath) === path.resolve(newPath)) {
      if (plate.storagePath !== newRelative) {
        await prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } });
      }
      continue;
    }
    const didMove = await moveStored(
      async () => managedPlatePath((await prisma.plate.findUnique({ where: { id: plate.id } })) ?? plate),
      newPath,
      () => prisma.plate.update({ where: { id: plate.id }, data: { storagePath: newRelative } }),
    );
    if (didMove) moved += 1;
  }
  return moved;
}

/** Moves only these plates' files, as a rename does: their names are all it changed, so nothing else of the model
 *  moves, and nothing else has to be looked at before the names are recorded. */
export async function relocateRenamedPlates(
  print: PrintLike & { assetsPath?: string | null },
  plates: Plate[],
): Promise<number> {
  const safeTemplate = validateStorageTemplate(await getStorageTemplate());
  const printValues = await printTemplateValues(print, safeTemplate);
  const target = (plate: Plate) =>
    path.resolve(
      STORAGE,
      renderFilePath(print, safeTemplate, printValues, plate.filename, plate.position, plate.folder),
    );
  // The paths these plates are about to leave: in a swap, a plate waits aside for its partner's.
  const leaving = new Set(
    plates
      .filter((plate) => !plate.sourcePath && path.resolve(managedPlatePath(plate)) !== target(plate))
      .map((plate) => path.resolve(managedPlatePath(plate))),
  );
  let moved = await relocatePlates(print, plates, safeTemplate, printValues, leaving);
  // Once they've all moved, a second pass puts each plate that waited where its name says. A target an unrelated file
  // holds keeps the move aside, at the fallback.
  const ids = plates.map((plate) => plate.id);
  const settled = await prisma.plate.findMany({ where: { id: { in: ids } } });
  moved += await relocatePlates(print, settled, safeTemplate, printValues);
  // A swap a failed request left halfway has a plate still waiting aside, whose way this rename of its partner may have
  // freed. The rename looked at its file before recording any name, and a move of it that fails fails the rename.
  const others = await prisma.plate.findMany({ where: { printId: print.id, id: { notIn: ids } } });
  moved += await relocatePlates(
    print,
    others.filter((other) => isWaitingAside(other, print.id)),
    safeTemplate,
    printValues,
  );
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
  let moved = await relocatePlates(print, plates, safeTemplate, printValues);
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
      files: { select: { filename: true, folder: true, storagePath: true } },
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
    // A tool's plate reads the tool's file, which a move leaves where it is.
    let misplaced = print.plates.filter(
      (plate) =>
        !plate.sourcePath &&
        !inPlace(
          plate.storagePath,
          renderFilePath(print, safeTemplate, values, plate.filename, plate.position, plate.folder),
          print.id,
        ),
    ).length;
    misplaced += print.files.filter((file) => {
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

type ThumbTarget = { home: string; db: Prisma.TransactionClient; placed?: (dest: string) => void };

/** The plate's model's pictures folder as the transaction sees it now, else the one the caller read. */
async function currentThumbHome(target: ThumbTarget, plateId: string): Promise<string> {
  const plate = await target.db.plate.findUnique({
    where: { id: plateId },
    select: { print: { select: { assetsPath: true } } },
  });
  return plate?.print.assetsPath ?? target.home;
}

async function saveThumbBuffer(
  plateId: string,
  input: Buffer,
  keepExif = false,
  target?: ThumbTarget,
): Promise<boolean> {
  let tmp: string | null = null;
  let placed = false;
  try {
    const file = plateThumbFile(plateId);
    // Read again just before the write, so a folder move since the caller looked takes the thumbnail along.
    const home = target ? await currentThumbHome(target, plateId) : await ensurePlateAssetHome(plateId);
    const dest = assetTarget(home, file);
    tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await writePhotoJpeg(input, tmp, 512, 88, keepExif);
    await fs.rename(tmp, dest);
    placed = true;
    target?.placed?.(dest);
    // The one in the old shared folder is out of date now.
    await removeAsset(null, file);
    // Any thumb but our own render; the generated-thumbnail route marks those after saving.
    const db = target?.db ?? prisma;
    await db.plate.updateMany({ where: { id: plateId, thumbGenerated: true }, data: { thumbGenerated: false } });
    return true;
  } catch (error) {
    if (tmp) await fs.rm(tmp, { force: true });
    // A caller in a transaction hears of a failure after the file is in place, so its rollback can take the file back.
    if (placed && target) throw error;
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

export async function saveThumbFromBytes(
  plateId: string,
  data: Buffer,
  keepExif = false,
  target?: ThumbTarget,
): Promise<boolean> {
  return saveThumbBuffer(plateId, data, keepExif, target);
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
