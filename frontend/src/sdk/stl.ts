// Writing an STL from a mesh.
//
// The customizer renders once and gets a 3MF plus the geometry behind it. An STL is wanted twice over from that
// same geometry: the viewer loads one without any 3MF parsing, and it is the format most people still ask for on
// the way out. Binary, not the ASCII the engine itself writes -- the same model is a fifth of the size.

import type { Mesh } from "./threeMf";

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50;

/**
 * The mesh as the bytes of a binary .stl file.
 *
 * STL has no vertex list: every triangle spells its three corners out, and carries a facet normal. The normal is
 * computed here rather than left at zero -- a zero normal is legal and most slicers work it out themselves, but
 * some viewers light the model flat black instead.
 */
export function writeStl(mesh: Mesh): Uint8Array {
  const count = Math.floor(mesh.triangles.length / 3);
  if (!count) throw new Error("There is nothing in the model to save.");

  const bytes = new Uint8Array(HEADER_BYTES + COUNT_BYTES + count * TRIANGLE_BYTES);
  const view = new DataView(bytes.buffer);
  // The header is free text. Naming it keeps a stray file identifiable, and the 80 zero bytes a blank one
  // leaves behind read as a corrupt header to some tools.
  bytes.set(new TextEncoder().encode("Thingport"), 0);
  view.setUint32(HEADER_BYTES, count, true);

  const { vertices, triangles } = mesh;
  let at = HEADER_BYTES + COUNT_BYTES;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3;
    const b = triangles[t + 1] * 3;
    const c = triangles[t + 2] * 3;

    // Right-hand rule over the corners in the order they were wound, which is the way OpenSCAD winds them.
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a];
    const vy = vertices[c + 1] - vertices[a + 1];
    const vz = vertices[c + 2] - vertices[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    // A degenerate triangle -- two corners in the same place -- has no normal to speak of; left at zero.
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    view.setFloat32(at, nx, true);
    view.setFloat32(at + 4, ny, true);
    view.setFloat32(at + 8, nz, true);
    for (const corner of [a, b, c]) {
      at += 12;
      view.setFloat32(at, vertices[corner], true);
      view.setFloat32(at + 4, vertices[corner + 1], true);
      view.setFloat32(at + 8, vertices[corner + 2], true);
    }
    // The attribute byte count, which nothing here uses.
    view.setUint16(at + 12, 0, true);
    at += 14;
  }
  return bytes;
}
