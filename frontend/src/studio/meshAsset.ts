import type { MeshData } from "./document";

// A design's copy of an imported mesh, as one small binary file: "TPSM", a version, the vertex and triangle counts,
// then every vertex's x, y, z as 32-bit floats and every triangle's three corners as 32-bit indices, little-endian.

const MAGIC = "TPSM";
const VERSION = 1;
const HEADER = 16;

export function encodeMesh({ positions, indices }: MeshData): Uint8Array {
  const bytes = new Uint8Array(HEADER + positions.byteLength + indices.byteLength);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 4; i++) bytes[i] = MAGIC.charCodeAt(i);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, positions.length / 3, true);
  view.setUint32(12, indices.length / 3, true);
  let offset = HEADER;
  for (const value of positions) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  for (const value of indices) {
    view.setUint32(offset, value, true);
    offset += 4;
  }
  return bytes;
}

export function decodeMesh(data: ArrayBuffer | Uint8Array): MeshData {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC || view.getUint32(4, true) !== VERSION) throw new Error("Not a Studio mesh");
  const vertices = view.getUint32(8, true);
  const triangles = view.getUint32(12, true);
  if (bytes.byteLength !== HEADER + vertices * 12 + triangles * 12) throw new Error("A Studio mesh cut short");
  const positions = new Float32Array(vertices * 3);
  const indices = new Uint32Array(triangles * 3);
  let offset = HEADER;
  for (let i = 0; i < positions.length; i++, offset += 4) positions[i] = view.getFloat32(offset, true);
  for (let i = 0; i < indices.length; i++, offset += 4) {
    indices[i] = view.getUint32(offset, true);
    if (indices[i] >= vertices) throw new Error("A Studio mesh with a corner out of range");
  }
  return { positions, indices };
}
