import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from "./vec";

// What the measure tool works out, as CAD measures: the shortest distance between two picks (points, straight edges and
// flat faces, all in the world in mm), where it runs from and to, the angle between them, and a pick's own size.

export type Triangle = [Vec3, Vec3, Vec3];

export type Measurable =
  | { kind: "point"; point: Vec3 }
  | { kind: "edge"; a: Vec3; b: Vec3 }
  /** A flat face as its triangles, and its outward normal. */
  | { kind: "face"; triangles: Triangle[]; normal: Vec3 };

export type Closest = { distance: number; from: Vec3; to: Vec3 };

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The point on segment ab nearest p. */
export function nearestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const span = dot(ab, ab);
  return span < 1e-24 ? a : lerp(a, b, clamp01(dot(sub(p, a), ab) / span));
}

/** The point on triangle abc nearest p (Ericson, Real-Time Collision Detection 5.1.5). */
export function nearestOnTriangle(p: Vec3, [a, b, c]: Triangle): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

/** The nearest points of segments p1q1 and p2q2 (Ericson 5.1.9). */
function nearestBetweenSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): [Vec3, Vec3] {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  if (a < 1e-24 && e < 1e-24) return [p1, p2];
  let s: number;
  let t: number;
  if (a < 1e-24) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e < 1e-24) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-24 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return [lerp(p1, q1, s), lerp(p2, q2, t)];
}

/** Where segment pq passes through triangle abc, if it does. */
function throughTriangle(p: Vec3, q: Vec3, [a, b, c]: Triangle): Vec3 | null {
  const direction = sub(q, p);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(direction, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-18) return null;
  const s = sub(p, a);
  const u = dot(s, h) / det;
  if (u < 0 || u > 1) return null;
  const qv = cross(s, e1);
  const v = dot(direction, qv) / det;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qv) / det;
  return t < 0 || t > 1 ? null : lerp(p, q, t);
}

type Primitive = { points: Vec3[]; edges: [Vec3, Vec3][]; triangles: Triangle[] };
type Box = { min: Vec3; max: Vec3 };

const boxOf = (points: Vec3[]): Box => ({
  min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))) as Vec3,
  max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))) as Vec3,
});
const boxGap = (a: Box, b: Box) =>
  Math.hypot(...[0, 1, 2].map((axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));

/** Each pick as the pieces the distance is found between: a point, a segment, or each of a face's triangles, each
 *  with the box round it. */
function piecesOf(item: Measurable): { box: Box; shape: Primitive }[] {
  const piece = (corners: Vec3[], shape: Partial<Primitive>) => ({
    box: boxOf(corners),
    shape: { points: [], edges: [], triangles: [], ...shape },
  });
  if (item.kind === "point") return [piece([item.point], { points: [item.point] })];
  if (item.kind === "edge") return [piece([item.a, item.b], { edges: [[item.a, item.b]] })];
  return item.triangles.map((triangle) => piece(triangle, { triangles: [triangle] }));
}

/** The nearest points of two pieces: each a point, a segment or a triangle. */
function nearestPieces(x: Primitive, y: Primitive): [Vec3, Vec3] {
  const best = {
    distance: Infinity,
    pair: [
      [0, 0, 0],
      [0, 0, 0],
    ] as [Vec3, Vec3],
  };
  const consider = (from: Vec3, to: Vec3) => {
    const distance = length(sub(to, from));
    if (distance < best.distance) {
      best.distance = distance;
      best.pair = [from, to];
    }
  };
  // A segment of one through a triangle of the other meets it there.
  for (const [p, q] of [...x.edges, ...x.triangles.flatMap(sides)])
    for (const triangle of y.triangles) {
      const hit = throughTriangle(p, q, triangle);
      if (hit) return [hit, hit];
    }
  for (const [p, q] of [...y.edges, ...y.triangles.flatMap(sides)])
    for (const triangle of x.triangles) {
      const hit = throughTriangle(p, q, triangle);
      if (hit) return [hit, hit];
    }
  const xPoints = [...x.points, ...x.edges.flat(), ...x.triangles.flat()];
  const yPoints = [...y.points, ...y.edges.flat(), ...y.triangles.flat()];
  const xSegments = [...x.edges, ...x.triangles.flatMap(sides)];
  const ySegments = [...y.edges, ...y.triangles.flatMap(sides)];
  for (const p of x.points) for (const q of y.points) consider(p, q);
  for (const p of xPoints) {
    for (const [a, b] of ySegments) consider(p, nearestOnSegment(p, a, b));
    for (const triangle of y.triangles) consider(p, nearestOnTriangle(p, triangle));
  }
  for (const q of yPoints) {
    for (const [a, b] of xSegments) consider(nearestOnSegment(q, a, b), q);
    for (const triangle of x.triangles) consider(nearestOnTriangle(q, triangle), q);
  }
  for (const [p1, q1] of xSegments)
    for (const [p2, q2] of ySegments) {
      const [from, to] = nearestBetweenSegments(p1, q1, p2, q2);
      consider(from, to);
    }
  return best.pair;
}

const sides = ([a, b, c]: Triangle): [Vec3, Vec3][] => [
  [a, b],
  [b, c],
  [c, a],
];

/** The shortest distance between two picks, and the points it runs between: 0 where they touch or cross. */
export function closestBetween(x: Measurable, y: Measurable): Closest {
  const xs = piecesOf(x);
  const ys = piecesOf(y);
  let best: Closest = { distance: Infinity, from: xs[0].box.min, to: ys[0].box.min };
  // A pair whose boxes are further apart than the best so far can't do better: big faces stay quick.
  for (const a of xs)
    for (const b of ys) {
      if (boxGap(a.box, b.box) >= best.distance) continue;
      const [from, to] = nearestPieces(a.shape, b.shape);
      const distance = length(sub(to, from));
      if (distance < best.distance) best = { distance, from, to };
      if (distance === 0) return best;
    }
  return best;
}

/** The angle between two picks that have a direction, in degrees from 0 (parallel) to 90 (square): between two
 *  edges, two faces' planes, or an edge and a face's plane. Null where either is a point. */
export function angleBetween(x: Measurable, y: Measurable): number | null {
  if (x.kind === "point" || y.kind === "point") return null;
  const way = (item: Exclude<Measurable, { kind: "point" }>) =>
    normalize(item.kind === "edge" ? sub(item.b, item.a) : item.normal);
  const cosine = Math.min(1, Math.abs(dot(way(x), way(y))));
  const between = (Math.acos(cosine) * 180) / Math.PI;
  // An edge against a face's plane is the angle off the plane, not off its normal.
  return x.kind !== y.kind ? 90 - between : between;
}

/** A flat face's area, in mm². */
export function areaOf(triangles: Triangle[]): number {
  return triangles.reduce((sum, [a, b, c]) => sum + length(cross(sub(b, a), sub(c, a))) / 2, 0);
}
