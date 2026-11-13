// A printer drawn from what the printer catalogue says of it, as Grab carries no pictures: one outline for every
// printer, wider for a bigger bed and taller for a taller printer, with a head per extruder (up to four); a printer
// with a round bed is a delta, drawn as its towers. Styled by styles/_printer-art.scss, in the theme's colours.

export type ArtPrinter = {
  bed: { shape: "rectangle" | "circle" | "polygon"; x: number; y: number } | null;
  height: number | null;
  extruders: number;
};

const r = (n: number) => Math.round(n * 10) / 10;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// The beds and heights printers span, from a small bed slinger to a large one, mapped onto the drawing's range.
const BED = { min: 160, span: 200 };
const HEIGHT = { min: 160, span: 260 };

/** The frame's width and height in a 100 × 100 box. */
export function frameSize(printer: ArtPrinter): { width: number; height: number } {
  const bed = printer.bed?.x ?? 220;
  const tall = printer.height ?? 220;
  return {
    width: r(46 + 38 * clamp((bed - BED.min) / BED.span, 0, 1)),
    height: r(52 + 32 * clamp((tall - HEIGHT.min) / HEIGHT.span, 0, 1)),
  };
}

function delta(width: number, height: number): string {
  const x = (100 - width) / 2;
  const y = 92 - height;
  const left = x + 6;
  const right = x + width - 6;
  return [
    `<line class="pa__line" x1="${r(left)}" y1="${r(y)}" x2="${r(left)}" y2="92"/>`,
    `<line class="pa__line" x1="${r(right)}" y1="${r(y)}" x2="${r(right)}" y2="92"/>`,
    `<line class="pa__line pa__line--thin" x1="50" y1="${r(y)}" x2="50" y2="${r(y + height * 0.3)}"/>`,
    `<rect class="pa__body" x="${r(left - 3)}" y="${r(y - 2)}" width="${r(right - left + 6)}" height="6" rx="2"/>`,
    `<line class="pa__line pa__line--thin" x1="${r(left)}" y1="${r(y + height * 0.32)}" x2="47" y2="${r(y + height * 0.55)}"/>`,
    `<line class="pa__line pa__line--thin" x1="${r(right)}" y1="${r(y + height * 0.32)}" x2="53" y2="${r(y + height * 0.55)}"/>`,
    `<rect class="pa__head" x="45" y="${r(y + height * 0.53)}" width="10" height="6" rx="1.5"/>`,
    `<ellipse class="pa__plate" cx="50" cy="86" rx="${r((right - left) / 2 - 2)}" ry="4"/>`,
    `<rect class="pa__body" x="${r(left - 4)}" y="88" width="${r(right - left + 8)}" height="5" rx="2"/>`,
  ].join("");
}

function boxed(width: number, height: number, extruders: number): string {
  const x = (100 - width) / 2;
  const y = 92 - height;
  const gantry = y + height * 0.3;
  const heads = clamp(Math.round(extruders) || 1, 1, 4);
  const headWidth = heads > 2 ? 7 : 10;
  const first = 50 - (heads * headWidth + (heads - 1) * 2) / 2;
  const plate = width * 0.74;
  const parts = [
    `<rect class="pa__body" x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" rx="5"/>`,
    `<rect class="pa__window" x="${r(x + 5)}" y="${r(y + 5)}" width="${r(width - 10)}" height="${r(height - 15)}" rx="2.5"/>`,
    `<line class="pa__line" x1="${r(x + 6)}" y1="${r(gantry)}" x2="${r(x + width - 6)}" y2="${r(gantry)}"/>`,
  ];
  for (let i = 0; i < heads; i++) {
    const hx = first + i * (headWidth + 2);
    parts.push(
      `<rect class="pa__head" x="${r(hx)}" y="${r(gantry - 4)}" width="${headWidth}" height="9" rx="1.5"/>`,
      `<path class="pa__nozzle" d="M${r(hx + headWidth / 2 - 1.6)} ${r(gantry + 5)}h3.2l-1.6 2.4z"/>`,
    );
  }
  parts.push(
    `<rect class="pa__plate" x="${r(50 - plate / 2)}" y="${r(y + height - 18)}" width="${r(plate)}" height="3.6" rx="1"/>`,
    `<rect class="pa__foot" x="${r(x + 4)}" y="${r(y + height)}" width="6" height="2.4" rx="1"/>`,
    `<rect class="pa__foot" x="${r(x + width - 10)}" y="${r(y + height)}" width="6" height="2.4" rx="1"/>`,
  );
  return parts.join("");
}

/** The printer's outline as SVG markup, for a box of any size; decorative, so hidden from screen readers. */
export function printerArtSvg(printer: ArtPrinter): string {
  const { width, height } = frameSize(printer);
  const body = printer.bed?.shape === "circle" ? delta(width, height) : boxed(width, height, printer.extruders);
  return `<svg class="pa" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`;
}
