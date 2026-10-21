import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE } from "../config";
import { HttpError } from "../utils/fileUtils";
import { mapWithConcurrency } from "../utils/concurrency";
import { assetKindOf, listAssetFiles, type AssetKind } from "./modelAssets";

// Administration's look at the managed model files, laid out as the storage template put them. The plates and
// supporting files come from their saved paths rather than a walk of the disk, so it's quick and only shows the
// models' own files; only those in the folder being looked at are checked on disk. Each model's pictures folder
// is read from disk, as most of what's in it has no row.

export type StorageFolder = {
  name: string;
  path: string;
  label: string | null;
  files: number;
  bytes: number;
  /** A model's pictures folder. */
  pictures: boolean;
};
export type StorageFileLocation = "managed" | "source" | "missing";
/** "plate" is a model file; "file" a supporting or prepared one; the rest are pictures. */
export type StorageFileKind = "plate" | "file" | AssetKind;
export type StorageFile = {
  name: string;
  path: string;
  kind: StorageFileKind;
  plate_id: string | null;
  print_id: string;
  print_name: string;
  owner_id: string;
  size: number;
  /** "source": kept where it was picked up from (an in-place consume folder); "missing": in neither place. */
  location: StorageFileLocation;
};
export type StorageListing = {
  path: string;
  crumbs: { name: string; path: string; label: string | null }[];
  folders: StorageFolder[];
  files: StorageFile[];
};

type ModelRef = { id: string; name: string; userId: string };
type Entry = {
  /** Relative to storage, with "/". */
  path: string;
  size: number;
  kind: StorageFileKind;
  plateId: string | null;
  print: ModelRef;
  /** Only asked of the files in the folder being looked at. */
  location: () => StorageFileLocation;
};

const USER_FOLDER_RE = /^u-(.+)$/;
// Pictures folders are read a few at a time, so a big library doesn't open every one at once.
const PICTURE_FOLDER_READS = 16;
// Storage paths are written with the server's separator; the page always gets "/".
const toSlash = (p: string) => p.split(path.sep).join("/");
const toNative = (p: string) => p.split("/").join(path.sep);
const exists = (relative: string) => fsSync.existsSync(path.join(STORAGE, relative));
const MODEL_SELECT = { select: { id: true, name: true, userId: true } } as const;

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

function plateLocation(storagePath: string, sourcePath: string | null): StorageFileLocation {
  if (exists(storagePath)) return "managed";
  if (sourcePath && fsSync.existsSync(sourcePath)) return "source";
  return "missing";
}

/** Every file of the models below `folder`, or of the one whose pictures folder it's in. */
async function entriesUnder(folder: string): Promise<{ entries: Entry[]; pictureFolders: Set<string> }> {
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
      select: { storagePath: true, size: true, print: MODEL_SELECT },
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
      kind: "file" as const,
      plateId: null,
      print: file.print,
      location: (): StorageFileLocation => (exists(file.storagePath) ? "managed" : "missing"),
    })),
  ];
  // Another model's files can be in a pictures folder, when a category puts them there; they're listed as its own.
  // The deepest folders go first, so a model's pictures folder inside another's keeps its pictures.
  const listed = new Set(entries.map((entry) => entry.path));
  const deepestFirst = homes.toSorted((a, b) => b.assetsPath!.length - a.assetsPath!.length);
  const pictures = await mapWithConcurrency(deepestFirst, PICTURE_FOLDER_READS, async (print) => {
    const home = toSlash(print.assetsPath!);
    return (await listAssetFiles(print.assetsPath!)).map((file) => ({
      path: `${home}/${file.path}`,
      size: file.size,
      kind: assetKindOf(file.path),
      plateId: null,
      print: { id: print.id, name: print.name, userId: print.userId },
      location: (): StorageFileLocation => "managed",
    }));
  });
  for (const picture of pictures.flat()) {
    if (listed.has(picture.path)) continue;
    listed.add(picture.path);
    entries.push(picture);
  }
  return { entries, pictureFolders: new Set(homes.map((print) => toSlash(print.assetsPath!))) };
}

/** One folder: the folders in it, with how many files and bytes each holds below it, and its own files. */
export async function listStorageFolder(rawFolder: string): Promise<StorageListing> {
  const folder = normalizeFolder(rawFolder);
  const prefix = folder ? `${folder}/` : "";
  const { entries, pictureFolders } = await entriesUnder(folder);

  const folders = new Map<string, StorageFolder>();
  const files: StorageFile[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash === -1) {
      files.push({
        name: relative,
        path: entry.path,
        kind: entry.kind,
        plate_id: entry.plateId,
        print_id: entry.print.id,
        print_name: entry.print.name,
        owner_id: entry.print.userId,
        size: entry.size,
        location: entry.location(),
      });
      continue;
    }
    const name = relative.slice(0, slash);
    const entryPath = prefix + name;
    const summary = folders.get(name) ?? {
      name,
      path: entryPath,
      label: null,
      files: 0,
      bytes: 0,
      pictures: pictureFolders.has(entryPath),
    };
    summary.files += 1;
    summary.bytes += entry.size;
    folders.set(name, summary);
  }
  if (folder && !folders.size && !files.length) throw new HttpError(404, "No such folder");

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
