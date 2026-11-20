import type { Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import { DEFAULT_SEGMENTS, type SplitFeature } from "./document";
import type { Own } from "./solids";
import { add, cross, frameMatrix, invertAffine, scale, type Vec3 } from "./vec";

const DIGITS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [0.25, 2.7, 1.2, 0.35],
  b: [1.4, 1.65, 0.35, 1.25],
  c: [1.4, 0.15, 0.35, 1.25],
  d: [0.25, 0, 1.2, 0.35],
  e: [0, 0.15, 0.35, 1.25],
  f: [0, 1.65, 0.35, 1.25],
  g: [0.25, 1.35, 1.2, 0.35],
  p: [0, 0, 0.5, 0.5],
};

/** Engraves the radial clearance so the pieces remain identifiable after printing. */
function engrave(wasm: ManifoldToplevel, own: Own, solid: Manifold, label: string) {
  if (!label) return solid;
  const depth = 0.45;
  const cutterHeight = 0.65;
  const cuts: Manifold[] = [];
  let x = 0;
  for (const char of label) {
    for (const segment of char === "." ? "p" : (DIGITS[Number(char)] ?? "")) {
      const [dx, dy, width, height] = SEGMENTS[segment];
      const block = own(wasm.Manifold.cube([width, height, cutterHeight]));
      cuts.push(own(block.translate([x + dx, dy, 0])));
    }
    x += char === "." ? 0.75 : 2.2;
  }
  const cutter = own(wasm.Manifold.union(cuts));
  const mark = cutter.boundingBox();
  const face = solid.boundingBox();
  const expected = (cutter.volume() * depth) / cutterHeight;
  const offsets = (axis: 0 | 1) => {
    const start = face.min[axis] - mark.min[axis] + 0.4;
    const end = face.max[axis] - mark.max[axis] - 0.4;
    return start <= end ? [start, end, (start + end) / 2] : [];
  };
  for (const y of offsets(1)) {
    for (const left of offsets(0)) {
      const placed = own(cutter.translate([left, y, face.max[2] - depth]));
      if (own(solid.intersect(placed)).volume() >= expected * 0.999) return own(solid.subtract(placed));
    }
  }
  throw new Error(`The socket sample has no flat area for its ${label} mm label.`);
}

export function splitWithPins(
  wasm: ManifoldToplevel,
  own: Own,
  half: Manifold,
  feature: SplitFeature,
  point: Vec3,
  normal: Vec3,
  u: Vec3,
  hair: number,
): Manifold {
  const spec = feature.connector!;
  const v = cross(normal, u);
  const front = feature.keep === "front";
  const radius = spec.diameter / 2 + (front ? 0 : spec.clearance);
  const depth = spec.depth + (front ? 0 : spec.clearance);
  const pieces: Manifold[] = [];
  let center = point;
  for (let i = 0; i < spec.count; i++) {
    center = add(
      add(point, scale(u, spec.offset[0] + (i - (spec.count - 1) / 2) * spec.spacing)),
      scale(v, spec.offset[1]),
    );
    const cyl = (start: number, height: number) => {
      const base = own(wasm.Manifold.cylinder(height, radius, radius, DEFAULT_SEGMENTS));
      const origin = add(center, scale(normal, start));
      return own(base.transform(frameMatrix(u, v, normal, origin) as Mat4));
    };
    const seat = front ? cyl(0, Math.min(depth, 0.5)) : cyl(-depth, depth);
    const volume = seat.volume();
    if (half.isEmpty() || own(half.intersect(seat)).volume() < volume * 0.9999)
      throw new Error(
        `Connector ${i + 1} needs more material on the ${front ? "pin" : "socket"} side. Move it inward or reduce its size.`,
      );
    pieces.push(cyl(-depth, depth + hair));
  }
  const cutters = own(wasm.Manifold.union(pieces));
  const connected = own(front ? half.add(cutters) : half.subtract(cutters));
  const sample = feature.fit_sample;
  if (!sample) return connected;

  const local = own(connected.transform(invertAffine(frameMatrix(u, v, normal, center)) as Mat4));
  const side = sample.size;
  const backing = depth + 2;
  const crop = own(wasm.Manifold.cube([side, side, backing + depth]));
  const positionedCrop = own(crop.translate([-side / 2, -side / 2, front ? -depth : -backing]));
  const cut = own(local.intersect(positionedCrop));
  const facedUp = front ? own(cut.rotate(180, 0, 0)) : cut;
  const minimum = facedUp.boundingBox().min[2];
  const placed = own(facedUp.translate([0, 0, -minimum]));
  return front ? placed : engrave(wasm, own, placed, sample.label);
}
