import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE } from "../config";
import { HttpError } from "../utils/fileUtils";

// Administration's look at the managed model files, laid out as the storage template put them. Built from
// the plates' saved paths rather than a walk of the disk, so it's quick and only shows model files; only the
// files in the folder being looked at are checked on disk.

export type StorageFolder = { name: string; path: string; label: string | null; files: number; bytes: number };
export type StorageFileLocation = "managed" | "source" | "missing";
export type StorageFile = {
  name: string;
  path: string;
  plate_id: string;
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

const USER_FOLDER_RE = /^u-(.+)$/;
// Storage paths are written with the server's separator; the page always gets "/".
const toSlash = (p: string) => p.split(path.sep).join("/");

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

function fileLocation(storagePath: string, sourcePath: string | null): StorageFileLocation {
  if (fsSync.existsSync(path.join(STORAGE, storagePath))) return "managed";
  if (sourcePath && fsSync.existsSync(sourcePath)) return "source";
  return "missing";
}

/** One folder: the folders in it, with how many files and bytes each holds below it, and its own files. */
export async function listStorageFolder(rawFolder: string): Promise<StorageListing> {
  const folder = normalizeFolder(rawFolder);
  const prefix = folder ? `${folder}/` : "";
  const plates = await prisma.plate.findMany({
    where: folder ? { storagePath: { startsWith: folder.split("/").join(path.sep) + path.sep } } : undefined,
    select: {
      id: true,
      storagePath: true,
      sourcePath: true,
      filename: true,
      size: true,
      print: { select: { id: true, name: true, userId: true } },
    },
  });

  const folders = new Map<string, StorageFolder>();
  const files: StorageFile[] = [];
  for (const plate of plates) {
    const relative = toSlash(plate.storagePath).slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash === -1) {
      files.push({
        name: relative,
        path: prefix + relative,
        plate_id: plate.id,
        print_id: plate.print.id,
        print_name: plate.print.name,
        owner_id: plate.print.userId,
        size: Number(plate.size),
        location: fileLocation(plate.storagePath, plate.sourcePath),
      });
      continue;
    }
    const name = relative.slice(0, slash);
    const entry = folders.get(name) ?? { name, path: prefix + name, label: null, files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += Number(plate.size);
    folders.set(name, entry);
  }
  if (folder && !folders.size && !files.length) throw new HttpError(404, "No such folder");

  const parts = folder ? folder.split("/") : [];
  // Only the top level is per user, as u-<id>.
  const labels = await userLabels(folder ? parts.slice(0, 1) : [...folders.keys()]);
  if (!folder) for (const entry of folders.values()) entry.label = labels.get(entry.name) ?? null;
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
