// GENERATED from frontend/src/studio/threads.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";
import { revolveProfile, type Own } from "./solids.generated";
import type { Vec2 } from "./vec.generated";

// ISO metric screw threads as solids: a threaded rod, or the solid a matching threaded hole is cut with, on ISO 68-1's
// profile and ISO 261's coarse pitches. Each is the rod's cross-section at z = 0, its radius following the profile once
// round, extruded with a twist of a turn per pitch: every point of the section then runs along the helix exactly.

export type ThreadSpec = {
  /** Nominal (major) diameter, mm: 8 for M8. */
  diameter: number;
  /** mm from one crest to the next along the axis: 1.25 for M8's coarse thread. */
  pitch: number;
  /** Along +Z from z = 0, the thread's axis on Z through the origin. */
  length: number;
  /** false: a threaded rod (an external thread). true: the solid a matching threaded hole is cut with. */
  internal: boolean;
  /** mm added to an internal cutter's radius, taken off an external rod's, so printed parts fit together. */
  clearance: number;
  /** Right climbs counter-clockwise seen from above (+Z), as nearly every screw does; left the other way. */
  hand: "right" | "left";
  /** A 45° lead-in at both ends: a rod's ends chamfered down to its root, a cutter's flared out like a countersink. */
  chamfer: boolean;
  /** Points round one turn. */
  segments: number;
};

/** The fundamental triangle's height, per mm of pitch: ISO 68-1's H. */
const H = Math.sqrt(3) / 2;
/** Layers per turn: the helix's chords between them stay within 0.5% of the radius. */
const LAYERS_PER_TURN = 32;
const MAX_TURNS = 1000;
const MIN_SEGMENTS = 16;
const MAX_SEGMENTS = 256;

// ISO 261's coarse series, first to third choice: [pitch, the nominal diameters that have it].
const ISO_COARSE: [number, number[]][] = [
  [0.25, [1, 1.1, 1.2]],
  [0.3, [1.4]],
  [0.35, [1.6, 1.8]],
  [0.4, [2]],
  [0.45, [2.2, 2.5]],
  [0.5, [3]],
  [0.6, [3.5]],
  [0.7, [4]],
  [0.75, [4.5]],
  [0.8, [5]],
  [1, [6, 7]],
  [1.25, [8, 9]],
  [1.5, [10, 11]],
  [1.75, [12]],
  [2, [14, 16]],
  [2.5, [18, 20, 22]],
  [3, [24, 27]],
  [3.5, [30, 33]],
  [4, [36, 39]],
  [4.5, [42, 45]],
  [5, [48, 52]],
  [5.5, [56, 60]],
  [6, [64]],
];

/** ISO 261 coarse pitch for a diameter (the nearest standard size's, M1 to M64; the smaller of two equally near). */
export function isoPitch(diameter: number): number {
  let best = ISO_COARSE[0][0];
  let off = Infinity;
  for (const [pitch, sizes] of ISO_COARSE) {
    for (const size of sizes) {
      if (Math.abs(size - diameter) < off) {
        off = Math.abs(size - diameter);
        best = pitch;
      }
    }
  }
  return best;
}

const mm = (value: number) => `${Number(value.toFixed(3))} mm`;

/** Why a spec can't be made, in words a person or an AI can act on; null when it can. */
export function threadProblem(spec: ThreadSpec): string | null {
  const { diameter: d, pitch: p, length, clearance: c, segments } = spec;
  // Written so a NaN fails each check too.
  if (!(d >= 1 && d <= 200)) return `A thread's diameter has to be from 1 to 200 mm (8 for M8), not ${d}`;
  if (!(p > 0 && p <= d / 3))
    return `The pitch has to be more than 0 and at most a third of the diameter, ${mm(d / 3)} here, not ${p}: the standard coarse pitch for ${mm(d)} is ${mm(isoPitch(d))}`;
  if (!(length >= p)) return `A thread has to be at least one pitch (${mm(p)}) long, not ${length}`;
  if (length / p > MAX_TURNS)
    return `That's ${Math.ceil(length / p)} turns, more than the ${MAX_TURNS.toLocaleString("en")} a thread may have: make it shorter or its pitch coarser`;
  if (!(c >= 0 && c <= 1)) return `The clearance has to be from 0 to 1 mm (0.1 to 0.2 suits most printers), not ${c}`;
  const core = d / 2 - (17 / 24) * H * p;
  if (!spec.internal && c > core / 2)
    return `A clearance of ${mm(c)} is too much for this rod: it would take more than half its core; at most ${mm(core / 2)}`;
  if (!(Number.isInteger(segments) && segments >= MIN_SEGMENTS && segments <= MAX_SEGMENTS))
    return `A thread's segments have to be a whole number from ${MIN_SEGMENTS} to ${MAX_SEGMENTS}, not ${segments}`;
  return null;
}

/** The thread's radius `v` along the axis from the middle of the nearest crest, from 0 to half a pitch. */
function profileRadius(spec: ThreadSpec, v: number): number {
  const p = spec.pitch;
  const h = H * p;
  const major = spec.diameter / 2 + (spec.internal ? spec.clearance : -spec.clearance);
  if (v <= p / 16) return major;
  if (v <= (3 * p) / 8) return major - (v - p / 16) * Math.sqrt(3);
  // Between the flanks: a nut's crest, flat at the basic minor diameter; or a rod's root, rounded with ISO's radius of
  // H/6 down to its smaller root diameter, which leaves room under the nut's crest.
  if (spec.internal) return major - (5 * h) / 8;
  const radius = h / 6;
  const centre = major - (17 * h) / 24 + radius;
  return centre - Math.sqrt(Math.max(0, radius * radius - (p / 2 - v) ** 2));
}

/** Where the section's points fall along one pitch: `segments` evenly, and the profile's corners between them. */
function phases(spec: ThreadSpec): number[] {
  const p = spec.pitch;
  const all = [p / 16, (3 * p) / 8, (5 * p) / 8, (15 * p) / 16];
  for (let i = 0; i < spec.segments; i++) all.push((i * p) / spec.segments);
  const kept: number[] = [];
  for (const u of all.toSorted((a, b) => a - b)) if (!kept.length || u - kept[kept.length - 1] > p * 1e-6) kept.push(u);
  return kept;
}

/** The section at z = 0, its crest on +X: the profile `u` along the pitch lies `u / pitch` of a turn round. */
function sectionPoints(spec: ThreadSpec): Vec2[] {
  const p = spec.pitch;
  return phases(spec).map((u): Vec2 => {
    const r = profileRadius(spec, Math.min(u, p - u));
    const angle = (2 * Math.PI * u) / p;
    return [r * Math.cos(angle), r * Math.sin(angle)];
  });
}

/** The section swept along the helix from z = `from` to `to`: turned a turn per pitch, the way the hand climbs. */
function sweep(own: Own, section: CrossSection, spec: ThreadSpec, from: number, to: number): Manifold {
  // Manifold twists counter-clockwise seen from above, which is how a right hand climbs.
  const turn = (z: number) => ((spec.hand === "right" ? 360 : -360) * z) / spec.pitch;
  const layers = Math.ceil(((to - from) / spec.pitch) * LAYERS_PER_TURN);
  const start = own(section.rotate(turn(from)));
  return own(own(start.extrude(to - from, layers - 1, turn(to) - turn(from))).translate([0, 0, from]));
}

/** A rod's ends cut back at 45° from just inside its root, as (radius, height) to be turned about Z. */
function rodLeadIns(spec: ThreadSpec): Vec2[] {
  const { pitch: p, length } = spec;
  const crest = spec.diameter / 2 - spec.clearance;
  // A hair inside the root, so the end's circle doesn't graze the root's lowest point.
  const end = crest - (17 / 24) * H * p - p / 100;
  const rise = Math.min(crest + p / 8 - end, length / 2);
  const outline: Vec2[] = [
    [0, 0],
    [end, 0],
    [end + rise, rise],
  ];
  if (rise < length / 2) outline.push([end + rise, length - rise]);
  outline.push([end, length], [0, length]);
  return outline;
}

/** A cutter's countersink at z = 0, past the end by `over`, as (radius, height) to be turned about Z. */
function cutterFlare(spec: ThreadSpec, over: number): Vec2[] {
  const p = spec.pitch;
  const major = spec.diameter / 2 + spec.clearance;
  // A hair past the major, so the cone doesn't meet the crest's flat right on the end face; and down to under the
  // minor, where the cutter is solid all round and buries the cone's tip.
  const mouth = major + p / 100;
  const inner = major - (5 / 8) * H * p - p / 8;
  return [
    [0, -over],
    [mouth + over, -over],
    [inner, mouth - inner],
    [0, mouth - inner],
  ];
}

/**
 * An ISO metric thread along +Z from z = 0, its axis on Z: a rod, or the solid that cuts the matching hole (subtract it
 * from a body). The crest is on +X at z = 0 for both, so a rod and a cutter of the same spec line up. Throws, saying
 * what to change, for a spec that can't be made.
 */
export function threadSolid(wasm: ManifoldToplevel, own: Own, spec: ThreadSpec): Manifold {
  const problem = threadProblem(spec);
  if (problem) throw new Error(problem);
  const section = own(new wasm.CrossSection([sectionPoints(spec)], "Positive"));
  let solid: Manifold;
  if (!spec.chamfer) solid = sweep(own, section, spec, 0, spec.length);
  else {
    // Past both ends, so the end faces are cut through the thread rather than lying on its own.
    const over = spec.pitch / 4;
    const long = sweep(own, section, spec, -over, spec.length + over);
    if (spec.internal) {
      const bottom = cutterFlare(spec, over);
      const top = bottom.map(([r, z]): Vec2 => [r, spec.length - z]);
      const flared = own(
        wasm.Manifold.union([
          long,
          revolveProfile(own, wasm, bottom, spec.segments),
          revolveProfile(own, wasm, top, spec.segments),
        ]),
      );
      solid = own(own(flared.trimByPlane([0, 0, 1], 0)).trimByPlane([0, 0, -1], -spec.length));
    } else solid = own(long.intersect(revolveProfile(own, wasm, rodLeadIns(spec), spec.segments)));
  }
  if (solid.status() !== "NoError" || solid.isEmpty()) throw new Error("The thread couldn't be made as a solid");
  return solid;
}

/**
 * Roughly how many triangles threadSolid makes, so a server can refuse one far too heavy before making it. A spec
 * threadSolid refuses counts as none: making it is what says why.
 */
export function threadTriangles(spec: ThreadSpec): number {
  if (threadProblem(spec)) return 0;
  // Two per point per layer round the sides, and the end caps. A chamfer trades the ends' thread for its cones' about
  // evenly.
  const points = phases(spec).length;
  const layers = Math.ceil((spec.length / spec.pitch) * LAYERS_PER_TURN);
  return 2 * points * layers + 2 * (points - 2);
}
