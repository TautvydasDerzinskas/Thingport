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

/** A stored file the caller has on record with this content. Only files Thingport manages: one left where it was found
 *  isn't ours to share. Its hash on record may be out of date -- the storage folder can be mounted and its files
 *  edited outside Thingport -- so `changed` is called when it no longer matches, for the caller to drop that hash. */
export type StoredCopy = { path: string; changed: () => Promise<void> };

/** A few stored copies with this content are enough; each is only tried if the ones before it couldn't be shared. */
export type StoredCopyFinder = (content: FileContent) => Promise<StoredCopy[]>;

const conflict = () => new HttpError(409, "Another file was just saved at the same path; try again");

/** Never over another file, as a plain store isn't either. False when none of them could be shared. */
async function placeSharedCopy(
  mode: Exclude<FileReuse, "off">,
  content: FileContent,
  stored: StoredCopy[],
  destAbsPath: string,
): Promise<boolean> {
  for (const copy of stored) {
    try {
      // Cheap first: a different size means it was edited, without reading it.
      if ((await fs.stat(copy.path)).size !== content.size) {
        await copy.changed();
        continue;
      }
      await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
      if (mode === "hardlink") await fs.link(copy.path, destAbsPath);
      // FORCE: without a clone it would copy the stored file, which saves nothing over the one we have.
      else
        await fs.copyFile(
          copy.path,
          destAbsPath,
          fsSync.constants.COPYFILE_EXCL | fsSync.constants.COPYFILE_FICLONE_FORCE,
        );
    } catch (err: any) {
      if (err?.code === "EEXIST") throw conflict();
      // Sharing only saves space, so anything else -- a filesystem without clones or hard links, a stored copy that's
      // gone or can't be read -- means this one isn't shared, and the file is stored as usual if none is. Nothing to
      // clean up: a failed link creates nothing, and a failed clone removes the destination it created itself.
      continue;
    }
    // What landed is checked, not the hash on record: the stored file may have been edited, even just now.
    const same = await sha256OfFile(destAbsPath).then(
      (sha) => sha === content.contentSha256,
      () => false,
    );
    if (same) return true;
    // Ours to remove: the link or EXCL clone above made it, so nothing else could have saved there.
    await fs.rm(destAbsPath, { force: true });
    await copy.changed();
  }
  return false;
}

/** Puts a stored copy of `fromPath` at `destAbsPath` when the admin setting allows and one with the same content is
 *  found, leaving `fromPath` as it is. `contentSha256` is null when the setting is off (the file isn't read then);
 *  otherwise the caller records it on the new file, shared or not, so a later identical file finds this one. When
 *  `shared` is false the caller stores the file as usual. */
export async function shareStoredCopy(
  fromPath: string,
  destAbsPath: string,
  findStored: StoredCopyFinder,
): Promise<{ contentSha256: string | null; shared: boolean }> {
  const mode = await getFileReuse();
  if (mode === "off") return { contentSha256: null, shared: false };
  const [contentSha256, stat] = await Promise.all([sha256OfFile(fromPath), fs.stat(fromPath)]);
  const content = { contentSha256, size: stat.size };
  return { contentSha256, shared: await placeSharedCopy(mode, content, await findStored(content), destAbsPath) };
}
