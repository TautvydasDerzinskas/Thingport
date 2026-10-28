// Reading a binary STL into the mesh shape the 3MF writer takes.
//
// It lives here rather than in Thingport's SDK because the planner is the only thing that needs it: the
// joints it carries are STL, and a wall's download puts them in one file beside the plates it drew. If
// something else ever wants it, this is small enough to lift out whole.
//
// Binary only. An STL can also be written as text, but nothing the tool carries is, and guessing between the
// two on a file that starts with the word "solid" either way is a known way to read a file wrong.

/** The header a binary STL always has: 80 bytes of anything, then the triangle count. */
const HEADER = 84;
const PER_TRIANGLE = 50;

/** Is this a binary STL? True when the triangle count and the length agree, which text never manages. */
export function isBinaryStl(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  if (!bytes || bytes.byteLength < HEADER) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes.byteLength === HEADER + view.getUint32(80, true) * PER_TRIANGLE;
}

/**
 * A binary STL as `{ vertices, triangles }`.
 *
 * STL repeats every corner it touches -- three of them a triangle, no matter how many triangles meet there --
 * so the corners are gathered as they are read and the triangles point at them. A snap of a hundred thousand
 * triangles carries about half as many distinct corners, and writing it out twice over would be that much
 * more of the download for nothing.
 *
 * Corners are matched at a thousandth of a millimetre. Two that a printer could never tell apart are the same
 * corner here, which is also what keeps a mesh from arriving full of cracks.
 */
export function readBinaryStl(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  if (!bytes || bytes.byteLength < HEADER) throw new Error("That is too short to be an STL");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.byteLength !== HEADER + count * PER_TRIANGLE) {
    throw new Error("That is not a binary STL (its length and triangle count disagree)");
  }

  const vertices = [];
  const triangles = new Uint32Array(count * 3);
  const seen = new Map();
  for (let t = 0; t < count; t++) {
    // 12 bytes of normal first, which is recomputed from the corners anyway, then three corners.
    const base = HEADER + t * PER_TRIANGLE + 12;
    for (let c = 0; c < 3; c++) {
      const at = base + c * 12;
      const x = view.getFloat32(at, true);
      const y = view.getFloat32(at + 4, true);
      const z = view.getFloat32(at + 8, true);
      const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
      let index = seen.get(key);
      if (index === undefined) {
        index = vertices.length / 3;
        vertices.push(x, y, z);
        seen.set(key, index);
      }
      triangles[t * 3 + c] = index;
    }
  }
  return { vertices: new Float64Array(vertices), triangles };
}
