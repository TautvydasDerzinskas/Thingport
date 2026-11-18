import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE, IMPORT_MAX_BYTES, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { isPendingStoragePath, PENDING_STORAGE_PREFIX, savesUnderWay } from "./printFileSaves";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { normalizeFolder } from "../utils/fileFolder";
import { isPreparedPrintFilename, inspectPreparedPrint } from "./preparedPrint";
import { pruneEmptyStorageDirs, relocatePrint, renderPrintFileStoragePath } from "./printService";
import { reuseMarker, shareStoredCopy } from "./fileReuse";
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
  return prisma.printFile.findMany({
    where: { printId, role: "SUPPORTING" },
    orderBy: [{ filename: "asc" }, { id: "asc" }],
  });
}

/** Never over another file: a link fails on one that's there, where a rename would replace it. Only the placing is
 *  under the storage lock (the file reuse backfill's swap renames over a path it has just checked, and mustn't land
 *  after a file saved at a path its row just freed); removing the temp file is not. */
async function placeUpload(tempPath: string, destination: string): Promise<void> {
  await withStorageLock(() => linkOrCopy(tempPath, destination));
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
    },
  });
  savesUnderWay.add(record.id);
  let destination: string | null = null;

  try {
    // Before normalisation, not after: an oversized upload is refused without anything reading through it.
    if ((await fs.stat(tempPath)).size > IMPORT_MAX_BYTES) {
      throw new HttpError(413, "Related file exceeds size limit");
    }
    await normalizeGeneratorScript(tempPath, safeName);
    // Again, since dropping each CRLF's CR leaves the file shorter than it arrived.
    const stat = await fs.stat(tempPath);
    // Claimed in the database first, so two uploads of one name can't both pick the same place.
    const storagePath = await renderPrintFileStoragePath(print, safeName, folder);
    await prisma.printFile.update({ where: { id: record.id }, data: { storagePath } });
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

    let oldPreparedPath: string | null = null;
    let oldPreparedId: string | null = null;
    const updatedPrint = await prisma.$transaction(async (tx) => {
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
        },
      });
      if (role === "PREPARED") {
        if (currentPrint.preparedFileId && currentPrint.preparedFileId !== record.id) {
          const old = await tx.printFile.findUnique({ where: { id: currentPrint.preparedFileId } });
          if (old) {
            oldPreparedPath = managedPrintFilePath(old);
            oldPreparedId = old.id;
          }
        }
        await tx.print.update({ where: { id: printId }, data: { preparedFileId: record.id } });
        if (oldPreparedId) {
          await tx.printFile.delete({ where: { id: oldPreparedId } });
        }
      }
      return tx.print.findUniqueOrThrow({ where: { id: printId } });
    });

    if (oldPreparedPath) {
      await fs.rm(oldPreparedPath, { force: true }).catch(() => undefined);
      await pruneEmptyStorageDirs(path.dirname(oldPreparedPath));
    }
    onStored?.(role, record.id);
    return updatedPrint;
  } catch (err) {
    // Only once it's ours: a 409 above means the file there is another one's.
    if (destination && !(err instanceof HttpError && err.status === 409)) {
      await fs.rm(destination, { force: true }).catch(() => undefined);
      await pruneEmptyStorageDirs(path.dirname(destination));
    }
    await prisma.printFile.delete({ where: { id: record.id } }).catch(() => undefined);
    throw err;
  } finally {
    savesUnderWay.delete(record.id);
  }
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
  if (savesUnderWay.has(record.id)) throw new HttpError(409, "That file is still being saved: try again once it's in");
  // Before sanitising, which turns nothing into "imported-file": that would quietly become the file's name.
  const trimmed = filename.trim();
  if (!trimmed) throw new HttpError(400, "A file needs a name");
  let wanted = sanitizeFilename(trimmed);
  if (!path.extname(wanted)) wanted += path.extname(record.filename);
  if (wanted === record.filename) return;

  // The names in use read and the new one taken under the lock, so two renames at once can't both take one name: the
  // table doesn't stop two of a folder's files sharing it.
  await withStorageLock(async () => {
    const taken = new Set(
      (
        await prisma.printFile.findMany({
          where: { printId, role: "SUPPORTING", folder: record.folder, id: { not: record.id } },
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

/** Deletes the rows that saves left at their placeholder when the last process ended before placing their files: there
 *  is no file to keep, and each would show as one that isn't there. At startup, before this process saves anything. */
export async function removeAbandonedPrintFileSaves(): Promise<number> {
  const { count } = await prisma.printFile.deleteMany({
    where: { OR: [{ storagePath: "pending" }, { storagePath: { startsWith: PENDING_STORAGE_PREFIX } }] },
  });
  return count;
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
      if (isPendingStoragePath(row.storagePath) || savesUnderWay.has(row.id)) continue;
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
  const record = await prisma.printFile.findUnique({ where: { id: fileId } });
  if (!record || record.printId !== printId || record.role !== "SUPPORTING") {
    throw new HttpError(404, "Supporting file not found");
  }
  const filePath = managedPrintFilePath(record);
  await prisma.printFile.delete({ where: { id: fileId } });
  await fs.rm(filePath, { force: true }).catch(() => undefined);
  await pruneEmptyStorageDirs(path.dirname(filePath));
  return prisma.print.findUniqueOrThrow({ where: { id: printId } });
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

export async function deletePreparedFile(userId: string, printId: string): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print || !print.preparedFileId) throw new HttpError(404, "No prepared print file");
  const record = await prisma.printFile.findUnique({ where: { id: print.preparedFileId } });
  if (!record || record.printId !== printId || record.role !== "PREPARED") {
    throw new HttpError(404, "No prepared print file");
  }
  const filePath = managedPrintFilePath(record);
  await prisma.$transaction([
    prisma.print.update({ where: { id: printId }, data: { preparedFileId: null } }),
    prisma.printFile.delete({ where: { id: record.id } }),
  ]);
  await fs.rm(filePath, { force: true }).catch(() => undefined);
  await pruneEmptyStorageDirs(path.dirname(filePath));
  return prisma.print.findUniqueOrThrow({ where: { id: printId } });
}
