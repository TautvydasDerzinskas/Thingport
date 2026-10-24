import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { getFileReuse } from "./settingsService";

// Saves a new file as a copy-on-write clone of a stored file with the same content, so the same model imported by
// several users takes its space once (see getFileReuse). The clone is a file of its own, so an edit made to either
// on disk never reaches the other. Knows nothing of what the file belongs to: the caller finds the stored copies of
// its own kind of file by content (services/storedContent.ts, across kinds) and records the hash on the new one.

export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fsSync.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** What a row records of a file that was made to share its bytes, as the backfill does (see fileReuseBackfill's
 *  alreadyShared): the file's inode and ctime. A run that finds both unchanged leaves the file alone. */
export type ReuseMarker = { reuseIno?: bigint; reuseCtimeNs?: bigint };

const MAX_REUSE_MARKER = (1n << 63n) - 1n;
const MIN_REUSE_MARKER = -(1n << 63n);

/** Records only a stable, verified final file. An external writer may have edited or replaced the clone
 *  since sharing checked it, so a path's current inode/ctime alone must not bless its bytes as shared. */
export async function reuseMarker(
  filePath: string,
  shared: boolean,
  contentSha256: string | null,
): Promise<ReuseMarker> {
  if (!shared || !contentSha256) return {};
  try {
    const opened = await openRegularFile(filePath, true);
    if (!opened) return {};
    try {
      const hash = await sha256OfHandle(opened.handle);
      const after = await opened.handle.stat({ bigint: true });
      const before = opened.stat;
      // Filesystem stats can exceed PostgreSQL's signed BIGINT; optional bookkeeping must not fail an import.
      if (
        after.ino < MIN_REUSE_MARKER ||
        after.ino > MAX_REUSE_MARKER ||
        after.ctimeNs < MIN_REUSE_MARKER ||
        after.ctimeNs > MAX_REUSE_MARKER
      )
        return {};
      if (
        hash !== contentSha256 ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      )
        return {};
      return { reuseIno: after.ino, reuseCtimeNs: after.ctimeNs };
    } finally {
      await opened.handle.close();
    }
  } catch {
    // Only bookkeeping: without it the next run looks at the file once more.
    return {};
  }
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

// Below a filesystem block (4 KiB) a clone saves nothing -- the file takes one block either way -- and tiny files
// (an empty one, a thumbnail-sized icon) are far likelier to match by chance than by being the same model. They're
// still hashed and recorded, so the record is the same whatever the size, just never shared.
export const MIN_SHARE_BYTES = 4096;

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
export const OPEN_FLAGS = fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW | fsSync.constants.O_NONBLOCK;

/** Null when what's at `filePath` isn't a regular file; open errors are thrown. The caller closes the handle. `bigint`
 *  gives 64-bit stats, so inode numbers and nanosecond times are exact. */
export async function openRegularFile(filePath: string): Promise<{ handle: fs.FileHandle; stat: fsSync.Stats } | null>;
export async function openRegularFile(
  filePath: string,
  bigint: true,
): Promise<{ handle: fs.FileHandle; stat: fsSync.BigIntStats } | null>;
export async function openRegularFile(
  filePath: string,
  bigint?: true,
): Promise<{ handle: fs.FileHandle; stat: any } | null> {
  const handle = await fs.open(filePath, OPEN_FLAGS);
  try {
    const stat = await handle.stat({ bigint } as { bigint: true });
    if (stat.isFile()) return { handle, stat };
  } catch (err) {
    await handle.close();
    throw err;
  }
  await handle.close();
  return null;
}

/** Clones the file an open handle holds to `dest`, never over a file there. From the handle, not a path, which may be
 *  something else by now: /proc/self/fd reopens that very file (where it doesn't exist, macOS on a dev machine, this
 *  fails like any other clone that can't be made). FORCE: without a clone it would copy the file, which saves nothing. */
export const cloneFromHandle = (handle: fs.FileHandle, dest: string): Promise<void> =>
  fs.copyFile(
    `/proc/self/fd/${handle.fd}`,
    dest,
    fsSync.constants.COPYFILE_EXCL | fsSync.constants.COPYFILE_FICLONE_FORCE,
  );

/** Hashes what the open handle holds from its start, whatever the path it was opened at is now. */
export async function sha256OfHandle(handle: fs.FileHandle): Promise<string> {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1 << 16);
  // Positional, from 0: the handle's own position may have been moved by an earlier read.
  for (let position = 0; ;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) return hash.digest("hex");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
}

/** sha256OfFile for a file we just wrote, which may have been swapped since for something else (see OPEN_FLAGS). */
async function sha256OfRegularFile(filePath: string): Promise<string> {
  const opened = await openRegularFile(filePath);
  if (!opened) throw new Error(`Not a regular file: ${filePath}`);
  try {
    return await sha256OfHandle(opened.handle);
  } finally {
    await opened.handle.close();
  }
}

/** Removes a clone we made and aren't keeping; a failure is thrown, as a leftover would block the plain store. */
async function discardClone(destAbsPath: string): Promise<void> {
  // Ours to remove: the EXCL clone made it, so nothing else could have saved there.
  await fs.rm(destAbsPath, { force: true });
}

type CloneOutcome = "kept" | "next" | "stop";

/** Tries one stored copy. "next" moves on to the next one, "stop" stores the file as usual. */
async function cloneFrom(
  copy: StoredCopy,
  content: FileContent,
  mode: number | undefined,
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
      // Placed under the storage lock, so the file reuse backfill's swap (which renames over a path it has just
      // checked) never lands after a file saved at a path its row just freed.
      await withStorageLock(() => cloneFromHandle(handle, destAbsPath));
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
  // No mode when the caller has no file whose permissions the new one should take (bytes in memory, which a plain store
  // writes with the default ones): the clone keeps the stored file's.
  if (mode === undefined) return "kept";
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

/** Puts a copy of one stored file whose location is already known -- not found by content -- at `destAbsPath`: the entry
 *  point for copying a model's files from another user's instead of downloading them again. The source is opened
 *  safely (never through a link, regular files only) and copied from that handle: cloned when the switch (getFileReuse)
 *  is "reflink" and the filesystem can, else copied plain, never over a file. What landed is read back and kept only if
 *  it's byte for byte `content`. `content` must be the hash and size taken from the same source file: a size from a DB
 *  column that may be 0 or null would make a good source look changed. Returns how it was made, or null when the source
 *  couldn't be used (gone, not a regular file, a different size or content than `content`), leaving nothing at
 *  `destAbsPath`; a 409 when something is already there. A caller that keeps a "cloned" result records it like the
 *  other store paths do, with reuseMarker of the final file. `source.changed` is called only for what the file itself shows:
 *  it's gone, or its own bytes don't hash to `content`. `mode` is applied as the store paths do. */
export async function copyStoredFile(
  source: StoredCopy,
  content: FileContent,
  destAbsPath: string,
  mode?: number,
): Promise<"cloned" | "copied" | null> {
  let opened;
  try {
    opened = await openRegularFile(source.path);
  } catch (err: any) {
    if (err?.code === "ENOENT") await forget(source);
    return null;
  }
  if (!opened) return null;
  const { handle, stat } = opened;
  try {
    // From the file's own size: if it differs, `content` isn't of this file, which doesn't say which of them is stale.
    if (stat.size !== content.size) return null;
    try {
      await fs.mkdir(path.dirname(destAbsPath), { recursive: true });
    } catch {
      return null;
    }
    let how: "cloned" | "copied" = "cloned";
    try {
      if ((await getFileReuse()) !== "reflink") throw new Error("sharing is off");
      await withStorageLock(() => cloneFromHandle(handle, destAbsPath));
    } catch (err: any) {
      if (err?.code === "EEXIST") throw conflict();
      how = "copied";
      try {
        await withStorageLock(() =>
          fs.copyFile(`/proc/self/fd/${handle.fd}`, destAbsPath, fsSync.constants.COPYFILE_EXCL),
        );
      } catch (copyErr: any) {
        if (copyErr?.code === "EEXIST") throw conflict();
        return null;
      }
    }
    const sha = await sha256OfRegularFile(destAbsPath).catch(() => null);
    if (sha !== content.contentSha256) {
      await discardClone(destAbsPath);
      // Only when the source itself is shown not to hash to `content`; a bad copy says nothing about it.
      if (sha && (await sha256OfHandle(handle).catch(() => content.contentSha256)) !== content.contentSha256) {
        await forget(source);
      }
      return null;
    }
    // A clone or copy takes the stored file's permissions; the store paths give the new file their own.
    if (mode !== undefined) {
      try {
        await fs.chmod(destAbsPath, mode);
      } catch {
        await discardClone(destAbsPath);
        return null;
      }
    }
    return how;
  } finally {
    await handle.close();
  }
}

/** Never over another file, as a plain store isn't either. False when none of them could be shared. */
async function placeClone(
  content: FileContent,
  mode: number | undefined,
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

/** Looks the content up and clones a stored copy of it to `destAbsPath`. A failed lookup only means nothing to share:
 *  the file is stored as usual, its hash still recorded. */
async function shareContent(
  content: FileContent,
  mode: number | undefined,
  destAbsPath: string,
  findStored: StoredCopyFinder,
): Promise<boolean> {
  // Hashed by the caller, so the record is the same whatever the size; one too small saves nothing by sharing (see
  // MIN_SHARE_BYTES) and one past MAX_LOOKUP_SIZE can't be looked up.
  if (content.size < MIN_SHARE_BYTES || content.size > MAX_LOOKUP_SIZE) return false;
  const stored = await findStored(content).catch(() => []);
  return placeClone(content, mode, stored, destAbsPath);
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
  const shared = await shareContent({ contentSha256, size: stat.size }, stat.mode & 0o7777, destAbsPath, findStored);
  return { contentSha256, shared };
}

/** The permissions a plain write gets (0o644: the usual 022 umask, as in the Docker image). A clone takes its donor's
 *  instead, so a caller that may clone a new file passes this as its mode, to match a plain write. */
export const plainWriteMode = (): number => 0o644;

/** shareStoredCopy for bytes in memory (a re-encoded or downloaded image), which have no file or permissions of their
 *  own. The caller writes them to `destAbsPath` itself when `shared` is false. */
export async function shareStoredBytes(
  bytes: Buffer,
  destAbsPath: string,
  findStored: StoredCopyFinder,
  mode?: number,
): Promise<{ contentSha256: string | null; shared: boolean }> {
  if ((await getFileReuse()) !== "reflink") return { contentSha256: null, shared: false };
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const shared = await shareContent({ contentSha256, size: bytes.length }, mode, destAbsPath, findStored);
  return { contentSha256, shared };
}
