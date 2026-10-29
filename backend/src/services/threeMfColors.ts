// What a 3MF says each triangle is coloured, in the two forms files use.
//
// A 3MF carries colour in its own right as a property group in <resources> -- the core spec's <basematerials>
// or the Materials extension's <m:colorgroup> -- which the object points at with `pid` and each triangle
// indexes with `p1`. A sliced Bambu or Orca project says it a second way instead: `paint_color` on each
// triangle, naming a filament slot in a slicer's own triangle-selector code.
//
// Both halves live here because the 3MF normalizer writes them and the preview renderer reads them, and the
// renderer runs in a worker thread that must stay free of config/db imports (and of JSZip, which the
// normalizer pulls in).

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

/** The colours of a 3MF's own property groups, flattened, and which of them a `pid` and index name. */
export type ThreeMfColors = {
  colors: string[];
  /** The slot a group's `index`th entry landed in, or null for a group or index the file hasn't got. */
  slotOf: (pid: string | null, index: number) => number | null;
};

const GROUP_RE = /<(basematerials|m:colorgroup|colorgroup)\b[^>]*\bid="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g;
const ENTRY_RE = /<(?:base|m:color|color)\b([^>]*?)\/?>/g;

/**
 * `#RRGGBB` or `#RRGGBBAA` as a CSS colour, alpha dropped: how see-through a material is says nothing about
 * what colour it was printed in. Null for anything that isn't one.
 *
 * Bambu Studio writes both spellings -- its filament list is usually `#RRGGBBAA` -- and three.js reads only
 * the six-digit one, so the alpha has to come off before anything is drawn in it.
 */
export function readColor(value: string | null): string | null {
  const hex = value?.trim().replace(/^#/, "") ?? "";
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

/**
 * The colour groups a 3MF declares, read from the model XML. Null for a file that declares none.
 *
 * Only the part of the document before the first object is scanned: property groups come first in
 * <resources>, and a model file runs to hundreds of megabytes of mesh that there is no reason to walk.
 * Entries are flattened across groups into one list, so a slot index means the same thing here as a
 * `paint_color` filament does and everything downstream colours the two alike.
 */
export function readColorGroups(xml: string): ThreeMfColors | null {
  const firstObject = xml.indexOf("<object");
  const resources = firstObject > 0 ? xml.slice(0, firstObject) : xml;
  const colors: string[] = [];
  const slots = new Map<string, number>();
  GROUP_RE.lastIndex = 0;
  let group: RegExpExecArray | null;
  while ((group = GROUP_RE.exec(resources))) {
    const groupId = group[2];
    if (!groupId) continue;
    ENTRY_RE.lastIndex = 0;
    let entry: RegExpExecArray | null;
    let index = 0;
    while ((entry = ENTRY_RE.exec(group[3]))) {
      const attrs = entry[1];
      const color = readColor(
        attrs.match(/(?:^|\s)color="([^"]*)"/)?.[1] ?? attrs.match(/(?:^|\s)displaycolor="([^"]*)"/)?.[1] ?? null,
      );
      // Keyed by where it actually sits, so an entry with no readable colour doesn't shift the ones after it.
      if (color) {
        slots.set(`${groupId}:${index}`, colors.length);
        colors.push(color);
      }
      index++;
    }
  }
  if (!colors.length) return null;
  return { colors, slotOf: (pid, index) => (pid === null ? null : (slots.get(`${pid}:${index}`) ?? null)) };
}
