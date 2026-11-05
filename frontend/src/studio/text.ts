import type { Vec2 } from "./vec";

// Text in a sketch: its letters' outlines, laid out on the sketch's plane, which extrude and revolve then make solid.
//
// The letters come from the fonts Thingport carries for tools (frontend/src/assets/toolFonts, all static, so their
// counters keep their winding). This file never reads a font itself: each side parses the ones a design uses (the
// browser fetches them, the server reads its copies) and hands them to addFont before anything here needs them. The
// font type below is the part of opentype.js's that's used, so this stays free of the parser.

/** The fonts a text shape can use: `id` is the font file's name. Kept to tools' fonts, as sdk/fonts.ts lists them. */
export const STUDIO_FONTS = [
  { id: "pt-sans", name: "PT Sans" },
  { id: "fira-sans", name: "Fira Sans" },
  { id: "fjalla-one", name: "Fjalla One" },
  { id: "bebas-neue", name: "Bebas Neue" },
  { id: "staatliches", name: "Staatliches" },
  { id: "pt-serif", name: "PT Serif" },
  { id: "arvo", name: "Arvo" },
  { id: "abril-fatface", name: "Abril Fatface" },
  { id: "alfa-slab-one", name: "Alfa Slab One" },
  { id: "anton", name: "Anton" },
  { id: "archivo-black", name: "Archivo Black" },
  { id: "bowlby-one", name: "Bowlby One" },
  { id: "sigmar-one", name: "Sigmar One" },
  { id: "titan-one", name: "Titan One" },
  { id: "concert-one", name: "Concert One" },
  { id: "patua-one", name: "Patua One" },
  { id: "bungee", name: "Bungee" },
  { id: "righteous", name: "Righteous" },
  { id: "russo-one", name: "Russo One" },
  { id: "lobster", name: "Lobster" },
  { id: "pacifico", name: "Pacifico" },
] as const;

export type StudioFontId = (typeof STUDIO_FONTS)[number]["id"];
export const STUDIO_FONT_IDS = STUDIO_FONTS.map((font) => font.id) as [StudioFontId, ...StudioFontId[]];
/** The plainest bold face: what text is in until another font is asked for. */
export const DEFAULT_FONT: StudioFontId = "pt-sans";

export type TextShape = {
  type: "text";
  /** Lines split at "\n". */
  text: string;
  font?: StudioFontId;
  /** A capital letter's height, in mm. */
  size: number;
  /** The middle of the text: halfway across its widest line, and halfway from the top line's capitals to the bottom
   *  line's baseline. */
  center: Vec2;
  align?: "left" | "center" | "right";
  /** Added between letters, in mm; negative draws them closer. */
  spacing?: number;
  hole?: boolean;
};

type PathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };
type Glyph = {
  index: number;
  advanceWidth?: number;
  getPath(x: number, y: number, fontSize: number): { commands: PathCommand[] };
};
/** What's used of an opentype.js Font. */
export type TextFont = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  tables: { os2?: { sCapHeight?: number }; hhea?: { lineGap?: number } };
  charToGlyph(char: string): Glyph;
  stringToGlyphs(text: string): Glyph[];
  getKerningValue(left: Glyph, right: Glyph): number;
};

const fonts = new Map<string, TextFont>();

/** Makes a parsed font available to text shapes. */
export function addFont(id: string, font: TextFont): void {
  fonts.set(id, font);
  outlines.clear();
}

export function hasFont(id: string): boolean {
  return fonts.has(id);
}

/** Every font the text shapes in `value` use, which must be added before they're drawn or made: `value` is anything
 *  holding shapes, a design or a command's arguments. */
export function fontsIn(value: unknown): StudioFontId[] {
  const found = new Set<StudioFontId>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    // A text shape, or add_text's arguments.
    if (typeof record.text === "string") {
      const font = (record.font as StudioFontId | undefined) ?? DEFAULT_FONT;
      if (STUDIO_FONT_IDS.includes(font)) found.add(font);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...found];
}

function fontOf(id: StudioFontId): TextFont {
  const font = fonts.get(id);
  if (!font) throw new Error(`The ${fontName(id)} font isn't loaded yet.`);
  return font;
}

export function fontName(id: string): string {
  return STUDIO_FONTS.find((font) => font.id === id)?.name ?? id;
}

/** The characters of `text` the font has no letter for, each once. */
export function missingCharacters(fontId: StudioFontId, text: string): string[] {
  const font = fontOf(fontId);
  return [...new Set([...text].filter((char) => /\S/.test(char) && font.charToGlyph(char).index === 0))];
}

/** The fonts that have every character of `text`, of those loaded. */
function fontsWith(text: string): string[] {
  return STUDIO_FONTS.filter((font) => fonts.has(font.id) && !missingCharacters(font.id, text).length).map(
    (font) => font.name,
  );
}

// A curve is cut into straight pieces about this long, in mm, at the size it's drawn.
const PIECE_MM = 0.25;
const MAX_PIECES = 24;
// Made again only when the shape changes; drawing and making a design ask for the same outlines often.
const outlines = new Map<string, Vec2[][]>();
const KEPT = 200;

/**
 * The text's outlines on its plane, in mm: every letter's contours, the counters (the holes in o, a, B) wound against
 * the outsides, so a nonzero fill makes them right. Throws when the font isn't loaded, or has no letter for one of the
 * characters: drawn without it, the words would come out wrong.
 */
export function textContours(shape: TextShape): Vec2[][] {
  const key = JSON.stringify([shape.text, shape.font, shape.size, shape.center, shape.align, shape.spacing]);
  const known = outlines.get(key);
  if (known) return known;
  const fontId = shape.font ?? DEFAULT_FONT;
  const font = fontOf(fontId);
  const missing = missingCharacters(fontId, shape.text);
  if (missing.length) {
    const others = fontsWith(shape.text);
    throw new Error(
      `${fontName(fontId)} has no letter for ${missing.map((char) => `“${char}”`).join(", ")}` +
        (others.length ? `. These fonts have them all: ${others.join(", ")}.` : "."),
    );
  }
  const capUnits = font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7;
  const scale = shape.size / capUnits;
  const spacing = (shape.spacing ?? 0) / scale;
  const pitch = (font.ascender - font.descender + (font.tables.hhea?.lineGap ?? 0)) * scale;
  // Each line laid out in font units: where each letter starts, kerned, and how wide the line is.
  const lines = shape.text.split("\n").map((line) => {
    const glyphs = font.stringToGlyphs(line.replace(/\t/g, "    "));
    let x = 0;
    const placed = glyphs.map((glyph, i) => {
      const at = x;
      x += glyph.advanceWidth ?? 0;
      if (i < glyphs.length - 1) x += font.getKerningValue(glyph, glyphs[i + 1]) + spacing;
      return { glyph, at };
    });
    return { placed, width: x * scale };
  });
  const widest = Math.max(...lines.map((line) => line.width));
  const height = shape.size + (lines.length - 1) * pitch;
  const [cu, cv] = shape.center;
  const top = cv + height / 2;
  const contours: Vec2[][] = [];
  lines.forEach((line, row) => {
    const baseline = top - shape.size - row * pitch;
    const left =
      shape.align === "left"
        ? cu - widest / 2
        : shape.align === "right"
          ? cu + widest / 2 - line.width
          : cu - line.width / 2;
    for (const { glyph, at } of line.placed) {
      // In font units, y down as opentype draws for a screen: turned back up here.
      const at2 = (x: number, y: number): Vec2 => [left + (at + x) * scale, baseline - y * scale];
      let contour: Vec2[] = [];
      let pen: Vec2 = [0, 0];
      const close = () => {
        const first = contour[0];
        const last = contour.at(-1);
        if (first && last && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) contour.pop();
        if (contour.length >= 3) contours.push(contour);
        contour = [];
      };
      const pieces = (...points: Vec2[]) => {
        let length = 0;
        for (let i = 1; i < points.length; i++)
          length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        return Math.max(2, Math.min(MAX_PIECES, Math.ceil(length / PIECE_MM)));
      };
      for (const command of glyph.getPath(0, 0, font.unitsPerEm).commands) {
        if (command.type === "M") {
          close();
          pen = at2(command.x, command.y);
          contour.push(pen);
        } else if (command.type === "L") {
          pen = at2(command.x, command.y);
          contour.push(pen);
        } else if (command.type === "Q") {
          const [p0, p1, p2] = [pen, at2(command.x1, command.y1), at2(command.x, command.y)];
          const n = pieces(p0, p1, p2);
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            const a = (1 - t) ** 2;
            const b = 2 * (1 - t) * t;
            const c = t * t;
            contour.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]);
          }
          pen = p2;
        } else if (command.type === "C") {
          const [p0, p1, p2, p3] = [
            pen,
            at2(command.x1, command.y1),
            at2(command.x2, command.y2),
            at2(command.x, command.y),
          ];
          const n = pieces(p0, p1, p2, p3);
          for (let i = 1; i <= n; i++) {
            const t = i / n;
            const a = (1 - t) ** 3;
            const b = 3 * (1 - t) ** 2 * t;
            const c = 3 * (1 - t) * t * t;
            const d = t ** 3;
            contour.push([
              a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
              a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
            ]);
          }
          pen = p3;
        } else close();
      }
      close();
    }
  });
  if (!contours.length) throw new Error("The text has no letters to draw: only spaces.");
  if (outlines.size >= KEPT) outlines.clear();
  outlines.set(key, contours);
  return contours;
}
