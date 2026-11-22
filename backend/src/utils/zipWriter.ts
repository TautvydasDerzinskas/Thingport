import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { isMissingError, openStored, type StorageSite } from "../modelFiles/storageFs";

// Minimal streaming ZIP writer on node:zlib; yauzl is read-only.

// Bit 3: the CRC and sizes follow the data, in a descriptor. Bit 11: names are UTF-8. Without it readers
// decode names as CP437 (yauzl, Python) or Latin-1 (fflate), garbling any non-ASCII model, category or
// file name.
const ENTRY_FLAGS = 0x0808;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Update(crc: number, buf: Buffer): number {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dateVal =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dateVal };
}

/** A model's file in storage, written from the handle the file door opened (Fs 2): left out when nothing is there by
 *  then or `stillNames` says its row, read again, no longer names it. */
export type StoredZipEntry = {
  arcname: string;
  filePath: string;
  site: StorageSite;
  stillNames: () => Promise<boolean>;
};

/** A model's file in storage, any other file on disk, or bytes made for the zip (a model's LICENSE.txt). */
export type ZipEntryDescriptor =
  StoredZipEntry | { arcname: string; filePath: string } | { arcname: string; content: Buffer; mtime?: Date };

/** The most entries a zip from writeZip holds. 0xFFFF there, like 0xFFFFFFFF in a size or an offset, tells a reader
 *  to look in a ZIP64 record, which this writer doesn't make. */
export const ZIP_MAX_ENTRIES = 0xfffe;
const ZIP_MAX_FIELD = 0xfffffffe;

/** At the most, where writeZip's central directory starts (after each entry's header, name, data and descriptor) and
 *  how long it is. Data that doesn't compress comes out of deflate bigger, by less than allowed here: zlib's
 *  deflateBound says under 0.04% and 7 bytes, with its default settings. A file that's gone counts as empty, since
 *  writeZip leaves it out. */
export function zipExtent(entries: ZipEntryDescriptor[]): { data: number; central: number } {
  let data = 0;
  let central = 0;
  for (const entry of entries) {
    const size =
      "content" in entry ? entry.content.length : (fs.statSync(entry.filePath, { throwIfNoEntry: false })?.size ?? 0);
    const name = Buffer.byteLength(entry.arcname.replace(/\\/g, "/"), "utf-8");
    data += 30 + name + size + Math.ceil(size / 1024) + 64 + 16;
    central += 46 + name;
  }
  return { data, central };
}

/** Whether writeZip can write these without ZIP64: how many, and every offset and size under its 32 bits. */
export function zipFits(entries: ZipEntryDescriptor[]): boolean {
  if (entries.length > ZIP_MAX_ENTRIES) return false;
  const { data, central } = zipExtent(entries);
  return data <= ZIP_MAX_FIELD && central <= ZIP_MAX_FIELD;
}

type CentralRecord = {
  nameBuf: Buffer;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  time: number;
  date: number;
};

/** Where an entry's bytes come from: its time, its bytes, and what to close once they're written. */
type EntrySource = { mtime: Date; read: () => Readable; close: () => Promise<void> };

const nothingToClose = async () => undefined;

/** An entry's source, or null to leave it out: a file that's gone by now (only ENOENT and ENOTDIR say so), or a
 *  stored one that isn't a regular file or whose row no longer names it. Any other error fails the zip, rather than
 *  leave a file out of it unsaid. */
async function sourceOf(entry: ZipEntryDescriptor): Promise<EntrySource | null> {
  if ("content" in entry) {
    return { mtime: entry.mtime ?? new Date(), read: () => Readable.from([entry.content]), close: nothingToClose };
  }
  if ("site" in entry) {
    const opened = await openStored(entry.filePath, entry.site);
    if (!opened) return null;
    let named = false;
    try {
      named = await entry.stillNames();
    } finally {
      if (!named) await opened.handle.close();
    }
    if (!named) return null;
    return {
      mtime: new Date(Number(BigInt(opened.mtimeNs) / 1_000_000n)),
      // From the handle, from its start: the file that was opened, whatever is at its path by now.
      read: () => opened.handle.createReadStream({ start: 0, autoClose: false }),
      close: () => opened.handle.close(),
    };
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(entry.filePath);
  } catch (err) {
    if (isMissingError(err)) return null;
    throw err;
  }
  return { mtime: stat.mtime, read: () => fs.createReadStream(entry.filePath), close: nothingToClose };
}

/** Leaves out entries whose file is gone; any other error reading one fails the whole zip. */
export async function writeZip(destPath: string, entries: ZipEntryDescriptor[]): Promise<void> {
  const out = fs.createWriteStream(destPath);
  let offset = 0;
  const write = (buf: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      out.write(buf, (err) => (err ? reject(err) : resolve()));
      offset += buf.length;
    });

  const records: CentralRecord[] = [];
  // The entry being written, closed once it's in or the zip fails.
  let writing: EntrySource | null = null;

  try {
    for (const entry of entries) {
      const source = await sourceOf(entry);
      if (!source) continue;
      writing = source;
      const nameBuf = Buffer.from(entry.arcname.replace(/\\/g, "/"), "utf-8");
      const { time, date } = dosDateTime(source.mtime);
      const localHeaderOffset = offset;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); // version needed
      localHeader.writeUInt16LE(ENTRY_FLAGS, 6); // flags
      localHeader.writeUInt16LE(8, 8); // method: deflate
      localHeader.writeUInt16LE(time, 10);
      localHeader.writeUInt16LE(date, 12);
      localHeader.writeUInt32LE(0, 14); // crc (in descriptor)
      localHeader.writeUInt32LE(0, 18); // compressed size (in descriptor)
      localHeader.writeUInt32LE(0, 22); // uncompressed size (in descriptor)
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      await write(localHeader);
      await write(nameBuf);

      let crc = 0;
      let uncompressedSize = 0;
      let compressedSize = 0;

      await new Promise<void>((resolve, reject) => {
        const readStream = source.read();
        const deflate = zlib.createDeflateRaw();
        readStream.on("data", (raw: string | Buffer) => {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          crc = crc32Update(crc, chunk);
          uncompressedSize += chunk.length;
        });
        readStream.on("error", reject);
        deflate.on("data", (raw: string | Buffer) => {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          compressedSize += chunk.length;
          offset += chunk.length;
          if (!out.write(chunk)) {
            deflate.pause();
            out.once("drain", () => deflate.resume());
          }
        });
        deflate.on("error", reject);
        deflate.on("end", resolve);
        readStream.pipe(deflate);
      });

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressedSize, 8);
      descriptor.writeUInt32LE(uncompressedSize, 12);
      await write(descriptor);

      records.push({ nameBuf, crc, compressedSize, uncompressedSize, localHeaderOffset, time, date });
      writing = null;
      await source.close();
    }

    const cdStart = offset;
    for (const rec of records) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4); // version made by
      central.writeUInt16LE(20, 6); // version needed
      central.writeUInt16LE(ENTRY_FLAGS, 8); // flags
      central.writeUInt16LE(8, 10); // method
      central.writeUInt16LE(rec.time, 12);
      central.writeUInt16LE(rec.date, 14);
      central.writeUInt32LE(rec.crc, 16);
      central.writeUInt32LE(rec.compressedSize, 20);
      central.writeUInt32LE(rec.uncompressedSize, 24);
      central.writeUInt16LE(rec.nameBuf.length, 28);
      central.writeUInt16LE(0, 30); // extra length
      central.writeUInt16LE(0, 32); // comment length
      central.writeUInt16LE(0, 34); // disk number start
      central.writeUInt16LE(0, 36); // internal attrs
      central.writeUInt32LE(0, 38); // external attrs
      central.writeUInt32LE(rec.localHeaderOffset, 42);
      await write(central);
      await write(rec.nameBuf);
    }
    const cdSize = offset - cdStart;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(records.length, 8);
    eocd.writeUInt16LE(records.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await write(eocd);

    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  } catch (err) {
    await writing?.close().catch(() => undefined);
    // Closed before the caller removes the file: an open still under way would make it again after the removal.
    if (!out.closed) await new Promise<void>((resolve) => out.once("close", () => resolve()).destroy());
    throw err;
  }
}
