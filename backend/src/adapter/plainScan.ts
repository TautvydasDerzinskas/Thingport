// What a plain 3MF's models say about its colours, read in pieces: how many colours they define, and whether every
// triangle is painted already, the way PrusaSlicer reads. The server reads the models as streams
// (services/threeMfFormat.ts), Thingport Grab as the strings it unzips, both with this.

import type { PlainModelScan } from "./format";

const COLOUR_RE = /<(?:[\w-]+:)?(?:color\b[^>]*?\bcolor|base\b[^>]*?\bdisplaycolor)\s*=\s*"#?([0-9a-f]{6})/gi;
const TRIANGLE_RE = /<(?:[\w-]+:)?triangle\b[^>]*>/gi;
const PAINT_RE = /\b(?:slic3rpe:mmu_segmentation|paint_color)\s*=\s*"[0-9a-f]/i;

export type PlainModelScanner = {
  /** The next piece of a model file's text; a tag split between two pieces is read with the second. */
  add(text: string): void;
  /** The end of one model file: what's left over isn't a whole tag. */
  endFile(): void;
  result(): PlainModelScan;
};

const OPEN_TRIANGLE_RE = /^<(?:[\w-]+:)?triangle\b/i;

/** The most of a tag kept from one piece for the next. A longer one (a comment that never ends, say) is read from its
 *  start alone, so that it isn't searched again with every piece and kept whole. */
export const MAX_CARRY = 64 * 1024;

export function plainModelScanner(): PlainModelScanner {
  const colours = new Set<string>();
  let triangles = 0;
  let painted = 0;
  let carry = "";
  // Inside a tag too long to keep: the rest of it, up to its `>`, is passed over.
  let skipping = false;
  const read = (whole: string) => {
    for (const m of whole.matchAll(COLOUR_RE)) colours.add(m[1].toUpperCase());
    for (const m of whole.matchAll(TRIANGLE_RE)) {
      triangles++;
      if (PAINT_RE.test(m[0])) painted++;
    }
  };
  return {
    add(text) {
      if (skipping) {
        const close = text.indexOf(">");
        if (close < 0) return;
        text = text.slice(close + 1);
        skipping = false;
      }
      const all = carry + text;
      const end = all.lastIndexOf(">") + 1;
      read(all.slice(0, end));
      carry = all.slice(end);
      if (carry.length <= MAX_CARRY) return;
      const open = carry.indexOf("<");
      if (open >= 0) {
        // What its start says: a triangle, painted or not, or a colour.
        const tag = carry.slice(open);
        for (const m of tag.matchAll(COLOUR_RE)) colours.add(m[1].toUpperCase());
        if (OPEN_TRIANGLE_RE.test(tag)) {
          triangles++;
          if (PAINT_RE.test(tag)) painted++;
        }
        skipping = true;
      }
      carry = "";
    },
    endFile() {
      carry = "";
      skipping = false;
    },
    result: () => ({ colours: colours.size, painted: triangles > 0 && painted === triangles }),
  };
}
