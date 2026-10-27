// A 3MF is a ZIP. This reads one with the browser's own inflate (DecompressionStream), so nothing is loaded at run
// time; it only reads, as the tool never writes a 3MF. The entries are listed from the central directory and each
// one's bytes are inflated when it's asked for, so a 200 MB sliced project costs nothing until a part of it is read.

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;

const fromUtf8 = new TextDecoder();

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error("A ZIP is read from bytes");
}

/** The archive's entries by name, each `{ name, size, bytes(), text() }`. */
export async function readZip(input) {
  const bytes = toBytes(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record sits in the last 64 KB, after a comment at most that long.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This isn't a 3MF: it isn't a ZIP archive.");
  let count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  // ZIP64, for an archive with more files or bytes than the plain format holds.
  if ((count === 0xffff || offset === 0xffffffff) && end >= 20 && view.getUint32(end - 20, true) === END64_LOCATOR) {
    const at = Number(view.getBigUint64(end - 12, true));
    if (view.getUint32(at, true) !== END64) throw new Error("The 3MF's ZIP64 directory is damaged.");
    count = Number(view.getBigUint64(at + 32, true));
    offset = Number(view.getBigUint64(at + 48, true));
  }

  const entries = new Map();
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
    // The ZIP64 extra field carries whichever of the sizes and the offset didn't fit, in that order.
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
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error(`${name} in the 3MF is encrypted.`);
    if (method !== 0 && method !== 8) throw new Error(`${name} in the 3MF is packed in a way this can't read.`);

    let inflated = null;
    const read = async () => {
      if (inflated) return inflated;
      if (view.getUint32(local, true) !== LOCAL) throw new Error(`${name} in the 3MF is damaged.`);
      // The local header repeats the name and extra field, whose lengths may differ from the directory's.
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + compressed);
      if (method === 0) inflated = data;
      else {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (inflated.length !== size) throw new Error(`${name} in the 3MF is damaged.`);
      return inflated;
    };
    entries.set(name, {
      name,
      size,
      bytes: read,
      text: async () => fromUtf8.decode(await read()),
    });
  }
  return entries;
}
