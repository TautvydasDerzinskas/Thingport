// The words under the code, as outlines.
//
// A caption is set with the font's own advance widths and kerning — not with one width for every letter — so it
// reads the way the typeface was drawn. It is sized by its capitals, which is what makes "6 mm" mean the height
// of a capital rather than of whatever happens to be the tallest thing in the line.

import { flattenPath, groupContours, shapeBounds, transformShapes } from "./outline.js";

/**
 * A caption as shapes with their holes, in millimetres, centred on x = 0 with its baseline at y = 0.
 *
 * `maxWidthMm` is what it has to fit in: a line too long for the plate is set smaller rather than run off it, and
 * `scaled` says by how much, so the window can mention it.
 */
export function captionShapes(font, text, { sizeMm = 6, maxWidthMm = Infinity, tracking = 0.02 } = {}) {
  const line = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line || !font) return { shapes: [], width: 0, height: 0, scaled: 1 };

  const units = font.unitsPerEm || 1000;
  const capHeight = font.tables?.os2?.sCapHeight || Math.round(units * 0.7);
  const letterSpacing = tracking * units;

  const rings = [];
  let pen = 0;
  const characters = [...line];
  characters.forEach((character, index) => {
    const glyph = font.charToGlyph(character);
    if (!glyph) return;
    if (character !== " ") {
      // The glyph drawn at the pen, in font units: `units` as the size keeps it in those units.
      for (const ring of flattenPath(glyph.getPath(pen, 0, units), units * 0.0006)) rings.push(ring);
    }
    const kerning =
      index + 1 < characters.length ? font.getKerningValue(glyph, font.charToGlyph(characters[index + 1])) : 0;
    pen += (glyph.advanceWidth ?? units * 0.5) + kerning + letterSpacing;
  });

  const grouped = groupContours(rings);
  if (!grouped.length) return { shapes: [], width: 0, height: 0, scaled: 1 };

  let scale = sizeMm / capHeight;
  const box = shapeBounds(grouped);
  const rawWidth = box.maxX - box.minX;
  let scaled = 1;
  if (rawWidth * scale > maxWidthMm) {
    scaled = maxWidthMm / (rawWidth * scale);
    scale *= scaled;
  }
  const shapes = transformShapes(grouped, scale, -((box.minX + box.maxX) / 2) * scale, 0);
  const sized = shapeBounds(shapes);
  return {
    shapes,
    width: sized.maxX - sized.minX,
    height: sized.maxY - sized.minY,
    bottom: sized.minY,
    top: sized.maxY,
    scaled,
  };
}
