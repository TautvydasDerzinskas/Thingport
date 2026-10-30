// The QR code itself: the symbol, worked out here rather than fetched from anywhere.
//
// It follows ISO/IEC 18004: the text is split into the fewest bits the data allows (digits, the 45-character
// alphanumeric set, or bytes as UTF-8), padded, cut into blocks, given its Reed-Solomon check codewords, laid
// into the grid around the finder, timing and alignment patterns, and masked with whichever of the eight masks
// scores best. Everything a printed code needs is here: nothing is fetched and nothing is guessed.
//
// The only tables that can't be derived are the error-correction ones from the standard: how many check
// codewords a block carries, and how many blocks a symbol has. The rest — how many codewords a version holds,
// where the alignment patterns sit, the format and version bits — is worked out from the version.

/** The four levels, with roughly how much damage each survives. */
export const LEVELS = ["L", "M", "Q", "H"];
export const LEVEL_RECOVERY = { L: 7, M: 15, Q: 25, H: 30 };
const LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Check codewords per block, by level and version. ISO/IEC 18004 tables 13-22. */
const ECC_PER_BLOCK = {
  L: [
    7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

/** How many blocks the codewords are cut into, by level and version. */
const BLOCKS = {
  L: [
    1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19,
    20, 21, 22, 24, 25,
  ],
  M: [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33,
    35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45,
    48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51,
    54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

/** The 45 characters alphanumeric mode can say, in its own order. */
const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** What's in the text, and so the fewest bits it can be said in. */
export function modeFor(text) {
  if (/^[0-9]*$/.test(text)) return "numeric";
  if ([...text].every((character) => ALPHANUMERIC.includes(character))) return "alphanumeric";
  return "byte";
}

const MODE_BITS = { numeric: 1, alphanumeric: 2, byte: 4 };

/** How wide the character count field is: it grows with the version. */
function countBits(mode, version) {
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][band];
}

/** How many modules across a version is. */
export const sizeOf = (version) => version * 4 + 17;

/** How many modules a version has left for data, once the patterns have taken theirs. */
function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    modules -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Every codeword a version holds, data and check together. */
export const totalCodewords = (version) => Math.floor(rawDataModules(version) / 8);

/** How many of those carry data, at a level. */
export function dataCodewords(version, level) {
  return totalCodewords(version) - ECC_PER_BLOCK[level][version - 1] * BLOCKS[level][version - 1];
}

/** How many characters of a kind a version and level can hold. */
export function capacity(version, level, mode) {
  const bits = dataCodewords(version, level) * 8 - 4 - countBits(mode, version);
  if (bits < 0) return 0;
  if (mode === "numeric") return Math.floor((bits * 3) / 10);
  if (mode === "alphanumeric") return Math.floor((bits * 2) / 11);
  return Math.floor(bits / 8);
}

/** The bytes a text takes in a mode. Byte mode is UTF-8, which is what a reader expects of anything but ASCII. */
const bytesOf = (text) => new TextEncoder().encode(text);

/** How many bits the text itself takes in a mode, the header aside. */
function payloadBits(text, mode) {
  if (mode === "numeric") return Math.ceil((text.length * 10) / 3);
  if (mode === "alphanumeric") return Math.ceil((text.length * 11) / 2);
  return bytesOf(text).length * 8;
}

/** The smallest version the text fits in at a level, or null when even the largest won't hold it. */
export function smallestVersion(text, level, mode = modeFor(text)) {
  const bits = payloadBits(text, mode);
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (4 + countBits(mode, version) + bits <= dataCodewords(version, level) * 8) return version;
  }
  return null;
}

// ---- bits ------------------------------------------------------------------------------------------------------

/** A string of bits being built up, one field at a time. */
class Bits {
  constructor() {
    this.bits = [];
  }
  push(value, width) {
    for (let i = width - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
}

function writePayload(bits, text, mode, version) {
  bits.push(MODE_BITS[mode], 4);
  if (mode === "numeric") {
    bits.push(text.length, countBits(mode, version));
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      bits.push(Number(group), group.length * 3 + 1);
    }
  } else if (mode === "alphanumeric") {
    bits.push(text.length, countBits(mode, version));
    for (let i = 0; i < text.length; i += 2) {
      const first = ALPHANUMERIC.indexOf(text[i]);
      if (i + 1 < text.length) bits.push(first * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
      else bits.push(first, 6);
    }
  } else {
    const bytes = bytesOf(text);
    bits.push(bytes.length, countBits(mode, version));
    for (const byte of bytes) bits.push(byte, 8);
  }
}

/** The data codewords: the payload, the terminator, and the standard padding to fill the version. */
function codewordsFor(text, mode, version, level) {
  const want = dataCodewords(version, level) * 8;
  const bits = new Bits();
  writePayload(bits, text, mode, version);
  if (bits.length > want) return null;
  bits.push(0, Math.min(4, want - bits.length)); // terminator
  bits.push(0, (8 - (bits.length % 8)) % 8); // up to the next whole codeword
  const bytes = new Uint8Array(want / 8);
  for (let i = 0; i < bits.bits.length; i++) bytes[i >> 3] |= bits.bits[i] << (7 - (i % 8));
  for (let i = Math.ceil(bits.length / 8), pad = 0; i < bytes.length; i++, pad++) {
    bytes[i] = pad % 2 ? 0x11 : 0xec; // the standard's own pad bytes
  }
  return bytes;
}

// ---- Reed-Solomon ----------------------------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d; // the field's own polynomial
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const times = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The generator polynomial for a given number of check codewords. */
function generator(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= times(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** The check codewords for one block. */
function checkCodewords(data, degree) {
  const poly = generator(degree);
  const out = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.copyWithin(0, 1);
    out[degree - 1] = 0;
    for (let i = 0; i < degree; i++) out[i] ^= times(poly[i + 1], factor);
  }
  return out;
}

/**
 * How a version's codewords are cut up at a level: how many blocks, how many check codewords each carries, and
 * how long a block is. The last `longBlocks` of them carry one data codeword more than the rest.
 */
export function blockStructure(version, level) {
  const blocks = BLOCKS[level][version - 1];
  const data = dataCodewords(version, level);
  return {
    blocks,
    ecc: ECC_PER_BLOCK[level][version - 1],
    short: Math.floor(data / blocks),
    longBlocks: data % blocks,
  };
}

/** The blocks interleaved as the standard puts them on the grid: data by column, then the check codewords. */
function interleave(data, version, level) {
  const { blocks, ecc, short, longBlocks } = blockStructure(version, level);
  const pieces = [];
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const length = short + (i >= blocks - longBlocks ? 1 : 0);
    const part = data.subarray(at, at + length);
    at += length;
    pieces.push({ data: part, check: checkCodewords(part, ecc) });
  }
  const out = new Uint8Array(totalCodewords(version));
  let write = 0;
  for (let i = 0; i < short + 1; i++) {
    for (const piece of pieces) if (i < piece.data.length) out[write++] = piece.data[i];
  }
  for (let i = 0; i < ecc; i++) {
    for (const piece of pieces) out[write++] = piece.check[i];
  }
  return out;
}

// ---- the grid --------------------------------------------------------------------------------------------------

/** Where the alignment patterns' centres sit, for a version. */
export function alignmentCentres(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = sizeOf(version);
  // The standard's own spacing: as even as it can be, always landing on the module next to the far finder.
  const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const centres = [6];
  for (let at = size - 7; centres.length < count; at -= step) centres.splice(1, 0, at);
  return centres;
}

/** A grid of modules, with a second grid saying which of them the patterns claimed. */
function emptyGrid(version) {
  const size = sizeOf(version);
  return { size, modules: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
}

function drawPatterns(grid, version) {
  const { size, modules, reserved } = grid;
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y * size + x] = dark ? 1 : 0;
    reserved[y * size + x] = 1;
  };

  // The three finders, each with its one-module light ring.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const reach = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, reach !== 2 && reach <= 3);
      }
    }
  }

  // The timing lines, and the one module that is always dark.
  for (let at = 8; at < size - 8; at++) {
    set(at, 6, at % 2 === 0);
    set(6, at, at % 2 === 0);
  }
  set(8, size - 8, true);

  // The alignment patterns, wherever they don't land on a finder.
  const centres = alignmentCentres(version);
  for (const cy of centres) {
    for (const cx of centres) {
      const corner = (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // The format bits' places, filled in once the mask is chosen. Module 6 of each is the timing line crossing
  // them, which is already drawn and is not a format bit.
  for (let i = 0; i <= 8; i++) {
    if (i === 6) continue;
    set(i, 8, false);
    set(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      set(size - 11 + (i % 3), Math.floor(i / 3), false);
      set(Math.floor(i / 3), size - 11 + (i % 3), false);
    }
  }
}

/** The codewords laid in, two columns at a time, upwards then downwards, skipping the timing column. */
function placeData(grid, codewords) {
  const { size, modules, reserved } = grid;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing line is never a data column
    for (let step = 0; step < size; step++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const upwards = ((right + 1) & 2) === 0;
        const y = upwards ? size - 1 - step : step;
        const at = y * size + x;
        if (reserved[at]) continue;
        const byte = codewords[bit >> 3];
        modules[at] = bit < codewords.length * 8 ? (byte >> (7 - (bit % 8))) & 1 : 0;
        bit++;
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid, mask) {
  const { size, modules, reserved } = grid;
  const rule = MASKS[mask];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      if (!reserved[at] && rule(x, y)) modules[at] ^= 1;
    }
  }
}

/** The 15 format bits: the level, the mask, their BCH check, and the standard's own mask over the lot. */
function formatBits(level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

/** The 18 version bits, for version 7 and up. */
function versionBits(version) {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return ((version << 12) | remainder) & 0x3ffff;
}

function drawFormat(grid, level, mask, version) {
  const { size, modules } = grid;
  const bits = formatBits(level, mask);
  const at = (x, y, dark) => (modules[y * size + x] = dark ? 1 : 0);
  for (let i = 0; i <= 5; i++) at(8, i, (bits >> i) & 1);
  at(8, 7, (bits >> 6) & 1);
  at(8, 8, (bits >> 7) & 1);
  at(7, 8, (bits >> 8) & 1);
  for (let i = 9; i < 15; i++) at(14 - i, 8, (bits >> i) & 1);
  for (let i = 0; i < 8; i++) at(size - 1 - i, 8, (bits >> i) & 1);
  for (let i = 8; i < 15; i++) at(8, size - 15 + i, (bits >> i) & 1);
  at(8, size - 8, 1);

  if (version >= 7) {
    const vbits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = (vbits >> i) & 1;
      at(size - 11 + (i % 3), Math.floor(i / 3), dark);
      at(Math.floor(i / 3), size - 11 + (i % 3), dark);
    }
  }
}

/** The eleven-module runs the standard calls finder-like wherever they turn up: each costs 40. */
const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

/** How badly a masked grid reads: the standard's four penalties, which is how the mask is chosen. */
export function penalty(grid) {
  const { size, modules } = grid;
  const dark = (x, y) => modules[y * size + x];
  let score = 0;

  // One: runs of five or more of a colour, in every row and every column.
  for (let a = 0; a < size; a++) {
    for (const byRow of [true, false]) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const here = byRow ? dark(b, a) : dark(a, b);
        const before = byRow ? dark(b - 1, a) : dark(a, b - 1);
        if (here === before) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Two: every two-by-two block of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = dark(x, y);
      if (value === dark(x + 1, y) && value === dark(x, y + 1) && value === dark(x + 1, y + 1)) score += 3;
    }
  }

  // Three: anything that looks like a finder's 1:1:3:1:1 with its light run, which would mislead a reader.
  for (let a = 0; a < size; a++) {
    for (let b = 0; b + 10 < size; b++) {
      for (const pattern of FINDER_LIKE) {
        let row = true;
        let column = true;
        for (let i = 0; i < 11; i++) {
          if (row && dark(b + i, a) !== pattern[i]) row = false;
          if (column && dark(a, b + i) !== pattern[i]) column = false;
          if (!row && !column) break;
        }
        if (row) score += 40;
        if (column) score += 40;
      }
    }
  }

  // Four: how far from half of the modules are dark, in steps of five per cent.
  let darkCount = 0;
  for (const value of modules) darkCount += value;
  const away = Math.abs((darkCount * 100) / (size * size) - 50);
  score += Math.floor(away / 5) * 10;
  return score;
}

/**
 * The symbol for a text.
 *
 * `level` is the error correction, `version` a version to insist on or "auto" for the smallest that fits, and
 * `mask` a mask to insist on or "auto" for the one that scores best. Throws when the text won't fit.
 */
export function encode(text, { level = "M", version = "auto", mask = "auto" } = {}) {
  const content = String(text ?? "");
  if (!content) throw Object.assign(new Error("There's nothing to put in the code."), { code: "empty" });
  if (!LEVELS.includes(level)) throw new Error(`Unknown error correction level ${level}`);
  const mode = modeFor(content);

  let chosen;
  if (version === "auto" || version == null) {
    chosen = smallestVersion(content, level, mode);
    if (!chosen) throw Object.assign(new Error("That's too much for one QR code."), { code: "tooMuch" });
  } else {
    chosen = Math.max(MIN_VERSION, Math.min(MAX_VERSION, Math.round(Number(version))));
  }

  const data = codewordsFor(content, mode, chosen, level);
  if (!data) {
    const needed = smallestVersion(content, level, mode);
    throw Object.assign(new Error(`That won't fit in version ${chosen}.`), {
      code: "wontFitVersion",
      vars: { version: chosen, needed: needed ?? MAX_VERSION },
    });
  }
  const codewords = interleave(data, chosen, level);

  const build = (which) => {
    const grid = emptyGrid(chosen);
    drawPatterns(grid, chosen);
    placeData(grid, codewords);
    applyMask(grid, which);
    drawFormat(grid, level, which, chosen);
    return grid;
  };

  let best;
  let bestMask = 0;
  if (mask === "penalties") return { penalties: [0, 1, 2, 3, 4, 5, 6, 7].map((which) => penalty(build(which))) };
  if (mask === "auto" || mask == null) {
    let bestScore = Infinity;
    for (let which = 0; which < 8; which++) {
      const grid = build(which);
      const score = penalty(grid);
      if (score < bestScore) {
        bestScore = score;
        best = grid;
        bestMask = which;
      }
    }
  } else {
    bestMask = Math.max(0, Math.min(7, Math.round(Number(mask))));
    best = build(bestMask);
  }

  return {
    version: chosen,
    level,
    mode,
    mask: bestMask,
    size: best.size,
    modules: best.modules,
    reserved: best.reserved,
    /** Whether a module is dark, by column and row. */
    dark: (x, y) => best.modules[y * best.size + x] === 1,
    /** Whether a module is part of a pattern rather than data: the finders and the rest. */
    fixed: (x, y) => best.reserved[y * best.size + x] === 1,
    capacity: capacity(chosen, level, mode),
    used: content.length,
  };
}
