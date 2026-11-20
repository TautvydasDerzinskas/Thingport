import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE, IMPORT_MAX_BYTES, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { isPendingStoragePath, isUnsettled, PENDING_STORAGE_PREFIX } from "./printFileSaves";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { normalizeFolder } from "../utils/fileFolder";
import { isPreparedPrintFilename, inspectPreparedPrint } from "./preparedPrint";
import { pruneEmptyStorageDirs, relocatePrint, relocatePrintFile, renderPrintFileStoragePath } from "./printService";
import { reuseMarker, sha256OfFile, shareStoredCopy } from "./fileReuse";
import { findStoredCopies } from "./storedContent";
import type { Prisma, Print, PrintFile } from "@prisma/client";

export function managedPrintFilePath(printFile: Pick<PrintFile, "storagePath">): string {
  const candidate = path.resolve(STORAGE, printFile.storagePath);
  const root = path.resolve(STORAGE);
  if (candidate === root || !candidate.startsWith(root + path.sep)) {
    throw new HttpError(400, "Related file resolved outside storage");
  }
  return candidate;
}

export async function listSupportingFiles(printId: string): Promise<PrintFile[]> {
  // Only those whose saves are done: one still on its way in would answer 404, and stay listed if its save failed.
  return prisma.printFile.findMany({
    where: { printId, role: "SUPPORTING", ready: true },
    orderBy: [{ filename: "asc" }, { id: "asc" }],
  });
}

/** Never over another file: a link fails on one that's there, where a rename would replace it. Only the placing is
 *  under the storage lock (the file reuse backfill's swap renames over a path it has just checked, and mustn't land
 *  after a file saved at a path its row just freed); removing the temp file is not. */
async function placeUpload(tempPath: string, destination: string): Promise<void> {
  // Its folder made again in the same turn: one made before could be pruned by a move emptying it in between.
  await withStorageLock(async () => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await linkOrCopy(tempPath, destination);
  });
  await fs.rm(tempPath, { force: true });
}

async function linkOrCopy(tempPath: string, destination: string): Promise<void> {
  try {
    await fs.link(tempPath, destination);
  } catch (err: any) {
    if (err?.code === "EEXIST") throw new HttpError(409, "Another file was just saved at the same path; try again");
    // Another disk, or one without hard links.
    try {
      await fs.copyFile(tempPath, destination, fsSync.constants.COPYFILE_EXCL);
    } catch (copyErr: any) {
      if (copyErr?.code === "EEXIST") {
        throw new HttpError(409, "Another file was just saved at the same path; try again");
      }
      throw copyErr;
    }
  }
}

const CR = 0x0d;
const LF = 0x0a;
const CRLF = Buffer.from([CR, LF]);
/** How much of a script is held at once while its line endings are read and rewritten. An upload may be as
 *  large as IMPORT_MAX_BYTES, and several arrive at once, so none of this is done a whole file at a time. */
const SCRIPT_CHUNK_BYTES = 1 << 20;

/** Whether a CRLF appears anywhere in the file, a chunk at a time. */
async function hasCrlf(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, "r");
  try {
    const chunk = Buffer.allocUnsafe(SCRIPT_CHUNK_BYTES);
    let endedInCr = false;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length);
      if (!bytesRead) return false;
      // A CRLF the reads fell between: the LF opens this chunk.
      if (endedInCr && chunk[0] === LF) return true;
      if (chunk.subarray(0, bytesRead).includes(CRLF)) return true;
      endedInCr = chunk[bytesRead - 1] === CR;
    }
  } finally {
    await handle.close();
  }
}

/** Node may take less than it is handed; the rest goes on the next call, and a script half-written is a
 *  script corrupted. */
async function writeAll(target: fs.FileHandle, buffer: Buffer, length: number): Promise<void> {
  for (let written = 0; written < length;) {
    const { bytesWritten } = await target.write(buffer, written, length - written);
    if (!bytesWritten) throw new Error("The rewritten script stopped being written");
    written += bytesWritten;
  }
}

/**
 * The file again at `destination`, without the CR of each CRLF.
 *
 * Byte by byte rather than through a string: a script in some other encoding -- a Latin-1 "é" in a comment --
 * survives whole, where decoding it as UTF-8 would replace every byte that isn't valid UTF-8 with U+FFFD and
 * write that back. CR and LF are the only bytes this looks at, and every other one is copied across untouched.
 */
async function writeWithoutCrlf(filePath: string, destination: string): Promise<void> {
  const source = await fs.open(filePath, "r");
  try {
    const target = await fs.open(destination, "w");
    try {
      const chunk = Buffer.allocUnsafe(SCRIPT_CHUNK_BYTES);
      // One longer than a chunk: a CR held over from the last read can precede a whole chunk of its own.
      const out = Buffer.allocUnsafe(SCRIPT_CHUNK_BYTES + 1);
      let heldCr = false;
      for (;;) {
        const { bytesRead } = await source.read(chunk, 0, chunk.length);
        if (!bytesRead) break;
        let length = 0;
        // The CR the last read ended on: part of a CRLF if this chunk opens with the LF, a lone CR otherwise.
        if (heldCr && chunk[0] !== LF) out[length++] = CR;
        heldCr = false;
        for (let at = 0; at < bytesRead; at++) {
          if (chunk[at] !== CR) out[length++] = chunk[at];
          // The last byte read: only the next chunk says whether an LF follows it.
          else if (at === bytesRead - 1) heldCr = true;
          else if (chunk[at + 1] !== LF) out[length++] = CR;
        }
        await writeAll(target, out, length);
      }
      // The file ended on a CR, so nothing followed it.
      if (heldCr) await writeAll(target, Buffer.from([CR]), 1);
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
}

/**
 * A generator script is stored with Unix line endings, whichever way it arrived.
 *
 * OpenSCAD reads a parameter's widget out of the comment after it and misses every one whose line ends in CRLF:
 * a script written on Windows opens with none of its dropdowns or sliders, in Thingport's customizer and in
 * OpenSCAD itself, with nothing said about why. Here rather than in the importer because a script reaches a
 * model four ways -- imported, uploaded with it, attached afterwards, or brought by a folder -- and all four
 * come through this.
 *
 * Looked at before anything is written, so the usual script -- Unix endings already -- is only read, never
 * copied. Where there is something to rewrite it goes beside the original and is renamed over it once it is
 * whole: writing in place truncates first, so a write that failed halfway would leave a damaged script behind
 * and this would carry on and store it.
 */
async function normalizeGeneratorScript(tempPath: string, filename: string): Promise<void> {
  if (!PARAMETRIC_SOURCE_EXTS.has(path.extname(filename).toLowerCase())) return;
  const rewritten = `${tempPath}.lf`;
  try {
    if (!(await hasCrlf(tempPath))) return;
    await writeWithoutCrlf(tempPath, rewritten);
    await fs.rename(rewritten, tempPath);
  } catch (err) {
    // Best-effort, and now truthful: the original is untouched, so the script is stored exactly as it came.
    await fs.rm(rewritten, { force: true }).catch(() => undefined);
    console.warn(`Couldn't normalize the line endings of ${filename}:`, err);
  }
}

/**
 * Saves an uploaded file onto a print, beside its plates where the storage structure puts them. The role comes
 * from the filename (a .3mf containing gcode becomes PREPARED) unless `role` is given, as for a copy of a file whose
 * role is already known; a new PREPARED file replaces the existing one. `leavePrepared` keeps one that would be
 * PREPARED as a supporting file instead, leaving the model's prepared print as it is (see batchFileSaver). `onStored`
 * is told the role it was stored with, and its id, once it's in.
 *
 * The row is made first, to claim the file's place, and is ready (PrintFile.ready) only in the transaction that finishes
 * the save: until then nothing lists, moves or sweeps it, and a move of the model's files passes it by, which is why
 * the save moves it after them once it's done.
 */
export async function saveFileFromTemp(
  userId: string,
  printId: string,
  tempPath: string,
  originalFilename: string,
  contentType: string | null | undefined,
  {
    role: givenRole,
    folder: givenFolder,
    leavePrepared = false,
    onStored,
  }: {
    role?: "SUPPORTING" | "PREPARED";
    folder?: string | null;
    leavePrepared?: boolean;
    onStored?: (role: "SUPPORTING" | "PREPARED", fileId: string) => void;
  } = {},
): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");

  const safeName = sanitizeFilename(originalFilename || "supporting-file");
  let role: "SUPPORTING" | "PREPARED" =
    givenRole ?? (isPreparedPrintFilename(safeName) && !leavePrepared ? "PREPARED" : "SUPPORTING");
  const mime = mimeFromContentType(contentType, safeName);
  const folder = normalizeFolder(givenFolder);

  const record = await prisma.printFile.create({
    data: {
      printId: print.id,
      filename: safeName,
      folder,
      mime,
      role,
      storagePath: `${PENDING_STORAGE_PREFIX}${randomUUID()}`,
      ready: false,
    },
  });
  let destination: string | null = null;
  // Once the transaction that finishes the save is sent: from then on a rejection may be a commit whose answer was lost.
  let finishing = false;
  // The prepared print that transaction replaced, set inside it.
  let replaced: string | null = null;
  let updatedPrint: Print | null = null;
  // The model as that transaction read it at its end: where the save turns out to have gone in, it's the answer, with
  // no read after that could fail it before the caller hears of the file (onStored).
  let readInIt: Print | null = null;

  try {
    // Before normalisation, not after: an oversized upload is refused without anything reading through it.
    if ((await fs.stat(tempPath)).size > IMPORT_MAX_BYTES) {
      throw new HttpError(413, "Related file exceeds size limit");
    }
    await normalizeGeneratorScript(tempPath, safeName);
    // Again, since dropping each CRLF's CR leaves the file shorter than it arrived.
    const stat = await fs.stat(tempPath);
    // Claimed in the database first, so two uploads of one name can't both pick the same place, and chosen and claimed
    // in one turn at the storage lock, as a failed repair puts its plates back in one (restorePlates): chosen outside
    // it, a place could be one a plate is just being given back, and both rows would name it.
    const storagePath = await withStorageLock(async () => {
      const chosen = await renderPrintFileStoragePath(print, safeName, folder);
      await prisma.printFile.update({ where: { id: record.id }, data: { storagePath: chosen } });
      return chosen;
    });
    destination = path.join(STORAGE, storagePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // A clone of a stored copy of the same bytes (any user's, any kind of file) when the admin setting allows; the
    // upload is then only clutter, not a reason to fail.
    let contentSha256: string | null = null;
    let shared = false;
    try {
      ({ contentSha256, shared } = await shareStoredCopy(tempPath, destination, findStoredCopies));
    } catch (err) {
      // Sharing only saves space: stored as usual, with no hash recorded. Another file at the path is a conflict.
      if (err instanceof HttpError && err.status === 409) throw err;
    }
    if (shared) await fs.rm(tempPath, { force: true }).catch(() => undefined);
    else await placeUpload(tempPath, destination);
    const marker = await reuseMarker(destination, shared, contentSha256);

    let metadata: Record<string, unknown> | null = null;
    if (role === "PREPARED" || safeName.toLowerCase().endsWith(".3mf")) {
      metadata = (await inspectPreparedPrint(destination, safeName)) as Record<string, unknown> | null;
    }
    if (metadata && !givenRole && !leavePrepared) role = "PREPARED";

    finishing = true;
    updatedPrint = await prisma.$transaction(async (tx) => {
      // The model's row locked before its prepared slot is read, as a merge locks it: two prepared prints saved at once
      // would otherwise both find the slot as it was, and the first stay a prepared print the model doesn't point at.
      await tx.$queryRaw`SELECT id FROM "Print" WHERE id = ${printId} FOR UPDATE`;
      const currentPrint = await tx.print.findUnique({ where: { id: printId } });
      if (!currentPrint) throw new HttpError(404, "Print not found");
      await tx.printFile.update({
        where: { id: record.id },
        data: {
          size: stat.size,
          contentSha256,
          ...marker,
          role,
          metadata: (metadata as Prisma.InputJsonValue | undefined) ?? undefined,
          ready: true,
        },
      });
      if (role === "PREPARED") {
        if (currentPrint.preparedFileId && currentPrint.preparedFileId !== record.id) {
          replaced = currentPrint.preparedFileId;
          // On its way out: from here nothing lists, moves or sweeps it, as with a save still under way, and the
          // clean-up at startup takes its row if it's still there then.
          await tx.printFile.updateMany({ where: { id: replaced }, data: { ready: false } });
        }
        await tx.print.update({ where: { id: printId }, data: { preparedFileId: record.id } });
      }
      readInIt = await tx.print.findUniqueOrThrow({ where: { id: printId } });
      return readInIt;
    });
  } catch (err) {
    // A commit whose answer was lost rejects too: the save stands where its row is ready, which only that transaction
    // makes it, having run to its end (`replaced` set). Where that can't be told, nothing is undone: taking the file
    // away could leave the model with neither print, and an unfinished row is the clean-up at startup's to settle.
    const now = finishing
      ? await prisma.printFile.findUnique({ where: { id: record.id } }).then(
          (row) => (row?.ready ? "saved" : "not"),
          () => "unknown",
        )
      : "not";
    if (now === "unknown") throw err;
    if (now === "saved") updatedPrint = readInIt ?? (await prisma.print.findUniqueOrThrow({ where: { id: printId } }));
    else {
      // Only once it's ours: a 409 above means the file there is another one's.
      const placed = Boolean(destination) && !(err instanceof HttpError && err.status === 409);
      // The row read under the storage lock, as any removal reads it: one gone was taken with its file by whatever took
      // it, and another save may have its file at the place it left. Only an unfinished one is this save's to undo.
      await withStorageLock(async () => {
        const row = await prisma.printFile.findUnique({ where: { id: record.id } });
        if (!row || row.ready) return;
        const where = placed && !isPendingStoragePath(row.storagePath) ? printFilePathOrNull(row) : null;
        if (where) await fs.rm(where, { force: true }).catch(() => undefined);
        await prisma.printFile.delete({ where: { id: record.id } }).catch(() => undefined);
        // Its emptied folders in the same turn, as for every removal (removeRowAndFile).
        if (where) await pruneEmptyStorageDirs(path.dirname(where)).catch(() => undefined);
      }).catch(() => undefined);
      throw err;
    }
  }

  // Committed by now: nothing after this may undo the save, or a replaced prepared print would be lost with it. The
  // one it replaced goes with its file, the row read under the storage lock as any removal reads it: a move that was
  // already under way may have taken the file elsewhere, and another file the place it left.
  if (replaced) await removeReplacedPrint(replaced);
  // To where the model's files are now: a move of them while this was on its way in passed it by.
  await relocatePrintFile(record.id).catch((err: unknown) =>
    console.warn(`Couldn't move ${safeName}, just saved, to where model ${printId}'s files are:`, err),
  );
  try {
    onStored?.(role, record.id);
  } catch (err) {
    console.error(`The save of ${safeName} was told to a caller that failed:`, err);
  }
  return updatedPrint;
}

// What a supporting file may be shown as in the browser rather than downloaded. Never HTML or SVG: the instance's own
// origin would run their scripts. Text-like files are all sent as plain text, so nothing in them is interpreted.
const INLINE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".scad",
  ".log",
  ".nfo",
  ".ini",
  ".cfg",
  ".conf",
  ".json",
  ".yaml",
  ".yml",
]);

/** The Content-Type a supporting file is shown inline with, or null for one that's only ever downloaded. */
export function inlineContentType(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTS.has(ext)) return "text/plain; charset=utf-8";
  return INLINE_TYPES[ext] ?? null;
}

/** Renames one of a model's supporting files, and moves it to match. A name another supporting file in the same folder
 *  has gets a number, as a second upload of it would; a name with no extension keeps the one it had. */
export async function renameSupportingFile(
  userId: string,
  printId: string,
  fileId: string,
  filename: string,
): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const record = await prisma.printFile.findUnique({ where: { id: fileId } });
  if (!record || record.printId !== printId || record.role !== "SUPPORTING") {
    throw new HttpError(404, "Supporting file not found");
  }
  // Its row has its place before its bytes are there: renamed now, the row would move on while the file lands behind.
  if (isUnsettled(record)) throw new HttpError(409, "That file is still being saved: try again once it's in");
  // Before sanitising, which turns nothing into "imported-file": that would quietly become the file's name.
  const trimmed = filename.trim();
  if (!trimmed) throw new HttpError(400, "A file needs a name");
  const asked = sanitizeFilename(trimmed);

  // The names in use read and the new one taken under the lock, so two renames at once can't both take one name: the
  // table doesn't stop two of a folder's files sharing it. Read again there, as its save may not have been done at the
  // first read. The name it has already is no change, but the move below still runs: a rename whose move failed is
  // finished by asking for it again.
  await withStorageLock(async () => {
    const now = await prisma.printFile.findUnique({ where: { id: record.id } });
    // Still this model's supporting file, in the folder it's in now: a merge or a move while this waited may have made
    // it another model's, or a prepared print.
    if (!now || now.printId !== printId || now.role !== "SUPPORTING") {
      throw new HttpError(404, "Supporting file not found");
    }
    if (isUnsettled(now)) throw new HttpError(409, "That file is still being saved: try again once it's in");
    // A name given without an extension keeps the one the file has now, which a rename just before may have changed.
    const wanted = path.extname(asked) ? asked : `${asked}${path.extname(now.filename)}`;
    if (wanted === now.filename) return;
    const taken = new Set(
      (
        await prisma.printFile.findMany({
          where: { printId, role: "SUPPORTING", folder: now.folder, id: { not: record.id } },
          select: { filename: true },
        })
      ).map((file) => file.filename.toLowerCase()),
    );
    const { name, ext } = path.parse(wanted);
    let next = wanted;
    for (let n = 2; taken.has(next.toLowerCase()); n++) next = `${name} (${n})${ext}`;
    await prisma.printFile.update({ where: { id: record.id }, data: { filename: next } });
  });
  // The file follows its name, as a plate's does, to where the model is now: an edit while this waited for the lock
  // moves the model's other files where its new name puts them.
  const current = await prisma.print.findUnique({ where: { id: printId } });
  if (current) await relocatePrint(current, []);
}

/**
 * Saves files that arrive onto one model together -- an upload, a consume-folder model -- as saveFileFromTemp does,
 * except that only the first prepared print among them takes the model's prepared slot. The ones after it are kept as
 * supporting files: each replacing the one before, as a lone upload replaces the model's prepared print, would leave
 * only the last.
 */
export function batchFileSaver(userId: string, printId: string) {
  let preparedTaken = false;
  return (
    tempPath: string,
    originalFilename: string,
    contentType: string | null | undefined,
    options: { folder?: string | null; role?: "SUPPORTING" } = {},
  ): Promise<Print> =>
    saveFileFromTemp(userId, printId, tempPath, originalFilename, contentType, {
      ...options,
      leavePrepared: preparedTaken,
      // What this save stored, not the model's prepared slot, which another upload may fill meanwhile.
      onStored: (role) => {
        if (role === "PREPARED") preparedTaken = true;
      },
    });
}

/** Deletes the rows of the saves the last process ended before finishing, each a file that isn't there or isn't whole,
 *  and of prepared prints another replaced that it hadn't removed yet. At startup, before this process saves anything.
 *  A replaced print's file goes first, while it's still the bytes its row saved (ownedFile); one that won't go keeps
 *  its row for the next start. A file found at a place an unfinished save claimed stays: nothing says for sure it's
 *  the save's own and not a moved file's or a plate's, so it's left for the storage browser rather than deleted. */
export async function removeAbandonedPrintFileSaves(): Promise<number> {
  const where: Prisma.PrintFileWhereInput = {
    OR: [{ ready: false }, { storagePath: "pending" }, { storagePath: { startsWith: PENDING_STORAGE_PREFIX } }],
  };
  return withStorageLock(async () => {
    const rows = await prisma.printFile.findMany({ where });
    // A file that won't go keeps its row, for the next start to try again, and the rest go on.
    const settled: string[] = [];
    for (const row of rows) {
      let file: string | null;
      try {
        file = await ownedFile(row);
      } catch (err) {
        console.warn(`Couldn't look at ${row.storagePath} at startup, so its row stays for the next:`, err);
        continue;
      }
      if (file) {
        try {
          await fs.rm(file, { force: true });
        } catch (err) {
          console.warn(`Couldn't remove ${file}, a replaced prepared print's, at startup:`, err);
          continue;
        }
        await pruneEmptyStorageDirs(path.dirname(file)).catch(() => undefined);
      }
      settled.push(row.id);
    }
    const { count } = await prisma.printFile.deleteMany({ where: { id: { in: settled } } });
    return count;
  });
}

/** The file of a row that was whole once -- its save set its size, and a hash where it took one, in the step that made
 *  it ready -- when the file at its place is still those bytes and no plate is kept there. Null for any other row,
 *  and for one whose file is gone; a look that fails throws, as that says nothing of what's there. */
async function ownedFile(row: PrintFile): Promise<string | null> {
  if (row.ready || row.size <= 0 || isPendingStoragePath(row.storagePath)) return null;
  const where = printFilePathOrNull(row);
  if (!where) return null;
  const stat = await fs.lstat(where).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return null;
    throw err;
  });
  if (!stat?.isFile() || stat.size !== row.size) return null;
  if (row.contentSha256 && (await sha256OfFile(where)) !== row.contentSha256) return null;
  if (await prisma.plate.count({ where: { storagePath: row.storagePath } })) return null;
  return where;
}

/** Drops the rows of a print's files -- supporting, prepared or LICENSE.txt -- whose files are no longer on disk, and
 *  keeps the rest. Deleting a prepared print's row empties the model's prepared slot (Print.preparedFile is SetNull).
 *  A file that can't be checked stops it with the error before any row goes (printFileOnDisk). */
export function removeMissingPrintFiles(printId: string): Promise<void> {
  // Under the storage lock, rows read inside it: a move (the model renamed meanwhile) renames a file before it saves
  // the new path, both under the lock, so a path read outside it could be one the file has just left.
  return withStorageLock(async () => {
    const rows = await prisma.printFile.findMany({ where: { printId } });
    const gone: PrintFile[] = [];
    for (const row of rows) {
      // A file still being saved isn't placed yet, which isn't the same as gone.
      if (isUnsettled(row)) continue;
      if (!(await printFileOnDisk(row))) gone.push(row);
    }
    if (!gone.length) return;
    await prisma.printFile.deleteMany({ where: { id: { in: gone.map((row) => row.id) } } });
    for (const row of gone) {
      const where = printFilePathOrNull(row);
      if (where) await pruneEmptyStorageDirs(path.dirname(where));
    }
  });
}

function printFilePathOrNull(row: Pick<PrintFile, "storagePath">): string | null {
  try {
    return managedPrintFilePath(row);
  } catch {
    // A path that leads out of storage is nothing to keep, and nothing to look for.
    return null;
  }
}

/** Takes a file's row away when its file is gone for sure, under the storage lock as the sweep reads them: never one
 *  still being saved, nor one the disk couldn't answer for. True when the row is gone, taken now or before this. */
export function removePrintFileIfGone(fileId: string): Promise<boolean> {
  return withStorageLock(async () => {
    const row = await prisma.printFile.findUnique({ where: { id: fileId } });
    if (!row) return true;
    if (isUnsettled(row)) return false;
    const onDisk = await printFileOnDisk(row).catch(() => true);
    if (onDisk) return false;
    await prisma.printFile.delete({ where: { id: row.id } });
    return true;
  }).catch(() => false);
}

/** Absent, rather than unreadable: a flaky or unmounted volume answers EIO or EACCES for a file that is there, and
 *  taking that for gone would drop its row. Those throw instead, as missingFilesService's check does. */
async function printFileOnDisk(row: Pick<PrintFile, "storagePath">): Promise<boolean> {
  const where = printFilePathOrNull(row);
  if (where === null) return false;
  return fs.access(where).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return false;
      throw err;
    },
  );
}

export async function deleteSupportingFile(userId: string, printId: string, fileId: string): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  await removeRowAndFile(async () => {
    const record = await prisma.printFile.findUnique({ where: { id: fileId } });
    if (!record || record.printId !== printId || record.role !== "SUPPORTING" || isUnsettled(record)) {
      throw new HttpError(404, "Supporting file not found");
    }
    const where = managedPrintFilePath(record);
    await prisma.printFile.delete({ where: { id: fileId } });
    return where;
  });
  return prisma.print.findUniqueOrThrow({ where: { id: printId } });
}

/** Takes a file's row away and then its file, both under the storage lock, the row read there: a move of the model's
 *  files renames one before it saves where it went, both under the lock, so a path read before it could be one the
 *  file has just left. `remove` takes the row away and says where the file is, or null when there's none to take. The
 *  folders that leaves empty go in the same turn: an upload makes its folder and links its file in one (placeUpload),
 *  and a folder taken away between the two would fail it. */
function removeRowAndFile<T extends string | null>(remove: () => Promise<T>): Promise<T> {
  return withStorageLock(async () => {
    const where = await remove();
    if (where) {
      await fs.rm(where, { force: true }).catch(() => undefined);
      await pruneEmptyStorageDirs(path.dirname(where));
    }
    return where;
  });
}

/** A prepared print another has just replaced, its file and then its row, both under the storage lock, the row read
 *  there. Best-effort: the save that replaced it stands, and a file that won't go keeps its row, unfinished since the
 *  replacing save and listed by nothing, for the clean-up at startup to try again. */
async function removeReplacedPrint(fileId: string): Promise<void> {
  try {
    await withStorageLock(async () => {
      const row = await prisma.printFile.findUnique({ where: { id: fileId } });
      if (!row) return;
      const at = printFilePathOrNull(row);
      if (at) await fs.rm(at, { force: true });
      await prisma.printFile.delete({ where: { id: fileId } });
      if (at) await pruneEmptyStorageDirs(path.dirname(at)).catch(() => undefined);
    });
  } catch (err) {
    console.warn(`Couldn't remove the prepared print ${fileId} that another replaced:`, err);
  }
}

export async function deleteAllPrintFiles(printId: string): Promise<void> {
  const rows = await prisma.printFile.findMany({ where: { printId } });
  const paths = rows.map((r) => managedPrintFilePath(r));
  // Print.preparedFileId FK will already be gone via cascade delete of the Print row itself,
  // but this helper runs against a still-live print (e.g. before a full print delete elsewhere).
  await prisma.printFile.deleteMany({ where: { printId } });
  for (const p of paths) {
    await fs.rm(p, { force: true }).catch(() => undefined);
    await pruneEmptyStorageDirs(path.dirname(p));
  }
}

/** Removes the model's prepared print; `fileId`, only while it's that file, as for undoing a save of one that another
 *  upload may have replaced since. The slot is read again with the model's row locked, as a save of a prepared print
 *  locks it: one that replaced this print meanwhile stays the model's, and this one, on its way out, goes all the same. */
export async function deletePreparedFile(userId: string, printId: string, fileId?: string): Promise<Print> {
  await removeRowAndFile(async () => {
    const print = await prisma.print.findFirst({ where: { id: printId, userId } });
    if (!print || !print.preparedFileId || (fileId && print.preparedFileId !== fileId)) {
      throw new HttpError(404, "No prepared print file");
    }
    const record = await prisma.printFile.findUnique({ where: { id: print.preparedFileId } });
    if (!record || record.printId !== printId || record.role !== "PREPARED") {
      throw new HttpError(404, "No prepared print file");
    }
    const where = managedPrintFilePath(record);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Print" WHERE id = ${printId} FOR UPDATE`;
      const now = await tx.print.findUnique({ where: { id: printId }, select: { preparedFileId: true } });
      if (fileId && now?.preparedFileId !== fileId) throw new HttpError(404, "No prepared print file");
      if (now?.preparedFileId === record.id) {
        await tx.print.update({ where: { id: printId }, data: { preparedFileId: null } });
      }
      await tx.printFile.delete({ where: { id: record.id } });
    });
    return where;
  });
  return prisma.print.findUniqueOrThrow({ where: { id: printId } });
}
