import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";
import { getFileReuse } from "./settingsService";

// Saves a new file as a copy-on-write clone of a stored file with the same content, so the same model imported by
// several users takes its space once (see getFileReuse). The clone is a file of its own, so an edit made to either
// on disk never reaches the other. Knows nothing of what the file belongs to: the caller finds the stored copies of
// its own kind of file by content and records the hash on the new one.

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

// Plate.size is a Postgres Int, so a larger file can't be looked up by size (Prisma rejects the query).
const MAX_LOOKUP_SIZE = 2_147_483_647;

/** Only bookkeeping, so a failure is swallowed: a hash that can't be dropped now is checked against the file again the
 *  next time it's offered anyway. */
async function forget(copy: StoredCopy): Promise<void> {
  try {
    await copy.changed();
  } catch {
    // See above.
  }
}

// Every file the storage folder holds is opened this way before it's used here, as anything may have been put in its
// place outside Thingport: NOFOLLOW so a link (to another user's file, or anywhere else) is never followed, and
// NONBLOCK so a FIFO or device returns at once rather than blocking a libuv thread for good. The handle is then
// fstat'ed, and only a regular file used.
const OPEN_FLAGS = fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW | fsSync.constants.O_NONBLOCK;

/** Null when what's at `filePath` isn't a regular file; open errors are thrown. The caller closes the handle. */
async function openRegularFile(filePath: string): Promise<{ handle: fs.FileHandle; stat: fsSync.Stats } | null> {
  const handle = await fs.open(filePath, OPEN_FLAGS);
  try {
    const stat = await handle.stat();
    if (stat.isFile()) return { handle, stat };
  } catch (err) {
    await handle.close();
    throw err;
  }
  await handle.close();
  return null;
}

/** sha256OfFile for a file we just wrote, which may have been swapped since for something else (see OPEN_FLAGS). */
async function sha256OfRegularFile(filePath: string): Promise<string> {
  const opened = await openRegularFile(filePath);
  if (!opened) throw new Error(`Not a regular file: ${filePath}`);
  try {
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(1 << 16);
    for (;;) {
      const { bytesRead } = await opened.handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) return hash.digest("hex");
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await opened.handle.close();
  }
}

/** Removes a clone we made and aren't keeping. A failure is thrown as it is: left there, the plain store would refuse
 *  to write over it, or worse store beside a file that isn't it, and it's no conflict with anyone else's file. */
async function discardClone(destAbsPath: string): Promise<void> {
  // Ours to remove: the EXCL clone made it, so nothing else could have saved there.
  await fs.rm(destAbsPath, { force: true });
}

type CloneOutcome = "kept" | "next" | "stop";

/** Tries one stored copy. "next" moves on to the next one, "stop" stores the file as usual. */
async function cloneFrom(
  copy: StoredCopy,
  content: FileContent,
  mode: number,
  destAbsPath: string,
): Promise<CloneOutcome> {
  let opened;
  try {
    opened = await openRegularFile(copy.path);
  } catch (err: any) {
    // Only a file that's gone is known to be stale. ELOOP (a link) or anything else may be passing, or not ours to
    // judge, so it's just not used now.
    if (err?.code === "ENOENT") await forget(copy);
    return "next";
  }
  if (!opened) return "next";
  const { handle, stat } = opened;
  try {
    // Cheap first: a different size means it was edited, without reading it.
    if (stat.size !== content.size) {
      await forget(copy);
      return "next";
    }
    try {
      await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
    } catch {
      // Not a conflict, even as EEXIST (a file where the folder should be): the plain store runs into the same thing
      // and reports what's really wrong.
      return "stop";
    }
    try {
      // From the handle checked above, not the path, which may be something else by now. /proc/self/fd reopens that
      // very file; where it doesn't exist (macOS, on a dev machine) this fails like any other clone that can't be
      // made, and the file is stored as usual. FORCE: without a clone it would copy the stored file, which saves
      // nothing over the one we have. EXCL: never over a file already there.
      await fs.copyFile(
        `/proc/self/fd/${handle.fd}`,
        destAbsPath,
        fsSync.constants.COPYFILE_EXCL | fsSync.constants.COPYFILE_FICLONE_FORCE,
      );
    } catch (err: any) {
      if (err?.code === "EEXIST") throw conflict();
      // ENOENT may as well be the destination's side -- its folder pruned just now -- so the stored copy is only
      // forgotten when it was really deleted. The open handle still tells, whatever is at its path now.
      if (err?.code === "ENOENT") {
        const now = await handle.stat().catch(() => null);
        if (now?.nlink === 0) await forget(copy);
      }
      // Sharing only saves space, so anything else -- a filesystem without clones, a stored copy that can't be read
      // -- means this one isn't shared, and the file is stored as usual if none is. Nothing to clean up: a failed
      // clone removes the destination it created itself.
      return "next";
    }
  } finally {
    await handle.close();
  }
  // What landed is checked, not the hash on record: the stored file may have been edited, even while it was being
  // cloned. Kept only when it's byte for byte the file being imported.
  let sha;
  try {
    sha = await sha256OfRegularFile(destAbsPath);
  } catch {
    // Couldn't tell, which says nothing about the stored copy: not kept, but not forgotten either.
    await discardClone(destAbsPath);
    return "next";
  }
  if (sha !== content.contentSha256) {
    await discardClone(destAbsPath);
    await forget(copy);
    return "next";
  }
  try {
    // A clone takes the stored file's permissions (libuv copies them over); a plain store gives it those of the
    // incoming file, so the clone is made to match.
    await fs.chmod(destAbsPath, mode);
  } catch {
    await discardClone(destAbsPath);
    return "stop";
  }
  return "kept";
}

/** Never over another file, as a plain store isn't either. False when none of them could be shared. */
async function placeClone(
  content: FileContent,
  mode: number,
  stored: StoredCopy[],
  destAbsPath: string,
): Promise<boolean> {
  for (const copy of stored) {
    const outcome = await cloneFrom(copy, content, mode, destAbsPath);
    if (outcome === "kept") return true;
    if (outcome === "stop") return false;
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
  if ((await getFileReuse()) !== "reflink") return { contentSha256: null, shared: false };
  const [contentSha256, stat] = await Promise.all([sha256OfFile(fromPath), fs.stat(fromPath)]);
  // Still hashed, so the record is the same whatever the size: an empty file saves nothing by sharing, and one past
  // MAX_LOOKUP_SIZE can't be looked up.
  if (stat.size === 0 || stat.size > MAX_LOOKUP_SIZE) return { contentSha256, shared: false };
  const content = { contentSha256, size: stat.size };
  // A failed lookup only means nothing to share: the file is stored as usual, its hash still recorded.
  const stored = await findStored(content).catch(() => []);
  return { contentSha256, shared: await placeClone(content, stat.mode & 0o7777, stored, destAbsPath) };
}
