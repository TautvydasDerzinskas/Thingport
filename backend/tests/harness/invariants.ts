import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { ASSET_SUBFOLDERS } from "../../src/services/modelAssets";

// What a whole library looks like, for the users in scope: every row's file is there at its size, every file under
// their folders is a row's or one of their models' pictures, and the rows agree with each other. Read with node:fs
// itself, never the file door, so a test's faults and pauses never reach it; and which picture is whose is worked out
// here rather than by modelAssets' ownedAssetFiles, so a bug there isn't also in what judges it.

/** Whose library: tests share one database and one storage folder, so only these users' rows and folders are read. */
export type Scope = { userIds: readonly string[] };

export type Rule =
  /** A plate's or file's row whose file isn't there. */
  | "file-missing"
  /** Something other than a regular file at a row's path. */
  | "not-a-file"
  /** A file that isn't the size its row says. */
  | "size"
  /** A file's row left at the placeholder a save starts from (printFileService.ts). */
  | "pending"
  /** Two of the rows' paths -- plates', files', pictures folders -- that are one. */
  | "shared-path"
  /** A file under a user's folder that no row has, and that isn't a picture of the model whose folder it's in. */
  | "unowned"
  /** Two plates of a model with one name in one folder, ignoring case, as availablePlateFilename numbers them. */
  | "plate-name"
  /** A model's plates not numbered 0 to n-1. */
  | "positions"
  /** A prepared slot naming a row that isn't the model's own prepared print. */
  | "prepared-slot"
  /** A tool's plate whose file is gone or not its size, or with anything at the path reserved for it. */
  | "tool-plate";

export type Violation = { rule: Rule; path?: string; printId?: string; id?: string; detail?: string };

const PENDING = "pending";
const PICTURE_FOLDERS = [...new Set(Object.values(ASSET_SUBFOLDERS))];

/** What `look` finds at `abs`, or null when nothing is there. */
async function statOrNull(abs: string, look: (abs: string) => Promise<Stats> = fs.stat): Promise<Stats | null> {
  try {
    return await look(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

/** Every entry below `dir` that isn't a folder, by absolute path. */
async function filesBelow(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const found: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesBelow(abs)));
    else found.push(abs);
  }
  return found;
}

/** Every rule the library of `scope` breaks, one violation each time; empty when it's whole. Read-only. */
export async function checkLibraryInvariants({ userIds }: Scope): Promise<Violation[]> {
  const prints = await prisma.print.findMany({
    where: { userId: { in: [...userIds] } },
    include: {
      plates: { orderBy: { position: "asc" } },
      files: { orderBy: { id: "asc" } },
      previewImages: { select: { id: true } },
      descriptionImages: { select: { id: true } },
    },
    orderBy: { id: "asc" },
  });
  const found: Violation[] = [];
  const at = (relative: string) => path.resolve(STORAGE, relative);
  /** Each path a row claims, and whose it is. */
  const claimed = new Map<string, string>();
  /** Each pictures folder, and the ids a file in it may be named by. */
  const pictureOwners = new Map<string, Set<string>>();

  const claim = (abs: string, whose: string, printId: string) => {
    const before = claimed.get(abs);
    if (before) found.push({ rule: "shared-path", path: abs, printId, detail: `${before} and ${whose}` });
    else claimed.set(abs, whose);
  };
  const isRowsFile = async (abs: string, size: number, printId: string, id: string) => {
    const stat = await statOrNull(abs);
    if (!stat) found.push({ rule: "file-missing", path: abs, printId, id });
    else if (!stat.isFile()) found.push({ rule: "not-a-file", path: abs, printId, id });
    else if (stat.size !== size) {
      found.push({ rule: "size", path: abs, printId, id, detail: `${stat.size} bytes, the row says ${size}` });
    }
  };

  for (const print of prints) {
    if (print.assetsPath) claim(at(print.assetsPath), `print ${print.id}'s pictures`, print.id);
    for (const plate of print.plates) {
      const own = at(plate.storagePath);
      claim(own, `plate ${plate.id}`, print.id);
      if (!plate.sourcePath) {
        await isRowsFile(own, plate.size, print.id, plate.id);
        continue;
      }
      // A tool's plate reads the tool's file, one for every user's copy, and the path rendered for it holds nothing.
      const source = await statOrNull(plate.sourcePath);
      if (!source?.isFile() || source.size !== plate.size) {
        const detail = source?.isFile() ? `${source.size} bytes, the row says ${plate.size}` : "its file is gone";
        found.push({ rule: "tool-plate", path: plate.sourcePath, printId: print.id, id: plate.id, detail });
      }
      if (await statOrNull(own, fs.lstat)) {
        found.push({
          rule: "tool-plate",
          path: own,
          printId: print.id,
          id: plate.id,
          detail: "something is at its path",
        });
      }
    }
    for (const file of print.files) {
      if (file.storagePath === PENDING) {
        found.push({ rule: "pending", printId: print.id, id: file.id });
        continue;
      }
      claim(at(file.storagePath), `file ${file.id}`, print.id);
      await isRowsFile(at(file.storagePath), file.size, print.id, file.id);
    }

    const names = new Map<string, string>();
    for (const plate of print.plates) {
      const key = `${plate.folder ?? ""}\n${plate.filename.toLowerCase()}`;
      const before = names.get(key);
      if (before) {
        found.push({ rule: "plate-name", printId: print.id, id: plate.id, detail: `${before} and ${plate.filename}` });
      } else names.set(key, plate.filename);
    }
    const positions = print.plates.map((plate) => plate.position);
    if (positions.some((position, index) => position !== index)) {
      found.push({ rule: "positions", printId: print.id, detail: positions.join(", ") });
    }
    if (
      print.preparedFileId &&
      !print.files.some((file) => file.id === print.preparedFileId && file.role === "PREPARED")
    ) {
      found.push({ rule: "prepared-slot", printId: print.id, id: print.preparedFileId });
    }

    if (print.assetsPath) {
      // A picture is named by the plate or image it's of, then a dot: "<id>.jpg", "<id>.render.v4.png".
      const ids = [...print.plates, ...print.previewImages, ...print.descriptionImages].map((row) => row.id);
      for (const folder of PICTURE_FOLDERS) {
        const abs = path.join(at(print.assetsPath), folder);
        pictureOwners.set(abs, new Set([...(pictureOwners.get(abs) ?? []), ...ids]));
      }
    }
  }

  for (const userId of userIds) {
    for (const abs of await filesBelow(path.join(STORAGE, `u-${userId}`))) {
      if (claimed.has(abs)) continue;
      if (pictureOwners.get(path.dirname(abs))?.has(path.basename(abs).split(".")[0])) continue;
      found.push({ rule: "unowned", path: abs });
    }
  }
  return found;
}
