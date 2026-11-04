import type { MeshData } from "./document";
import { cross, dot, length, normalize, scale, sub, add, type Vec2, type Vec3 } from "./vec";

// What a body is made of, read off its triangles: its flat faces (coplanar triangles that touch), and its straight
// sharp edges (where two flat faces meet at an angle). Studio has no faces or edges of its own, only meshes, so these
// are how a fillet, a press/pull, a hole or a shell finds what it was pointed at, and how an assistant names it.

/** Faces meeting at less than this aren't an edge: the facets of a curved surface. */
export const SHARP_EDGE_DEGREES = 20;
// Triangles whose normals differ by less than this are one flat face.
const COPLANAR_RADIANS = 1e-3;

export type Face = {
  normal: Vec3;
  /** The plane: normal · p = offset. */
  offset: number;
  triangles: number[];
  area: number;
  centroid: Vec3;
};

export type Edge = {
  a: Vec3;
  b: Vec3;
  faces: [number, number];
  /** From the edge into each face, square to the edge, along the face. */
  into: [Vec3, Vec3];
  /** True where material is on the inside of the angle (an outside corner); false for an inside corner. */
  convex: boolean;
  /** Degrees between the two faces' normals: 90 for a box's edge. */
  bend: number;
};

export type Topology = {
  mesh: MeshData;
  /** Each triangle's face. */
  faceOf: Int32Array;
  faces: Face[];
  edges: Edge[];
  /** How close counts as on a face or an edge, from the mesh's size. */
  tolerance: number;
  /** Each mesh edge's two triangles, by edgeKey. */
  sides: Map<number, number[]>;
};

const edgeKey = (v0: number, v1: number, vertices: number) => Math.min(v0, v1) * vertices + Math.max(v0, v1);

const vertex = (mesh: MeshData, i: number): Vec3 => [
  mesh.positions[i * 3],
  mesh.positions[i * 3 + 1],
  mesh.positions[i * 3 + 2],
];

export function analyze(mesh: MeshData): Topology {
  const triangles = mesh.indices.length / 3;
  const vertices = mesh.positions.length / 3;
  let extent = 0;
  for (let i = 0; i < mesh.positions.length; i++) extent = Math.max(extent, Math.abs(mesh.positions[i]));
  const tolerance = Math.max(1e-5, extent * 2e-6);

  const normals: Vec3[] = [];
  const areas: number[] = [];
  for (let t = 0; t < triangles; t++) {
    const [p0, p1, p2] = [0, 1, 2].map((k) => vertex(mesh, mesh.indices[t * 3 + k]));
    const n = cross(sub(p1, p0), sub(p2, p0));
    areas.push(length(n) / 2);
    normals.push(normalize(n));
  }
  const offsetOf = (t: number) => dot(normals[t], vertex(mesh, mesh.indices[t * 3]));

  // Each edge's two triangles; manifold's meshes are closed, so there are always two.
  const sides = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const v0 = mesh.indices[t * 3 + k];
      const v1 = mesh.indices[t * 3 + ((k + 1) % 3)];
      const key = edgeKey(v0, v1, vertices);
      const list = sides.get(key);
      if (list) list.push(t);
      else sides.set(key, [t]);
    }
  }

  // Coplanar neighbours are one face.
  const parent = Int32Array.from({ length: triangles }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const cosCoplanar = Math.cos(COPLANAR_RADIANS);
  for (const pair of sides.values()) {
    if (pair.length !== 2) continue;
    const [t1, t2] = pair;
    if (dot(normals[t1], normals[t2]) > cosCoplanar && Math.abs(offsetOf(t1) - offsetOf(t2)) < tolerance * 10)
      parent[root(t1)] = root(t2);
  }
  const faceOf = new Int32Array(triangles);
  const faceIndex = new Map<number, number>();
  const faces: Face[] = [];
  for (let t = 0; t < triangles; t++) {
    const r = root(t);
    let index = faceIndex.get(r);
    if (index === undefined) {
      index = faces.length;
      faceIndex.set(r, index);
      faces.push({ normal: [0, 0, 0], offset: 0, triangles: [], area: 0, centroid: [0, 0, 0] });
    }
    faceOf[t] = index;
    const face = faces[index];
    face.triangles.push(t);
    face.area += areas[t];
    face.normal = add(face.normal, scale(normals[t], areas[t]));
    const [p0, p1, p2] = [0, 1, 2].map((k) => vertex(mesh, mesh.indices[t * 3 + k]));
    face.centroid = add(face.centroid, scale(add(add(p0, p1), p2), areas[t] / 3));
  }
  for (const face of faces) {
    face.normal = normalize(face.normal);
    face.centroid = face.area > 0 ? scale(face.centroid, 1 / face.area) : face.centroid;
    face.offset = dot(face.normal, face.centroid);
  }

  // Sharp edges, gathered by the two faces they're between, then joined into straight runs.
  const cosSharp = Math.cos((SHARP_EDGE_DEGREES * Math.PI) / 180);
  const byPair = new Map<string, { v0: Vec3; v1: Vec3; tA: number; tB: number; third: [Vec3, Vec3] }[]>();
  for (const [key, pair] of sides) {
    if (pair.length !== 2) continue;
    const [t1, t2] = pair;
    const f1 = faceOf[t1];
    const f2 = faceOf[t2];
    if (f1 === f2 || dot(faces[f1].normal, faces[f2].normal) > cosSharp) continue;
    const i0 = Math.floor(key / vertices);
    const i1 = key % vertices;
    const thirdOf = (t: number): Vec3 => {
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k];
        if (v !== i0 && v !== i1) return vertex(mesh, v);
      }
      return vertex(mesh, i0);
    };
    const [tA, tB] = f1 < f2 ? [t1, t2] : [t2, t1];
    const id = `${faceOf[tA]}:${faceOf[tB]}`;
    const entry = {
      v0: vertex(mesh, i0),
      v1: vertex(mesh, i1),
      tA,
      tB,
      third: [thirdOf(tA), thirdOf(tB)] as [Vec3, Vec3],
    };
    const list = byPair.get(id);
    if (list) list.push(entry);
    else byPair.set(id, [entry]);
  }

  const edges: Edge[] = [];
  for (const segments of byPair.values()) {
    const fA = faceOf[segments[0].tA];
    const fB = faceOf[segments[0].tB];
    const direction = normalize(cross(faces[fA].normal, faces[fB].normal));
    // Two flat faces meet in one line, so every piece is on it; pieces with a gap between are separate edges.
    const origin = segments[0].v0;
    const spans = segments
      .map((s) => {
        const [s0, s1] = [dot(sub(s.v0, origin), direction), dot(sub(s.v1, origin), direction)];
        return { from: Math.min(s0, s1), to: Math.max(s0, s1), s };
      })
      .toSorted((x, y) => x.from - y.from);
    let run = { from: spans[0].from, to: spans[0].to, s: spans[0].s };
    const flush = () => {
      const { s } = run;
      const intoOf = (normal: Vec3, third: Vec3): Vec3 => {
        const across = normalize(cross(normal, direction));
        return dot(sub(third, s.v0), across) >= 0 ? across : scale(across, -1);
      };
      const into: [Vec3, Vec3] = [intoOf(faces[fA].normal, s.third[0]), intoOf(faces[fB].normal, s.third[1])];
      const base = sub(s.v0, scale(direction, dot(sub(s.v0, origin), direction)));
      edges.push({
        a: add(base, scale(direction, run.from)),
        b: add(base, scale(direction, run.to)),
        faces: [fA, fB],
        into,
        convex: dot(faces[fA].normal, into[1]) < 0,
        bend: (Math.acos(Math.max(-1, Math.min(1, dot(faces[fA].normal, faces[fB].normal)))) * 180) / Math.PI,
      });
    };
    for (const span of spans.slice(1)) {
      if (span.from <= run.to + tolerance * 10) run.to = Math.max(run.to, span.to);
      else {
        flush();
        run = { from: span.from, to: span.to, s: span.s };
      }
    }
    flush();
  }
  return { mesh, faceOf, faces, edges, tolerance, sides };
}

/** Whether a point on the face's plane is on the face itself, within the tolerance. */
export function onFace(top: Topology, faceIndex: number, point: Vec3, slack = top.tolerance * 20): boolean {
  const face = top.faces[faceIndex];
  if (Math.abs(dot(face.normal, point) - face.offset) > slack) return false;
  for (const t of face.triangles) {
    const [p0, p1, p2] = [0, 1, 2].map((k) => vertex(top.mesh, top.mesh.indices[t * 3 + k]));
    // Inside when on the inner side of all three edges, allowing the slack.
    const inside = [
      [p0, p1],
      [p1, p2],
      [p2, p0],
    ].every(([a, b]) => {
      const inward = normalize(cross(face.normal, sub(b, a)));
      return dot(sub(point, a), inward) >= -slack;
    });
    if (inside) return true;
  }
  return false;
}

/** The flat face a reference points at, as the body is now: on its plane, facing its way, under its point. */
export function findFace(top: Topology, point: Vec3, normal: Vec3): number {
  const n = normalize(normal);
  let best = -1;
  for (let i = 0; i < top.faces.length; i++) {
    if (dot(top.faces[i].normal, n) < 0.9995) continue;
    if (!onFace(top, i, point)) continue;
    if (best < 0 || top.faces[i].area > top.faces[best].area) best = i;
  }
  return best;
}

/** The straight edge a reference points at: along its line, with its middle on the edge. */
export function findEdge(top: Topology, a: Vec3, b: Vec3): number {
  const direction = normalize(sub(b, a));
  const middle = scale(add(a, b), 0.5);
  let best = -1;
  let bestDistance = Infinity;
  top.edges.forEach((edge, i) => {
    const along = normalize(sub(edge.b, edge.a));
    if (Math.abs(dot(along, direction)) < 0.9995) return;
    const offset = sub(middle, edge.a);
    const t = dot(offset, along);
    if (t < -top.tolerance * 50 || t > length(sub(edge.b, edge.a)) + top.tolerance * 50) return;
    const off = length(sub(offset, scale(along, t)));
    if (off < top.tolerance * 50 && off < bestDistance) {
      best = i;
      bestDistance = off;
    }
  });
  return best;
}

/** A face's triangles laid onto its plane, in (u, v) about `origin`: what a CrossSection unites into its outline. */
export function faceTriangles2d(top: Topology, faceIndex: number, origin: Vec3, u: Vec3, v: Vec3): Vec2[][] {
  return top.faces[faceIndex].triangles.map((t) =>
    [0, 1, 2].map((k): Vec2 => {
      const p = sub(vertex(top.mesh, top.mesh.indices[t * 3 + k]), origin);
      return [dot(p, u), dot(p, v)];
    }),
  );
}

/** A mesh edge where two faces meet, however slight the bend: by its vertices' indices as well as where they are. */
export type Crease = { a: Vec3; b: Vec3; ends: [number, number]; faces: [number, number]; inside: boolean };

/** Every mesh edge between two faces, the facets of a curved surface's included. `inside` where the faces meet in a
 *  valley (the material wraps round more than half a turn), as at an L's inner corner or along a hole's wall. */
export function creases(top: Topology): Crease[] {
  const { mesh } = top;
  const vertices = mesh.positions.length / 3;
  const found: Crease[] = [];
  for (const [key, pair] of top.sides) {
    if (pair.length !== 2) continue;
    const [t1, t2] = pair;
    const f1 = top.faceOf[t1];
    const f2 = top.faceOf[t2];
    if (f1 === f2) continue;
    const i0 = Math.floor(key / vertices);
    const i1 = key % vertices;
    let third = i0;
    for (let k = 0; k < 3; k++) {
      const v = mesh.indices[t2 * 3 + k];
      if (v !== i0 && v !== i1) third = v;
    }
    const a = vertex(mesh, i0);
    const inside = dot(top.faces[f1].normal, sub(vertex(mesh, third), a)) > top.tolerance;
    found.push({ a, b: vertex(mesh, i1), ends: [i0, i1], faces: [f1, f2], inside });
  }
  return found;
}
