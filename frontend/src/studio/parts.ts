import type { Manifold, ManifoldToplevel, Mesh } from "manifold-3d";
import type { MeshData } from "./document";
import type { Own } from "./solids";
import { length, sub, type Vec3 } from "./vec";

// A body's loose parts, the pieces of it that don't touch, which separate_parts makes bodies of their own. A hollow
// inside a part stays with it, and parts that overlap without being joined are still two: they share no surface.

export type Bounds = { min: Vec3; max: Vec3 };

/** The way a ray goes to tell inside from outside: a slant no model's faces or edges are likely to run along, so it
 *  doesn't graze one. */
const RAY: Vec3 = (() => {
  const d: Vec3 = [0.3141, 0.5926, 0.7419];
  const n = length(d);
  return [d[0] / n, d[1] / n, d[2] / n];
})();

/** Whether a point is inside a closed surface: a ray from it crosses the surface an odd number of times. */
function encloses(mesh: Mesh, point: Vec3): boolean {
  const { vertProperties: v, triVerts: t, numProp } = mesh;
  const at = (i: number): Vec3 => [v[i * numProp], v[i * numProp + 1], v[i * numProp + 2]];
  let crossings = 0;
  for (let k = 0; k < t.length; k += 3) {
    // Möller–Trumbore.
    const a = at(t[k]);
    const e1 = sub(at(t[k + 1]), a);
    const e2 = sub(at(t[k + 2]), a);
    const p: Vec3 = [RAY[1] * e2[2] - RAY[2] * e2[1], RAY[2] * e2[0] - RAY[0] * e2[2], RAY[0] * e2[1] - RAY[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(point, a);
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q: Vec3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const w = (RAY[0] * q[0] + RAY[1] * q[1] + RAY[2] * q[2]) / det;
    if (w < 0 || u + w > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 1e-9) crossings++;
  }
  return crossings % 2 === 1;
}

function contains(box: { min: number[]; max: number[] }, point: Vec3): boolean {
  return point.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]);
}

/** Closed surfaces as one manifold, as they are, with no boolean between them. */
function together(wasm: ManifoldToplevel, own: Own, surfaces: Manifold[]): Manifold {
  if (surfaces.length === 1) return surfaces[0];
  const meshes = surfaces.map((surface) => surface.getMesh());
  const numProp = meshes[0].numProp;
  const vertProperties = new Float32Array(meshes.reduce((sum, mesh) => sum + mesh.vertProperties.length, 0));
  const triVerts = new Uint32Array(meshes.reduce((sum, mesh) => sum + mesh.triVerts.length, 0));
  const mergeFrom: number[] = [];
  const mergeTo: number[] = [];
  let vertices = 0;
  let props = 0;
  let tris = 0;
  for (const mesh of meshes) {
    if (mesh.numProp !== numProp) throw new Error("Parts with different vertex properties can't be put together");
    vertProperties.set(mesh.vertProperties, props);
    for (let i = 0; i < mesh.triVerts.length; i++) triVerts[tris + i] = mesh.triVerts[i] + vertices;
    mesh.mergeFromVert?.forEach((from) => mergeFrom.push(from + vertices));
    mesh.mergeToVert?.forEach((to) => mergeTo.push(to + vertices));
    props += mesh.vertProperties.length;
    tris += mesh.triVerts.length;
    vertices += mesh.vertProperties.length / numProp;
  }
  return own(
    new wasm.Manifold(
      new wasm.Mesh({
        numProp,
        vertProperties,
        triVerts,
        mergeFromVert: new Uint32Array(mergeFrom),
        mergeToVert: new Uint32Array(mergeTo),
      }),
    ),
  );
}

/**
 * A closed body's loose parts. Manifold hands back each closed surface on its own, a hollow's inside one turned in, with
 * negative volume: that goes back with the smallest part around it, so a hollow part is one part and a ball rattling
 * inside it another.
 */
export function closedParts(wasm: ManifoldToplevel, own: Own, solid: Manifold): Manifold[] {
  const surfaces = solid.decompose().map(own);
  if (surfaces.length < 2) return [solid];
  const outer = surfaces.filter((surface) => surface.volume() >= 0);
  const hollows = surfaces.filter((surface) => surface.volume() < 0);
  const inside = outer.map((): Manifold[] => []);
  const volumes = outer.map((surface) => surface.volume());
  for (const hollow of hollows) {
    const mesh = hollow.getMesh();
    const point: Vec3 = [mesh.vertProperties[0], mesh.vertProperties[1], mesh.vertProperties[2]];
    let best = -1;
    outer.forEach((surface, index) => {
      if (best >= 0 && volumes[index] >= volumes[best]) return;
      if (contains(surface.boundingBox(), point) && encloses(surface.getMesh(), point)) best = index;
    });
    // A hollow with nothing around it is a broken mesh's; it stays with the largest part rather than being lost.
    if (best < 0) best = volumes.indexOf(Math.max(...volumes));
    inside[best].push(hollow);
  }
  return outer.map((surface, index) => together(wasm, own, [surface, ...inside[index]]));
}

/** An open mesh's loose parts: the triangles joined to each other through corners they share. */
export function openParts(mesh: MeshData): MeshData[] {
  const vertices = mesh.positions.length / 3;
  const parent = new Int32Array(vertices).map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const [ra, rb] = [root(a), root(b)];
    if (ra !== rb) parent[ra] = rb;
  };
  for (let k = 0; k < mesh.indices.length; k += 3) {
    join(mesh.indices[k], mesh.indices[k + 1]);
    join(mesh.indices[k], mesh.indices[k + 2]);
  }
  const groups = new Map<number, number[]>();
  for (let k = 0; k < mesh.indices.length; k += 3) {
    const key = root(mesh.indices[k]);
    const triangles = groups.get(key);
    if (triangles) triangles.push(k);
    else groups.set(key, [k]);
  }
  if (groups.size < 2) return [mesh];
  return [...groups.values()].map((triangles) => {
    const renumbered = new Map<number, number>();
    const positions: number[] = [];
    const indices = new Uint32Array(triangles.length * 3);
    triangles.forEach((k, n) => {
      for (let c = 0; c < 3; c++) {
        const vertex = mesh.indices[k + c];
        let index = renumbered.get(vertex);
        if (index === undefined) {
          index = renumbered.size;
          renumbered.set(vertex, index);
          positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
        }
        indices[n * 3 + c] = index;
      }
    });
    return { positions: new Float32Array(positions), indices };
  });
}

export function boundsOfPositions(positions: ArrayLike<number>): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

const middle = (b: Bounds): Vec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const extent = (b: Bounds): Vec3 => sub(b.max, b.min);

/** Largest first, by the box around each; ties by where they are, so the order is the same every time. */
export function partOrder(a: Bounds, b: Bounds): number {
  const volume = (box: Bounds) => extent(box).reduce((product, side) => product * side, 1);
  return volume(b) - volume(a) || a.min[0] - b.min[0] || a.min[1] - b.min[1] || a.min[2] - b.min[2];
}

/**
 * Which of the parts a body has now each part separated from it was: the closest by where it is and how big, each taken
 * once, and none when nothing is near enough, say after an edit took the part away. -1 for a part not found.
 */
export function matchParts(wanted: Bounds[], found: Bounds[]): number[] {
  const pairs: { score: number; w: number; f: number }[] = [];
  wanted.forEach((want, w) => {
    const reach = 0.25 * length(extent(want)) + 0.01;
    found.forEach((have, f) => {
      const score = length(sub(middle(want), middle(have))) + length(sub(extent(want), extent(have)));
      if (score <= reach) pairs.push({ score, w, f });
    });
  });
  pairs.sort((a, b) => a.score - b.score);
  const match = wanted.map(() => -1);
  const taken = new Set<number>();
  for (const { w, f } of pairs) {
    if (match[w] >= 0 || taken.has(f)) continue;
    match[w] = f;
    taken.add(f);
  }
  return match;
}
