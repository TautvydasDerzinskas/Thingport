import fsSync from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";
import { checkpoint, checkpointSync } from "./checkpoints";

// The door storage code asks the disk through about a stored file (docs/STORAGE_DEVELOPMENT.md, Fs 1 and Fs 2): only
// ENOENT and ENOTDIR mean a file is missing, what's there but isn't a regular file isn't one, and any other error stops
// the operation, so nothing is deleted or reported missing on a disk that only failed to answer. Each call names its
// site, so a test's checkpoints and faults point at one call. Calls go through the fs objects, as tests spy on them.

/** Every call site, by name. */
export const STORAGE_SITES = [
  "plate.file",
  "serve.plate",
  "serve.supporting",
  "serve.prepared",
  "zip.entry",
  "send.file",
  "mcp.file",
  "partner.file",
  "copy.source",
  "path.taken",
  "move.source",
  "move.target",
  "move.settle",
  "browser.location",
  "scan.plate",
  "repair.look",
  "repair.sweep",
  "repair.gallery",
  "migrate.export",
  "delete.look",
  "delete.unlink",
  "rename.look",
] as const;
export type StorageSite = (typeof STORAGE_SITES)[number];

/** Locks that serialise storage work, each with a checkpoint a caller reaches as it queues for the lock. */
export const LOCK_SITES = ["plate.rename"] as const;
export type LockSite = (typeof LOCK_SITES)[number];

/** The checkpoints the door reaches: before each look, before each open, once a file is open, and before each removal;
 *  and where a caller has queued for a storage lock. */
export type DoorCheckpoint =
  | `fileState:${StorageSite}`
  | `open:${StorageSite}`
  | `opened:${StorageSite}`
  | `remove:${StorageSite}`
  | `lock:${LockSite}`;
export const DOOR_CHECKPOINTS: ReadonlySet<string> = new Set([
  ...STORAGE_SITES.flatMap((site) => [`fileState:${site}`, `open:${site}`, `opened:${site}`, `remove:${site}`]),
  ...LOCK_SITES.map((site) => `lock:${site}`),
]);

/** Reached once a caller has queued for a storage lock, so a test can see it waits its turn. Never holds the caller
 *  up: a pause here only marks that it was reached. */
export function lockQueued(site: LockSite, key: string): void {
  // A test's fault here, thrown at once or later, has nothing to stop: the caller is queued either way.
  try {
    void Promise.resolve(checkpoint(`lock:${site}`, { path: key })).catch(() => undefined);
  } catch {
    // Ignored, as above.
  }
}

export type FileState =
  { state: "file"; size: number; mtimeNs: string } | { state: "missing" } | { state: "not-a-file" };

/** A stored file opened to be read, and what it was when it was opened. */
export type OpenedFile = { handle: FileHandle; size: number; mtimeNs: string };

/** The codes that mean nothing is there. */
export function isMissingError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function stateOf(stat: fsSync.BigIntStats): FileState {
  return stat.isFile()
    ? { state: "file", size: Number(stat.size), mtimeNs: String(stat.mtimeNs) }
    : { state: "not-a-file" };
}

/** What is at `abs`. Follows a final link, as the existsSync checks it replaces did. */
export async function fileState(abs: string, site: StorageSite): Promise<FileState> {
  try {
    await checkpoint(`fileState:${site}`, { path: abs });
    return stateOf(await fs.stat(abs, { bigint: true }));
  } catch (err) {
    if (isMissingError(err)) return { state: "missing" };
    throw err;
  }
}

/** fileState for code that can't wait, with the same answers. */
export function fileStateSync(abs: string, site: StorageSite): FileState {
  try {
    checkpointSync(`fileState:${site}`, { path: abs });
    const stat = fsSync.statSync(abs, { bigint: true, throwIfNoEntry: false });
    return stat ? stateOf(stat) : { state: "missing" };
  } catch (err) {
    if (isMissingError(err)) return { state: "missing" };
    throw err;
  }
}

/** `abs` opened for reading, or null when no regular file is there; other errors throw. Reaches `open:<site>` before
 *  opening and `opened:<site>` once open, so a test can change the disk or the row in between. The caller checks that
 *  its row, read again, still names this path before reading (Fs 2), and closes the handle; on an error once it's
 *  open, it's closed here. NONBLOCK, so a FIFO put in a file's place answers at once rather than holding a thread. */
export async function openStored(abs: string, site: StorageSite): Promise<OpenedFile | null> {
  let handle: FileHandle;
  try {
    await checkpoint(`open:${site}`, { path: abs });
    handle = await fs.open(abs, fsSync.constants.O_RDONLY | fsSync.constants.O_NONBLOCK);
  } catch (err) {
    if (isMissingError(err)) return null;
    throw err;
  }
  try {
    await checkpoint(`opened:${site}`, { path: abs });
    const stat = await handle.stat({ bigint: true });
    if (stat.isFile()) return { handle, size: Number(stat.size), mtimeNs: String(stat.mtimeNs) };
  } catch (err) {
    await handle.close().catch(() => undefined);
    throw err;
  }
  await handle.close();
  return null;
}

/** Removes the file at `abs`, as rm -f does: nothing there is fine, and any other error throws. */
export async function removeFile(abs: string, site: StorageSite): Promise<void> {
  try {
    await checkpoint(`remove:${site}`, { path: abs });
    await fs.rm(abs, { force: true });
  } catch (err) {
    if (!isMissingError(err)) throw err;
  }
}
