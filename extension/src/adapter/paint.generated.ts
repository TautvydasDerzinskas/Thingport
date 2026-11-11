// GENERATED from backend/src/adapter/paint.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
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

/** Encodes a whole-triangle extruder state in Bambu's TriangleSelector paint format. */
export function encodePaintState(state: number): string {
  if (!Number.isInteger(state) || state <= 0) return "";
  if (state <= 2) return (((state & 1) << 2) | (((state >> 1) & 1) << 3)).toString(16).toUpperCase();
  return `${Math.min(state - 3, 15)
    .toString(16)
    .toUpperCase()}C`;
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
      return xx === 3 ? read4() + 3 : xx;
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
