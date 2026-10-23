import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";
import { getFileReuse, type FileReuse } from "./settingsService";

// Saves a new file as a copy-on-write clone of, or a hard link to, a stored file with the same content, so the same
// model imported by several users takes its space once (see getFileReuse). Knows nothing of what the file belongs to:
// the caller finds the stored copies of its own kind of file by content and records the hash on the new one.

export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fsSync.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** What stored copies of a file are looked up by. */
export type FileContent = { contentSha256: string; size: number };

/** Absolute paths of stored files with this content, to share one of. Only files Thingport manages: one left where it
 *  was found may change under us. A few are enough; each is only tried if the one before it is gone. */
export type StoredCopyFinder = (content: FileContent) => Promise<string[]>;

// Errors a clone or link gives where the filesystem can't, or the stored copy is gone: store the file as usual.
const UNSHAREABLE_CODES = new Set(["ENOENT", "EXDEV", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "EPERM", "EMLINK", "ENOSYS"]);

/** Never over another file, as a plain store isn't either. False when none of them could be shared. */
async function placeSharedCopy(
  mode: Exclude<FileReuse, "off">,
  storedPaths: string[],
  destAbsPath: string,
): Promise<boolean> {
  for (const storedPath of storedPaths) {
    await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
    try {
      if (mode === "hardlink") await fs.link(storedPath, destAbsPath);
      // FORCE: without a clone it would copy the stored file, which saves nothing over the one we have.
      else
        await fs.copyFile(
          storedPath,
          destAbsPath,
          fsSync.constants.COPYFILE_EXCL | fsSync.constants.COPYFILE_FICLONE_FORCE,
        );
      return true;
    } catch (err: any) {
      if (err?.code === "EEXIST") throw new HttpError(409, "Another file was just saved at the same path; try again");
      if (!UNSHAREABLE_CODES.has(err?.code)) throw err;
      // EXCL made the destination ours, so a half-made one can go.
      await fs.rm(destAbsPath, { force: true }).catch(() => undefined);
      // A filesystem that can't share one stored file can't share the others either.
      if (err.code !== "ENOENT") return false;
    }
  }
  return false;
}

/** Puts a stored copy of `fromPath` at `destAbsPath` when the admin setting allows and one is found, leaving
 *  `fromPath` as it is. `contentSha256` is null when the setting is off (the file isn't read then); otherwise the
 *  caller records it on the new file, shared or not, so a later identical file finds this one. When `shared` is
 *  false the caller stores the file as usual. */
export async function shareStoredCopy(
  fromPath: string,
  destAbsPath: string,
  findStored: StoredCopyFinder,
): Promise<{ contentSha256: string | null; shared: boolean }> {
  const mode = await getFileReuse();
  if (mode === "off") return { contentSha256: null, shared: false };
  const [contentSha256, stat] = await Promise.all([sha256OfFile(fromPath), fs.stat(fromPath)]);
  const stored = await findStored({ contentSha256, size: stat.size });
  return { contentSha256, shared: await placeSharedCopy(mode, stored, destAbsPath) };
}
