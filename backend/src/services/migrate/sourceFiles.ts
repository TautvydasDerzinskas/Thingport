import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE } from "../../config";
import { MigrateError } from "./errors";

/** Where the old instance's files are read from, by the paths its database gives them, relative to its storage. */
export interface SourceFiles {
  /** Whether the file is there. */
  exists(relative: string): Promise<boolean>;
  /** Copies the file to `to`, an absolute path here; false when it isn't there. */
  copy(relative: string, to: string): Promise<boolean>;
  /** Copies every file under the folder to `to`, keeping their places; how many it copied. */
  copyFolder(relative: string, to: string): Promise<number>;
}

/** The old instance's storage folder, as this server sees it: mounted or copied here by the admin. */
export async function folderSource(given: string): Promise<SourceFiles> {
  const root = await checkFolder(given);

  /** The file's real place, if it's a plain file inside the folder: its paths come from the old database, and a link
   *  in the folder could lead anywhere this server can read. */
  const resolve = async (relative: string): Promise<string | null> => {
    if (!relative || path.isAbsolute(relative)) return null;
    const joined = path.resolve(root, relative);
    if (!joined.startsWith(root + path.sep)) return null;
    try {
      const real = await fs.realpath(joined);
      if (!real.startsWith(root + path.sep)) return null;
      return (await fs.stat(real)).isFile() ? real : null;
    } catch {
      return null;
    }
  };

  const copyTo = async (from: string, to: string) => {
    await fs.mkdir(path.dirname(to), { recursive: true });
    // A clone where the disk can make one, else a copy.
    await fs.copyFile(from, to, fsSync.constants.COPYFILE_FICLONE);
  };

  return {
    exists: async (relative) => (await resolve(relative)) !== null,
    copy: async (relative, to) => {
      const from = await resolve(relative);
      if (!from) return false;
      await copyTo(from, to);
      return true;
    },
    copyFolder: async (relative, to) => {
      const start = path.resolve(root, relative);
      if (!start.startsWith(root + path.sep)) return 0;
      let copied = 0;
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const inner = path.relative(root, path.join(dir, entry.name));
          if (entry.isDirectory()) await walk(path.join(dir, entry.name));
          else if (entry.isFile() || entry.isSymbolicLink()) {
            const from = await resolve(inner);
            if (!from) continue;
            await copyTo(from, path.join(to, path.relative(start, path.join(dir, entry.name))));
            copied += 1;
          }
        }
      };
      await walk(start);
      return copied;
    },
  };
}

/** The one folder on this server a migration reads from: the old instance's storage folder and, when it isn't
 *  uploaded, its dump are in it. As with the consume folder, an admin mounts it rather than naming any path, so a
 *  migration can't be pointed at anything else this server can read. */
export function migrateRoot(): string {
  return path.resolve(process.env.MIGRATE_DIR || "/app/migrate");
}

/** `given` as a real path inside the migrate folder, or why it isn't one. */
async function insideRoot(given: string): Promise<string> {
  const trimmed = given.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    throw new MigrateError("folder_relative", "Give the folder's full path on this server, starting with /.");
  }
  const root = migrateRoot();
  const outside = new MigrateError(
    "outside",
    `Give a path inside ${root}: the old instance's files are read only from there.`,
    { root },
  );
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) throw outside;
  let real: string;
  try {
    real = await fs.realpath(trimmed);
  } catch {
    // Missing, or it doesn't stay inside: told apart only for paths that would have been inside.
    if (path.resolve(trimmed).startsWith(root + path.sep)) {
      throw new MigrateError("folder_missing", `There's no folder at ${trimmed} on this server.`, { folder: trimmed });
    }
    throw outside;
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw outside;
  return real;
}

/** The dump the admin named, when it's on the server rather than uploaded. */
export async function checkDumpFile(given: string): Promise<string> {
  const real = await insideRoot(given).catch((err) => {
    if (err instanceof MigrateError && err.code === "folder_missing") {
      throw new MigrateError("dump_missing", `There's no file at ${given.trim()} on this server.`);
    }
    throw err;
  });
  if (!(await fs.stat(real)).isFile()) {
    throw new MigrateError("dump_missing", `There's no file at ${given.trim()} on this server.`);
  }
  return real;
}

/** The folder the admin gave, as an absolute real path, or why it can't be read from. */
export async function checkFolder(given: string): Promise<string> {
  const trimmed = given.trim();
  const real = await insideRoot(trimmed);
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) {
    throw new MigrateError("folder_missing", `There's no folder at ${trimmed} on this server.`, { folder: trimmed });
  }
  const storage = await fs.realpath(STORAGE).catch(() => path.resolve(STORAGE));
  // This instance's storage, or a folder holding it ("/" included).
  if (real === storage || storage.startsWith(real.endsWith(path.sep) ? real : real + path.sep)) {
    throw new MigrateError(
      "folder_is_storage",
      "That's this instance's own storage. Give the old instance's storage folder.",
      { folder: trimmed },
    );
  }
  try {
    await fs.access(real, fsSync.constants.R_OK | fsSync.constants.X_OK);
  } catch {
    throw new MigrateError("folder_unreadable", `This server can't read ${trimmed}.`, { folder: trimmed });
  }
  return real;
}
