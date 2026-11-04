import type { Vec3 } from "../../studio/document";
import { angleBetween, areaOf, closestBetween, type Measurable } from "../../studio/measure";
import { sub } from "../../studio/vec";
import type { BodyStats, Picked } from "./StudioViewport";

// The measure tool's readings, as CAD's measure dialog gives them: one pick's own size, or what lies between two. It
// only looks: nothing it does changes the design, so it's no command.

export type MeasureFilter = "point" | "edge" | "face" | "body";
export const MEASURE_FILTERS: MeasureFilter[] = ["point", "edge", "face", "body"];

/** The gap between two bodies, as the page's worker measures it (studio_measure's). */
export type BodyGap = { gap: number; overlap: number } | { failure: string };

/** One line of the readout: what it is, and its value, in mm, mm², mm³ or degrees. */
export type Reading =
  | { key: "x" | "y" | "z" | "dx" | "dy" | "dz" | "distance" | "length" | "gap"; kind: "length"; value: number }
  | { key: "area"; kind: "area"; value: number }
  | { key: "volume" | "overlap"; kind: "volume"; value: number }
  | { key: "angle"; kind: "angle"; value: number }
  | { key: "size"; kind: "size"; value: Vec3 }
  | { key: "touching" | "far" | "openMesh" | "measuring"; kind: "note" }
  | { key: "failed"; kind: "failure"; message: string };

/** mm: the farthest the worker looks for a gap between two bodies. */
const SEARCH = 1000;

function measurable(picked: Picked): Measurable | null {
  if (picked.kind === "point") return { kind: "point", point: picked.point.point };
  if (picked.kind === "edge") return { kind: "edge", a: picked.edge.a, b: picked.edge.b };
  if (picked.kind === "face") return { kind: "face", triangles: picked.region, normal: picked.face.normal };
  return null;
}

/** What the picks so far measure, and the line the view draws for a distance. */
export function readingsOf(
  picks: Picked[],
  stats: ReadonlyMap<string, BodyStats>,
  gap: BodyGap | null,
): { readings: Reading[]; line: [Vec3, Vec3] | null } {
  const [first, second] = picks;
  if (!first) return { readings: [], line: null };
  if (first.kind === "body") {
    if (!second) {
      const body = stats.get(first.body);
      if (!body) return { readings: [], line: null };
      const size = sub(body.bounds.max, body.bounds.min);
      return {
        readings: [
          { key: "size", kind: "size", value: size },
          Number.isFinite(body.volume)
            ? { key: "volume", kind: "volume", value: body.volume }
            : { key: "openMesh", kind: "note" },
        ],
        line: null,
      };
    }
    if (!gap) return { readings: [{ key: "measuring", kind: "note" }], line: null };
    if ("failure" in gap) return { readings: [{ key: "failed", kind: "failure", message: gap.failure }], line: null };
    if (gap.overlap > 0) return { readings: [{ key: "overlap", kind: "volume", value: gap.overlap }], line: null };
    if (gap.gap === 0) return { readings: [{ key: "touching", kind: "note" }], line: null };
    if (gap.gap >= SEARCH) return { readings: [{ key: "far", kind: "note" }], line: null };
    return { readings: [{ key: "gap", kind: "length", value: gap.gap }], line: null };
  }

  const one = measurable(first)!;
  if (!second) {
    if (one.kind === "point")
      return {
        readings: (["x", "y", "z"] as const).map((key, axis) => ({ key, kind: "length", value: one.point[axis] })),
        line: null,
      };
    if (one.kind === "edge")
      return {
        readings: [{ key: "length", kind: "length", value: Math.hypot(...sub(one.b, one.a)) }],
        line: null,
      };
    return { readings: [{ key: "area", kind: "area", value: areaOf(one.triangles) }], line: null };
  }
  const other = measurable(second)!;
  const closest = closestBetween(one, other);
  const delta = sub(closest.to, closest.from);
  const angle = angleBetween(one, other);
  return {
    readings: [
      { key: "distance", kind: "length", value: closest.distance },
      ...(["dx", "dy", "dz"] as const).map((key, axis): Reading => ({
        key,
        kind: "length",
        value: Math.abs(delta[axis]),
      })),
      ...(angle === null ? [] : [{ key: "angle", kind: "angle", value: angle } as const]),
    ],
    line: closest.distance > 0 ? [closest.from, closest.to] : null,
  };
}
