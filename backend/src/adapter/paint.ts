// Bambu's TriangleSelector paint strings, which PrusaSlicer reads too (`slic3rpe:mmu_segmentation`): a whole
// triangle's state is one short hex code, a split triangle a tree of them.

function hexToBitstream(hex: string): boolean[] {
  const bits: boolean[] = [];
  const s = hex.toUpperCase();
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    let dec: number;
    if (ch >= "0" && ch <= "9") dec = ch.charCodeAt(0) - 48;
    else if (ch >= "A" && ch <= "F") dec = 10 + ch.charCodeAt(0) - 65;
    else continue;
    for (let b = 0; b < 4; b++) bits.push((dec & (1 << b)) !== 0);
  }
  return bits;
}

/** Encodes a whole-triangle extruder state in Bambu's TriangleSelector paint format: past state 17, a nibble 15 for
 *  each 15 more, then the rest (TriangleSelector.cpp). */
export function encodePaintState(state: number): string {
  if (!Number.isInteger(state) || state <= 0) return "";
  if (state <= 2) return (((state & 1) << 2) | (((state >> 1) & 1) << 3)).toString(16).toUpperCase();
  let rest = state - 3;
  let hex = "C";
  while (rest >= 15) {
    hex = `F${hex}`;
    rest -= 15;
  }
  return `${rest.toString(16).toUpperCase()}${hex}`;
}

/** The dominant extruder state of a TriangleSelector paint string; 0 means unpainted. */
export function decodePaintState(hex: string): number {
  if (!hex) return 0;
  const bits = hexToBitstream(hex);
  let pos = 0;
  const read2 = () => (bits[pos++] ? 1 : 0) | (bits[pos++] ? 2 : 0);
  const read4 = () => {
    let n = 0;
    for (let i = 0; i < 4; i++) if (bits[pos++]) n |= 1 << i;
    return n;
  };
  const decodeNode = (): number => {
    if (pos >= bits.length) return 0;
    const splitSides = read2();
    if (splitSides === 0) {
      const xx = read2();
      if (xx !== 3) return xx;
      // Each nibble 15 is 15 more and another nibble.
      let state = 3;
      let nibble;
      do {
        nibble = read4();
        state += nibble;
      } while (nibble === 15 && pos < bits.length);
      return state;
    }
    read2();
    const counts = new Map<number, number>();
    for (let c = splitSides; c >= 0; c--) {
      const state = decodeNode();
      counts.set(state, (counts.get(state) || 0) + 1);
    }
    let best = 0;
    let bestN = -1;
    for (const [state, n] of counts) {
      if (n > bestN || (n === bestN && state !== 0 && best === 0)) {
        best = state;
        bestN = n;
      }
    }
    return best;
  };
  return decodeNode();
}

export function stateToMaterialIndex(state: number, defaultExtruder: number, colorCount: number): number {
  let idx = !state || state <= 0 ? Math.max(0, (defaultExtruder || 1) - 1) : state - 1;
  if (colorCount > 0) idx = Math.min(idx, colorCount - 1);
  return idx;
}

function bitsToHex(bits: boolean[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) if (bits[i + b]) nibble |= 1 << b;
    hex = nibble.toString(16).toUpperCase() + hex;
  }
  return hex;
}

/**
 * A PrusaSlicer 2.9.6+ colour painting string (`slic3rpe:MmPaintingVersion` 2) as Bambu's. They encode states up to
 * 16 alike; past that PrusaSlicer writes nibble 14 and a byte (state - 17), Bambu runs of nibble 15 (15 more each)
 * and a last nibble (TriangleSelector.cpp in both).
 */
export function prusaPaintToBambu(hex: string): string {
  const bits = hexToBitstream(hex);
  if (!bits.length) return hex;
  const out: boolean[] = [];
  let pos = 0;
  const read = (n: number) => {
    let value = 0;
    for (let i = 0; i < n; i++) if (bits[pos++]) value |= 1 << i;
    return value;
  };
  const write = (value: number, n: number) => {
    for (let i = 0; i < n; i++) out.push(((value >> i) & 1) === 1);
  };
  const node = (): void => {
    if (pos >= bits.length) return;
    const split = read(2);
    write(split, 2);
    if (split !== 0) {
      write(read(2), 2);
      for (let child = split; child >= 0; child--) node();
      return;
    }
    const xx = read(2);
    write(xx, 2);
    if (xx !== 3) return;
    const nibble = read(4);
    let rest = (nibble === 14 ? 17 + read(8) : nibble + 3) - 3;
    while (rest >= 15) {
      write(15, 4);
      rest -= 15;
    }
    write(rest, 4);
  };
  node();
  return bitsToHex(out);
}
