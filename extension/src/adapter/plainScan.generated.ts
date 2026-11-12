// GENERATED from backend/src/adapter/plainScan.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// What a plain 3MF's models say about its colours, read in pieces: how many colours they define, and whether every
// triangle is painted already, the way PrusaSlicer reads. The server reads the models as streams
// (services/threeMfFormat.ts), Thingport Grab as the strings it unzips, both with this.

import type { PlainModelScan } from "./format.generated";

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

export function plainModelScanner(): PlainModelScanner {
  const colours = new Set<string>();
  let triangles = 0;
  let painted = 0;
  let carry = "";
  return {
    add(text) {
      const all = carry + text;
      const end = all.lastIndexOf(">") + 1;
      const whole = all.slice(0, end);
      carry = all.slice(end);
      for (const m of whole.matchAll(COLOUR_RE)) colours.add(m[1].toUpperCase());
      for (const m of whole.matchAll(TRIANGLE_RE)) {
        triangles++;
        if (PAINT_RE.test(m[0])) painted++;
      }
    },
    endFile() {
      carry = "";
    },
    result: () => ({ colours: colours.size, painted: triangles > 0 && painted === triangles }),
  };
}
