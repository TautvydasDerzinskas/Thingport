// Turning what OwlCAD stores into a file Thingport takes. Its two shapes of geometry both arrive as plain triangles,
// so both become a binary STL:
//
// - A library part is a GLB in Firebase Storage. They come from asset packs, not from CAD, so they are far from the
//   simple case: up to 85 nodes deep in a hierarchy, transformed, interleaved (`byteStride`), indexed as uint8,
//   uint16 or uint32, and carrying texture, colour and skin attributes we drop. Only the positions matter.
// - A CAD project's imported mesh comes from resolveProject's signed links in OwlCAD's own packed format.
//
// Pure: no config or network, so the contract test converts recorded bytes.

import { HttpError } from "../../utils/fileUtils";

/** glTF's triangle mode; a primitive drawn any other way is skipped rather than guessed at. */
const TRIANGLES = 4;
const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_BYTE = 5121;

/** A 4x4 as glTF writes it: column-major, 16 numbers. */
type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = Array.from({ length: 16 }, () => 0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** A node's own transform: its matrix, or the translation/rotation/scale it is built from. */
function nodeMatrix(node: Record<string, unknown>): Matrix {
  const matrix = node.matrix;
  if (Array.isArray(matrix) && matrix.length === 16 && matrix.every((n) => typeof n === "number")) {
    return matrix as Matrix;
  }
  const [tx, ty, tz] = (Array.isArray(node.translation) ? node.translation : [0, 0, 0]) as number[];
  const [qx, qy, qz, qw] = (Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1]) as number[];
  const [sx, sy, sz] = (Array.isArray(node.scale) ? node.scale : [1, 1, 1]) as number[];
  // The usual quaternion-to-basis expansion, each column then scaled.
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

type Gltf = {
  accessors?: Record<string, unknown>[];
  bufferViews?: Record<string, unknown>[];
  meshes?: { primitives: Record<string, unknown>[] }[];
  nodes?: Record<string, unknown>[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsRequired?: string[];
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The GLB container: a header, then a JSON chunk and a binary one. */
function readGlb(bytes: Uint8Array): { gltf: Gltf; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) {
    throw new HttpError(502, "OwlCAD sent something that isn't a GLB file.");
  }
  const total = Math.min(view.getUint32(8, true), bytes.byteLength);
  let offset = 12;
  let gltf: Gltf | null = null;
  let bin: Uint8Array = new Uint8Array(0);
  while (offset + 8 <= total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength) break;
    // 0x4e4f534a "JSON", 0x004e4942 "BIN\0"; any other chunk type is an extension's, and ignored.
    if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + length)));
    else if (type === 0x004e4942) bin = bytes.subarray(offset, offset + length);
    offset += length;
  }
  if (!gltf) throw new HttpError(502, "OwlCAD's GLB file has no glTF chunk.");
  return { gltf, bin };
}

/** Reads an accessor's numbers, honouring the interleaving (`byteStride`) the asset packs use. */
function readAccessor(gltf: Gltf, bin: Uint8Array, index: number, want: number[]): number[] {
  const accessor = gltf.accessors?.[index];
  if (!accessor) throw new HttpError(502, "OwlCAD's GLB file names an accessor it hasn't got.");
  if (accessor.sparse) throw new HttpError(502, "OwlCAD's GLB file uses sparse accessors, which Thingport can't read.");
  const componentType = num(accessor.componentType);
  if (!want.includes(componentType)) {
    throw new HttpError(502, `OwlCAD's GLB file stores geometry as type ${componentType}, which Thingport can't read.`);
  }
  const perElement = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[String(accessor.type)] ?? 0;
  if (!perElement) throw new HttpError(502, "OwlCAD's GLB file stores geometry in a shape Thingport can't read.");
  const count = num(accessor.count);
  const view = gltf.bufferViews?.[num(accessor.bufferView, -1)];
  if (!view) throw new HttpError(502, "OwlCAD's GLB file names a buffer view it hasn't got.");
  // Every offset below is into the GLB's own binary chunk, which is buffer 0. A view pointing at another buffer
  // means the data is in a file beside this one, and reading the chunk at that offset would be nonsense.
  if (num(view.buffer) !== 0) throw new HttpError(502, "OwlCAD's GLB file keeps its geometry in a separate file.");

  const size = { [FLOAT]: 4, [UNSIGNED_INT]: 4, [UNSIGNED_SHORT]: 2, [UNSIGNED_BYTE]: 1 }[componentType]!;
  const start = num(view.byteOffset) + num(accessor.byteOffset);
  const element = perElement * size;
  const stride = num(view.byteStride) || element;
  // `count` and `byteStride` are the file's own numbers, and the output array is sized from them. Both are checked
  // against the binary chunk first: otherwise a few hundred bytes of GLB claiming millions of elements, or a stride
  // too short to hold one, would be allocated for before anything noticed.
  if (stride < element) throw new HttpError(502, "OwlCAD's GLB file packs its geometry tighter than it fits.");
  if (start < 0 || (count > 0 && start + (count - 1) * stride + element > bin.byteLength)) {
    throw new HttpError(502, "OwlCAD's GLB file points past the end of its data.");
  }
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out: number[] = Array.from({ length: count * perElement });
  for (let i = 0; i < count; i++) {
    const base = start + i * stride;
    for (let c = 0; c < perElement; c++) {
      const at = base + c * size;
      out[i * perElement + c] =
        componentType === FLOAT
          ? data.getFloat32(at, true)
          : componentType === UNSIGNED_INT
            ? data.getUint32(at, true)
            : componentType === UNSIGNED_SHORT
              ? data.getUint16(at, true)
              : data.getUint8(at);
    }
  }
  return out;
}

/** Every triangle of a mesh node's primitives, in the node's own place in the scene. */
function collectMesh(gltf: Gltf, bin: Uint8Array, meshIndex: number, world: Matrix, out: number[]): void {
  for (const primitive of gltf.meshes?.[meshIndex]?.primitives ?? []) {
    if (num(primitive.mode, TRIANGLES) !== TRIANGLES) continue;
    const attributes = primitive.attributes as Record<string, number> | undefined;
    if (typeof attributes?.POSITION !== "number") continue;
    const positions = readAccessor(gltf, bin, attributes.POSITION, [FLOAT]);
    const indices =
      typeof primitive.indices === "number"
        ? readAccessor(gltf, bin, primitive.indices, [UNSIGNED_INT, UNSIGNED_SHORT, UNSIGNED_BYTE])
        : Array.from({ length: positions.length / 3 }, (_, i) => i);
    for (let i = 0; i + 2 < indices.length; i += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const at = indices[i + corner] * 3;
        const [x, y, z] = transformPoint(world, positions[at], positions[at + 1], positions[at + 2]);
        out.push(x, y, z);
      }
    }
  }
}

/** Walks the scene, composing each node's transform into its children's. */
function collectNode(gltf: Gltf, bin: Uint8Array, index: number, parent: Matrix, seen: Set<number>, out: number[]) {
  // Node graphs are trees, but a malformed file could loop; a node is visited once either way.
  if (seen.has(index)) return;
  seen.add(index);
  const node = gltf.nodes?.[index];
  if (!node) return;
  const world = multiply(parent, nodeMatrix(node));
  if (typeof node.mesh === "number") collectMesh(gltf, bin, node.mesh, world, out);
  for (const child of (Array.isArray(node.children) ? node.children : []) as number[]) {
    collectNode(gltf, bin, child, world, seen, out);
  }
}

/** A GLB's triangles, flattened to 9 numbers each, in the scene's own coordinates. */
export function glbTriangles(bytes: Uint8Array): number[] {
  const { gltf, bin } = readGlb(bytes);
  // KHR_materials_unlit and KHR_texture_transform are the ones its packs use; both only dress the surface. A
  // required extension, though, could be Draco, which would leave us reading nothing at all.
  if (gltf.extensionsRequired?.length) {
    throw new HttpError(
      502,
      `This OwlCAD part needs the glTF extension ${gltf.extensionsRequired[0]}, which Thingport can't read.`,
    );
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const roots = gltf.scenes?.[num(gltf.scene)]?.nodes;
  if (roots?.length) for (const root of roots) collectNode(gltf, bin, root, IDENTITY, seen, out);
  // A file with no scene, or one naming no nodes: every node is a root, and the walk still visits each once.
  else gltf.nodes?.forEach((_, index) => collectNode(gltf, bin, index, IDENTITY, seen, out));
  return out;
}

/** What OwlCAD makes a library part when it puts one on the plate: its longest side. */
const PART_SIZE_MM = 40;

/** A library part as OwlCAD itself has it, not as its asset pack stored it.
 *
 *  The packs are game assets, so a GLB's numbers are game units and its up axis is Y -- a Kenney tree is about one
 *  unit tall, which as millimetres would print the size of a grain of rice. OwlCAD turns it Z-up and scales it so
 *  its longest side is 40 mm, and that is the part everywhere on the site: it is what the gallery shows, and
 *  reproducing it here is what makes a doc's `meshStats.sizeMm` match what we import (the contract test checks
 *  exactly that). A part whose longest side is already 0 is left alone rather than divided by it. */
export function fitPartTriangles(triangles: number[]): number[] {
  const out: number[] = Array.from({ length: triangles.length });
  // glTF's (x, y, z) is OwlCAD's (x, -z, y).
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    out[i] = triangles[i];
    out[i + 1] = -triangles[i + 2];
    out[i + 2] = triangles[i + 1];
  }
  let longest = 0;
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = axis; i < out.length; i += 3) {
      if (out[i] < min) min = out[i];
      if (out[i] > max) max = out[i];
    }
    if (max > min) longest = Math.max(longest, max - min);
  }
  if (!(longest > 0)) return out;
  const scale = PART_SIZE_MM / longest;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/** OwlCAD's packed mesh: two or three little-endian lengths, then the positions, the indices and any colours. The
 *  third length is there only when the first two don't account for the whole file. A CAD project's mesh is already
 *  in the document's own millimetres and Z-up, so unlike a library part it is taken as it is. */
export function packedMeshTriangles(bytes: Uint8Array): number[] {
  if (bytes.byteLength < 8) throw new HttpError(502, "OwlCAD sent a mesh shorter than its own header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positionBytes = view.getUint32(0, true);
  const indexBytes = view.getUint32(4, true);
  if (positionBytes % 4 || indexBytes % 4) throw new HttpError(502, "OwlCAD sent a mesh with a corrupt header.");
  let header = 8;
  if (8 + positionBytes + indexBytes !== bytes.byteLength) {
    if (bytes.byteLength < 12) throw new HttpError(502, "OwlCAD sent a mesh shorter than its own header.");
    const colourBytes = view.getUint32(8, true);
    if (colourBytes % 4 || 12 + positionBytes + indexBytes + colourBytes !== bytes.byteLength) {
      throw new HttpError(502, "OwlCAD sent a mesh with a corrupt header.");
    }
    header = 12;
  }
  const out: number[] = [];
  const indexAt = header + positionBytes;
  for (let i = 0; i + 12 <= indexBytes; i += 12) {
    for (let corner = 0; corner < 3; corner++) {
      const at = header + view.getUint32(indexAt + i + corner * 4, true) * 12;
      if (at + 12 > indexAt) throw new HttpError(502, "OwlCAD sent a mesh pointing past its own vertices.");
      out.push(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));
    }
  }
  return out;
}

/** Triangles as a binary STL. The normals are computed per facet, since neither source stores one per triangle and
 *  slicers take the winding over the normal anyway. */
export function trianglesToStl(triangles: number[]): Buffer {
  const count = Math.floor(triangles.length / 9);
  const stl = Buffer.alloc(84 + count * 50);
  stl.writeUInt32LE(count, 80);
  for (let t = 0; t < count; t++) {
    const at = t * 9;
    const ux = triangles[at + 3] - triangles[at];
    const uy = triangles[at + 4] - triangles[at + 1];
    const uz = triangles[at + 5] - triangles[at + 2];
    const vx = triangles[at + 6] - triangles[at];
    const vy = triangles[at + 7] - triangles[at + 1];
    const vz = triangles[at + 8] - triangles[at + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // A degenerate triangle has no normal to speak of; STL takes zeroes for "work it out yourself".
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      nx = ny = nz = 0;
    }
    const facet = 84 + t * 50;
    stl.writeFloatLE(nx, facet);
    stl.writeFloatLE(ny, facet + 4);
    stl.writeFloatLE(nz, facet + 8);
    for (let corner = 0; corner < 9; corner++) stl.writeFloatLE(triangles[at + corner], facet + 12 + corner * 4);
  }
  return stl;
}
