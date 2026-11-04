import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Own } from "./solids";
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from "./vec";

// Whether a design's bodies will print as they're placed: resting on the bed and within it, each in one piece and none
// overlapping another, with no overhang that needs support and no wall too thin to print. An assistant checks its own
// work with it, and a person sees the same report.

export type PrintCheckOptions = {
  /** The printer's build volume, mm [x, y, z]; the bed is z = 0 centred on x = y = 0. */
  bed: Vec3;
  /** Steepest overhang that prints without support, in degrees from vertical (45 usual). */
  overhang: number;
  /** Thinnest wall that prints, mm (about two nozzle widths, 0.8 usual). */
  minWall: number;
};

export type BodyCheck = {
  id: string;
  size: Vec3;
  /** mm³. */
  volume: number;
  /** How far its lowest point is above the bed (floating) or below it (sunk); 0 when it sits on it. */
  aboveBed: number;
  belowBed: number;
  /** Whether it's within the build volume as it is placed. */
  fitsBed: boolean;
  /** Loose pieces in it: more than one prints as separate pieces. */
  pieces: number;
  /** Faces pointing down more steeply than options.overhang, not resting on the bed: what needs support. */
  overhang: { area: number; lowest: number } | null;
  /** Walls thinner than options.minWall: their area and the thinnest found. */
  thinWalls: { area: number; thinnest: number } | null;
};

export type PrintCheck = {
  bodies: BodyCheck[];
  /** Bodies that overlap without being joined: printed as they are, the overlap is counted twice. */
  overlaps: { a: string; b: string; volume: number }[];
  /** Plain-English lines saying what to fix, the worst first, each naming the body; empty when it's all fine. */
  problems: string[];
};

/** mm: within this of a limit meets it, so rounding never makes a problem of a body that's exactly right. */
const SLACK = 0.01;
/** Degrees: a face this little past the overhang limit is at it, as a 45° chamfer is, give or take rounding. */
const ANGLE_SLACK = 0.1;
/** mm: an overhang this low prints on the bed. The first layers squash onto it, and no support fits under them, so a
 *  small fillet along a bottom edge is no overhang. */
const BED_HOLDS = 0.4;
/** mm²: less overhang than this in one place, or less thin wall in all, is a sliver a boolean or a fillet left. */
const NOISE_AREA = 1;
/** mm³: less than this is a crumb a boolean left, or bodies only touching. */
const NOISE_VOLUME = 1e-3;
/** Triangles a body's walls are measured at, at most: enough to find a wall anywhere, few enough to be quick. */
const MAX_SAMPLES = 20_000;
/** mm: how far inside a ray starts, so it doesn't hit the triangle it starts from. */
const RAY_START = 1e-3;
/** A ray out through the far side within 60° of square has crossed a wall. Nearer tangent than that, it has only run
 *  out through a face meeting its own at an edge, as by a slightly tapered side. */
const ACROSS = 0.5;
/** mm: a triangle narrower than this is a sliver, whose normal is too unsure to go by. */
const SLIVER = 1e-4;

type Triangle = { corners: [Vec3, Vec3, Vec3]; vertices: [number, number, number]; normal: Vec3; area: number };

/** A solid's triangles, each with its outward normal and area, slivers left out; and how many vertices they share. */
function trianglesOf(solid: Manifold): { triangles: Triangle[]; vertices: number } {
  const { numProp, vertProperties, triVerts, mergeFromVert, mergeToVert } = solid.getMesh();
  const vertices = vertProperties.length / numProp;
  // A vertex copied for its other properties is one corner, so the triangles round it touch.
  const same = Uint32Array.from({ length: vertices }, (_, i) => i);
  mergeFromVert?.forEach((from, i) => (same[from] = mergeToVert[i]));
  const at = (v: number): Vec3 => [
    vertProperties[v * numProp],
    vertProperties[v * numProp + 1],
    vertProperties[v * numProp + 2],
  ];
  const triangles: Triangle[] = [];
  for (let t = 0; t < triVerts.length; t += 3) {
    const corners: [Vec3, Vec3, Vec3] = [at(triVerts[t]), at(triVerts[t + 1]), at(triVerts[t + 2])];
    const [a, b, c] = corners;
    const n = cross(sub(b, a), sub(c, a));
    const twice = length(n);
    const longest = Math.max(length(sub(b, a)), length(sub(c, b)), length(sub(a, c)));
    if (!(twice / longest >= SLIVER)) continue;
    triangles.push({
      corners,
      vertices: [same[triVerts[t]], same[triVerts[t + 1]], same[triVerts[t + 2]]],
      normal: scale(n, 1 / twice),
      area: twice / 2,
    });
  }
  return { triangles, vertices };
}

/** How much of a triangle is above height `h`, from its corners' heights lowest first, by similar triangles. */
function areaAbove([z0, z1, z2]: number[], h: number, area: number): number {
  if (h <= z0) return area;
  if (h >= z2) return 0;
  if (h >= z1) return (area * (z2 - h) ** 2) / ((z2 - z0) * (z2 - z1));
  return area * (1 - (h - z0) ** 2 / ((z1 - z0) * (z2 - z0)));
}

/**
 * The faces pointing down more steeply than `limit` degrees from vertical, above `floor`: what needs support. They're
 * gathered into patches by the edges they share. A patch narrower than a printed line, `line` wide, is left out, as
 * along a bottom edge's fillet: a line there still rests partly on the layer below. So is one too small to matter.
 */
function overhangOf(
  triangles: Triangle[],
  vertices: number,
  floor: number,
  limit: number,
  line: number,
): BodyCheck["overhang"] {
  const steep = Math.sin((Math.min(90, Math.max(0, limit) + ANGLE_SLACK) * Math.PI) / 180);
  const parent = Int32Array.from({ length: triangles.length }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // Each edge by the overhanging triangle that has it, until a second one does and it's inside a patch.
  const edges = new Map<number, { t: number; length: number }>();
  const found: { t: number; area: number; lowest: number }[] = [];
  triangles.forEach((triangle, t) => {
    if (-triangle.normal[2] <= steep) return;
    const heights = triangle.corners.map((corner) => corner[2]).toSorted((a, b) => a - b);
    const area = areaAbove(heights, floor, triangle.area);
    if (area <= 0) return;
    found.push({ t, area, lowest: Math.max(heights[0], floor) });
    for (let k = 0; k < 3; k++) {
      const [v0, v1] = [triangle.vertices[k], triangle.vertices[(k + 1) % 3]];
      const key = Math.min(v0, v1) * vertices + Math.max(v0, v1);
      const other = edges.get(key);
      if (other) {
        parent[root(t)] = root(other.t);
        edges.delete(key);
      } else edges.set(key, { t, length: length(sub(triangle.corners[(k + 1) % 3], triangle.corners[k])) });
    }
  });
  const patches = new Map<number, { area: number; lowest: number; rim: number }>();
  const patchOf = (t: number) => {
    let patch = patches.get(root(t));
    if (!patch) patches.set(root(t), (patch = { area: 0, lowest: Infinity, rim: 0 }));
    return patch;
  };
  for (const { t, area, lowest } of found) {
    const patch = patchOf(t);
    patch.area += area;
    patch.lowest = Math.min(patch.lowest, lowest);
  }
  for (const { t, length: side } of edges.values()) patchOf(t).rim += side;
  // How wide a patch is: a strip's width, a disc's radius.
  const kept = [...patches.values()].filter(
    (patch) => patch.area >= NOISE_AREA && (2 * patch.area) / patch.rim >= line,
  );
  if (!kept.length) return null;
  return {
    area: kept.reduce((sum, patch) => sum + patch.area, 0),
    lowest: Math.min(...kept.map((patch) => patch.lowest)),
  };
}

/**
 * Walls thinner than `minWall`: from the middle of each sampled triangle, a ray straight in, which across a wall leaves
 * through its far side. The area is the wall's, half the surface found thin, as a wall is found from both its faces;
 * the thinnest is the thinnest over a square millimetre or so, as the slivers a fillet leaves at its ends are thinner.
 */
function thinWallsOf(solid: Manifold, triangles: Triangle[], minWall: number): BodyCheck["thinWalls"] {
  if (!(minWall > SLACK) || !triangles.length) return null;
  const samples = Math.min(triangles.length, MAX_SAMPLES);
  const reach = minWall + 0.1;
  let total = 0;
  for (const triangle of triangles) total += triangle.area;
  let sampled = 0;
  const thin: { thickness: number; area: number }[] = [];
  for (let k = 0; k < samples; k++) {
    const { corners, normal, area } = triangles[Math.floor((k * triangles.length) / samples)];
    sampled += area;
    const middle = scale(add(add(corners[0], corners[1]), corners[2]), 1 / 3);
    const inward = scale(normal, -1);
    const [hit] = solid.rayCast(add(middle, scale(inward, RAY_START)), add(middle, scale(inward, reach)));
    if (!hit) continue;
    const thickness = RAY_START + hit.distance * (reach - RAY_START);
    if (thickness < minWall - SLACK && dot(normalize(hit.normal), inward) >= ACROSS) thin.push({ thickness, area });
  }
  // The wall each sampled square millimetre of surface stands for.
  const share = total / sampled / 2;
  const area = thin.reduce((sum, sample) => sum + sample.area, 0) * share;
  if (area < NOISE_AREA) return null;
  const thinnestFirst = thin.toSorted((a, b) => a.thickness - b.thickness);
  let covered = 0;
  // The last when rounding leaves the sum a hair short of what `area` came to.
  const thinnest =
    thinnestFirst.find((sample) => (covered += sample.area * share) >= NOISE_AREA) ?? thinnestFirst.at(-1)!;
  return { area, thinnest: thinnest.thickness };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/** A number as a person would say it: three figures, and no more than two decimals. */
const figure = (n: number) => String(Number(Number(n.toPrecision(3)).toFixed(2)) + 0);

/** "a", "a and b", "a, b and c". */
const listed = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const AXES = ["x", "y", "z"];
const EXTENTS = ["wide", "deep", "tall"];

/** What to fix, worst first: what can't print at all, then what prints wrong, then what may print poorly. */
const RANK = {
  empty: 0,
  tooBig: 1,
  offBed: 2,
  floating: 3,
  sunk: 4,
  overlap: 5,
  pieces: 6,
  overhang: 7,
  thin: 8,
} as const;

/** `weight` is how bad it is beside others of its rank: how far, how much or how many. */
type Problem = { rank: number; weight: number; text: string };

/**
 * Checks bodies (each a closed solid where it is in the world) for printing on the bed `options` describes: whether
 * each rests on the bed and fits within it, how many loose pieces it is, its overhangs that need support and walls too
 * thin to print, and which bodies overlap without being joined. Each problem found is a line in `problems`, worst
 * first, saying what to change. Sizes are in mm; a floating body's overhangs are measured as they'd be once it's moved
 * down onto the bed, as `problems` says to. A body's `plain` form, where it has one, is what its overhangs and walls
 * are judged on: a threaded body with its threads as the plain cylinders they're cut on, as CAD analyses a thread.
 */
export function checkPrint(
  wasm: ManifoldToplevel,
  own: Own,
  bodies: { id: string; solid: Manifold; plain?: Manifold }[],
  options: PrintCheckOptions,
): PrintCheck {
  const { bed } = options;
  const bedText = `${bed.map(figure).join(" × ")} mm`;
  const problems: Problem[] = [];
  const say = (rank: number, weight: number, text: string) => problems.push({ rank, weight, text });

  const checks = bodies.map(({ id, solid, plain }): BodyCheck => {
    if (solid.isEmpty()) {
      say(RANK.empty, 0, `${id} is empty: there's nothing to print.`);
      return {
        id,
        size: [0, 0, 0],
        volume: 0,
        aboveBed: 0,
        belowBed: 0,
        fitsBed: true,
        pieces: 0,
        overhang: null,
        thinWalls: null,
      };
    }
    const box = solid.boundingBox();
    const min = [...box.min] as Vec3;
    const max = [...box.max] as Vec3;
    const size = sub(max, min);
    const aboveBed = min[2] > SLACK ? min[2] : 0;
    const belowBed = min[2] < -SLACK ? -min[2] : 0;

    const tooBig = [0, 1, 2].filter((axis) => size[axis] > bed[axis] + SLACK);
    const off = [0, 1].map((axis) => Math.max(0, max[axis] - bed[axis] / 2, -bed[axis] / 2 - min[axis]));
    const offAxes = [0, 1].filter((axis) => off[axis] > SLACK && !tooBig.includes(axis));
    const fitsBed = !tooBig.length && off.every((by) => by <= SLACK) && max[2] <= bed[2] + SLACK && min[2] >= -SLACK;
    if (tooBig.length) {
      const fits = (sizes: number[], room: number[]) => sizes.every((side, axis) => side <= room[axis] + SLACK);
      const sorted = (sides: number[]) => sides.toSorted((a, b) => a - b);
      const hint = fits([size[1], size[0], size[2]], bed)
        ? "Turned 90° about z, it would fit."
        : fits(sorted(size), sorted(bed))
          ? "Turned onto another side, it would fit."
          : "Scale it down or split it.";
      const extents = tooBig.map((axis) => `${figure(size[axis])} mm ${EXTENTS[axis]}`);
      say(
        RANK.tooBig,
        Math.max(...tooBig.map((axis) => size[axis] - bed[axis])),
        `${id} doesn't fit the ${bedText} bed: it's ${listed(extents)}. ${hint}`,
      );
    }
    if (offAxes.length) {
      const amounts = offAxes.map((axis) => `${figure(off[axis])} mm in ${AXES[axis]}`);
      const fields = listed(offAxes.map((axis) => AXES[axis]));
      say(
        RANK.offBed,
        Math.max(...offAxes.map((axis) => off[axis])),
        `${id} runs off the bed by ${listed(amounts)}: move it (position ${fields}) back onto the ` +
          `${figure(bed[0])} × ${figure(bed[1])} mm bed, which is centred on x = y = 0.`,
      );
    }
    if (aboveBed)
      say(
        RANK.floating,
        aboveBed,
        `${id} is floating ${figure(aboveBed)} mm above the bed: move it down (position z) so it rests on it.`,
      );
    if (belowBed)
      say(
        RANK.sunk,
        belowBed,
        `${id} is sunk ${figure(belowBed)} mm into the bed, so its bottom won't print: ` +
          "move it up (position z) so it rests on it.",
      );

    const pieces = Math.max(1, solid.decompose().filter((piece) => own(piece).volume() > NOISE_VOLUME).length);
    if (pieces > 1) say(RANK.pieces, pieces, `${id} is in ${pieces} loose pieces: join them if it's meant to be one.`);

    const judged = plain ?? solid;
    const { triangles, vertices } = trianglesOf(judged);
    // Sunk, the bed cuts it; floating, it's measured as it will be once moved down.
    const floor = Math.max(0, min[2]) + BED_HOLDS;
    const overhang = overhangOf(triangles, vertices, floor, options.overhang, options.minWall / 2);
    if (overhang)
      say(
        RANK.overhang,
        overhang.area,
        `${id} has ${figure(overhang.area)} mm² of overhang steeper than ${figure(options.overhang)}°, lowest at ` +
          `z = ${figure(overhang.lowest)} mm: it needs support there, or turning so it faces up.`,
      );
    const thinWalls = thinWallsOf(judged, triangles, options.minWall);
    if (thinWalls)
      say(
        RANK.thin,
        thinWalls.area,
        `${id} has walls down to ${figure(thinWalls.thinnest)} mm, thinner than ${figure(options.minWall)} mm ` +
          `(${figure(thinWalls.area)} mm² of them): they may not print.`,
      );

    return {
      id,
      size: [round3(size[0]), round3(size[1]), round3(size[2])],
      volume: round3(solid.volume()),
      aboveBed: round3(aboveBed),
      belowBed: round3(belowBed),
      fitsBed,
      pieces,
      overhang: overhang && { area: round3(overhang.area), lowest: round3(overhang.lowest) },
      thinWalls: thinWalls && { area: round3(thinWalls.area), thinnest: round3(thinWalls.thinnest) },
    };
  });

  const overlaps: PrintCheck["overlaps"] = [];
  const boxes = bodies.map(({ solid }) => solid.boundingBox());
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const [p, q] = [boxes[i], boxes[j]];
      if (![0, 1, 2].every((axis) => p.min[axis] < q.max[axis] && q.min[axis] < p.max[axis])) continue;
      const volume = own(wasm.Manifold.intersection([bodies[i].solid, bodies[j].solid])).volume();
      if (volume < NOISE_VOLUME) continue;
      const [a, b] = [bodies[i].id, bodies[j].id];
      overlaps.push({ a, b, volume: round3(volume) });
      say(RANK.overlap, volume, `${a} and ${b} overlap by ${figure(volume)} mm³ without being joined: union them.`);
    }
  }

  return {
    bodies: checks,
    overlaps,
    problems: problems.toSorted((x, y) => x.rank - y.rank || y.weight - x.weight).map((problem) => problem.text),
  };
}
