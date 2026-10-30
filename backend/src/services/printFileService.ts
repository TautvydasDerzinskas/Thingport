import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { STORAGE, IMPORT_MAX_BYTES, PARAMETRIC_SOURCE_EXTS } from "../config";
import { withStorageLock } from "../utils/storageLock";
import { HttpError, sanitizeFilename, mimeFromContentType } from "../utils/fileUtils";
import { isPreparedPrintFilename, inspectPreparedPrint } from "./preparedPrint";
import { pruneEmptyStorageDirs, renderPrintFileStoragePath } from "./printService";
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
 * from the filename (a .3mf containing gcode becomes PREPARED); a new PREPARED file replaces the existing one.
 */
export async function saveFileFromTemp(
  userId: string,
  printId: string,
  tempPath: string,
  originalFilename: string,
  contentType: string | null | undefined,
): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");

  const safeName = sanitizeFilename(originalFilename || "supporting-file");
  let role: "SUPPORTING" | "PREPARED" = isPreparedPrintFilename(safeName) ? "PREPARED" : "SUPPORTING";
  const mime = mimeFromContentType(contentType, safeName);

  const record = await prisma.printFile.create({
    data: {
      printId: print.id,
      filename: safeName,
      mime,
      role,
      storagePath: "pending",
    },
  });
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
    const storagePath = await renderPrintFileStoragePath(print, safeName);
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
    if (metadata) role = "PREPARED";

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
    return updatedPrint;
  } catch (err) {
    // Only once it's ours: a 409 above means the file there is another one's.
    if (destination && !(err instanceof HttpError && err.status === 409)) {
      await fs.rm(destination, { force: true }).catch(() => undefined);
      await pruneEmptyStorageDirs(path.dirname(destination));
    }
    await prisma.printFile.delete({ where: { id: record.id } }).catch(() => undefined);
    throw err;
  }
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
