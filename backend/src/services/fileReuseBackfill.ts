import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { withStorageLock } from "../utils/storageLock";
import { cloneFromHandle, MIN_SHARE_BYTES, openRegularFile, sha256OfFile, sha256OfHandle } from "./fileReuse";
import { createNotification } from "./notificationService";
import { pruneEmptyStorageDirs } from "./printService";
import { getFileReuse } from "./settingsService";
import { currentStorageMove } from "./storageMoveService";
import { delegate, DROP, LEGACY_BUNDLES, managedPathOf, STORED, type StoredKind } from "./storedContent";

// Bringing the files stored before file reuse was turned on (or before it covered their kind) in line with it, in the
// background: first every stored file gets its hash recorded, then files with the same content are each replaced by a
// copy-on-write clone of the oldest of them, so identical files take their space once. Rows never change -- each keeps
// its own path and file; only the bytes on disk are shared, as independent clones, so deleting or editing one user's
// file never reaches another's. Modelled on storageMoveService: state in memory for the page to poll, a setting that
// lets a restart carry on, a notification when done.
//
// Replacing a file in place is the one step that could lose someone's file, so it's done defensively (see swapOne).

const log = createLogger("file-reuse-backfill");
const PENDING_KEY = "file_reuse_backfill_pending";
// The one temp file in flight, written down before it's created so a crash can't leave it unfindable.
const TEMP_KEY = "file_reuse_backfill_tmp";

const KINDS: StoredKind[] = ["plate", "printFile", "previewImage", "descriptionImage"];
const HASH_PAGE = 500;
const SAVE_EVERY = 100;
const TEMP_NAME = /^\..*\.[0-9a-f]{12}\.reuse\.tmp$/;

export type FileReuseBackfillRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  phase: "hashing" | "cloning";
  /** Files to go through in the current phase. */
  total: number;
  done: number;
  /** Files whose hash was recorded. */
  hashed: number;
  /** Files replaced by a clone of an identical one. */
  cloned: number;
  /** The size of the files cloned: an upper bound, as snapshots may keep their old extents. */
  reclaimedBytes: number;
  /** Files left as they were: gone, not a regular file, hard-linked, on another filesystem, changed meanwhile... */
  skipped: number;
  /** The filesystem can't clone, so hashes were recorded and nothing replaced. */
  unsupported: boolean;
  /** The switch was turned off while it ran. */
  stopped: boolean;
  /** The run hit an error and ended early; the server log says what. */
  failed: boolean;
  /** A start was asked for while this run was winding down after being stopped; a new run starts when it has ended. */
  restartQueued: boolean;
};

/** Where a restart carries on. `cursor` is the last row done: "<kind index>:<id>" hashing, a hash cloning. No `userId`
 *  for a run nobody asked for. */
type Pending = { userId: string | null; phase: "hashing" | "cloning"; cursor: string };

let current: FileReuseBackfillRun | null = null;
/** Who asked for the start that's waiting for the current run to end (null for nobody), if one is. */
let queuedStart: { userId: string | null } | null = null;

export function currentFileReuseBackfill(): FileReuseBackfillRun | null {
  return current;
}

/** Starts the backfill; null while one is already going. A start asked for while a run is still winding down after the
 *  switch was turned off is remembered instead, and made once that run has ended: the switch turned off and on again
 *  quickly would otherwise start nothing, and leave "Stopped" until someone checks again. */
export function startFileReuseBackfill(
  userId: string | null,
  from: { phase: Pending["phase"]; cursor: string } = { phase: "hashing", cursor: "" },
): FileReuseBackfillRun | null {
  if (current?.running) {
    if (current.stopped) {
      queuedStart = { userId };
      current.restartQueued = true;
    }
    return null;
  }
  current = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    phase: from.phase,
    total: 0,
    done: 0,
    hashed: 0,
    cloned: 0,
    reclaimedBytes: 0,
    skipped: 0,
    unsupported: false,
    stopped: false,
    failed: false,
    restartQueued: false,
  };
  void run(current, { userId, ...from });
  return current;
}

/** At startup: carries on with a run the previous process didn't finish. */
export async function resumeFileReuseBackfill(): Promise<void> {
  const row = await prisma.setting.findUnique({ where: { key: PENDING_KEY } });
  const pending = row?.value as Pending | undefined;
  if (!pending) return;
  if ((await getFileReuse()) !== "reflink") {
    // Not carrying on, but what the interrupted run left half done still has to be settled.
    await removeLeftovers();
    await dropSetting(PENDING_KEY);
    return;
  }
  log.info("resuming an interrupted run");
  startFileReuseBackfill(pending.userId ?? null, { phase: pending.phase, cursor: pending.cursor ?? "" });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Read fresh each time: the check inside the storage lock, right before a file is replaced, is the one that matters.
const enabled = async () => (await getFileReuse()) === "reflink";

/** Written down before the work it describes, so a restart can read it back. */
async function putSetting(key: string, entry: object): Promise<void> {
  const value = entry as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const dropSetting = (key: string) => prisma.setting.deleteMany({ where: { key } }).catch(() => undefined);

async function run(state: FileReuseBackfillRun, pending: Pending): Promise<void> {
  try {
    await putSetting(PENDING_KEY, pending);
    // A move changes where files are; wait for it rather than race it. (Starting one is refused while this runs.)
    while (currentStorageMove()?.running) await sleep(1000);
    await removeLeftovers();
    const canClone = await probeClones();
    state.unsupported = !canClone;
    log.info("checking identical files", { canClone, phase: pending.phase });
    let carryOn = true;
    if (pending.phase === "hashing") carryOn = await hashPhase(state, pending);
    // Hashes are recorded even where nothing can be cloned: a later copy of a model's files is verified against them.
    if (carryOn && canClone) {
      state.phase = "cloning";
      pending.phase = "cloning";
      if (pending.cursor.includes(":")) pending.cursor = "";
      carryOn = await clonePhase(state, pending);
    }
    log.info("identical files checked", {
      hashed: state.hashed,
      cloned: state.cloned,
      skipped: state.skipped,
      stopped: state.stopped,
    });
    if (pending.userId && !state.stopped) await notifyDone(pending.userId, state);
  } catch (err) {
    log.error("checking identical files failed", { error: err });
    state.failed = true;
    if (!pending.userId) return;
    await createNotification(pending.userId, {
      type: "general",
      title: "Couldn't finish checking identical files",
      body: "Some files may still be stored in full. Check again in Administration > Storage.",
      internalPath: "/admin-storage",
    }).catch(() => undefined);
  } finally {
    await dropSetting(PENDING_KEY);
    state.running = false;
    state.finishedAt = new Date().toISOString();
    await startQueued(state);
  }
}

/** Starts the run asked for while `ended` was winding down, if the switch is on again by now. */
async function startQueued(ended: FileReuseBackfillRun): Promise<void> {
  const queued = queuedStart;
  queuedStart = null;
  if (!queued) return;
  try {
    if (await enabled()) startFileReuseBackfill(queued.userId);
    else ended.restartQueued = false;
  } catch (err) {
    ended.restartQueued = false;
    log.error("couldn't start the queued run", { error: err });
  }
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

async function notifyDone(userId: string, state: FileReuseBackfillRun): Promise<void> {
  const parts: string[] = [];
  if (state.unsupported) {
    parts.push("This storage can't clone files, so identical files stay as they are.");
  } else {
    parts.push(
      `${state.cloned} file${state.cloned === 1 ? "" : "s"} now share${state.cloned === 1 ? "s" : ""} space, up to ${formatBytes(state.reclaimedBytes)} freed.`,
    );
  }
  if (state.skipped) parts.push(`${state.skipped} couldn't be checked and stayed as they were; see the server log.`);
  await createNotification(userId, {
    type: "general",
    title: "Identical files checked",
    body: parts.join(" "),
    internalPath: "/admin-storage",
  });
}

// --- Where the files are ---

type Located = { abs: string; sha: string | null; ino: bigint | null; ctimeNs: bigint | null };

/** Where the row's file is now, the hash on record for it and what it was when last made to share; null when the row is
 *  gone or its file isn't ours. */
async function locate(kind: StoredKind, id: string): Promise<Located | null> {
  const row = await delegate(kind).findUnique({
    where: { id },
    select: { ...STORED[kind].select, contentSha256: true, reuseIno: true, reuseCtimeNs: true },
  });
  if (!row) return null;
  const abs = managedPathOf(STORED[kind].toRow(row));
  return abs ? { abs, sha: row.contentSha256, ino: row.reuseIno, ctimeNs: row.reuseCtimeNs } : null;
}

/** The folder a file is really in, and the file through it, if that's inside the storage folder: a folder that's a link
 *  out of it (put there outside Thingport) is never worked in. Everything below uses these real paths. */
async function realLocation(abs: string): Promise<{ dir: string; file: string } | null> {
  try {
    const [root, dir] = await Promise.all([fs.realpath(STORAGE), fs.realpath(path.dirname(abs))]);
    if (dir !== root && !dir.startsWith(root + path.sep)) return null;
    return { dir, file: path.join(dir, path.basename(abs)) };
  } catch {
    return null;
  }
}

// --- Phase A: hashes ---

async function hashPhase(state: FileReuseBackfillRun, pending: Pending): Promise<boolean> {
  const [startKind, startAfter] = parseHashCursor(pending.cursor);
  state.phase = "hashing";
  state.total = 0;
  for (const [index, kind] of KINDS.entries()) {
    if (index < startKind) continue;
    // Only what's still to be visited: the rows of the resumed kind up to the cursor aren't.
    const after = index === startKind ? startAfter : "";
    state.total += await delegate(kind).count({
      where: { contentSha256: null, id: { gt: after }, ...STORED[kind].managed },
    });
  }
  let sinceSave = 0;
  for (const [index, kind] of KINDS.entries()) {
    if (index < startKind) continue;
    let after = index === startKind ? startAfter : "";
    for (;;) {
      const rows = await delegate(kind).findMany({
        where: { contentSha256: null, id: { gt: after }, ...STORED[kind].managed },
        orderBy: { id: "asc" },
        take: HASH_PAGE,
        select: STORED[kind].select,
      });
      if (!rows.length) break;
      for (const row of rows) {
        if (!(await enabled())) return stop(state);
        try {
          const result = await hashOne(kind, row);
          if (result === true) state.hashed += 1;
          else {
            log.debug("left a file unhashed", { kind, id: row.id, reason: result });
            state.skipped += 1;
          }
        } catch (err) {
          log.warn("couldn't hash a file", { kind, id: row.id, error: err });
          state.skipped += 1;
        }
        state.done += 1;
        after = row.id;
        if (++sinceSave >= SAVE_EVERY) {
          sinceSave = 0;
          await putSetting(PENDING_KEY, { userId: pending.userId, phase: "hashing", cursor: `${index}:${after}` });
        }
      }
    }
  }
  return true;
}

function parseHashCursor(cursor: string): [number, string] {
  const [kind, ...rest] = cursor.split(":");
  const index = Number(kind);
  return cursor && Number.isInteger(index) && index >= 0 && index < KINDS.length ? [index, rest.join(":")] : [0, ""];
}

function stop(state: FileReuseBackfillRun): false {
  state.stopped = true;
  return false;
}

/** True when the hash was recorded, else why not. A row that already has one by now isn't touched. */
async function hashOne(kind: StoredKind, row: any): Promise<true | string> {
  const abs = managedPathOf(STORED[kind].toRow(row));
  const location = abs && (await realLocation(abs));
  if (!location) return "not a file in the storage folder";
  let opened;
  try {
    opened = await openRegularFile(location.file);
  } catch (err: any) {
    if (err?.code === "ENOENT") return "file is gone";
    // A link (ELOOP) or an unreadable file: left as it is, but worth a line in the log.
    log.warn("couldn't open a file to hash it", { kind, id: row.id, error: err });
    return `couldn't open it (${err?.code ?? "error"})`;
  }
  if (!opened) return "not a regular file";
  try {
    const contentSha256 = await sha256OfHandle(opened.handle);
    // A gallery image's size wasn't kept before; the lookup needs it.
    const data = kind === "previewImage" ? { contentSha256, size: opened.stat.size } : { contentSha256 };
    await delegate(kind).updateMany({ where: { id: row.id, contentSha256: null }, data });
    return true;
  } finally {
    await opened.handle.close();
  }
}

// --- Phase B: replacing duplicates by clones ---

// Every stored file with a hash on record that's ours to replace, as (kind, id, hash, createdAt).
const MEMBERS = Prisma.sql`
  SELECT 'plate'::text AS kind, p."id" AS id, p."contentSha256" AS sha, p."createdAt" AS "createdAt"
    FROM "Plate" p WHERE p."contentSha256" IS NOT NULL AND p."sourcePath" IS NULL
  UNION ALL
  SELECT 'printFile'::text, f."id", f."contentSha256", f."createdAt"
    FROM "PrintFile" f WHERE f."contentSha256" IS NOT NULL AND f."storagePath" NOT LIKE ${LEGACY_BUNDLES + "%"}
  UNION ALL
  SELECT 'previewImage'::text, i."id", i."contentSha256", i."createdAt"
    FROM "PreviewImage" i JOIN "Print" pr ON pr."id" = i."printId"
    WHERE i."contentSha256" IS NOT NULL AND pr."assetsPath" IS NOT NULL
  UNION ALL
  SELECT 'descriptionImage'::text, d."id", d."contentSha256", d."createdAt"
    FROM "DescriptionImage" d JOIN "Print" pr ON pr."id" = d."printId"
    WHERE d."contentSha256" IS NOT NULL AND pr."assetsPath" IS NOT NULL`;

type Member = { kind: StoredKind; id: string };

async function clonePhase(state: FileReuseBackfillRun, pending: Pending): Promise<boolean> {
  state.done = 0;
  // Every hash that more than one file has, once: a few bytes each, so even a very large library is a few MB, and the
  // aggregate over all files isn't repeated for every page of groups.
  const groups = await prisma.$queryRaw<{ sha: string; n: number }[]>`
    SELECT m.sha, count(*)::int AS n FROM (${MEMBERS}) m WHERE m.sha > ${pending.cursor}
    GROUP BY m.sha HAVING count(*) > 1 ORDER BY m.sha`;
  state.total = groups.reduce((sum, group) => sum + group.n, 0);
  let sinceSave = 0;
  for (const { sha } of groups) {
    const members = await prisma.$queryRaw<Member[]>`
      SELECT m.kind, m.id FROM (${MEMBERS}) m WHERE m.sha = ${sha} ORDER BY m."createdAt" ASC, m.id ASC`;
    if (!(await shareGroup(state, sha, members))) return false;
    if (++sinceSave >= SAVE_EVERY) {
      sinceSave = 0;
      await putSetting(PENDING_KEY, { userId: pending.userId, phase: "cloning", cursor: sha });
    }
  }
  return true;
}

type Donor = { handle: fs.FileHandle; stat: fsSync.BigIntStats };

const skipLog = (member: Member, reason: string) => log.debug("left a file as it was", { ...member, reason });

/** A file left as it was, for `reason`. */
function skip(state: FileReuseBackfillRun, member: Member, reason: string): void {
  skipLog(member, reason);
  state.skipped += 1;
}

/** A file left as it was after an error: a file that's gone is only a note, anything else a warning for the log. */
function failed(state: FileReuseBackfillRun, member: Member, err: any, message: string): void {
  if (err?.code === "ENOENT") skipLog(member, "file is gone");
  else log.warn(message, { ...member, error: err });
  state.skipped += 1;
}

/** Records the file's real hash in place of the one on record, which it no longer has; it no longer shares either. */
async function rehash(member: Member, sha: string, actual: string): Promise<void> {
  await delegate(member.kind).updateMany({
    where: { id: member.id, contentSha256: sha },
    data: { ...DROP, contentSha256: actual },
  });
}

/** The oldest member that's still what its hash says is the file the others are cloned from. Its handle stays open for
 *  the group: it's read through that, whatever the path holds by then. */
async function findDonor(members: Member[], sha: string, state: FileReuseBackfillRun): Promise<[Donor | null, number]> {
  for (const [index, member] of members.entries()) {
    try {
      const row = await locate(member.kind, member.id);
      if (!row || row.sha !== sha) {
        skip(state, member, "row changed or gone");
        continue;
      }
      const location = await realLocation(row.abs);
      const opened = location && (await openRegularFile(location.file, true));
      if (!opened) {
        skip(state, member, "not a regular file in the storage folder");
        continue;
      }
      // Below a filesystem block a clone saves nothing; the whole group is that size.
      if (Number(opened.stat.size) < MIN_SHARE_BYTES) {
        await opened.handle.close();
        return [null, members.length];
      }
      const actual = await sha256OfHandle(opened.handle);
      if (actual !== sha) {
        await opened.handle.close();
        await rehash(member, sha, actual);
        skip(state, member, "changed since its hash was recorded");
        continue;
      }
      return [{ handle: opened.handle, stat: opened.stat }, index + 1];
    } catch (err: any) {
      failed(state, member, err, "couldn't read a file");
    }
  }
  return [null, members.length];
}

/** Whether the member is still the file the last run made share its bytes: same inode and ctime as recorded then. Any
 *  write, move, link or replacement changes one of them, so a match means nothing happened to it since. */
async function alreadyShared(member: Member): Promise<boolean> {
  try {
    const row = await locate(member.kind, member.id);
    if (!row || row.ino === null || row.ctimeNs === null) return false;
    const location = await realLocation(row.abs);
    const stat = location && (await fs.lstat(location.file, { bigint: true }).catch(() => null));
    return !!stat && stat.isFile() && stat.ino === row.ino && stat.ctimeNs === row.ctimeNs;
  } catch {
    return false;
  }
}

async function markShared(member: Member, sha: string, stat: Big): Promise<void> {
  await delegate(member.kind)
    .updateMany({
      where: { id: member.id, contentSha256: sha },
      data: { reuseIno: stat.ino, reuseCtimeNs: stat.ctimeNs },
    })
    .catch((err) => log.warn("couldn't record a shared file", { ...member, error: err }));
}

/** False when the run is to stop. */
async function shareGroup(state: FileReuseBackfillRun, sha: string, members: Member[]): Promise<boolean> {
  // What a run before already made share is left alone: replacing it again would read it three times and give it a new
  // inode (which an incremental backup copies in full) for no saving.
  const shared = new Set<Member>();
  for (const member of members) if (await alreadyShared(member)) shared.add(member);
  if (shared.size === members.length) {
    state.done += members.length;
    return true;
  }
  const [donor, used] = await findDonor(members, sha, state);
  state.done += used;
  if (!donor) {
    state.done += members.length - used;
    return true;
  }
  try {
    let settled = used === 1;
    for (const member of members.slice(used)) {
      if (!(await enabled())) return stop(state);
      while (currentStorageMove()?.running) await sleep(1000);
      if (shared.has(member)) {
        state.done += 1;
        continue;
      }
      try {
        const result = await swapOne(state, donor, member, sha);
        if (result !== true) {
          skip(state, member, result);
          settled = false;
        }
      } catch (err: any) {
        failed(state, member, err, "couldn't replace a file by a clone");
        settled = false;
      }
      state.done += 1;
    }
    // Every other member shares the donor's bytes: the donor needn't be read again until something changes it.
    if (settled && members.length > 1)
      await markShared(members[used - 1], sha, await donor.handle.stat({ bigint: true }));
  } finally {
    await donor.handle.close();
  }
  return true;
}

const tempName = (base: string) => {
  // Cut by bytes, not letters: the whole name must stay within the filesystem's limit.
  let stem = "";
  for (const letter of base) {
    if (Buffer.byteLength(stem + letter) > 100) break;
    stem += letter;
  }
  // A dot first so the pictures folder's own-files check never takes it for a picture's, and .tmp last so the
  // storage overview's file listing skips it.
  return `.${stem}.${crypto.randomBytes(6).toString("hex")}.reuse.tmp`;
};

/** What a swap in flight has made, written down before it's made so a crash can't leave any of it unfindable:
 *  `path` the clone, `backup` a second hard link to the original (see swapOne), and which row and hash it is about. */
type JournalEntry = { path: string; backup?: string; kind?: StoredKind; id?: string; sha?: string };

/** Removes a temp file of ours that isn't being kept. Only ever called on a path made here, by name. */
async function discard(tmp: string): Promise<void> {
  await fs.rm(tmp, { force: true }).catch(() => undefined);
  await dropSetting(TEMP_KEY);
}

type Big = fsSync.BigIntStats;
const sameFile = (a: Big, b: Big) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
// The same file, content and all, by what a change to it would alter. Not ctime, which a hard link changes by itself.
const sameContent = (a: Big, b: Big) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;

/**
 * Replaces one file by a clone of the donor's: made beside it, checked, and renamed over it. True when replaced, else
 * why not (nothing was changed then).
 *
 * The original's bytes are never given up before the clone is known good, and not even after the rename until it's
 * known that nothing was written to the original meanwhile. For that, a second name for the original is made beside it
 * (a hard link, which takes no space) just before the rename, so the original lives on under it, and only when the
 * rename is done and the original found unchanged is that name removed. If something wrote to the original in between
 * -- through a handle it already had open, which nothing here can see -- that name is renamed back over the clone: a
 * rename needs no space, so a full disk can't lose the bytes, and every step is journalled, so neither can a crash (see
 * settleBackup). The checks and the rename run under the storage lock, so a move of files can't come between them.
 */
async function swapOne(state: FileReuseBackfillRun, donor: Donor, member: Member, sha: string): Promise<true | string> {
  const row = await locate(member.kind, member.id);
  if (!row || row.sha !== sha) return "row changed or gone";
  const location = await realLocation(row.abs);
  if (!location) return "not a file in the storage folder";
  const target = await openRegularFile(location.file, true);
  if (!target) return "not a regular file";
  const { handle } = target;
  let tmp: string | null = null;
  let cloneHandle: fs.FileHandle | null = null;
  let rowGone = false;
  try {
    const before = target.stat;
    // One name for the file, on the donor's filesystem and its own file: a hard link elsewhere would keep the old bytes
    // (and a rename would only replace one name of it), another filesystem can't clone from the donor.
    if (before.nlink !== 1n) return "has another hard link";
    if (before.dev !== donor.stat.dev) return "on another filesystem";
    if (before.ino === donor.stat.ino) return "is the donor itself";
    if (before.size !== donor.stat.size) return "a different size than the donor";
    const actual = await sha256OfHandle(handle);
    if (actual !== sha) {
      await rehash(member, sha, actual);
      return "changed since its hash was recorded";
    }
    // What the file was while it was read and what it is now: if it changed meanwhile, the hash says nothing.
    const snapshot = await handle.stat({ bigint: true });
    if (!sameFile(before, snapshot)) return "changed while it was read";

    tmp = path.join(location.dir, tempName(path.basename(location.file)));
    const backup = path.join(location.dir, tempName(path.basename(location.file)));
    await putSetting(TEMP_KEY, { path: tmp, backup, kind: member.kind, id: member.id, sha });
    try {
      await cloneFromHandle(donor.handle, tmp);
    } catch (err: any) {
      // A name taken isn't ours to remove; any other failure removed what it made itself.
      if (err?.code === "EEXIST") await dropSetting(TEMP_KEY);
      else await discard(tmp);
      tmp = null;
      if (err?.code !== "EEXIST") log.warn("couldn't clone a file", { ...member, error: err });
      return `couldn't be cloned (${err?.code ?? "error"})`;
    }

    const opened = await openRegularFile(tmp, true);
    if (!opened) return "the clone isn't a regular file";
    cloneHandle = opened.handle;
    if (opened.stat.nlink !== 1n || (await sha256OfHandle(cloneHandle)) !== sha) return "the clone didn't match";
    // What a plain file there would have: the original's permissions, owner and times.
    await cloneHandle.chmod(Number(snapshot.mode & 0o7777n));
    if (opened.stat.uid !== snapshot.uid || opened.stat.gid !== snapshot.gid) {
      await cloneHandle.chown(Number(snapshot.uid), Number(snapshot.gid));
    }
    await cloneHandle.utimes(Number(snapshot.atimeNs) / 1e9, Number(snapshot.mtimeNs) / 1e9);

    const outcome = await withStorageLock(async (): Promise<true | string> => {
      if (!(await enabled())) return "the switch was turned off";
      const now = await locate(member.kind, member.id);
      if (!now) {
        rowGone = true;
        return "its row was deleted";
      }
      if (now.abs !== row.abs || now.sha !== sha) return "its row changed";
      const where = await realLocation(now.abs);
      if (!where || where.file !== location.file) return "it moved";
      // Checked before the next steps, so that what's checked last is immediately followed by the rename.
      const held = await handle.stat({ bigint: true });
      if (!sameContent(held, snapshot) || held.nlink !== 1n) return "changed before it could be replaced";

      // The second name. From here the original has two, so whatever happens to the path, its bytes stay.
      await fs.link(location.file, backup);
      const onDisk = await fs.lstat(location.file, { bigint: true }).catch(() => null);
      if (!onDisk || !onDisk.isFile() || !sameContent(onDisk, snapshot) || onDisk.nlink !== 2n) {
        // Not what was checked: not replaced. If its path is empty and its row still there, the original is put back;
        // only a name that's really not wanted is removed.
        if (!onDisk && (await locate(member.kind, member.id))) {
          try {
            await fs.link(backup, location.file);
          } catch (err) {
            log.error("kept a file's original beside its path: couldn't put it back", {
              file: location.file,
              backup,
              error: err,
            });
            return "changed before it could be replaced";
          }
        } else if (!onDisk) {
          rowGone = true;
        }
        await fs.rm(backup, { force: true });
        return "changed before it could be replaced";
      }
      try {
        await fs.rename(tmp!, location.file);
      } catch (err) {
        // Not renamed, so the original is still at its path: its second name isn't needed.
        await fs.rm(backup, { force: true });
        throw err;
      }
      tmp = null;

      // Settled with the original's bytes under their second name until here: only now is anything given up.
      const clone = await cloneHandle!.stat({ bigint: true });
      const after = await handle.stat({ bigint: true });
      const here = await fs.lstat(location.file, { bigint: true }).catch(() => null);
      const cloneHere = !!here && here.dev === clone.dev && here.ino === clone.ino;
      const again = await locate(member.kind, member.id);
      if (!again) {
        // A delete landed meanwhile and the rename put a file back that no row owns: gone with it.
        rowGone = true;
        if (cloneHere) await fs.rm(location.file, { force: true });
        await fs.rm(backup, { force: true });
        await dropSetting(TEMP_KEY);
        return "its row was deleted";
      }
      if (!sameContent(after, snapshot) || again.abs !== row.abs || again.sha !== sha) {
        log.warn("a file was changed while it was being replaced; putting the original back", { file: location.file });
        if (cloneHere) {
          await fs.rename(backup, location.file);
        } else if (!here) {
          await fs.link(backup, location.file);
          await fs.rm(backup, { force: true });
        } else {
          log.error("couldn't put a changed file back: something else is at its path; its bytes are kept beside it", {
            file: location.file,
            backup,
          });
        }
        await dropSetting(TEMP_KEY);
        return "written to while it was being replaced";
      }
      await fs.rm(backup, { force: true });
      await dropSetting(TEMP_KEY);
      await markShared(member, sha, clone);
      return true;
    });
    if (outcome !== true) return outcome;
    state.cloned += 1;
    state.reclaimedBytes += Number(snapshot.size);
    return true;
  } finally {
    await cloneHandle?.close().catch(() => undefined);
    await handle.close().catch(() => undefined);
    if (tmp) await discard(tmp);
    // A model deleted while this ran leaves its folder behind when the clone was the last thing in it.
    if (rowGone) await pruneEmptyStorageDirs(location.dir).catch(() => undefined);
  }
}

// --- Start-up checks ---

/** The files a crashed run may have left: the journalled clone and backup, and a probe folder. */
async function removeLeftovers(): Promise<void> {
  const names = await fs.readdir(STORAGE).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.startsWith(".reflink-probe-"))) {
    await fs.rm(path.join(STORAGE, name), { recursive: true, force: true }).catch(() => undefined);
  }
  const row = await prisma.setting.findUnique({ where: { key: TEMP_KEY } });
  const entry = row?.value as JournalEntry | null | undefined;
  if (!entry?.path) {
    await dropSetting(TEMP_KEY);
    return;
  }
  // The original first: nothing else is removed while its bytes aren't settled.
  if (entry.backup) {
    try {
      await withStorageLock(() => settleBackup(entry));
    } catch (err) {
      // Left journalled for the next start; nothing was removed.
      log.error("couldn't settle a file the last run was replacing; its original is kept", { entry, error: err });
      return;
    }
  }
  await removeLeftoverTemp(entry.path).catch((err) => log.warn("couldn't remove a leftover temp file", { error: err }));
  await dropSetting(TEMP_KEY);
}

/**
 * A crash can stop swapOne at any step (see there); this settles the backup from what's on disk, favouring the bytes
 * kept. It is removed only when the path holds the same file or the same bytes, or the original's
 * bytes are what the clone was checked to be (so only a later edit of the clone differs); it is renamed back when the
 * original was written to after the swap; it is kept, with an error in the log, when neither is the case.
 *
 *  - Before the rename: the path still holds the original (same inode as the backup): the backup goes.
 *  - After it: the path holds the clone. Same bytes as the backup: it goes. The clone as checked but the original
 *    different: the original was written to, so it's renamed back over the clone. The original as checked but the clone
 *    different: the clone was edited since, which is newer, so the backup goes. Both different: both are kept.
 *  - The path is gone while its row is there: the backup is linked back to it. The row is gone: the backup goes with it.
 */
async function settleBackup(entry: JournalEntry): Promise<void> {
  const backup = await ourTemp(entry.backup!);
  if (!backup) return;
  const backupStat = await fs.lstat(backup, { bigint: true }).catch(() => null);
  if (!backupStat?.isFile()) return;
  if (!entry.kind || !entry.id || !entry.sha) {
    log.error("kept a file's original beside its path: the journal doesn't say whose it is", { backup });
    return;
  }
  const row = await locate(entry.kind, entry.id);
  if (!row) {
    await fs.rm(backup, { force: true });
    return;
  }
  const where = await realLocation(row.abs);
  if (!where || where.dir !== path.dirname(backup)) {
    log.error("kept a file's original beside its path: its path isn't next to it", { backup });
    return;
  }
  const file = where.file;
  const fileStat = await fs.lstat(file, { bigint: true }).catch(() => null);
  if (!fileStat) {
    await fs.link(backup, file);
    await fs.rm(backup, { force: true });
    log.warn("put a file's original back at its path", { file });
    return;
  }
  if (!fileStat.isFile()) {
    log.error("kept a file's original beside its path: something that isn't a file is there", { file, backup });
    return;
  }
  if (fileStat.dev === backupStat.dev && fileStat.ino === backupStat.ino) {
    await fs.rm(backup, { force: true });
    return;
  }
  const [fileSha, backupSha] = await Promise.all([sha256OfFile(file), sha256OfFile(backup)]);
  if (fileSha === backupSha || backupSha === entry.sha) {
    await fs.rm(backup, { force: true });
  } else if (fileSha === entry.sha) {
    await fs.rename(backup, file);
    log.warn("put a file's changed original back over its clone", { file });
  } else {
    log.error("kept a file's original beside its path: both it and the file there changed", { file, backup });
  }
}

/** The path resolved, when it's named like this job's temp files and inside storage; the journal is trusted no further
 *  than that. */
async function ourTemp(p: string): Promise<string | null> {
  const root = await fs.realpath(STORAGE);
  const resolved = path.resolve(p);
  return TEMP_NAME.test(path.basename(resolved)) && resolved.startsWith(root + path.sep) ? resolved : null;
}

async function removeLeftoverTemp(tmp: string): Promise<void> {
  const resolved = await ourTemp(tmp);
  if (!resolved) return;
  const root = await fs.realpath(STORAGE);
  // A plain file no row has as its own.
  const stat = await fs.lstat(resolved).catch(() => null);
  if (!stat?.isFile()) return;
  const relative = path.relative(root, resolved);
  const [plate, printFile] = await Promise.all([
    prisma.plate.count({ where: { storagePath: relative } }),
    prisma.printFile.count({ where: { storagePath: relative } }),
  ]);
  if (plate || printFile) return;
  await fs.rm(resolved, { force: true });
}

/** Whether the storage folder's filesystem clones files: tried once on two small files, through the same call as every
 *  other clone -- from the open file's handlePath, so a container without /proc reports it can't. */
async function probeClones(): Promise<boolean> {
  const dir = path.join(STORAGE, `.reflink-probe-${crypto.randomBytes(6).toString("hex")}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const from = path.join(dir, "a");
    await fs.writeFile(from, Buffer.alloc(MIN_SHARE_BYTES, 1), { flag: "wx" });
    const source = await fs.open(from, "r");
    try {
      await cloneFromHandle(source, path.join(dir, "b"));
    } finally {
      await source.close();
    }
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
