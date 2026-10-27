// A 3MF is a ZIP. This reads and writes them with the browser's own deflate (CompressionStream), in place of a ZIP
// library, and offers the part of JSZip's interface sanitizer.js uses: MiniZip.loadAsync(bytes), new MiniZip(),
// zip.file(name, data), zip.file(name), zip.files and zip.generateAsync({ type: "uint8array" }).

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Runs bytes through a compression or decompression stream. */
async function through(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === "string") return utf8.encode(input);
  throw new Error("A ZIP entry takes text or bytes");
}

/** One file in the archive: read from a loaded one (compressed until asked for) or added with file(). */
class ZipEntry {
  constructor(name, source) {
    this.name = name;
    this.dir = name.endsWith("/");
    this._source = source;
    this._bytes = null;
  }

  async _data() {
    if (!this._bytes) this._bytes = await this._source();
    return this._bytes;
  }

  async async(type) {
    const bytes = await this._data();
    if (type === "string" || type === "text") return fromUtf8.decode(bytes);
    if (type === "uint8array") return bytes;
    if (type === "arraybuffer") return bytes.slice().buffer;
    throw new Error(`Can't read a ZIP entry as ${type}`);
  }
}

export class MiniZip {
  constructor() {
    this.files = {};
  }

  /** file(name) is the entry of that name, or null; file(name, data) adds or replaces one. */
  file(name, data) {
    if (data === undefined) return this.files[name] ?? null;
    const bytes = toBytes(data);
    this.files[name] = new ZipEntry(name, async () => bytes);
    return this;
  }

  static async loadAsync(input) {
    const bytes = toBytes(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const zip = new MiniZip();

    // The end record sits in the last 64 KB (its comment is at most that long).
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === END) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error("This isn't a 3MF: it's not a ZIP archive.");
    let count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    // ZIP64, for archives with more files or bytes than the plain format holds.
    if ((count === 0xffff || offset === 0xffffffff) && end >= 20 && view.getUint32(end - 20, true) === END64_LOCATOR) {
      const at = Number(view.getBigUint64(end - 12, true));
      if (view.getUint32(at, true) !== END64) throw new Error("The 3MF's ZIP64 directory is damaged.");
      count = Number(view.getBigUint64(at + 32, true));
      offset = Number(view.getBigUint64(at + 48, true));
    }

    for (let n = 0; n < count; n++) {
      if (view.getUint32(offset, true) !== CENTRAL) throw new Error("The 3MF's ZIP directory is damaged.");
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      let compressed = view.getUint32(offset + 20, true);
      let size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      let local = view.getUint32(offset + 42, true);
      const name = fromUtf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      // The ZIP64 extra field carries whichever of the sizes and offset didn't fit, in that order.
      let extra = offset + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = view.getUint16(extra, true);
        const length = view.getUint16(extra + 2, true);
        if (id === 0x0001) {
          let at = extra + 4;
          const big = () => {
            const value = Number(view.getBigUint64(at, true));
            at += 8;
            return value;
          };
          if (size === 0xffffffff) size = big();
          if (compressed === 0xffffffff) compressed = big();
          if (local === 0xffffffff) local = big();
        }
        extra += 4 + length;
      }
      offset = extraEnd + commentLength;

      if (flags & 1) throw new Error(`${name} in the 3MF is encrypted.`);
      if (method !== 0 && method !== 8) throw new Error(`${name} in the 3MF is packed in a way this can't read.`);
      zip.files[name] = new ZipEntry(name, async () => {
        if (view.getUint32(local, true) !== LOCAL) throw new Error(`${name} in the 3MF is damaged.`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const data = bytes.subarray(start, start + compressed);
        const out = method === 8 ? await through(data, new DecompressionStream("deflate-raw")) : data.slice();
        if (out.length !== size) throw new Error(`${name} in the 3MF is damaged.`);
        return out;
      });
    }
    return zip;
  }

  /** The archive, deflated where that makes a file smaller. */
  async generateAsync({ type = "uint8array" } = {}) {
    if (type !== "uint8array") throw new Error("MiniZip writes Uint8Arrays only");
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const entry of Object.values(this.files)) {
      if (entry.dir) continue;
      const data = await entry._data();
      const name = utf8.encode(entry.name);
      const crc = crc32(data);
      let method = 8;
      let packed = await through(data, new CompressionStream("deflate-raw"));
      if (packed.length >= data.length) {
        method = 0;
        packed = data;
      }
      if (offset + packed.length > 0xfffffff0) throw new Error("The 3MF would be over 4 GB, more than this writes.");
      const header = new DataView(new ArrayBuffer(30));
      header.setUint32(0, LOCAL, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 0x0800, true); // UTF-8 names
      header.setUint16(8, method, true);
      header.setUint16(10, time, true);
      header.setUint16(12, date, true);
      header.setUint32(14, crc, true);
      header.setUint32(18, packed.length, true);
      header.setUint32(22, data.length, true);
      header.setUint16(26, name.length, true);
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, CENTRAL, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      for (let i = 6; i < 26; i++) record.setUint8(i + 2, header.getUint8(i));
      record.setUint16(28, name.length, true);
      record.setUint32(42, offset, true);
      chunks.push(new Uint8Array(header.buffer), name, packed);
      central.push(new Uint8Array(record.buffer), name);
      offset += 30 + name.length + packed.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    const count = central.length / 2;
    end.setUint32(0, END, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}
