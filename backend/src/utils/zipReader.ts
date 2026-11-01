import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export type ZipEntryInfo = { name: string; size: number; isDirectory: boolean };

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err || !zipfile) return reject(err || new Error("Failed to open zip"));
      resolve(zipfile);
    });
  });
}

export async function listZipEntries(filePath: string): Promise<ZipEntryInfo[]> {
  const zipfile = await openZip(filePath);
  return new Promise((resolve, reject) => {
    const entries: ZipEntryInfo[] = [];
    zipfile.on("entry", (entry) => {
      const isDirectory = entry.fileName.endsWith("/");
      entries.push({ name: entry.fileName, size: entry.uncompressedSize, isDirectory });
      zipfile.readEntry();
    });
    zipfile.on("end", () => {
      zipfile.close();
      resolve(entries);
    });
    zipfile.on("error", (err) => {
      zipfile.close();
      reject(err);
    });
    zipfile.readEntry();
  });
}

/**
 * Null if the entry is missing, a directory, or over maxBytes. For small metadata files only.
 */
export async function readZipEntry(filePath: string, entryName: string, maxBytes: number): Promise<Buffer | null> {
  const zipfile = await openZip(filePath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: Buffer | null, err?: Error) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      if (err) reject(err);
      else resolve(value);
    };
    zipfile.on("entry", (entry) => {
      if (entry.fileName !== entryName || entry.fileName.endsWith("/")) {
        zipfile.readEntry();
        return;
      }
      if (entry.uncompressedSize > maxBytes) {
        finish(null);
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          finish(null, err ?? undefined);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            stream.destroy();
            finish(null);
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => finish(Buffer.concat(chunks)));
        stream.on("error", (streamErr) => finish(null, streamErr));
      });
    });
    zipfile.on("end", () => finish(null));
    zipfile.on("error", (err) => finish(null, err));
    zipfile.readEntry();
  });
}

/**
 * The first maxBytes of an entry, for files whose interesting part is at the start and whose total size doesn't
 * matter. Null if the entry is missing or a directory.
 */
export async function readZipEntryPrefix(
  filePath: string,
  entryName: string,
  maxBytes: number,
): Promise<Buffer | null> {
  const zipfile = await openZip(filePath);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: Buffer | null, err?: Error) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      if (err) reject(err);
      else resolve(value);
    };
    zipfile.on("entry", (entry) => {
      if (entry.fileName !== entryName || entry.fileName.endsWith("/")) {
        zipfile.readEntry();
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          finish(null, err ?? undefined);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= maxBytes) {
            stream.destroy();
            finish(Buffer.concat(chunks).subarray(0, maxBytes));
          }
        });
        stream.on("end", () => finish(Buffer.concat(chunks)));
        stream.on("error", (streamErr) => finish(null, streamErr));
      });
    });
    zipfile.on("end", () => finish(null));
    zipfile.on("error", (err) => finish(null, err));
    zipfile.readEntry();
  });
}

/** An entry whose bytes run past the cap -- including one whose own directory entry understated its size. */
class EntryOverCapError extends Error {}

/**
 * Writes one entry straight to destPath, holding none of it in memory, for the files too big to read the way
 * readZipEntry does. The bytes written, or null -- with no file left behind -- if the entry is missing, a directory,
 * or over maxBytes.
 */
export async function extractZipEntryToFile(
  filePath: string,
  entryName: string,
  destPath: string,
  maxBytes: number,
): Promise<number | null> {
  const zipfile = await openZip(filePath);
  let written: number | null = null;
  try {
    written = await new Promise<number | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: number | null, err?: Error) => {
        if (settled) return;
        settled = true;
        zipfile.close();
        if (err) reject(err);
        else resolve(value);
      };
      zipfile.on("entry", (entry) => {
        if (entry.fileName !== entryName || entry.fileName.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        if (entry.uncompressedSize > maxBytes) {
          finish(null);
          return;
        }
        zipfile.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            finish(null, err ?? undefined);
            return;
          }
          let total = 0;
          const capped = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              total += chunk.length;
              done(total > maxBytes ? new EntryOverCapError() : null, chunk);
            },
          });
          pipeline(stream, capped, createWriteStream(destPath)).then(
            () => finish(total),
            (pipeErr: Error) => finish(null, pipeErr instanceof EntryOverCapError ? undefined : pipeErr),
          );
        });
      });
      zipfile.on("end", () => finish(null));
      zipfile.on("error", (err) => finish(null, err));
      zipfile.readEntry();
    });
  } finally {
    if (written === null) await fs.rm(destPath, { force: true }).catch(() => undefined);
  }
  return written;
}

/**
 * Streams entries in one pass. `onEntry` must consume or destroy the stream before returning.
 */
export async function walkZipEntries(
  filePath: string,
  shouldExtract: (entry: ZipEntryInfo) => boolean,
  onEntry: (entry: ZipEntryInfo, stream: NodeJS.ReadableStream) => Promise<void>,
): Promise<void> {
  const zipfile = await openZip(filePath);
  await new Promise<void>((resolve, reject) => {
    zipfile.on("entry", (entry) => {
      const isDirectory = entry.fileName.endsWith("/");
      const info: ZipEntryInfo = { name: entry.fileName, size: entry.uncompressedSize, isDirectory };
      if (isDirectory || !shouldExtract(info)) {
        zipfile.readEntry();
        return;
      }
      zipfile.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          zipfile.readEntry();
          return;
        }
        onEntry(info, stream)
          .catch(() => undefined)
          .finally(() => zipfile.readEntry());
      });
    });
    zipfile.on("end", () => {
      zipfile.close();
      resolve();
    });
    zipfile.on("error", (err) => {
      zipfile.close();
      reject(err);
    });
    zipfile.readEntry();
  });
}
