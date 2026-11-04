import type { OutlineShape, PathShape, Vec2 } from "../../studio/document";

// What a sketch's Line and Arc tools draw: one chain, as CAD's do, of straight pieces and arcs end to end, each from
// where the last one ended. Closed, on its first point or by Enter, it's a shape add_sketch_shape takes: a polygon when
// it's all straight, so its corners can be rounded, or a path when it has arcs.

/** One piece of the chain: to `to`, straight, or an arc through `through` on the way (CAD's 3-point arc). */
export type ChainPiece = { to: Vec2; through?: Vec2 };

const tidy = (value: number) => Number(value.toFixed(3)) + 0;
const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;
/** Twice the signed area of a, b, c: above 0 when they turn counter-clockwise (v up), 0 in a line. */
const turn = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** The circle through three points, or null when they're in a line. */
function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * turn(a, b, c);
  if (Math.abs(d) < 1e-9) return null;
  const square = (p: Vec2) => p[0] ** 2 + p[1] ** 2;
  const center: Vec2 = [
    (square(a) * (b[1] - c[1]) + square(b) * (c[1] - a[1]) + square(c) * (a[1] - b[1])) / d,
    (square(a) * (c[0] - b[0]) + square(b) * (a[0] - c[0]) + square(c) * (b[0] - a[0])) / d,
  ];
  return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
}

/** Points along the arc from `from` through `through` to `to`, ending exactly on `to`, for drawing it: just `to` where
 *  the three are in a line. */
export function arcPoints(from: Vec2, through: Vec2, to: Vec2): Vec2[] {
  const circle = circleThrough(from, through, to);
  if (!circle) return [to];
  const { center, radius } = circle;
  const angle = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const start = angle(from);
  let sweep = angle(to) - start;
  // The way round that passes `through`.
  if (turn(from, through, to) > 0) {
    if (sweep <= 0) sweep += 2 * Math.PI;
  } else if (sweep >= 0) sweep -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
  return Array.from({ length: steps }, (_, i): Vec2 => {
    if (i === steps - 1) return to;
    const at = start + (sweep * (i + 1)) / steps;
    return [center[0] + radius * Math.cos(at), center[1] + radius * Math.sin(at)];
  });
}

/** The chain as it's drawn so far, arcs as short straight steps. */
export function chainPoints(start: Vec2, pieces: readonly ChainPiece[]): Vec2[] {
  const points: Vec2[] = [start];
  for (const piece of pieces) {
    const from = points[points.length - 1];
    points.push(...(piece.through ? arcPoints(from, piece.through, piece.to) : [piece.to]));
  }
  return points;
}

/** The chain closed into a shape, back to its start in a straight line where it doesn't end there; null where it
 *  encloses nothing yet (one straight piece, say). */
export function chainShape(start: Vec2, pieces: readonly ChainPiece[]): OutlineShape | PathShape | null {
  let from = start;
  const steps = pieces.map((piece) => {
    const circle = piece.through ? circleThrough(from, piece.through, piece.to) : null;
    const step = { from, to: piece.to, through: piece.through, circle };
    from = piece.to;
    return step;
  });
  if (!steps.some((step) => step.circle)) {
    const points = [start, ...pieces.map((piece) => piece.to)].filter(
      (point, i, all) => i === 0 || !same(point, all[i - 1]),
    );
    if (points.length > 1 && same(points[points.length - 1], start)) points.pop();
    return points.length >= 3 ? { type: "polygon", points } : null;
  }
  const at = ([u, v]: Vec2) => `${tidy(u)} ${tidy(v)}`;
  const d = [`M ${at(start)}`];
  for (const { from: a, to, through, circle } of steps) {
    if (!circle || !through) {
      d.push(`L ${at(to)}`);
      continue;
    }
    // The longer way round where the centre is on the far side of the chord; arcs' sweep 1 turns counter-clockwise.
    const large = Math.sign(turn(a, to, through)) === Math.sign(turn(a, to, circle.center)) ? 1 : 0;
    const sweep = turn(a, through, to) > 0 ? 1 : 0;
    const radius = tidy(circle.radius);
    d.push(`A ${radius} ${radius} 0 ${large} ${sweep} ${at(to)}`);
  }
  d.push("Z");
  return { type: "path", d: d.join(" ") };
}
