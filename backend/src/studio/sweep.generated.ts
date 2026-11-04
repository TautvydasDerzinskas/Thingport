// GENERATED from frontend/src/studio/sweep.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { DEFAULT_SEGMENTS } from "./document.generated";
import type { Own } from "./solids.generated";
import {
  add,
  cross,
  distance,
  dot,
  length,
  normalize,
  perpendicular,
  scale,
  sub,
  type Vec2,
  type Vec3,
} from "./vec.generated";

// Lofts and sweeps: a solid through a run of flat outlines placed in the world, or a profile pulled along a path. Both
// are rings of points joined by straight walls into one mesh. Manifold takes a mesh that folds or runs into itself
// without complaint, and then gets booleans on it wrong, so each is checked for that here before it's handed over.

/** The most points a loft's outlines are resampled to. */
const LOFT_POINTS_MAX = 1024;
/** Outlines of different detail meet on at least this many points, so one's corners blend into the other's sides. */
const LOFT_POINTS_BLEND = 64;
/** Points closer than this are the same point, in mm. */
const SAME_POINT = 1e-6;
/** How far a curve's straight pieces may stray from it where the profile reaches furthest out, in mm. */
const SAG = 0.02;
/** A curve turns no more than this from one straight piece to the next: no coarser than a circle is drawn. */
const STEP_ANGLE = (2 * Math.PI) / DEFAULT_SEGMENTS;
const SPAN_STEPS_MAX = 128;
/** How finely a curve's span is measured before it's cut into pieces. */
const FINE = 32;
/** How far every wall has to run along a straight piece of the path, in mm. */
const ADVANCE = 1e-6;
/** Triangles a box holds before it's halved, when looking for ones that cross. */
const LEAF = 8;
/** How far a drawn profile's plane may be from the path's first point, in mm, and turned from square to it. A curve's
 *  first straight piece leans off its tangent by up to half a step, so a smooth path is allowed that as well. */
const ON_PLANE = 0.01;
const SQUARE = (0.5 * Math.PI) / 180;

const lerp = (a: Vec3, b: Vec3, w: number): Vec3 => add(a, scale(sub(b, a), w));
const figure = (value: number) => Number(value.toFixed(3));
const angleBetween = (a: Vec3, b: Vec3) => Math.atan2(length(cross(a, b)), dot(a, b));

/**
 * A solid through two or more outlines in order, each a closed flat loop of points in the world with no holes: a
 * funnel from a circle to a square, a transition between two sketches. Straight (ruled) sides between neighbours, flat
 * ends. Either winding works, and an outline may start anywhere round itself: all are wound alike, about the way the
 * loft runs, and each starts where the sides twist least. Outlines with as many points as each other are joined point
 * to point; others
 * are resampled by length to the same count (the most detailed one's, at least 64 and at most 1024), keeping their
 * corners. Throws for fewer than 2 outlines, one with fewer than 3 points, one that isn't flat or crosses itself, and a
 * loft that turns inside out or whose sides run into each other.
 */
export function loftSolid(wasm: ManifoldToplevel, own: Own, loops: Vec3[][]): Manifold {
  const total = loops.length;
  if (total < 2) throw new Error(`A loft needs at least 2 outlines, got ${total}`);
  const name = (k: number) => `Outline ${k + 1} of ${total}`;
  const outlines = loops.map((loop, k) => flatOutline(loop, name(k)));

  // Each wound counter-clockwise about the way the loft goes there, so all its walls face out.
  outlines.forEach((outline, k) => {
    const way = sub(outlines[Math.min(k + 1, total - 1)].center, outlines[Math.max(k - 1, 0)].center);
    let facing = length(way) > SAME_POINT ? dot(outline.normal, normalize(way)) : 0;
    if (Math.abs(facing) < 1e-3 && k > 0) facing = dot(outline.normal, outlines[k - 1].normal);
    if (Math.abs(facing) < 1e-3)
      throw new Error(`${name(k)} lies along the loft instead of across it: each outline has to face the next`);
    if (facing < 0) {
      outline.points.reverse();
      outline.normal = scale(outline.normal, -1);
    }
  });

  const counts = outlines.map((outline) => outline.points.length);
  const most = Math.max(...counts);
  const count = Math.min(
    LOFT_POINTS_MAX,
    counts.every((each) => each === most) ? most : Math.max(most, LOFT_POINTS_BLEND),
  );
  const rings: Vec3[][] = [];
  for (const outline of outlines) {
    const ring = resampled(outline.points, count);
    rings.push(rings.length ? leastTwisted(rings[rings.length - 1], ring) : ring);
  }

  const origin = outlines[0].center;
  const positions = positionsOf(rings);
  const triangles: number[] = [];
  const pieces: number[] = [];
  for (let k = 0; k + 1 < total; k++) {
    const from = triangles.length;
    joinRings(triangles, positions, k, k + 1, [count], count);
    // The walls closed off at both outlines: the solid between these two alone.
    pieces.push(
      signedVolume(positions, triangles, origin, from) - fanVolume(rings[k], origin) + fanVolume(rings[k + 1], origin),
    );
  }
  for (const [k, forward] of [
    [0, false],
    [total - 1, true],
  ] as const) {
    const { normal, center } = outlines[k];
    cap(triangles, wasm.triangulate([onPlane(rings[k], normal, center)]), k, count, forward);
  }

  // Every part between two outlines has to enclose some volume, the same way round as the whole: one that comes out
  // as nothing, past rounding, is folded flat onto itself.
  const volume = signedVolume(positions, triangles, origin);
  const inverted = pieces.findIndex((piece) => piece * Math.sign(volume) <= 1e-9 * Math.abs(volume));
  if (inverted >= 0)
    throw new Error(
      `The loft turns inside out between outlines ${inverted + 1} and ${inverted + 2}: each outline has to be further along than the one before it, facing it`,
    );
  if (volume < 0) flip(triangles);
  if (crossesItself(positions, triangles))
    throw new Error(
      "The loft's sides run into each other: space the outlines further apart, or keep each further along than the last",
    );
  return solidFrom(wasm, own, positions, triangles, "The loft couldn't be made into a closed solid");
}

/** A sketch's plane in the world: its origin, and its u and v axes (unit, square to each other). */
export type DrawnPlane = { origin: Vec3; u: Vec3; v: Vec3 };

/**
 * A profile pulled along a path: `contours` are the profile on its own plane in mm (outsides and holes wound opposite
 * ways, as a nonzero fill reads them); `path` is points in the world.
 *
 * With `drawn`, the contours are in that plane's [u, v], and the profile stays where it's drawn, as CAD sweeps a
 * sketch: the plane has to pass through the path's first point, square to the path there, and the solid starts on it,
 * a profile drawn beside the path sweeping beside it all the way. Throws, saying which, when it doesn't.
 *
 * Without, the contours are already square to the path at its first point, their [0, 0] on it, v (second) axis
 * pointing as close to world +Z as it can, or +Y where the path starts straight up or down, and u (first) axis v × the
 * path's direction: along +X, u is +Y and v is +Z; along +Y, u is -X and v is +Z; straight up +Z, u is +X and v is +Y,
 * as a sketch on XY extruded up. Either way it's carried along without twisting (rotation-minimizing frames).
 *
 * `smooth` runs a curve through the points (centripetal Catmull-Rom, which doesn't overshoot them), cut into pieces fine
 * enough that the profile's outside stays within 0.02 mm of it; otherwise the path is straight between them, the
 * profile mitred round each corner (on the plane halfway between the two pieces) so the walls don't pinch. `closed`
 * joins the last point back to the first (a last point repeating the first is left out), with no ends, the twist a
 * path in 3D gathers on the way round spread evenly along it so the profile meets itself; otherwise both ends are flat
 * and square to the path. Throws for fewer than 2 points (3 when closed), two in a row in the same place, an empty
 * profile, or a path that bends too tightly for the profile: one that turns tighter on the inside than the profile
 * reaches, doubles back, or comes back through the solid it has already swept.
 */
export function sweepSolid(
  wasm: ManifoldToplevel,
  own: Own,
  contours: Vec2[][],
  path: Vec3[],
  options: { closed: boolean; smooth: boolean; drawn?: DrawnPlane },
): Manifold {
  const { closed, smooth, drawn } = options;
  // Read as manifold reads a sketch: overlaps joined, outsides counter-clockwise and holes clockwise.
  const outlines = contours.filter((contour) => contour.length >= 3);
  const section = outlines.length ? own(new wasm.CrossSection(outlines, "NonZero")) : null;
  let profile = section && section.area() > 1e-9 ? (section.toPolygons() as Vec2[][]) : [];
  if (!profile.length) throw new Error("The profile is empty: it needs an outline with some area");

  const given = pathPoints(path, closed);
  const start = given[0];
  const world = drawn
    ? profile.map((outline) => outline.map(([x, y]) => add(drawn.origin, add(scale(drawn.u, x), scale(drawn.v, y)))))
    : null;
  // How far the profile reaches from the path, which a rigid move along it keeps.
  const reach = world
    ? Math.max(...world.flat().map((point) => distance(point, start)))
    : Math.max(...profile.flat().map(([x, y]) => Math.hypot(x, y)));

  let line: Line = smooth ? smoothed(given, closed, reach) : { points: given, near: given.map((_, i) => i) };
  const tight = (k: number, why: string) =>
    new Error(
      `The path bends too tightly for the profile ${smooth ? "near" : "at"} path point ${line.near[k] + 1}: ${why}`,
    );
  let pieces = piecesOf(line.points, closed);
  pieces.bends.forEach((bend, k) => {
    if (bend > 2 - 1e-9) throw tight(k, "it turns straight back on itself there");
  });
  if (closed) {
    // Carried once round, the frame comes back turned by however much the path's own turning twists it, which is
    // undone a little along every piece. Over a long straight piece that would pinch a flat profile half way, so those
    // are cut until each twists no more than a curve's step turns.
    const twist = Math.abs(carriedFrames(pieces.ways, true).twist);
    const whole = pieces.lengths.reduce((sum, each) => sum + each, 0);
    const cuts = pieces.lengths.map((each) => Math.ceil((twist * each) / whole / STEP_ANGLE));
    if (cuts.some((count) => count > 1)) {
      line = cutPieces(line, pieces, cuts, reach);
      pieces = piecesOf(line.points, closed);
    }
  }

  const { ways, lengths, bends } = pieces;
  const n = line.points.length;
  const spans = ways.length;
  const into = (k: number) => ways[(k - 1 + spans) % spans];
  const { us, twist } = carriedFrames(ways, closed);
  const whole = lengths.reduce((sum, each) => sum + each, 0);
  let along = 0;
  for (let j = 0; j < spans; j++) {
    us[j] = turned(us[j], ways[j], (-twist * along) / whole);
    along += lengths[j];
  }
  const vs = us.map((u, j) => cross(ways[j], u));
  if (drawn && world) {
    const facing = normalize(cross(drawn.u, drawn.v));
    const off = dot(sub(start, drawn.origin), facing);
    const at = `[${start.map(figure).join(", ")}]`;
    if (Math.abs(off) > ON_PLANE)
      throw new Error(
        `The profile's sketch doesn't pass through the path's first point ${at}: it's ${figure(Math.abs(off))} mm off ` +
          "it. A sweep starts where its profile is drawn, so start the path on the sketch's plane, or put the sketch there",
      );
    const leans = angleBetween(facing, ways[0]);
    const square = Math.min(leans, Math.PI - leans);
    if (square > SQUARE + (smooth ? STEP_ANGLE / 2 : 0))
      throw new Error(
        `The profile's sketch isn't square to the path where it starts: the path leaves ${at} along ` +
          `[${ways[0].map(figure).join(", ")}], ${figure((square * 180) / Math.PI)}° off square to the sketch. Start ` +
          "the path straight out of the sketch, or put the sketch on a plane square to the path's first piece",
      );
    // The profile in the path's own frame at its start; seen from behind, it's wound the other way, so it's turned back.
    profile = world.map((outline) => {
      const placed = outline.map((point): Vec2 => [dot(sub(point, start), us[0]), dot(sub(point, start), vs[0])]);
      return leans > Math.PI / 2 ? placed.toReversed() : placed;
    });
  }
  const flat = profile.flat();

  // Each ring is the profile square to the piece leaving its point, slid along that piece onto the point's plane:
  // square to the path at an open end, halfway between the pieces either side at a corner.
  const rings = line.points.map((center, k) => {
    const j = Math.min(k, spans - 1);
    const way = ways[j];
    const plane = bends[k] > 0 ? normalize(add(into(k), way)) : way;
    const lean = dot(way, plane);
    return flat.map(([x, y]) => {
      const offset = add(scale(us[j], x), scale(vs[j], y));
      return add(add(center, offset), scale(way, -dot(offset, plane) / lean));
    });
  });
  // A wall that runs backwards along its piece is where the profile, on the inside of a bend, folds over itself.
  for (let j = 0; j < spans; j++) {
    const [from, to] = [rings[j], rings[(j + 1) % n]];
    if (from.some((point, i) => dot(sub(to[i], point), ways[j]) <= ADVANCE)) {
      const k = bends[j] >= bends[(j + 1) % n] ? j : (j + 1) % n;
      throw tight(
        k,
        "on the inside of the bend the profile reaches further than the path leaves room for. Use a gentler bend, longer straight runs or a smaller profile",
      );
    }
  }

  const perRing = flat.length;
  const positions = positionsOf(rings);
  const triangles: number[] = [];
  // Which piece each triangle is on, an end with the piece it closes.
  const pieceOf: number[] = [];
  const sizes = profile.map((outline) => outline.length);
  for (let j = 0; j < spans; j++) {
    joinRings(triangles, positions, j, (j + 1) % n, sizes, perRing, Math.abs(twist * lengths[j]) > 1e-6 * whole);
    while (pieceOf.length < triangles.length / 3) pieceOf.push(j);
  }
  if (!closed) {
    const ends = wasm.triangulate(profile);
    cap(triangles, ends, 0, perRing, false);
    while (pieceOf.length < triangles.length / 3) pieceOf.push(0);
    cap(triangles, ends, n - 1, perRing, true);
    while (pieceOf.length < triangles.length / 3) pieceOf.push(spans - 1);
  }
  // With every wall running forwards, each piece lies between its ends' planes, so it can't cross itself or the
  // pieces either side: only pieces further apart need comparing.
  const apart = (a: number, b: number) => {
    const gap = Math.abs(pieceOf[a] - pieceOf[b]);
    return Math.min(gap, closed ? spans - gap : gap) > 1;
  };
  if (signedVolume(positions, triangles, line.points[0]) <= 0 || crossesItself(positions, triangles, apart))
    throw new Error(
      "The path bends too tightly for the profile: the solid it sweeps runs into itself where the path comes back within the profile's width of itself. Space the path out or use a smaller profile",
    );
  return solidFrom(wasm, own, positions, triangles, "The sweep couldn't be made into a closed solid");
}

/** A loft's outline checked: its points without repeats, the way it faces (counter-clockwise about it), its middle. */
function flatOutline(loop: Vec3[], name: string): { points: Vec3[]; normal: Vec3; center: Vec3 } {
  const points = loop.filter((point, i) => distance(point, loop[(i + 1) % loop.length]) > SAME_POINT);
  if (points.length < 3) throw new Error(`${name} has fewer than 3 points`);
  let twice: Vec3 = [0, 0, 0];
  points.forEach((point, i) => (twice = add(twice, cross(point, points[(i + 1) % points.length]))));
  const center = scale(points.reduce(add), 1 / points.length);
  const size = Math.max(...points.map((point) => distance(point, center)));
  if (length(twice) / 2 <= 1e-9 * size * size) throw new Error(`${name} has no area: its points are in a line`);
  const normal = normalize(twice);
  const off = Math.max(...points.map((point) => Math.abs(dot(sub(point, center), normal))));
  if (off > Math.max(1e-3, size * 1e-4))
    throw new Error(
      `${name} isn't flat: its points are up to ${off.toFixed(3)} mm off one plane, and a loft takes flat outlines`,
    );
  if (edgesCross(onPlane(points, normal, center)))
    throw new Error(`${name} crosses itself: give its points in order round it`);
  return { points, normal, center };
}

/**
 * Whether two edges of an outline that aren't neighbours cross. The edges are taken left to right, each compared only
 * with those still open across its left end, so an ordinary outline costs little more than sorting its edges.
 */
function edgesCross(points: Vec2[]): boolean {
  const n = points.length;
  const orient = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const edges = points
    .map((point, i) => {
      const next = points[(i + 1) % n];
      return { i, a: point, b: next, left: Math.min(point[0], next[0]), right: Math.max(point[0], next[0]) };
    })
    .toSorted((first, second) => first.left - second.left);
  let open: typeof edges = [];
  for (const edge of edges) {
    open = open.filter((other) => other.right >= edge.left);
    for (const other of open) {
      const gap = Math.abs(edge.i - other.i);
      if (gap <= 1 || gap === n - 1) continue;
      if (
        orient(edge.a, edge.b, other.a) * orient(edge.a, edge.b, other.b) < 0 &&
        orient(other.a, other.b, edge.a) * orient(other.a, other.b, edge.b) < 0
      )
        return true;
    }
    open.push(edge);
  }
  return false;
}

/** Points on a plane as they're seen from the side `normal` points to, counter-clockwise staying so. */
function onPlane(points: Vec3[], normal: Vec3, center: Vec3): Vec2[] {
  const u = perpendicular(normal);
  const v = cross(normal, u);
  return points.map((point): Vec2 => [dot(sub(point, center), u), dot(sub(point, center), v)]);
}

/**
 * The outline as `count` points spread by length. One with fewer keeps its corners, more points going to its longest
 * edges; one with more is walked at even steps, which may cut a corner, but only an outline past the cap has more.
 */
function resampled(points: Vec3[], count: number): Vec3[] {
  const n = points.length;
  if (n === count) return points;
  const edges = points.map((point, i) => distance(point, points[(i + 1) % n]));
  const out: Vec3[] = [];
  if (n < count) {
    const pieces = edges.map(() => 1);
    for (let extra = count - n; extra > 0; extra--) {
      let longest = 0;
      for (let i = 1; i < n; i++) if (edges[i] / pieces[i] > edges[longest] / pieces[longest]) longest = i;
      pieces[longest]++;
    }
    points.forEach((point, i) => {
      for (let s = 0; s < pieces[i]; s++) out.push(lerp(point, points[(i + 1) % n], s / pieces[i]));
    });
    return out;
  }
  const perimeter = edges.reduce((sum, each) => sum + each, 0);
  let edge = 0;
  let before = 0;
  for (let j = 0; j < count; j++) {
    const at = (perimeter * j) / count;
    while (edge < n - 1 && before + edges[edge] < at) before += edges[edge++];
    out.push(lerp(points[edge], points[(edge + 1) % n], (at - before) / edges[edge]));
  }
  return out;
}

/** The ring started at the point that puts it nearest, point for point, to the one before: the least twist. */
function leastTwisted(previous: Vec3[], ring: Vec3[]): Vec3[] {
  const n = ring.length;
  let best = 0;
  let bestSum = Infinity;
  for (let offset = 0; offset < n; offset++) {
    let sum = 0;
    for (let i = 0; i < n && sum < bestSum; i++) {
      const p = previous[i];
      const q = ring[(i + offset) % n];
      sum += Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
    }
    if (sum < bestSum) [best, bestSum] = [offset, sum];
  }
  return best ? [...ring.slice(best), ...ring.slice(0, best)] : ring;
}

/** The path's points checked: a closed path's last left out when it repeats the first. */
function pathPoints(path: Vec3[], closed: boolean): Vec3[] {
  const points =
    closed && path.length > 1 && distance(path[0], path[path.length - 1]) <= SAME_POINT ? path.slice(0, -1) : path;
  const n = points.length;
  if (n < (closed ? 3 : 2))
    throw new Error(
      closed ? `A closed path needs at least 3 different points, got ${n}` : `A path needs at least 2 points, got ${n}`,
    );
  for (let i = 0; i < (closed ? n : n - 1); i++)
    if (distance(points[i], points[(i + 1) % n]) <= SAME_POINT)
      throw new Error(`Path points ${i + 1} and ${((i + 1) % n) + 1} of ${n} are in the same place: leave one out`);
  return points;
}

/** A path as straight pieces between `points`, with the given path point each is nearest, for saying where it's wrong. */
type Line = { points: Vec3[]; near: number[] };

/** A path's straight pieces: which way each goes, how long, and how sharply the path turns at each point. */
type Pieces = { ways: Vec3[]; lengths: number[]; bends: number[] };

function piecesOf(points: Vec3[], closed: boolean): Pieces {
  const n = points.length;
  const ways: Vec3[] = [];
  const lengths: number[] = [];
  for (let j = 0; j < (closed ? n : n - 1); j++) {
    const step = sub(points[(j + 1) % n], points[j]);
    lengths.push(length(step));
    ways.push(normalize(step));
  }
  // 0 straight on, 2 straight back. An open path's ends don't turn.
  const bends = points.map((_, k) =>
    closed || (k > 0 && k < n - 1) ? 1 - dot(ways[(k - 1 + ways.length) % ways.length], ways[k]) : 0,
  );
  return { ways, lengths, bends };
}

/**
 * The profile's u axis on each piece, carried from the start without twisting, and on a closed path the angle it comes
 * back round to the start turned by (counter-clockwise about the first piece). At the start v points as near +Z as it
 * can, or +Y on a path that starts straight up or down, and u = v × the path.
 */
function carriedFrames(ways: Vec3[], closed: boolean): { us: Vec3[]; twist: number } {
  const first = ways[0];
  let up = sub([0, 0, 1], scale(first, first[2]));
  if (length(up) < 1e-6) up = sub([0, 1, 0], scale(first, first[1]));
  const us: Vec3[] = [cross(normalize(up), first)];
  for (let j = 1; j < ways.length; j++) us.push(carried(us[j - 1], ways[j - 1], ways[j]));
  if (!closed) return { us, twist: 0 };
  const back = carried(us[us.length - 1], ways[ways.length - 1], first);
  return { us, twist: Math.atan2(dot(cross(us[0], back), first), dot(us[0], back)) };
}

/**
 * The closed path with each straight piece cut into `cuts` of it. The cuts keep clear of the corners, where a mitred
 * ring reaches along the piece by up to the profile's reach times the tangent of half the turn: a ring square to the
 * piece any nearer would fold the walls between them.
 */
function cutPieces(line: Line, { lengths, bends }: Pieces, cuts: number[], reach: number): Line {
  const n = line.points.length;
  const clear = (k: number) => reach * Math.sqrt(bends[k] / (2 - bends[k]));
  const out: Line = { points: [], near: [] };
  line.points.forEach((point, j) => {
    out.points.push(point);
    out.near.push(line.near[j]);
    const next = (j + 1) % n;
    const [from, to] = [clear(j), lengths[j] - clear(next)];
    if (cuts[j] < 2 || to <= from) return;
    for (let s = 1; s < cuts[j]; s++) {
      const at = from + ((to - from) * s) / cuts[j];
      out.points.push(lerp(point, line.points[next], at / lengths[j]));
      out.near.push(at * 2 < lengths[j] ? line.near[j] : line.near[next]);
    }
  });
  return out;
}

/**
 * A centripetal Catmull-Rom curve through the points as short straight pieces, each turning little enough for the
 * profile's reach.
 */
function smoothed(points: Vec3[], closed: boolean, reach: number): Line {
  const n = points.length;
  // An open curve runs on past its ends as if mirrored through them, so it leaves each heading for its neighbour.
  const at = (i: number): Vec3 => {
    if (closed) return points[(i + n) % n];
    if (i < 0) return sub(scale(points[0], 2), points[1]);
    if (i >= n) return sub(scale(points[n - 1], 2), points[n - 2]);
    return points[i];
  };
  const out: Vec3[] = [];
  const near: number[] = [];
  for (let s = 0; s < (closed ? n : n - 1); s++) {
    const curve = centripetal(at(s - 1), at(s), at(s + 1), at(s + 2));
    const fine = Array.from({ length: FINE + 1 }, (_, i) => curve(i / FINE));
    const runs = [0];
    let turning = 0;
    for (let i = 1; i <= FINE; i++) {
      runs.push(runs[i - 1] + distance(fine[i - 1], fine[i]));
      if (i > 1) turning += angleBetween(sub(fine[i - 1], fine[i - 2]), sub(fine[i], fine[i - 1]));
    }
    const span = runs[FINE];
    // The outside of a bend strays furthest from its pieces, by about its radius times the step's angle squared over 8.
    const step = Math.min(STEP_ANGLE, Math.sqrt((8 * SAG) / (span / turning + reach)));
    const steps = turning > 1e-9 ? Math.min(SPAN_STEPS_MAX, Math.ceil(turning / step)) : 1;
    for (let k = 0; k < steps; k++) {
      // Evenly along the span's length, which its parameter isn't.
      const target = (span * k) / steps;
      let i = 0;
      while (i < FINE - 1 && runs[i + 1] < target) i++;
      out.push(k ? curve((i + (target - runs[i]) / (runs[i + 1] - runs[i])) / FINE) : points[s]);
      near.push(k * 2 < steps ? s : (s + 1) % n);
    }
  }
  if (!closed) {
    out.push(points[n - 1]);
    near.push(n - 1);
  }
  return { points: out, near };
}

/**
 * The span from `p1` to `p2` of a Catmull-Rom curve through all four, `f` running 0 to 1 along it. Centripetal: its
 * parameter steps by the square root of the distance between points, so it neither overshoots nor loops.
 */
function centripetal(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): (f: number) => Vec3 {
  const t1 = Math.sqrt(distance(p0, p1));
  const t2 = t1 + Math.sqrt(distance(p1, p2));
  const t3 = t2 + Math.sqrt(distance(p2, p3));
  const mix = (a: Vec3, b: Vec3, from: number, to: number, t: number) => lerp(a, b, (t - from) / (to - from));
  return (f) => {
    const t = t1 + (t2 - t1) * f;
    const a1 = mix(p0, p1, 0, t1, t);
    const a2 = mix(p1, p2, t1, t2, t);
    const a3 = mix(p2, p3, t2, t3, t);
    return mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t);
  };
}

/**
 * `u`, square to `from`, carried round to be square to `to` without twisting: reflected in the plane between the two
 * directions, then in the plane square to `to`, which together turn it about the axis square to both.
 */
function carried(u: Vec3, from: Vec3, to: Vec3): Vec3 {
  const reflect = (a: Vec3, n: Vec3) => sub(a, scale(n, (2 * dot(a, n)) / dot(n, n)));
  const moved = reflect(reflect(u, add(from, to)), to);
  return normalize(sub(moved, scale(to, dot(moved, to))));
}

/** `u` turned by `angle` radians about `axis`, which it's square to. */
function turned(u: Vec3, axis: Vec3, angle: number): Vec3 {
  return add(scale(u, Math.cos(angle)), scale(cross(axis, u), Math.sin(angle)));
}

/** Rings of points one after another, as manifold takes them. */
function positionsOf(rings: Vec3[][]): number[] {
  return rings.flat(2);
}

const pointAt = (positions: number[], i: number): Vec3 => [
  positions[i * 3],
  positions[i * 3 + 1],
  positions[i * 3 + 2],
];

/**
 * The walls from ring `from` to ring `to`, outline by outline (`sizes` points each): facing out where the outlines wind
 * counter-clockwise about the way from one ring to the next. Each quad is split along its shorter diagonal, which
 * follows the surface more closely; or, where the rings are `twisted` against each other, into four round a point
 * added at its middle. A twisted quad isn't flat, and splitting every one along its shorter diagonal bulges all the
 * walls the same way, putting on volume the profile doesn't have.
 */
function joinRings(
  triangles: number[],
  positions: number[],
  from: number,
  to: number,
  sizes: number[],
  perRing: number,
  twisted = false,
) {
  const gap = (a: number, b: number) => distance(pointAt(positions, a), pointAt(positions, b));
  let start = 0;
  for (const size of sizes) {
    for (let i = 0; i < size; i++) {
      const [a0, b0] = [from * perRing + start + i, from * perRing + start + ((i + 1) % size)];
      const [a1, b1] = [to * perRing + start + i, to * perRing + start + ((i + 1) % size)];
      if (twisted) {
        const middle = positions.length / 3;
        positions.push(...scale([a0, b0, b1, a1].map((k) => pointAt(positions, k)).reduce(add), 1 / 4));
        triangles.push(a0, b0, middle, b0, b1, middle, b1, a1, middle, a1, a0, middle);
      } else if (gap(a0, b1) <= gap(b0, a1)) triangles.push(a0, b0, b1, a0, b1, a1);
      else triangles.push(a0, b0, a1, b0, b1, a1);
    }
    start += size;
  }
}

/** A ring's flat end from its triangulation, facing the way the rings go (`forward`) or back. */
function cap(triangles: number[], triangulation: Vec3[], ring: number, perRing: number, forward: boolean) {
  const base = ring * perRing;
  for (const [a, b, c] of triangulation) {
    if (forward) triangles.push(base + a, base + b, base + c);
    else triangles.push(base + a, base + c, base + b);
  }
}

/** The volume triangles enclose, signed by which way they face; measured from `origin`, near them, for precision. */
function signedVolume(positions: number[], triangles: number[], origin: Vec3, from = 0, to = triangles.length) {
  let sum = 0;
  for (let t = from; t < to; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => sub(pointAt(positions, triangles[t + k]), origin));
    sum += dot(a, cross(b, c));
  }
  return sum / 6;
}

/** What a fan from a ring's middle, facing the way the ring winds, adds to a signed volume. */
function fanVolume(ring: Vec3[], origin: Vec3): number {
  const middle = sub(scale(ring.reduce(add), 1 / ring.length), origin);
  let sum = 0;
  ring.forEach((point, i) => (sum += dot(middle, cross(sub(point, origin), sub(ring[(i + 1) % ring.length], origin)))));
  return sum / 6;
}

function flip(triangles: number[]) {
  for (let t = 0; t < triangles.length; t += 3)
    [triangles[t + 1], triangles[t + 2]] = [triangles[t + 2], triangles[t + 1]];
}

/**
 * Whether two triangles that share no corner cut through each other, as where a fold or a path coming back on itself
 * makes the surface pass through itself; `apart` says which pairs are worth comparing at all. The triangles go in a
 * tree of boxes, each halved along its longest side, so only those whose boxes overlap are compared: a grid does badly
 * with the long thin triangles a loft's walls are made of. Two triangles overlapping in one plane aren't seen, as a
 * solid that does that crosses itself elsewhere too.
 */
function crossesItself(
  positions: number[],
  triangles: number[],
  apart: (a: number, b: number) => boolean = () => true,
): boolean {
  const at = Float64Array.from(positions);
  const count = triangles.length / 3;
  const boxes = new Float64Array(count * 6);
  // Each triangle's plane, as a normal and its offset.
  const planes = new Float64Array(count * 4);
  for (let t = 0; t < count; t++) {
    for (let axis = 0; axis < 3; axis++) {
      let [min, max] = [Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const value = at[triangles[t * 3 + k] * 3 + axis];
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      boxes[t * 6 + axis] = min;
      boxes[t * 6 + 3 + axis] = max;
    }
    const [a, b, c] = [0, 1, 2].map((k) => pointAt(positions, triangles[t * 3 + k]));
    const normal = cross(sub(b, a), sub(c, a));
    planes.set([...normal, dot(normal, a)], t * 4);
  }

  type Node = { from: number; to: number; box: Float64Array; halves: [Node, Node] | null };
  const order = Array.from({ length: count }, (_, t) => t);
  const build = (from: number, to: number): Node => {
    const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    for (let i = from; i < to; i++)
      for (let axis = 0; axis < 3; axis++) {
        box[axis] = Math.min(box[axis], boxes[order[i] * 6 + axis]);
        box[axis + 3] = Math.max(box[axis + 3], boxes[order[i] * 6 + 3 + axis]);
      }
    if (to - from <= LEAF) return { from, to, box, halves: null };
    const axis = [0, 1, 2].reduce((best, each) =>
      box[each + 3] - box[each] > box[best + 3] - box[best] ? each : best,
    );
    const middle = (from + to) >> 1;
    // Only which half each triangle goes in matters, not the order within them: the run is partitioned about its
    // middle one along the axis rather than sorted.
    const key = (i: number) => boxes[order[i] * 6 + axis] + boxes[order[i] * 6 + 3 + axis];
    let [low, high] = [from, to - 1];
    while (low < high) {
      const pivot = key((low + high) >> 1);
      let [i, j] = [low, high];
      while (i <= j) {
        while (key(i) < pivot) i++;
        while (key(j) > pivot) j--;
        if (i <= j) {
          [order[i], order[j]] = [order[j], order[i]];
          i++;
          j--;
        }
      }
      if (middle <= j) high = j;
      else if (middle >= i) low = i;
      else break;
    }
    return { from, to, box, halves: [build(from, middle), build(middle, to)] };
  };

  const overlap = (a: Float64Array, b: Float64Array, i = 0, j = 0) =>
    a[i] <= b[j + 3] &&
    b[j] <= a[i + 3] &&
    a[i + 1] <= b[j + 4] &&
    b[j + 1] <= a[i + 4] &&
    a[i + 2] <= b[j + 5] &&
    b[j + 2] <= a[i + 5];
  // Whether all of `other`'s corners are on one side of `t`'s plane, which rules most neighbours out cheaply.
  const oneSide = (t: number, other: number) => {
    let above = false;
    let below = false;
    for (let k = 0; k < 3; k++) {
      const i = triangles[other * 3 + k] * 3;
      const side = planes[t * 4] * at[i] + planes[t * 4 + 1] * at[i + 1] + planes[t * 4 + 2] * at[i + 2];
      if (side > planes[t * 4 + 3]) above = true;
      else if (side < planes[t * 4 + 3]) below = true;
      else return false;
    }
    return !(above && below);
  };
  const clash = (a: number, b: number) => {
    if (!apart(a, b) || !overlap(boxes, boxes, a * 6, b * 6)) return false;
    const [p0, p1, p2] = [triangles[a * 3] * 3, triangles[a * 3 + 1] * 3, triangles[a * 3 + 2] * 3];
    const [q0, q1, q2] = [triangles[b * 3] * 3, triangles[b * 3 + 1] * 3, triangles[b * 3 + 2] * 3];
    const among = (p: number) => p === q0 || p === q1 || p === q2;
    if (among(p0) || among(p1) || among(p2) || oneSide(a, b) || oneSide(b, a)) return false;
    return (
      pierces(at, p0, p1, q0, q1, q2) ||
      pierces(at, p1, p2, q0, q1, q2) ||
      pierces(at, p2, p0, q0, q1, q2) ||
      pierces(at, q0, q1, p0, p1, p2) ||
      pierces(at, q1, q2, p0, p1, p2) ||
      pierces(at, q2, q0, p0, p1, p2)
    );
  };
  const search = (a: Node, b: Node): boolean => {
    if (!overlap(a.box, b.box)) return false;
    if (a === b && a.halves) {
      const [left, right] = a.halves;
      return search(left, left) || search(right, right) || search(left, right);
    }
    // The bigger of the two is opened up first.
    if (b.halves && (!a.halves || b.to - b.from > a.to - a.from))
      return search(a, b.halves[0]) || search(a, b.halves[1]);
    if (a.halves) return search(a.halves[0], b) || search(a.halves[1], b);
    for (let i = a.from; i < a.to; i++)
      for (let j = a === b ? i + 1 : b.from; j < b.to; j++) if (clash(order[i], order[j])) return true;
    return false;
  };
  if (!count) return false;
  const root = build(0, count);
  return search(root, root);
}

/**
 * Whether the segment from `p` to `q` passes through the triangle `a b c`, each the offset of a point's x in `at`. The
 * segment's own ends and the triangle's corners are left out, as that's where a mesh's pieces meet; its edges count,
 * since two mirror-image walls cross only along edges. Written out rather than with vec's helpers, as it runs for
 * every pair of nearby triangles.
 */
function pierces(at: Float64Array, p: number, q: number, a: number, b: number, c: number): boolean {
  const slack = 1e-9;
  const [dx, dy, dz] = [at[q] - at[p], at[q + 1] - at[p + 1], at[q + 2] - at[p + 2]];
  const [ex, ey, ez] = [at[b] - at[a], at[b + 1] - at[a + 1], at[b + 2] - at[a + 2]];
  const [fx, fy, fz] = [at[c] - at[a], at[c + 1] - at[a + 1], at[c + 2] - at[a + 2]];
  const [hx, hy, hz] = [dy * fz - dz * fy, dz * fx - dx * fz, dx * fy - dy * fx];
  const det = ex * hx + ey * hy + ez * hz;
  // Parallel to the triangle's plane, or the triangle has no area.
  if (
    det * det <=
    1e-24 * (dx * dx + dy * dy + dz * dz) * (ex * ex + ey * ey + ez * ez) * (fx * fx + fy * fy + fz * fz)
  )
    return false;
  const [sx, sy, sz] = [at[p] - at[a], at[p + 1] - at[a + 1], at[p + 2] - at[a + 2]];
  const [kx, ky, kz] = [sy * ez - sz * ey, sz * ex - sx * ez, sx * ey - sy * ex];
  const t = (fx * kx + fy * ky + fz * kz) / det;
  if (t <= slack || t >= 1 - slack) return false;
  const u = (sx * hx + sy * hy + sz * hz) / det;
  const v = (dx * kx + dy * ky + dz * kz) / det;
  const w = 1 - u - v;
  if (u < -slack || v < -slack || w < -slack) return false;
  return Number(u <= slack) + Number(v <= slack) + Number(w <= slack) < 2;
}

/** The mesh as a manifold, or `failure` when manifold won't take it as a closed solid. */
function solidFrom(
  wasm: ManifoldToplevel,
  own: Own,
  positions: number[],
  triangles: number[],
  failure: string,
): Manifold {
  let solid: Manifold;
  try {
    solid = own(
      new wasm.Manifold(
        new wasm.Mesh({
          numProp: 3,
          vertProperties: Float32Array.from(positions),
          triVerts: Uint32Array.from(triangles),
        }),
      ),
    );
  } catch {
    throw new Error(failure);
  }
  if (solid.status() !== "NoError" || solid.isEmpty() || solid.volume() <= 0) throw new Error(failure);
  return solid;
}
