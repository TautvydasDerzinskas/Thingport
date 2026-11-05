import type { Vec2 } from "./vec";

// Outlines on a plane: rounding their corners, and moving their edges in or out while every corner keeps its place in
// the list, which is what a tapered or rounded extrude is lofted from.

/** Positive for a counter-clockwise outline. */
export function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len2 = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return [a[0] / l, a[1] / l];
};

/** A corner's rounding or bevel, by its index in the outline. */
export type CornerTreatment = { type: "fillet" | "chamfer"; size: number };

/**
 * The outline with the corners `treat` names rounded (an arc of the size's radius, tangent to both edges) or bevelled
 * (cut back the size's distance along both). Convex and inside corners alike. Throws when an edge is too short for
 * what its two corners take from it.
 */
export function treatCorners(
  points: readonly Vec2[],
  treat: (index: number) => CornerTreatment | null,
  segmentsPerQuarter = 8,
): Vec2[] {
  const n = points.length;
  const plans = points.map((corner, i) => {
    const treatment = treat(i);
    if (!treatment || treatment.size <= 0) return null;
    const toPrev = unit2(sub2(points[(i - 1 + n) % n], corner));
    const toNext = unit2(sub2(points[(i + 1) % n], corner));
    const cos = Math.max(-1, Math.min(1, toPrev[0] * toNext[0] + toPrev[1] * toNext[1]));
    const angle = Math.acos(cos);
    // A straight run has no corner to round.
    if (angle > Math.PI - 1e-6) return null;
    const along = treatment.type === "fillet" ? treatment.size / Math.tan(angle / 2) : treatment.size;
    return { treatment, toPrev, toNext, angle, along };
  });
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const used = (plans[i]?.along ?? 0) + (plans[next]?.along ?? 0);
    if (used > len2(sub2(points[next], points[i])) + 1e-9)
      throw new Error("The corner radius or chamfer is too big for the shape's edges");
  }
  const out: Vec2[] = [];
  points.forEach((corner, i) => {
    const plan = plans[i];
    if (!plan) return void out.push(corner);
    const from: Vec2 = [corner[0] + plan.toPrev[0] * plan.along, corner[1] + plan.toPrev[1] * plan.along];
    const to: Vec2 = [corner[0] + plan.toNext[0] * plan.along, corner[1] + plan.toNext[1] * plan.along];
    if (plan.treatment.type === "chamfer") return void out.push(from, to);
    // The arc's centre is along the corner's bisector, on the side of the smaller angle between its edges.
    const bisector = unit2([plan.toPrev[0] + plan.toNext[0], plan.toPrev[1] + plan.toNext[1]]);
    const reach = plan.treatment.size / Math.sin(plan.angle / 2);
    const center: Vec2 = [corner[0] + bisector[0] * reach, corner[1] + bisector[1] * reach];
    const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
    let sweep = Math.atan2(to[1] - center[1], to[0] - center[0]) - start;
    // The short way round: the arc facing the corner.
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const steps = Math.max(2, Math.ceil((segmentsPerQuarter * Math.abs(sweep)) / (Math.PI / 2)));
    for (let s = 0; s <= steps; s++) {
      const a = start + (sweep * s) / steps;
      out.push([center[0] + Math.cos(a) * plan.treatment.size, center[1] + Math.sin(a) * plan.treatment.size]);
    }
  });
  return out;
}

/**
 * Every edge moved `d` to its left, with mitred corners: into the material for a counter-clockwise outline and for a
 * clockwise hole alike. Corner i of the result is corner i moved. Null when a corner is too sharp to mitre.
 */
export function insetOutline(points: readonly Vec2[], d: number): Vec2[] | null {
  const n = points.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const e1 = unit2(sub2(p, points[(i - 1 + n) % n]));
    const e2 = unit2(sub2(points[(i + 1) % n], p));
    const n1: Vec2 = [-e1[1], e1[0]];
    const n2: Vec2 = [-e2[1], e2[0]];
    const denominator = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    if (denominator < 1e-3) return null;
    out.push([p[0] + (d * (n1[0] + n2[0])) / denominator, p[1] + (d * (n1[1] + n2[1])) / denominator]);
  }
  return out;
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const orient = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/**
 * Whether `moved` is still the same outlines as `original`, only smaller or bigger: every edge pointing the way it did,
 * and no edge crossing another. When an inset goes past a narrow part, edges flip or cross, and a solid lofted through
 * it would fold into itself.
 */
export function stillValid(original: readonly Vec2[][], moved: readonly Vec2[][]): boolean {
  for (let c = 0; c < original.length; c++) {
    const before = original[c];
    const after = moved[c];
    for (let i = 0; i < before.length; i++) {
      const j = (i + 1) % before.length;
      const was = sub2(before[j], before[i]);
      const now = sub2(after[j], after[i]);
      if (was[0] * now[0] + was[1] * now[1] <= 0) return false;
    }
  }
  const edges: [Vec2, Vec2, number, number][] = [];
  moved.forEach((outline, c) =>
    outline.forEach((point, i) => edges.push([point, outline[(i + 1) % outline.length], c, i])),
  );
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b, ca, ia] = edges[i];
      const [c, d, cb, ib] = edges[j];
      if (ca === cb) {
        const count = moved[ca].length;
        if (Math.abs(ia - ib) <= 1 || Math.abs(ia - ib) === count - 1) continue;
      }
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}
