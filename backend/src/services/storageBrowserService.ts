import path from "node:path";
import { prisma } from "../db";
import { STORAGE } from "../config";
import { fileState } from "../modelFiles/storageFs";
import { HttpError } from "../utils/fileUtils";
import { mapWithConcurrency } from "../utils/concurrency";
import { assetKindOf, listAssetFiles, type AssetKind } from "./modelAssets";

// Administration's look at the managed model files, laid out as the storage template put them. The plates and
// supporting files come from their saved paths rather than a walk of the disk, so it's quick and only shows the
// models' own files; only those in the folder being looked at are checked on disk, through the file door, so one the
// disk can't read shows as unreadable rather than missing. Each model's pictures folder is read from disk, as most of
// what's in it has no row; a folder there the disk can't list is shown as unreadable too, rather than left out.

export type StorageFolder = {
  name: string;
  path: string;
  label: string | null;
  files: number;
  bytes: number;
  /** A model's pictures folder. */
  pictures: boolean;
  /** The error's code (e.g. "EIO") when the disk couldn't list it, so what's in it may not all be shown. */
  error_code: string | null;
};
/** "unreadable": the disk couldn't say whether it's there (EIO, EACCES, ...), so it may still be. */
export type StorageFileLocation = "managed" | "source" | "missing" | "unreadable";
/** "plate" is a model file; "file" a supporting or prepared one; "license" the LICENSE.txt Thingport writes; the rest are
 *  pictures. */
export type StorageFileKind = "plate" | "file" | "license" | AssetKind;
export type StorageFile = {
  name: string;
  path: string;
  kind: StorageFileKind;
  plate_id: string | null;
  print_id: string;
  print_name: string;
  owner_id: string;
  size: number;
  /** "source": read where it was picked up from (a tool's file), never from its own path; "missing": not there. */
  location: StorageFileLocation;
  /** With "unreadable", the error's code, e.g. "EIO". */
  error_code: string | null;
};
export type StorageListing = {
  path: string;
  crumbs: { name: string; path: string; label: string | null }[];
  folders: StorageFolder[];
  files: StorageFile[];
};

type ModelRef = { id: string; name: string; userId: string };
type Located = { location: StorageFileLocation; code: string | null };
type Entry = {
  /** Relative to storage, with "/". */
  path: string;
  size: number;
  kind: StorageFileKind;
  plateId: string | null;
  print: ModelRef;
  /** Only asked of the files in the folder being looked at. */
  location: () => Promise<Located>;
};

const USER_FOLDER_RE = /^u-(.+)$/;
// Pictures folders are read a few at a time, so a big library doesn't open every one at once; so are the files of
// the folder being looked at.
const PICTURE_FOLDER_READS = 16;
const FILE_LOOKS = 16;
// Storage paths are written with the server's separator; the page always gets "/".
const toSlash = (p: string) => p.split(path.sep).join("/");
const toNative = (p: string) => p.split("/").join(path.sep);
const MODEL_SELECT = { select: { id: true, name: true, userId: true } } as const;
const errorCode = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code ?? "UNKNOWN";

function normalizeFolder(raw: string): string {
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new HttpError(400, "Invalid folder");
  return parts.join("/");
}

async function userLabels(folderNames: string[]): Promise<Map<string, string>> {
  const ids = folderNames.flatMap((name) => USER_FOLDER_RE.exec(name)?.[1] ?? []);
  if (!ids.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  return new Map(users.map((user) => [`u-${user.id}`, user.displayName]));
}

const byName = (a: { name: string; label?: string | null }, b: { name: string; label?: string | null }) =>
  (a.label ?? a.name).localeCompare(b.label ?? b.name, undefined, { numeric: true });

/** A row's file as the browser shows it: `there` when a file is at `abs`, "missing" when nothing or a folder is, and
 *  "unreadable", with the error's code, when the disk couldn't say. */
async function look(abs: string, there: "managed" | "source"): Promise<Located> {
  try {
    const { state } = await fileState(abs, "browser.location");
    return { location: state === "file" ? there : "missing", code: null };
  } catch (err) {
    return { location: "unreadable", code: errorCode(err) };
  }
}

// A plate with a sourcePath (a tool's) is read there only: nothing at its storagePath is its own.
const plateLocation = (storagePath: string, sourcePath: string | null) =>
  sourcePath ? look(sourcePath, "source") : look(path.join(STORAGE, storagePath), "managed");

/** Every file of the models below `folder`, or of the one whose pictures folder it's in, and each folder among their
 *  pictures the disk couldn't list, with the error's code. */
async function entriesUnder(
  folder: string,
): Promise<{ entries: Entry[]; pictureFolders: Set<string>; unreadableFolders: Map<string, string> }> {
  const below = folder ? { startsWith: toNative(folder) + path.sep } : undefined;
  const parts = folder ? folder.split("/") : [];
  // Inside a pictures folder, the model it belongs to is found by the folder or one above it.
  const enclosing = parts.map((_, index) => toNative(parts.slice(0, index + 1).join("/")));
  const [plates, files, homes] = await Promise.all([
    prisma.plate.findMany({
      where: below ? { storagePath: below } : undefined,
      select: { id: true, storagePath: true, sourcePath: true, size: true, print: MODEL_SELECT },
    }),
    prisma.printFile.findMany({
      where: below ? { storagePath: below } : undefined,
      select: { storagePath: true, size: true, role: true, print: MODEL_SELECT },
    }),
    prisma.print.findMany({
      where: below ? { OR: [{ assetsPath: below }, { assetsPath: { in: enclosing } }] } : { assetsPath: { not: null } },
      select: { id: true, name: true, userId: true, assetsPath: true },
    }),
  ]);

  const entries: Entry[] = [
    ...plates.map((plate) => ({
      path: toSlash(plate.storagePath),
      size: Number(plate.size),
      kind: "plate" as const,
      plateId: plate.id,
      print: plate.print,
      location: () => plateLocation(plate.storagePath, plate.sourcePath),
    })),
    ...files.map((file) => ({
      path: toSlash(file.storagePath),
      size: Number(file.size),
      kind: file.role === "LICENSE" ? ("license" as const) : ("file" as const),
      plateId: null,
      print: file.print,
      location: () => look(path.join(STORAGE, file.storagePath), "managed"),
    })),
  ];
  // Another model's files can be in a pictures folder, when a category puts them there; they're listed as its own.
  // The deepest folders go first, so a model's pictures folder inside another's keeps its pictures.
  const listed = new Set(entries.map((entry) => entry.path));
  const unreadableFolders = new Map<string, string>();
  const deepestFirst = homes.toSorted((a, b) => b.assetsPath!.length - a.assetsPath!.length);
  const pictures = await mapWithConcurrency(deepestFirst, PICTURE_FOLDER_READS, async (print) => {
    const home = toSlash(print.assetsPath!);
    const found = await listAssetFiles(print.assetsPath!);
    for (const unreadable of found.unreadable) {
      unreadableFolders.set(unreadable.path ? `${home}/${unreadable.path}` : home, unreadable.code);
    }
    return found.files.map((file) => ({
      path: `${home}/${file.path}`,
      size: file.size,
      kind: assetKindOf(file.path),
      plateId: null,
      print: { id: print.id, name: print.name, userId: print.userId },
      location: async (): Promise<Located> => ({ location: "managed", code: null }),
    }));
  });
  for (const picture of pictures.flat()) {
    if (listed.has(picture.path)) continue;
    listed.add(picture.path);
    entries.push(picture);
  }
  return { entries, pictureFolders: new Set(homes.map((print) => toSlash(print.assetsPath!))), unreadableFolders };
}

/** One folder: the folders in it, with how many files and bytes each holds below it, and its own files. */
export async function listStorageFolder(rawFolder: string): Promise<StorageListing> {
  const folder = normalizeFolder(rawFolder);
  const prefix = folder ? `${folder}/` : "";
  const { entries, pictureFolders, unreadableFolders } = await entriesUnder(folder);

  const folders = new Map<string, StorageFolder>();
  const summaryOf = (name: string): StorageFolder => {
    const entryPath = prefix + name;
    const summary = folders.get(name) ?? {
      name,
      path: entryPath,
      label: null,
      files: 0,
      bytes: 0,
      pictures: pictureFolders.has(entryPath),
      error_code: null,
    };
    folders.set(name, summary);
    return summary;
  };
  const here: Entry[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash === -1) {
      here.push(entry);
      continue;
    }
    const summary = summaryOf(relative.slice(0, slash));
    summary.files += 1;
    summary.bytes += entry.size;
  }
  // A folder the disk couldn't list carries its error, and the folders on the way down to it are listed however
  // little else is in them, so it isn't hidden at any level.
  for (const [unreadable, code] of unreadableFolders) {
    if (!unreadable.startsWith(prefix)) continue;
    const relative = unreadable.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash === -1) summaryOf(relative).error_code = code;
    else summaryOf(relative.slice(0, slash));
  }
  // The folder asked for is one the disk couldn't list: say that, not that it isn't there.
  const ownError = folder ? unreadableFolders.get(folder) : undefined;
  if (ownError && !folders.size && !here.length) {
    throw new HttpError(500, `The disk couldn't read this folder (${ownError})`, "folder_unreadable");
  }
  if (folder && !folders.size && !here.length) throw new HttpError(404, "No such folder");
  const files = await mapWithConcurrency(here, FILE_LOOKS, async (entry): Promise<StorageFile> => {
    const { location, code } = await entry.location();
    return {
      name: entry.path.slice(prefix.length),
      path: entry.path,
      kind: entry.kind,
      plate_id: entry.plateId,
      print_id: entry.print.id,
      print_name: entry.print.name,
      owner_id: entry.print.userId,
      size: entry.size,
      location,
      error_code: code,
    };
  });

  const parts = folder ? folder.split("/") : [];
  // Only the top level is per user, as u-<id>.
  const labels = await userLabels(folder ? parts.slice(0, 1) : [...folders.keys()]);
  if (!folder) for (const summary of folders.values()) summary.label = labels.get(summary.name) ?? null;
  return {
    path: folder,
    crumbs: parts.map((name, index) => ({
      name,
      path: parts.slice(0, index + 1).join("/"),
      label: index === 0 ? (labels.get(name) ?? null) : null,
    })),
    folders: [...folders.values()].toSorted(byName),
    files: files.toSorted(byName),
  };
}
