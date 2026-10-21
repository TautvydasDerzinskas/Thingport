// Printability checks on a triangle mesh: holes, non-manifold edges, flipped faces, loose fragments and an
// implausible size. The rules are the ones slicers (ADMesh) and Blender's 3D Print Toolbox use: every edge of a
// solid belongs to exactly two faces, walked in opposite directions.
//
// Pure: runs in the render worker (modelPreviewWorker.ts) and in tests, so no config/db imports.

/** Bump when the rules change, so files checked by older rules are checked again on the next open. */
export const QUALITY_CHECK_VERSION = 1;

export type MeshStats = {
  triangles: number;
  /** Edges with one face: the boundary of a hole. */
  openEdges: number;
  /** Edges with three or more faces. */
  nonManifoldEdges: number;
  /** Edges whose two faces walk them the same way: one of the faces is turned inside out. */
  flippedEdges: number;
  /** Zero-area triangles, which slicers drop silently. */
  degenerateTriangles: number;
  /** Connected bodies. */
  shells: number;
  /** Bodies tiny next to the whole mesh: stray debris rather than a part. */
  fragments: number;
  /** Signed volume, negative when the whole mesh faces inwards. */
  volume: number;
  min: [number, number, number];
  max: [number, number, number];
};

// Positions closer than this (in model units, usually mm) are one corner. STL repeats each corner per triangle, and
// exporters round differently, so exact matching would leave cracks that aren't there.
const WELD_TOLERANCE = 1e-4;
// A body whose bounding box is under this fraction of the whole mesh's is a fragment.
const FRAGMENT_SIZE_RATIO = 0.01;

/** Open-addressing hash of quantised positions to welded vertex ids. */
function weldVertices(vertices: ArrayLike<number>): { ids: Uint32Array; count: number } {
  const vertexCount = Math.floor(vertices.length / 3);
  const ids = new Uint32Array(vertexCount);
  let size = 1;
  while (size < vertexCount * 2) size <<= 1;
  const mask = size - 1;
  const slots = new Int32Array(size).fill(-1);
  // The quantised position of each welded vertex, to compare on collision.
  const keys = new Float64Array(vertexCount * 3);
  let count = 0;
  for (let v = 0; v < vertexCount; v++) {
    const qx = Math.round(vertices[v * 3] / WELD_TOLERANCE);
    const qy = Math.round(vertices[v * 3 + 1] / WELD_TOLERANCE);
    const qz = Math.round(vertices[v * 3 + 2] / WELD_TOLERANCE);
    let slot = (Math.imul(qx | 0, 73856093) ^ Math.imul(qy | 0, 19349663) ^ Math.imul(qz | 0, 83492791)) & mask;
    for (;;) {
      const existing = slots[slot];
      if (existing === -1) {
        slots[slot] = count;
        keys[count * 3] = qx;
        keys[count * 3 + 1] = qy;
        keys[count * 3 + 2] = qz;
        ids[v] = count++;
        break;
      }
      if (keys[existing * 3] === qx && keys[existing * 3 + 1] === qy && keys[existing * 3 + 2] === qz) {
        ids[v] = existing;
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return { ids, count };
}

function findRoot(parent: Uint32Array, node: number): number {
  let root = node;
  while (parent[root] !== root) root = parent[root];
  // Path halving keeps later lookups short.
  while (parent[node] !== root) {
    const next = parent[node];
    parent[node] = root;
    node = next;
  }
  return root;
}

/** `triangles` indexes `vertices` three per face; without it, every three vertices are a face (as in STL). */
export function analyzeMesh(vertices: ArrayLike<number>, triangles?: ArrayLike<number> | null): MeshStats {
  const { ids, count: vertexCount } = weldVertices(vertices);
  const corner = triangles ? (i: number) => ids[triangles[i]] : (i: number) => ids[i];
  const cornerCount = triangles ? triangles.length : ids.length;
  const triangleCount = Math.floor(cornerCount / 3);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = vertices[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // Twice the area below which a triangle counts as having none, relative to the mesh's size.
  const degenerateArea = (diagonal * 1e-9) ** 2;

  const parent = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  // Each edge as (low * vertexCount + high) * 2 + (walked high -> low). Exact in a double up to ~67M vertices.
  const edges = new Float64Array(triangleCount * 3);
  let edgeCount = 0;
  let degenerate = 0;
  let volume = 0;
  // Any original vertex of each welded one, to read its position back.
  const firstVertex = new Uint32Array(vertexCount);
  for (let v = ids.length - 1; v >= 0; v--) firstVertex[ids[v]] = v;
  const position = (id: number, axis: number) => vertices[firstVertex[id] * 3 + axis];
  // Degenerate faces join no body, so they mustn't make a bounding box of their own either.
  const skipped = new Uint8Array(triangleCount);

  for (let t = 0; t < triangleCount; t++) {
    const a = corner(t * 3);
    const b = corner(t * 3 + 1);
    const c = corner(t * 3 + 2);
    // An index past the vertex list would make NaN edge keys, which never group and stall the loop below.
    if (a === undefined || b === undefined || c === undefined) {
      throw new RangeError("Triangle index outside the vertex list");
    }
    const ax = position(a, 0);
    const ay = position(a, 1);
    const az = position(a, 2);
    const ux = position(b, 0) - ax;
    const uy = position(b, 1) - ay;
    const uz = position(b, 2) - az;
    const vx = position(c, 0) - ax;
    const vy = position(c, 1) - ay;
    const vz = position(c, 2) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (a === b || b === c || a === c || nx * nx + ny * ny + nz * nz <= degenerateArea * degenerateArea) {
      degenerate++;
      skipped[t] = 1;
      continue;
    }
    // The tetrahedron to the origin; the sum over a closed surface is its volume.
    volume += (ax * nx + ay * ny + az * nz) / 6;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      edges[edgeCount++] = (low * vertexCount + high) * 2 + (from > to ? 1 : 0);
      const rootFrom = findRoot(parent, from);
      const rootTo = findRoot(parent, to);
      if (rootFrom !== rootTo) parent[rootFrom] = rootTo;
    }
  }

  // oxlint-disable-next-line unicorn/no-array-sort -- in place on purpose: a copy would double the largest buffer.
  const sorted = edges.subarray(0, edgeCount).sort();
  let openEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  for (let start = 0; start < sorted.length;) {
    const edge = Math.floor(sorted[start] / 2);
    let end = start;
    let reversed = 0;
    while (end < sorted.length && Math.floor(sorted[end] / 2) === edge) {
      reversed += sorted[end] % 2;
      end++;
    }
    const faces = end - start;
    if (faces === 1) openEdges++;
    else if (faces > 2) nonManifoldEdges++;
    else if (reversed !== 1) flippedEdges++;
    start = end;
  }

  // Each body's bounding box, keyed by its root vertex.
  const boxes = new Map<number, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    if (skipped[t]) continue;
    for (let k = 0; k < 3; k++) {
      const id = corner(t * 3 + k);
      const root = findRoot(parent, id);
      let box = boxes.get(root);
      if (!box) {
        box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        boxes.set(root, box);
      }
      for (let axis = 0; axis < 3; axis++) {
        const value = position(id, axis);
        if (value < box[axis]) box[axis] = value;
        if (value > box[axis + 3]) box[axis + 3] = value;
      }
    }
  }
  let fragments = 0;
  if (boxes.size > 1) {
    for (const box of boxes.values()) {
      const size = Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]);
      if (size < diagonal * FRAGMENT_SIZE_RATIO) fragments++;
    }
  }

  return {
    triangles: triangleCount,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    degenerateTriangles: degenerate,
    shells: boxes.size,
    fragments,
    volume,
    min,
    max,
  };
}

export type QualityIssueCode =
  | "unreadable"
  | "empty"
  | "missingParts"
  | "openEdges"
  | "nonManifoldEdges"
  | "flippedFaces"
  | "insideOut"
  | "fragments"
  | "tooSmall"
  | "tooLarge";
/** What an admin switches on or off: related issues share one. */
export type QualityCheckKey =
  "damaged" | "missingParts" | "openEdges" | "nonManifoldEdges" | "flippedFaces" | "insideOut" | "fragments" | "scale";
export const QUALITY_CHECK_KEYS: readonly QualityCheckKey[] = [
  "damaged",
  "missingParts",
  "openEdges",
  "nonManifoldEdges",
  "flippedFaces",
  "insideOut",
  "fragments",
  "scale",
];
export const QUALITY_CHECK_OF_ISSUE: Record<QualityIssueCode, QualityCheckKey> = {
  unreadable: "damaged",
  empty: "damaged",
  missingParts: "missingParts",
  openEdges: "openEdges",
  nonManifoldEdges: "nonManifoldEdges",
  flippedFaces: "flippedFaces",
  insideOut: "insideOut",
  fragments: "fragments",
  tooSmall: "scale",
  tooLarge: "scale",
};

/** Critical: the print fails or comes out incomplete. Major: it likely prints with defects. Minor: slicers usually
 * cope, or it's a quick fix in one. */
export type QualitySeverity = "critical" | "major" | "minor";
// Looked up when results are read rather than saved with them, so changing one needs no new check.
export const QUALITY_SEVERITY: Record<QualityCheckKey, QualitySeverity> = {
  damaged: "critical",
  missingParts: "critical",
  openEdges: "major",
  flippedFaces: "major",
  insideOut: "major",
  nonManifoldEdges: "minor",
  fragments: "minor",
  scale: "minor",
};

export type QualityIssue = { code: QualityIssueCode; count?: number };

export type QualityReport = {
  version: number;
  status: "good" | "issues";
  issues: QualityIssue[];
  triangles: number;
  shells: number;
  /** Bounding box size in model units (mm for print files). */
  size: [number, number, number];
};

// A print smaller than this in every direction was almost certainly exported in metres or inches-as-mm.
const TOO_SMALL_MM = 1;
// Bigger than any consumer printer, in one direction: likely exported in the wrong unit.
const TOO_LARGE_MM = 2000;

/** One file's verdict from the stats of each mesh in it. Meshes are checked apart, since separate objects touching
 * each other aren't a defect. */
export function summarizeQuality(meshes: MeshStats[], missingParts = 0): QualityReport {
  const total = (key: "openEdges" | "nonManifoldEdges" | "flippedEdges" | "fragments" | "triangles" | "shells") =>
    meshes.reduce((sum, mesh) => sum + mesh[key], 0);
  const min = [0, 1, 2].map((axis) => Math.min(...meshes.map((mesh) => mesh.min[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...meshes.map((mesh) => mesh.max[axis])));
  const size = (meshes.length ? [0, 1, 2].map((axis) => max[axis] - min[axis]) : [0, 0, 0]) as [number, number, number];

  const issues: QualityIssue[] = [];
  const add = (code: QualityIssueCode, count?: number) => {
    if (count === undefined || count > 0) issues.push(count === undefined ? { code } : { code, count });
  };
  const triangles = total("triangles");
  if (triangles === 0) add("empty");
  add("missingParts", missingParts);
  add("openEdges", total("openEdges"));
  add("nonManifoldEdges", total("nonManifoldEdges"));
  add("flippedFaces", total("flippedEdges"));
  // Only for a closed mesh: an open one has no inside, so its sign means nothing.
  const insideOut = meshes.filter((mesh) => mesh.openEdges === 0 && mesh.triangles > 0 && mesh.volume < 0).length;
  add("insideOut", insideOut);
  add("fragments", total("fragments"));
  if (triangles > 0) {
    if (Math.max(...size) < TOO_SMALL_MM) add("tooSmall");
    else if (Math.max(...size) > TOO_LARGE_MM) add("tooLarge");
  }

  return {
    version: QUALITY_CHECK_VERSION,
    status: issues.length ? "issues" : "good",
    issues,
    triangles,
    shells: total("shells"),
    size,
  };
}
