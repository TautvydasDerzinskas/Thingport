import fs from "node:fs/promises";

// QIDI Maker's zip of a model's files is written as a stream that, for most models published since August 2026, never
// got to its end: every entry is there, each followed by the data descriptor that gives its size, but not the central
// directory a zip reader starts from, so nothing opens it -- the site's own Download STL/CAD gives the same file. The
// entries' own headers say all the directory would, so it's rebuilt from them and put back at the end.

const LOCAL = 0x04034b50;
const DESCRIPTOR = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const LOCAL_SIZE = 30;
const DESCRIPTOR_SIZE = 16;
// What may come right after an entry's descriptor: the next entry, the directory, or its end record.
const FOLLOWERS = [LOCAL, CENTRAL, END].map((signature) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(signature);
  return bytes;
});
// Bit 3: the sizes and CRC come after the data, in a data descriptor.
const SIZES_AFTER = 0x08;
const CHUNK = 1 << 20;
// The end record is 22 bytes, with a comment of up to 65535 after it.
const END_SEARCH = 22 + 0xffff;

type Entry = {
  offset: number;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  name: Buffer;
};

async function readAt(file: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** Whether the file ends with the record a zip reader starts from. */
async function hasEndRecord(file: fs.FileHandle, size: number): Promise<boolean> {
  const length = Math.min(size, END_SEARCH);
  const tail = await readAt(file, size - length, length);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tail.readUInt32LE(at) === END && at + 22 + tail.readUInt16LE(at + 20) === tail.length) return true;
  }
  return false;
}

/** Whether `next`, the four bytes after a descriptor or what's left of the file there, is one of FOLLOWERS, or all of
 *  one a zip cut off there kept. Nothing at all is the file's end. */
const followsRight = (next: Buffer) => FOLLOWERS.some((signature) => signature.subarray(0, next.length).equals(next));

/** Where the descriptor after an entry's data starts: one whose compressed size is the distance from `dataStart`, and
 *  that the next entry, the directory or the file's end follows, as a stored file's own bytes that only look like one
 *  aren't. Null when there's none, and the entry is dropped rather than cut short. */
async function findDescriptor(file: fs.FileHandle, dataStart: number, size: number): Promise<number | null> {
  for (let from = dataStart; from < size; from += CHUNK) {
    // The chunks overlap by a descriptor and the signature after it, so both are read whole across their edge.
    const chunk = await readAt(file, from, CHUNK + DESCRIPTOR_SIZE + 4);
    const end = Math.min(chunk.length - DESCRIPTOR_SIZE, CHUNK - 1);
    for (let at = chunk.indexOf(DESCRIPTOR); at !== -1 && at <= end; at = chunk.indexOf(DESCRIPTOR, at + 1)) {
      const position = from + at;
      const next = chunk.subarray(at + DESCRIPTOR_SIZE, at + DESCRIPTOR_SIZE + 4);
      if (chunk.readUInt32LE(at + 8) === position - dataStart && followsRight(next)) return position;
    }
  }
  return null;
}

/** Every entry, by its local header, up to the first thing that isn't one; and where the last one ends. */
async function readEntries(file: fs.FileHandle, size: number): Promise<{ entries: Entry[]; end: number }> {
  const entries: Entry[] = [];
  let at = 0;
  while (at + LOCAL_SIZE <= size) {
    const header = await readAt(file, at, LOCAL_SIZE);
    if (header.readUInt32LE(0) !== LOCAL) break;
    const flags = header.readUInt16LE(6);
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataStart = at + LOCAL_SIZE + nameLength + extraLength;
    if (dataStart > size) break;
    let crc = header.readUInt32LE(14);
    let compressedSize = header.readUInt32LE(18);
    let entrySize = header.readUInt32LE(22);
    let next = dataStart + compressedSize;
    if (flags & SIZES_AFTER) {
      const descriptor = await findDescriptor(file, dataStart, size);
      if (descriptor === null) break;
      const fields = await readAt(file, descriptor, DESCRIPTOR_SIZE);
      crc = fields.readUInt32LE(4);
      compressedSize = fields.readUInt32LE(8);
      entrySize = fields.readUInt32LE(12);
      next = descriptor + DESCRIPTOR_SIZE;
    }
    if (next > size) break;
    entries.push({
      offset: at,
      versionNeeded: header.readUInt16LE(4),
      flags,
      method: header.readUInt16LE(8),
      time: header.readUInt16LE(10),
      date: header.readUInt16LE(12),
      crc,
      compressedSize,
      size: entrySize,
      name: await readAt(file, at + LOCAL_SIZE, nameLength),
    });
    at = next;
  }
  return { entries, end: at };
}

function centralDirectory(entries: Entry[], offset: number): Buffer {
  const records = entries.map((entry) => {
    const record = Buffer.alloc(46 + entry.name.length);
    record.writeUInt32LE(CENTRAL, 0);
    record.writeUInt16LE(20, 4); // made by: MS-DOS, version 2.0
    record.writeUInt16LE(entry.versionNeeded, 6);
    record.writeUInt16LE(entry.flags, 8);
    record.writeUInt16LE(entry.method, 10);
    record.writeUInt16LE(entry.time, 12);
    record.writeUInt16LE(entry.date, 14);
    record.writeUInt32LE(entry.crc, 16);
    record.writeUInt32LE(entry.compressedSize, 20);
    record.writeUInt32LE(entry.size, 24);
    record.writeUInt16LE(entry.name.length, 28);
    // Extra field, comment, disk, attributes: none.
    record.writeUInt32LE(entry.offset, 42);
    entry.name.copy(record, 46);
    return record;
  });
  const directory = Buffer.concat(records);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([directory, end]);
}

/** Puts back the central directory of a zip that lost it, in place. A zip that has one is left as it is. Returns
 *  whether it changed the file; throws where it isn't a zip at all, or one too big for a plain directory. */
export async function repairZipDirectory(filePath: string): Promise<boolean> {
  const file = await fs.open(filePath, "r+");
  try {
    const { size } = await file.stat();
    if (await hasEndRecord(file, size)) return false;
    const { entries, end } = await readEntries(file, size);
    if (!entries.length) throw new Error("Not a zip: no entry in it can be read");
    if (entries.length > 0xffff || end > 0xffffffff) throw new Error("Too big a zip to repair");
    // Whatever follows the last whole entry is a partial one, or a directory cut short.
    await file.truncate(end);
    await file.write(centralDirectory(entries, end), 0, undefined, end);
    return true;
  } finally {
    await file.close();
  }
}
