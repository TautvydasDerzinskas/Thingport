// Solid modelling by BSP trees: union, difference and intersection of closed solids made of convex polygons, by the
// method of Evan Wallace's csg.js (MIT), written again here with loops in place of recursion, so big solids don't run
// out of stack. Then the result made printable: vertices welded, T-junctions closed, and triangles out.

const EPSILON = 1e-5;
const COPLANAR = 0;
const FRONT = 1;
const BACK = 2;
const SPANNING = 3;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A convex polygon, its vertices anticlockwise seen from outside, or null when it has no area. */
export function polygon(vertices) {
  // Newell's normal: steady for polygons whose first corners are nearly in line.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12) return null;
  const normal = [nx / length, ny / length, nz / length];
  return { vertices, normal, w: dot(normal, vertices[0]) };
}

const flipped = (p) => ({
  vertices: p.vertices.slice().reverse(),
  normal: [-p.normal[0], -p.normal[1], -p.normal[2]],
  w: -p.w,
});

/** Sorts `p` against `plane` into the four lists, cutting it in two where it crosses. */
function split(plane, p, coplanarFront, coplanarBack, front, back) {
  let kind = 0;
  const types = new Array(p.vertices.length);
  for (let i = 0; i < p.vertices.length; i++) {
    const t = dot(plane.normal, p.vertices[i]) - plane.w;
    const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
    kind |= type;
    types[i] = type;
  }
  if (kind === COPLANAR) (dot(plane.normal, p.normal) > 0 ? coplanarFront : coplanarBack).push(p);
  else if (kind === FRONT) front.push(p);
  else if (kind === BACK) back.push(p);
  else {
    const f = [];
    const b = [];
    const n = p.vertices.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ti = types[i];
      const tj = types[j];
      const vi = p.vertices[i];
      const vj = p.vertices[j];
      if (ti !== BACK) f.push(vi);
      if (ti !== FRONT) b.push(vi);
      if ((ti | tj) === SPANNING) {
        const t = (plane.w - dot(plane.normal, vi)) / dot(plane.normal, sub(vj, vi));
        const v = lerp(vi, vj, t);
        f.push(v);
        b.push(v);
      }
    }
    if (f.length >= 3) front.push({ vertices: f, normal: p.normal, w: p.w });
    if (b.length >= 3) back.push({ vertices: b, normal: p.normal, w: p.w });
  }
}

class Node {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }

  /** Every node of the tree. */
  nodes() {
    const out = [];
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      out.push(node);
      if (node.front) stack.push(node.front);
      if (node.back) stack.push(node.back);
    }
    return out;
  }

  invert() {
    for (const node of this.nodes()) {
      node.polygons = node.polygons.map(flipped);
      if (node.plane) node.plane = { normal: node.plane.normal.map((c) => -c), w: -node.plane.w };
      [node.front, node.back] = [node.back, node.front];
    }
  }

  /** The parts of `polygons` outside the solid this tree bounds. */
  clipPolygons(polygons) {
    const out = [];
    const stack = [[this, polygons]];
    while (stack.length) {
      const [node, list] = stack.pop();
      if (!node.plane) {
        for (const p of list) out.push(p);
        continue;
      }
      const front = [];
      const back = [];
      for (const p of list) split(node.plane, p, front, back, front, back);
      if (node.front) stack.push([node.front, front]);
      else for (const p of front) out.push(p);
      if (node.back) stack.push([node.back, back]);
    }
    return out;
  }

  clipTo(tree) {
    for (const node of this.nodes()) node.polygons = tree.clipPolygons(node.polygons);
  }

  allPolygons() {
    const out = [];
    for (const node of this.nodes()) for (const p of node.polygons) out.push(p);
    return out;
  }

  build(polygons) {
    const stack = [[this, polygons]];
    while (stack.length) {
      const [node, list] = stack.pop();
      if (!list.length) continue;
      if (!node.plane) node.plane = { normal: list[0].normal, w: list[0].w };
      const front = [];
      const back = [];
      for (const p of list) split(node.plane, p, node.polygons, node.polygons, front, back);
      if (front.length) stack.push([(node.front ??= new Node()), front]);
      if (back.length) stack.push([(node.back ??= new Node()), back]);
    }
  }
}

/** The box round a solid's polygons. */
export function bounds(polygons) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of polygons)
    for (const v of p.vertices)
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
  return { min, max };
}

const apart = (a, b) => {
  for (let i = 0; i < 3; i++) if (a.max[i] < b.min[i] - EPSILON || b.max[i] < a.min[i] - EPSILON) return true;
  return false;
};

/** A polygon's own box. */
function boxOf(p) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of p.vertices)
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i];
      if (v[i] > max[i]) max[i] = v[i];
    }
  return { min, max };
}

/** `polygons` split into those whose box meets `box` and those well away from it. */
function nearAndFar(polygons, box) {
  const near = [];
  const far = [];
  for (const p of polygons) (apart(boxOf(p), box) ? far : near).push(p);
  return { near, far };
}

// The operations differ from csg.js in one way: the trees only sort polygons into inside and outside, and the
// polygons kept are the ones given, cut only where the other solid's faces cross them. csg.js keeps the polygons
// stored in the trees, which building the tree has also cut along every plane of their own solid, leaving slivers a
// few microns wide that a printable mesh can't be made from. Polygons well away from the other solid aren't cut at
// all.

/** The solids given, joined: a list of polygons. */
export function union(...solids) {
  const list = solids.filter((s) => s?.length);
  if (!list.length) return [];
  return list.reduce((a, b) => {
    const boxA = bounds(a);
    const boxB = bounds(b);
    // Apart, they join by putting their polygons together.
    if (apart(boxA, boxB)) return a.concat(b);
    const A = nearAndFar(a, boxB);
    const B = nearAndFar(b, boxA);
    const treeA = new Node(a);
    const treeB = new Node(b);
    // A outside B; B outside A, less where its faces lie on A's facing the same way.
    const keptA = treeB.clipPolygons(A.near);
    const outsideA = treeA.clipPolygons(B.near);
    const keptB = treeA.clipPolygons(outsideA.map(flipped)).map(flipped);
    return [...A.far, ...keptA, ...B.far, ...keptB];
  });
}

/** `a` with `b` taken away. */
export function subtract(a, b) {
  if (!a.length || !b?.length) return a;
  const boxA = bounds(a);
  const boxB = bounds(b);
  if (apart(boxA, boxB)) return a;
  const A = nearAndFar(a, boxB);
  // B's faces outside A's box can't be inside A, so they're no part of the hole.
  const nearB = nearAndFar(b, boxA).near;
  const treeA = new Node(a);
  const treeB = new Node(b);
  // A outside B, A's faces flipped while they're clipped, so faces lying on B's go with B.
  const keptA = treeB.clipPolygons(A.near.map(flipped)).map(flipped);
  // B inside A, turned inside out: the walls of the hole.
  treeA.invert();
  const insideA = treeA.clipPolygons(nearB).map(flipped);
  const keptB = treeA.clipPolygons(insideA).map(flipped);
  return [...A.far, ...keptA, ...keptB.map(flipped)];
}

/** Where `a` and `b` overlap. */
export function intersect(a, b) {
  if (!a.length || !b?.length || apart(bounds(a), bounds(b))) return [];
  const A = new Node(a);
  const B = new Node(b);
  A.invert();
  B.clipTo(A);
  B.invert();
  A.clipTo(B);
  B.clipTo(A);
  A.build(B.allPolygons());
  A.invert();
  return A.allPolygons();
}

/**
 * Many solids joined, cheaply: those whose boxes don't touch are put together as they are, and only those that do
 * are joined properly. For the holes and parts of a model, which mostly stand apart.
 */
export function unionAll(solids) {
  const groups = [];
  for (const solid of solids) {
    if (!solid?.length) continue;
    let item = { solid, box: bounds(solid) };
    // Join with every group it touches, until it touches none.
    for (let i = 0; i < groups.length;) {
      if (!apart(groups[i].box, item.box)) {
        const solidJoined = union(groups[i].solid, item.solid);
        item = { solid: solidJoined, box: bounds(solidJoined) };
        groups.splice(i, 1);
        i = 0;
      } else i++;
    }
    groups.push(item);
  }
  return groups.flatMap((g) => g.solid);
}

/** Each point moved by `fn`. Keeps the polygons' winding, so `fn` mustn't mirror. */
export function transform(polygons, fn) {
  return polygons.map((p) => polygon(p.vertices.map(fn))).filter(Boolean);
}

export const translate = (polygons, [x, y, z]) => transform(polygons, (v) => [v[0] + x, v[1] + y, v[2] + z]);

// ---- printable triangles ---------------------------------------------------------------------------------------

/**
 * The solid as triangles, [[a, b, c], ...], every edge shared by exactly two of them. Cutting leaves a face in many
 * pieces, some of them slivers a micron wide; this puts them back together, a plane at a time:
 *  - vertices closer than `weld` become one;
 *  - a vertex lying on a piece's edge is put into that edge, so neighbouring pieces' edges match;
 *  - the pieces in each plane are merged, their shared edges cancelling, leaving the plane's outlines and holes;
 *  - and those outlines are cut into triangles afresh.
 */
export function triangles(polygons, weld = 1e-3) {
  // One vertex for all the points within `weld` of each other: each point looks for one already kept in its cell of a
  // grid and the cells round it, so two close points either side of a cell's edge still become one.
  const index = new Map();
  const points = [];
  const id = (v) => {
    const cx = Math.floor(v[0] / weld);
    const cy = Math.floor(v[1] / weld);
    const cz = Math.floor(v[2] / weld);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = index.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const i of list) {
            const w = points[i];
            if (Math.abs(w[0] - v[0]) <= weld && Math.abs(w[1] - v[1]) <= weld && Math.abs(w[2] - v[2]) <= weld)
              return i;
          }
        }
    const i = points.length;
    points.push(v);
    const k = `${cx},${cy},${cz}`;
    const list = index.get(k);
    if (list) list.push(i);
    else index.set(k, [i]);
    return i;
  };
  const faces = [];
  for (const p of polygons) {
    const ids = [];
    for (const v of p.vertices) {
      const i = id(v);
      if (ids[ids.length - 1] !== i) ids.push(i);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length >= 3) faces.push({ ids, normal: p.normal, w: p.w });
  }

  // A grid of the vertices, to find those lying on an edge without testing them all. A point within a micron of an
  // edge is on it: slivers are narrower than that.
  const tol = 2e-3;
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const v of points)
    for (let i = 0; i < 3; i++) {
      box.min[i] = Math.min(box.min[i], v[i]);
      box.max[i] = Math.max(box.max[i], v[i]);
    }
  const size = Math.max(...box.max.map((m, i) => m - box.min[i])) / 48 || 1;
  const cells = new Map();
  const cellOf = (v) => v.map((c, i) => Math.floor((c - box.min[i]) / size));
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    const lo = cellOf(v.map((c) => c - tol));
    const hi = cellOf(v.map((c) => c + tol));
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++)
        for (let z = lo[2]; z <= hi[2]; z++) {
          const k = `${x},${y},${z}`;
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push(i);
        }
  }

  /** The vertices lying on the edge from a to b, but not at its ends, in order from a. */
  const onEdge = (a, b) => {
    const pa = points[a];
    const pb = points[b];
    const d = sub(pb, pa);
    const length2 = dot(d, d);
    if (length2 < 1e-12) return [];
    const found = new Map();
    // The cells along the edge, stepped through a third of a cell at a time, and the cells round each: every point of
    // the edge is within a sixth of a cell of a step, so one where the edge only clips a cell's corner isn't missed.
    const steps = Math.ceil(Math.sqrt(length2) / (size / 3)) + 1;
    const seen = new Set();
    const visit = [];
    for (let s = 0; s <= steps; s++) {
      const c = cellOf(lerp(pa, pb, s / steps));
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const k = `${c[0] + dx},${c[1] + dy},${c[2] + dz}`;
            if (!seen.has(k)) {
              seen.add(k);
              visit.push(k);
            }
          }
    }
    for (const k of visit) {
      for (const i of cells.get(k) ?? []) {
        if (i === a || i === b || found.has(i)) continue;
        const t = dot(sub(points[i], pa), d) / length2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const off = sub(points[i], lerp(pa, pb, t));
        if (dot(off, off) <= tol * tol) found.set(i, t);
      }
    }
    return [...found.entries()].sort((x, y) => x[1] - y[1]).map(([i]) => i);
  };

  // Each piece with the points on its edges put in, gathered by plane.
  const edgeCache = new Map();
  const planes = new Map();
  for (const face of faces) {
    const ring = [];
    for (let i = 0; i < face.ids.length; i++) {
      const a = face.ids[i];
      const b = face.ids[(i + 1) % face.ids.length];
      ring.push(a);
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let between = edgeCache.get(k);
      if (!between) {
        between = onEdge(Math.min(a, b), Math.max(a, b));
        edgeCache.set(k, between);
      }
      for (const v of a < b ? between : between.slice().reverse()) ring.push(v);
    }
    const n = face.normal;
    const key = `${Math.round(n[0] * 1e5)},${Math.round(n[1] * 1e5)},${Math.round(n[2] * 1e5)},${Math.round(face.w * 1e3)}`;
    let plane = planes.get(key);
    if (!plane) planes.set(key, (plane = { normal: n, rings: [] }));
    plane.rings.push(ring);
  }

  const tris = [];
  for (const plane of planes.values()) for (const tri of outlines(plane.rings, points, plane.normal)) tris.push(tri);
  const closed = fillGaps(dropFins(tris.filter(([a, b, c]) => a !== b && b !== c && c !== a)));
  return dropFins(closed).map((t) => t.map((i) => points[i]));
}

/**
 * The pieces in one plane merged and cut into triangles: their edges each way cancel, what's left is the plane's
 * outlines (anticlockwise) and holes (clockwise), and each outline with its holes is cut into triangles.
 */
function outlines(rings, points, normal) {
  // The plane drawn flat: u and v across it, u × v along its normal, so anticlockwise stays anticlockwise.
  const axis = Math.abs(normal[0]) < 0.6 ? [1, 0, 0] : Math.abs(normal[1]) < 0.6 ? [0, 1, 0] : [0, 0, 1];
  const uRaw = cross(axis, normal);
  const uLen = Math.hypot(...uRaw);
  const u = uRaw.map((c) => c / uLen);
  const v = cross(normal, u);
  const flat = (i) => ({ id: i, x: dot(points[i], u), y: dot(points[i], v) });

  // A single piece needs nothing merged.
  if (rings.length === 1) return earcut([rings[0].map(flat)], points);

  const counts = new Map();
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const k = `${ring[i]}_${ring[(i + 1) % ring.length]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  const outgoing = new Map();
  for (const [k, n] of counts) {
    const [a, b] = k.split("_").map(Number);
    const left = n - (counts.get(`${b}_${a}`) ?? 0);
    for (let j = 0; j < left; j++) {
      let list = outgoing.get(a);
      if (!list) outgoing.set(a, (list = []));
      list.push(b);
    }
  }

  // Follow the edges left round into loops, turning as far left as possible where two loops touch.
  const loops = [];
  for (const start of [...outgoing.keys()]) {
    while (outgoing.get(start)?.length) {
      const loop = [start];
      let prev = start;
      let at = outgoing.get(start).pop();
      while (at !== start && loop.length <= points.length) {
        loop.push(at);
        const options = outgoing.get(at);
        if (!options?.length) break;
        let pick = 0;
        if (options.length > 1) {
          const p = flat(prev);
          const q = flat(at);
          const d = [q.x - p.x, q.y - p.y];
          let best = -Infinity;
          options.forEach((c, i) => {
            const r = flat(c);
            const e = [r.x - q.x, r.y - q.y];
            const turn = Math.atan2(d[0] * e[1] - d[1] * e[0], d[0] * e[0] + d[1] * e[1]);
            if (turn > best) [best, pick] = [turn, i];
          });
        }
        prev = at;
        at = options.splice(pick, 1)[0];
      }
      if (at === start && loop.length >= 3) loops.push(loop.map(flat));
    }
  }
  return earcut(loops, points);
}

const area2 = (loop) => {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

function insideLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Outlines with their holes, cut into triangles of vertex ids by clipping ears. */
function earcut(loops, points) {
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    const a = area2(loop);
    if (Math.abs(a) < 1e-12) continue;
    (a > 0 ? outers : holes).push({ loop, area: a, holes: [] });
  }
  for (const hole of holes) {
    // Into the smallest outline round it.
    let home = null;
    for (const outer of outers) {
      if (home && outer.area >= home.area) continue;
      if (hole.loop.some((p) => insideLoop(p, outer.loop))) home = outer;
    }
    if (home) home.holes.push(hole.loop);
  }
  const out = [];
  for (const outer of outers) {
    let polygon = outer.loop;
    const sorted = outer.holes
      .map((loop) => ({ loop, left: Math.min(...loop.map((p) => p.x)) }))
      .sort((a, b) => a.left - b.left);
    for (const { loop } of sorted) polygon = bridge(polygon, loop);
    clipStraightened(polygon, points, out);
  }
  return out;
}

/**
 * Cuts a polygon into triangles with the corners that lie in line with their neighbours left out, which ear clipping
 * can't tell convex from reflex, then puts each back by cutting the triangle whose edge it lies on: the neighbouring
 * faces have them, so the edges still match.
 */
function clipStraightened(polygon, points, out) {
  const n = polygon.length;
  const prev = polygon.map((_, i) => (i - 1 + n) % n);
  const next = polygon.map((_, i) => (i + 1) % n);
  const removed = new Set();
  const inLine = (i) => {
    const a = polygon[prev[i]];
    const b = polygon[i];
    const c = polygon[next[i]];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const length2 = dx * dx + dy * dy;
    if (length2 < 1e-12) return false;
    const t = ((b.x - a.x) * dx + (b.y - a.y) * dy) / length2;
    if (t <= 0 || t >= 1) return false;
    const off = ((b.x - a.x) * dy - (b.y - a.y) * dx) ** 2 / length2;
    return off < 1e-10;
  };
  let left = n;
  for (let i = 0, steps = 0; steps < 2 * n && left > 3; steps++) {
    if (!removed.has(i) && inLine(i)) {
      removed.add(i);
      next[prev[i]] = next[i];
      prev[next[i]] = prev[i];
      left--;
      i = prev[i];
    } else i = next[i];
  }
  // The straightened polygon, and the corners taken out after each of its corners.
  const kept = [];
  for (let i = 0; i < n; i++) if (!removed.has(i)) kept.push(i);
  const between = new Map();
  kept.forEach((k, j) => {
    const to = kept[(j + 1) % kept.length];
    const list = [];
    for (let i = (k + 1) % n; i !== to; i = (i + 1) % n) list.push(polygon[i].id);
    between.set(j, list);
  });
  const ears = [];
  clipEars(
    kept.map((k, j) => ({ ...polygon[k], at: j })),
    ears,
  );
  for (const tri of ears) {
    // Each edge with the corners that lie on it, where it's an edge of the polygon.
    const ring = [];
    const crowded = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      ring.push(a.id);
      const list = (a.at + 1) % kept.length === b.at ? between.get(a.at) : [];
      if (list.length) crowded.push(e);
      ring.push(...list);
    }
    if (!crowded.length) out.push(ring);
    else if (crowded.length === 1) {
      // Points along one edge: a fan from the corner across from it.
      const far = tri[(crowded[0] + 2) % 3].id;
      const at = ring.indexOf(far);
      for (let i = 1; i + 1 < ring.length; i++)
        out.push([far, ring[(at + i) % ring.length], ring[(at + i + 1) % ring.length]]);
    } else {
      // Points along more than one edge: a fan from the triangle's middle.
      const centre = points.length;
      points.push([0, 1, 2].map((c) => tri.reduce((sum, p) => sum + points[p.id][c], 0) / 3));
      for (let i = 0; i < ring.length; i++) out.push([centre, ring[i], ring[(i + 1) % ring.length]]);
    }
  }
}

const crossAt = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

// Holes are joined to their outline as earcut (Mapbox, ISC) joins them, which copes with corners exactly in line with
// a hole's, as rows of vents have: a cut from the hole's leftmost point to the nearest corner it can see to its left.

/** Twice the signed area of the triangle p, q, r, negative when it turns left. */
const turnOf = (p, q, r) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);

/** Whether the cut from corner i to `b` runs inside the polygon where it leaves i. */
function locallyInside(polygon, i, b) {
  const n = polygon.length;
  const a = polygon[i];
  const prev = polygon[(i - 1 + n) % n];
  const next = polygon[(i + 1) % n];
  return turnOf(prev, a, next) < 0
    ? turnOf(a, b, next) >= 0 && turnOf(a, prev, b) >= 0
    : turnOf(a, b, prev) < 0 || turnOf(a, next, b) < 0;
}

/** For two corners at the same place: whether the one at j lies within the angle of the one at i. */
function sectorContains(polygon, i, j) {
  const n = polygon.length;
  return (
    turnOf(polygon[(i - 1 + n) % n], polygon[i], polygon[(j - 1 + n) % n]) < 0 &&
    turnOf(polygon[(j + 1) % n], polygon[i], polygon[(i + 1) % n]) < 0
  );
}

/** The polygon with `hole` joined into it by a cut there and back. */
function bridge(polygon, hole) {
  let m = 0;
  for (let i = 1; i < hole.length; i++)
    if (hole[i].x < hole[m].x || (hole[i].x === hole[m].x && hole[i].y < hole[m].y)) m = i;
  const H = hole[m];
  const n = polygon.length;
  let qx = -Infinity;
  let pick = -1;
  for (let i = 0; i < n; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % n];
    if (p.x === H.x && p.y === H.y) {
      pick = i;
      qx = H.x;
      break;
    }
    if (H.y <= p.y && H.y >= q.y && q.y !== p.y) {
      const x = p.x + ((H.y - p.y) * (q.x - p.x)) / (q.y - p.y);
      if (x <= H.x && x > qx) {
        qx = x;
        pick = p.x < q.x ? i : (i + 1) % n;
        if (x === H.x) break;
      }
    }
  }
  if (pick < 0) {
    // Nothing to the left: the nearest corner will do.
    let near = Infinity;
    polygon.forEach((p, i) => {
      const d = (p.x - H.x) ** 2 + (p.y - H.y) ** 2;
      if (d < near) [near, pick] = [d, i];
    });
  } else if (!(polygon[pick].x === H.x && polygon[pick].y === H.y)) {
    // A corner inside the triangle of H, the crossing and the chosen end would block the view: take the one most in
    // line with the ray instead.
    const M = polygon[pick];
    let tanMin = Infinity;
    for (let k = 0; k < n; k++) {
      const i = (pick + k) % n;
      const p = polygon[i];
      if (
        H.x >= p.x &&
        p.x >= M.x &&
        H.x !== p.x &&
        inTriangle({ x: H.y < M.y ? H.x : qx, y: H.y }, M, { x: H.y < M.y ? qx : H.x, y: H.y }, p)
      ) {
        const tan = Math.abs(H.y - p.y) / (H.x - p.x);
        const best = polygon[pick];
        if (
          locallyInside(polygon, i, H) &&
          (tan < tanMin || (tan === tanMin && (p.x > best.x || (p.x === best.x && sectorContains(polygon, pick, i)))))
        ) {
          pick = i;
          tanMin = tan;
        }
      }
    }
  }
  const P = polygon[pick];
  return [
    ...polygon.slice(0, pick + 1),
    ...hole.slice(m),
    ...hole.slice(0, m + 1),
    { ...P },
    ...polygon.slice(pick + 1),
  ];
}

function inTriangle(a, b, c, p) {
  return (
    (c.x - p.x) * (a.y - p.y) - (a.x - p.x) * (c.y - p.y) >= 0 &&
    (a.x - p.x) * (b.y - p.y) - (b.x - p.x) * (a.y - p.y) >= 0 &&
    (b.x - p.x) * (c.y - p.y) - (c.x - p.x) * (b.y - p.y) >= 0
  );
}

/** Cuts an anticlockwise polygon into triangles, an ear at a time, adding them to `out` as its corners. */
function clipEars(polygon, out) {
  const n = polygon.length;
  if (n < 3) return;
  const prev = polygon.map((_, i) => (i - 1 + n) % n);
  const next = polygon.map((_, i) => (i + 1) % n);
  const same = (p, q) => p.x === q.x && p.y === q.y;
  let left = n;
  let i = 0;
  const isEar = (i, strict) => {
    const a = polygon[prev[i]];
    const b = polygon[i];
    const c = polygon[next[i]];
    const turn = crossAt(a, b, c);
    if (strict ? turn <= 0 : turn < 0) return false;
    // No other corner inside it, or on it, except at the same place as one of its own.
    for (let j = next[next[i]]; j !== prev[i]; j = next[j]) {
      const p = polygon[j];
      if (same(p, a) || same(p, b) || same(p, c)) continue;
      if (inTriangle(a, b, c, p) && crossAt(polygon[prev[j]], p, polygon[next[j]]) <= 0) return false;
    }
    return true;
  };
  let strict = true;
  let tries = 0;
  while (left > 3) {
    if (isEar(i, strict)) {
      out.push([polygon[prev[i]], polygon[i], polygon[next[i]]]);
      next[prev[i]] = next[i];
      prev[next[i]] = prev[i];
      left--;
      i = prev[i];
      tries = 0;
      strict = true;
      continue;
    }
    i = next[i];
    if (++tries > left) {
      // No ear: corners in line, or a polygon touching itself. Take the flattest and go on.
      if (strict) strict = false;
      else {
        out.push([polygon[prev[i]], polygon[i], polygon[next[i]]]);
        next[prev[i]] = next[i];
        prev[next[i]] = prev[i];
        left--;
        i = prev[i];
        strict = true;
      }
      tries = 0;
    }
  }
  out.push([polygon[prev[i]], polygon[i], polygon[next[i]]]);
}

/** Without triangles that meet their own reverse: a fin of no thickness, which welding can leave. */
function dropFins(tris) {
  const key = ([a, b, c]) => (a < b && a < c ? `${a}_${b}_${c}` : b < c ? `${b}_${c}_${a}` : `${c}_${a}_${b}`);
  const counts = new Map();
  for (const t of tris) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  return tris.filter((t) => {
    const back = key([t[0], t[2], t[1]]);
    if (!counts.get(back)) return true;
    // One of each way: both go.
    counts.set(back, counts.get(back) - 1);
    counts.set(key(t), counts.get(key(t)) - 1);
    return false;
  });
}

/**
 * Closes what's still open, as a last resort: edges used one way and never the other, chained into loops, each
 * filled with triangles wound the other way.
 */
function fillGaps(tris) {
  const used = new Set();
  for (const [a, b, c] of tris)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      used.add(`${p}_${q}`);
  const next = new Map();
  for (const [a, b, c] of tris)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      if (!used.has(`${q}_${p}`)) {
        let list = next.get(p);
        if (!list) next.set(p, (list = []));
        list.push(q);
      }
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      let at = next.get(start).pop();
      while (at !== start && loop.length < 64) {
        loop.push(at);
        const list = next.get(at);
        if (!list?.length) break;
        at = list.pop();
      }
      if (at !== start) continue;
      for (let i = 1; i + 1 < loop.length; i++) tris.push([loop[0], loop[i + 1], loop[i]]);
    }
  }
  return tris;
}

/** A binary STL of the triangles. */
export function stl(tris, name = "model") {
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  const header = `${name} - made with Thingport's enclosure generator`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, tris.length, true);
  let at = 84;
  for (const [a, b, c] of tris) {
    const n = cross(sub(b, a), sub(c, a));
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const value of [...n.map((x) => x / length), ...a, ...b, ...c]) {
      view.setFloat32(at, value, true);
      at += 4;
    }
    view.setUint16(at, 0, true);
    at += 2;
  }
  return new Uint8Array(buffer);
}

/** The volume the triangles close, in mm³. */
export function volume(tris) {
  let sum = 0;
  for (const [a, b, c] of tris) sum += dot(a, cross(b, c));
  return sum / 6;
}
