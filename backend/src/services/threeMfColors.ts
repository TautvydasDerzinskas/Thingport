// What a 3MF says each triangle is coloured, in the two forms files use.
//
// A 3MF carries colour in its own right as a property group in <resources> -- the core spec's <basematerials>
// or the Materials extension's <m:colorgroup> -- which the object points at with `pid` and each triangle
// indexes with `p1`. A sliced Bambu or Orca project says it a second way instead: `paint_color` on each
// triangle, naming a filament slot in a slicer's own triangle-selector code.
//
// The paint strings come from the 3MF adapter, which writes them; the preview renderer reads them here, in a worker
// thread that must stay free of config/db imports (and of JSZip, which the adapter's writers pull in).

export { decodePaintState, encodePaintState, stateToMaterialIndex } from "../adapter/paint";

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

/**
 * One file's colour groups re-based into a palette the whole model shares, or null where it declares none.
 *
 * A slot number has to mean one colour by the time anything is drawn, and the two ways a 3MF names one don't
 * agree on that: `paint_color` names a filament of the project's, while a `p1` index is into the groups of
 * whichever model file the triangle sits in -- the main one, or any of the part files a multi-part object is
 * split across, each numbering its own resources from scratch. Appending every file's colours to one list,
 * the project's filaments first, keeps them apart: each gets its own stretch of the palette, and a slot from
 * anywhere indexes the colour that file meant. `palette` is extended in place.
 */
export function sharePalette(palette: string[], colors: ThreeMfColors | null): ThreeMfColors | null {
  if (!colors) return null;
  const base = palette.length;
  palette.push(...colors.colors);
  return {
    colors: palette,
    slotOf: (pid, index) => {
      const slot = colors.slotOf(pid, index);
      return slot === null ? null : base + slot;
    },
  };
}
