// GENERATED from frontend/src/studio/svgPath.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { Vec2 } from "./vec.generated";

// SVG path data as a sketch's outlines: how an AI draws a shape a rectangle, circle or polygon can't, in a notation it
// already knows well, and how a shape is taken from an SVG file. Every subpath is one closed outline, its curves cut
// into straight pieces, which extrude and revolve then make solid like any other shape's.

/** How far a straight piece may stray from the curve it stands for, in mm, unless asked otherwise: finer than a print
 *  can show. */
export const PATH_TOLERANCE = 0.05;
/** The most path data read, in characters, and the most points it may draw in all: a sketch needs far fewer, and every
 *  change to the design carries them along. */
export const PATH_CHARACTERS = 20_000;
export const PATH_POINTS = 20_000;

// However fine the tolerance, no one curve is cut into more pieces than this.
const MAX_PIECES = 256;
// Points nearer each other than this, in mm, are one point.
const SAME = 1e-9;
// A loop that fits in less than this, in mm², is a speck or a line drawn there and back, not a shape.
const LEAST_AREA = 1e-6;
// Beyond this a number is a mistake, and squaring it on the way round an arc would run out of digits.
const LARGEST = 1e9;

// What each command takes, for a message asking for what's missing.
const TAKES: Record<string, string> = {
  M: "x y",
  L: "x y",
  H: "x",
  V: "y",
  C: "x1 y1 x2 y2 x y",
  S: "x2 y2 x y",
  Q: "x1 y1 x y",
  T: "x y",
  A: "rx ry rotation large-arc sweep x y",
};
const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const DEGREES = Math.PI / 180;

const isSpace = (char: string) => char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) <= SAME && Math.abs(a[1] - b[1]) <= SAME;
const pieces = (n: number) => Math.min(MAX_PIECES, Math.max(1, Math.ceil(n)));
const count = (n: number) => n.toLocaleString("en-US");

/** About the area of the box the loop fits in, turned to lie along it. Not its signed area: a figure of eight's halves
 *  cancel out in that, though a nonzero fill fills them both. */
function spread(loop: Vec2[]): number {
  const [a] = loop;
  let far = a;
  for (const p of loop) if (Math.hypot(p[0] - a[0], p[1] - a[1]) > Math.hypot(far[0] - a[0], far[1] - a[1])) far = p;
  // Each cross product is the length from a to far times how far the point is off the line between them.
  let widest = 0;
  for (const p of loop)
    widest = Math.max(widest, Math.abs((far[0] - a[0]) * (p[1] - a[1]) - (far[1] - a[1]) * (p[0] - a[0])));
  return widest;
}

/** A Bézier curve's point at `t`, by de Casteljau's construction. */
function bezier(points: Vec2[], t: number): Vec2 {
  let row = points;
  while (row.length > 1)
    row = row.slice(1).map((b, i): Vec2 => [row[i][0] + (b[0] - row[i][0]) * t, row[i][1] + (b[1] - row[i][1]) * t]);
  return row[0];
}

/** The points of a Bézier curve after its first, ending exactly on its last. */
function bezierPoints(points: Vec2[], tolerance: number): Vec2[] {
  const degree = points.length - 1;
  let bend = 0;
  for (let i = 0; i + 2 < points.length; i++) {
    const [a, b, c] = [points[i], points[i + 1], points[i + 2]];
    bend = Math.max(bend, Math.hypot(a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1]));
  }
  // Wang's formula: with this many even steps of t, no piece strays more than the tolerance from the curve.
  const n = pieces(Math.sqrt((degree * (degree - 1) * bend) / (8 * tolerance)));
  const out: Vec2[] = [];
  for (let i = 1; i < n; i++) out.push(bezier(points, i / n));
  out.push(points[degree]);
  return out;
}

/**
 * The points of an elliptical arc after `from`, ending exactly on `to`, found as the SVG spec does (appendix F.6.5,
 * endpoint to centre): radii too small to reach are scaled up until they do, a radius of 0 makes it a straight line,
 * and an arc ending where it starts draws nothing.
 */
function arcPoints(
  from: Vec2,
  to: Vec2,
  radii: Vec2,
  rotation: number,
  large: boolean,
  sweep: boolean,
  tolerance: number,
): Vec2[] {
  if (same(from, to)) return [];
  let rx = Math.abs(radii[0]);
  let ry = Math.abs(radii[1]);
  if (!rx || !ry) return [to];
  const cos = Math.cos(rotation * DEGREES);
  const sin = Math.sin(rotation * DEGREES);
  // Half the way from one end to the other, in a frame turned with the ellipse.
  const hx = (from[0] - to[0]) / 2;
  const hy = (from[1] - to[1]) / 2;
  const x = cos * hx + sin * hy;
  const y = -sin * hx + cos * hy;
  const reach = (x / rx) ** 2 + (y / ry) ** 2;
  if (reach > 1) {
    rx *= Math.sqrt(reach);
    ry *= Math.sqrt(reach);
  }
  // Of the two centres an ellipse this size could have, the one on the side the flags ask for.
  const k =
    (large === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, ((rx * ry) ** 2 - (rx * y) ** 2 - (ry * x) ** 2) / ((rx * y) ** 2 + (ry * x) ** 2)));
  const ex = (k * rx * y) / ry;
  const ey = (-k * ry * x) / rx;
  const cx = cos * ex - sin * ey + (from[0] + to[0]) / 2;
  const cy = sin * ex + cos * ey + (from[1] + to[1]) / 2;
  const [ux, uy] = [(x - ex) / rx, (y - ey) / ry];
  const [vx, vy] = [(-x - ex) / rx, (-y - ey) / ry];
  const start = Math.atan2(uy, ux);
  let turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (sweep && turn < 0) turn += 2 * Math.PI;
  else if (!sweep && turn > 0) turn -= 2 * Math.PI;
  // Even steps of the angle, short enough that no chord strays more than the tolerance from a circle of the larger
  // radius: the ellipse is that circle squashed, so its chords stray no more.
  const step = 2 * Math.acos(Math.max(0, 1 - tolerance / Math.max(rx, ry)));
  const n = pieces(Math.abs(turn) / step);
  const out: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    const t = start + (turn * i) / n;
    const [px, py] = [rx * Math.cos(t), ry * Math.sin(t)];
    out.push([cx + cos * px - sin * py, cy + sin * px + cos * py]);
  }
  out.push(to);
  return out;
}

/**
 * The outlines path data draws, as closed loops of [u, v] points in mm. It's SVG's path data (M L H V C S Q T A Z,
 * upper case to a point, lower case from the pen), with its coordinates used as they're written: x is u and y is v.
 * v points up on a sketch where SVG's y points down, so a path copied from an SVG file comes out mirrored top to
 * bottom. Every subpath is one outline (M starts the next), closed back to its start whether or not it ends with Z,
 * and its curves are cut into straight pieces none more than `tolerance` mm from the curve. Each loop keeps the way
 * it was drawn round, so, as with SVG's own nonzero fill, a hole goes round the other way from the outline it's in.
 * Loops with fewer than three points, or next to no area, are left out. Throws, saying where, when the data can't be
 * read or draws no area, or when it's over 20,000 characters or 20,000 points.
 */
export function pathContours(d: string, tolerance = PATH_TOLERANCE): Vec2[][] {
  if (!(tolerance > 0 && tolerance < Infinity))
    throw new Error(`A path's tolerance is a distance in mm above 0, not ${tolerance}.`);
  if (d.length > PATH_CHARACTERS)
    throw new Error(
      `Path data is ${count(d.length)} characters long, over the ${count(PATH_CHARACTERS)} it may be: ` +
        "draw the shape with fewer points.",
    );
  if (!d.trim()) throw new Error("Path data is empty: it starts with a move (M x y), then lines and curves.");

  let at = 0;
  // The command as it was written, which a message names.
  let written = "";
  const fail = (problem: string): never => {
    if (at >= d.length) {
      const tail = d.trimEnd();
      throw new Error(
        `Path data ends too soon, after "${tail.length > 16 ? `…${tail.slice(-16).trimStart()}` : tail}": ${problem}.`,
      );
    }
    const rest = d.slice(at);
    throw new Error(
      `Path data can't be read at "${rest.length > 16 ? `${rest.slice(0, 16).trimEnd()}…` : rest.trimEnd()}" ` +
        `(character ${at + 1}): ${problem}.`,
    );
  };
  // Between numbers: spaces, and a comma at most.
  const skip = () => {
    while (at < d.length && isSpace(d[at])) at++;
    if (d[at] !== ",") return;
    at++;
    while (at < d.length && isSpace(d[at])) at++;
  };
  const number = (): number => {
    skip();
    NUMBER.lastIndex = at;
    const match = NUMBER.exec(d);
    if (!match) return fail(`a number was expected (${written} takes ${TAKES[written.toUpperCase()]})`);
    const value = Number(match[0]);
    if (!(Math.abs(value) <= LARGEST)) return fail(`${match[0]} is too big a number to draw with`);
    at = NUMBER.lastIndex;
    return value;
  };
  // A flag is one digit, so "105" after an arc's rotation is both flags and then a 5.
  const flag = (): boolean => {
    skip();
    if (d[at] !== "0" && d[at] !== "1") return fail(`a flag, 0 or 1, was expected (${written} takes ${TAKES.A})`);
    return d[at++] === "1";
  };

  const loops: Vec2[][] = [];
  let loop: Vec2[] = [];
  let points = 0;
  let pen: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  // The last curve's control point nearest its end, which a smooth curve after it mirrors.
  let cubic: Vec2 | null = null;
  let quad: Vec2 | null = null;
  const add = (point: Vec2) => {
    const last = loop.at(-1);
    if (last && same(last, point)) return;
    if (++points > PATH_POINTS)
      throw new Error(
        `Path data draws more than ${count(PATH_POINTS)} points, the most a shape may have: ` +
          "draw it with fewer or plainer curves.",
      );
    loop.push(point);
  };
  const finish = () => {
    // Coming back to the start is the closing edge, not a point of its own.
    while (loop.length > 1 && same(loop[0], loop.at(-1)!)) loop.pop();
    if (loop.length >= 3 && spread(loop) >= LEAST_AREA) loops.push(loop);
    loop = [];
  };
  // After a Z, the next line starts a new outline where the last one started, as SVG has it.
  const lineTo = (point: Vec2) => {
    if (!loop.length) add(pen);
    add(point);
    pen = point;
  };
  const mirror = (control: Vec2): Vec2 => [2 * pen[0] - control[0], 2 * pen[1] - control[1]];

  let command = "";
  for (skip(); at < d.length; skip()) {
    const char = d[at];
    if (COMMANDS.includes(char)) {
      if (!command && char !== "M" && char !== "m") fail("it has to start with a move, M x y");
      command = written = char;
      at++;
    } else if (!command) fail("it has to start with a move, M x y");
    else if (!/[\d.+-]/.test(char))
      fail("a command letter was expected: M, L, H, V, C, S, Q, T, A or Z, or lower case to go from the pen");
    else if (command === "Z" || command === "z") fail(`a command letter was expected, as ${command} takes no numbers`);
    // More numbers repeat the command, though after a move they're lines.
    else if (command === "M") command = "L";
    else if (command === "m") command = "l";

    const [ox, oy] = command === command.toLowerCase() ? pen : [0, 0];
    const point = (): Vec2 => [ox + number(), oy + number()];
    const lastCubic: Vec2 | null = cubic;
    const lastQuad: Vec2 | null = quad;
    cubic = quad = null;
    switch (command.toUpperCase()) {
      case "M": {
        const to = point();
        finish();
        pen = start = to;
        add(to);
        break;
      }
      case "Z":
        finish();
        pen = start;
        break;
      case "L":
        lineTo(point());
        break;
      case "H":
        lineTo([ox + number(), pen[1]]);
        break;
      case "V":
        lineTo([pen[0], oy + number()]);
        break;
      case "C":
      case "S": {
        // A smooth curve's first control point mirrors the last curve's second, or is the pen after anything else.
        const first: Vec2 = command.toUpperCase() === "C" ? point() : lastCubic ? mirror(lastCubic) : pen;
        const second = point();
        bezierPoints([pen, first, second, point()], tolerance).forEach(lineTo);
        cubic = second;
        break;
      }
      case "Q":
      case "T": {
        const control: Vec2 = command.toUpperCase() === "Q" ? point() : lastQuad ? mirror(lastQuad) : pen;
        bezierPoints([pen, control, point()], tolerance).forEach(lineTo);
        quad = control;
        break;
      }
      case "A": {
        const radii: Vec2 = [number(), number()];
        const rotation = number();
        const large = flag();
        const sweep = flag();
        arcPoints(pen, point(), radii, rotation, large, sweep, tolerance).forEach(lineTo);
        break;
      }
    }
  }
  finish();
  if (!loops.length)
    throw new Error("Path data draws no area: an outline needs three points or more, not all on one line.");
  return loops;
}
