import fs from "node:fs/promises";
import path from "node:path";
import { PARAMETRIC_SOURCE_EXTS } from "../config";

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
export async function normalizeGeneratorScript(tempPath: string, filename: string): Promise<void> {
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
