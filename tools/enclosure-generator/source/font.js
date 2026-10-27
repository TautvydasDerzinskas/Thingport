// A stroke font for text raised on or cut into a case: each character is lines on a grid 4 wide and 6 high, drawn
// as bars with round joints, thick enough to print. Capitals, digits and common signs; small letters print as
// capitals, and letters with accents without them.

import { unionAll } from "./csg.js";
import { prismIn } from "./shapes.js";

const GLYPHS = {
  A: "0,0 0,4 2,6 4,4 4,0|0,3 4,3",
  B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0",
  C: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1",
  D: "0,0 0,6 2,6 4,4 4,2 2,0 0,0",
  E: "4,6 0,6 0,0 4,0|0,3 3,3",
  F: "4,6 0,6 0,0|0,3 3,3",
  G: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3",
  H: "0,0 0,6|4,0 4,6|0,3 4,3",
  I: "1,6 3,6|2,6 2,0|1,0 3,0",
  J: "4,6 4,1 3,0 1,0 0,1",
  K: "0,0 0,6|4,6 0,2|1,3 4,0",
  L: "0,6 0,0 4,0",
  M: "0,0 0,6 2,3 4,6 4,0",
  N: "0,0 0,6 4,0 4,6",
  O: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0",
  P: "0,0 0,6 3,6 4,5 4,4 3,3 0,3",
  Q: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2.5,1.5 4,0",
  R: "0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0",
  S: "4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1",
  T: "0,6 4,6|2,6 2,0",
  U: "0,6 0,1 1,0 3,0 4,1 4,6",
  V: "0,6 2,0 4,6",
  W: "0,6 1,0 2,3 3,0 4,6",
  X: "0,0 4,6|0,6 4,0",
  Y: "0,6 2,3 4,6|2,3 2,0",
  Z: "0,6 4,6 0,0 4,0",
  0: "1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|1,1.5 3,4.5",
  1: "1,5 2,6 2,0|1,0 3,0",
  2: "0,5 1,6 3,6 4,5 4,4 0,0 4,0",
  3: "0,5 1,6 3,6 4,5 4,4 3,3 1,3|3,3 4,2 4,1 3,0 1,0 0,1",
  4: "3,0 3,6 0,2 4,2",
  5: "4,6 0,6 0,3 3,3 4,2 4,1 3,0 0,0",
  6: "4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3",
  7: "0,6 4,6 1,0",
  8: "1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3",
  9: "0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3",
  "-": "1,3 3,3",
  "+": "2,1 2,5|0,3 4,3",
  "=": "0,2 4,2|0,4 4,4",
  ".": "2,0",
  ",": "2,0.6 1.4,-1",
  ":": "2,0.6|2,4.4",
  ";": "2,4.4|2,0.6 1.4,-1",
  "/": "0,0 4,6",
  "\\": "0,6 4,0",
  "!": "2,6 2,2|2,0",
  "?": "0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0",
  "'": "2,6 2,4.5",
  '"': "1,6 1,4.5|3,6 3,4.5",
  "(": "3,6 2,5 1.6,3 2,1 3,0",
  ")": "1,6 2,5 2.4,3 2,1 1,0",
  "[": "3,6 1.5,6 1.5,0 3,0",
  "]": "1,6 2.5,6 2.5,0 1,0",
  "#": "1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4",
  "%": "0,0 4,6|0.5,5.5|3.5,0.5",
  "&": "4,0 1,4 1,5 2,6 3,5 0,2 0,1 1,0 2,0 4,2",
  "*": "2,1.5 2,4.5|0.7,2.2 3.3,3.8|0.7,3.8 3.3,2.2",
  "<": "4,5 0,3 4,1",
  ">": "0,5 4,3 0,1",
  _: "0,-0.5 4,-0.5",
  "°": "1,5 2,6 3,5 2,4 1,5",
  "|": "2,-1 2,7",
};

const parsed = new Map(
  Object.entries(GLYPHS).map(([ch, spec]) => [
    ch,
    spec.split("|").map((line) => line.split(" ").map((p) => p.split(",").map(Number))),
  ]),
);

const ADVANCE = 6;

/** The text as it'll be drawn: capitals, accents dropped, unknown characters as "?". */
export function printable(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .map((ch) => (ch === " " || parsed.has(ch) ? ch : "?"))
    .join("");
}

/** The width and height a line of text takes at a cap height of `size`. */
export function measure(text, size) {
  const n = printable(text).length;
  const unit = size / 6;
  return { width: n ? (n * ADVANCE - 2) * unit + strokeWidth(size) : 0, height: size + strokeWidth(size) };
}

const strokeWidth = (size) => Math.max(0.6, size * 0.14);

/**
 * The text as a solid: lines of it in the plane through `origin` spanned by `a` (along the text) and `b` (up the
 * letters), centred there, from `d0` to `d1` along a × b.
 */
export function textSolid(text, size, origin, a, b, d0, d1) {
  const chars = printable(text);
  if (!chars.trim()) return [];
  const unit = size / 6;
  const sw = strokeWidth(size);
  const left = -((chars.length * ADVANCE - 2) * unit) / 2;
  const bottom = -size / 2;
  const pieces = [];
  // An octagon for each joint and dot, so the strokes meet round.
  const joint = (x, y) =>
    Array.from({ length: 8 }, (_, i) => {
      const t = (Math.PI / 4) * i + Math.PI / 8;
      return [x + (sw / 2 / Math.cos(Math.PI / 8)) * Math.cos(t), y + (sw / 2 / Math.cos(Math.PI / 8)) * Math.sin(t)];
    });
  [...chars].forEach((ch, index) => {
    const lines = parsed.get(ch);
    if (!lines) return;
    const ox = left + index * ADVANCE * unit;
    for (const line of lines) {
      const pts = line.map(([x, y]) => [ox + x * unit, bottom + y * unit]);
      for (const [x, y] of pts) pieces.push(prismIn(joint(x, y), origin, a, b, d0, d1));
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const length = Math.hypot(x1 - x0, y1 - y0);
        if (length < 1e-6) continue;
        const nx = (-(y1 - y0) / length) * (sw / 2);
        const ny = ((x1 - x0) / length) * (sw / 2);
        pieces.push(
          prismIn(
            [
              [x0 - nx, y0 - ny],
              [x1 - nx, y1 - ny],
              [x1 + nx, y1 + ny],
              [x0 + nx, y0 + ny],
            ],
            origin,
            a,
            b,
            d0,
            d1,
          ),
        );
      }
    }
  });
  return unionAll(pieces);
}
