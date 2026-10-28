import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fitPartTriangles,
  glbTriangles,
  packedMeshTriangles,
  trianglesToStl,
} from "../../src/providers/owlcad/geometry";

// The two shapes OwlCAD's geometry arrives in, converted. Pure: no network, no database -- the GLB is the recorded
// one in fixtures/providers/owlcad, and the packed mesh is built here, since its format is three little-endian
// lengths and two typed arrays.

const partGlb = () =>
  new Uint8Array(fs.readFileSync(path.join(__dirname, "../fixtures/providers/owlcad/part-model.glb")));

/** OwlCAD's packed mesh: positionBytes, indexBytes, [colourBytes], then the positions, indices and any colours. */
function packed(positions: number[], indices: number[], colours?: number[]): Uint8Array {
  const pos = Float32Array.from(positions);
  const idx = Uint32Array.from(indices);
  const col = colours ? Float32Array.from(colours) : null;
  const header = col ? 12 : 8;
  const out = new Uint8Array(header + pos.byteLength + idx.byteLength + (col?.byteLength ?? 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, pos.byteLength, true);
  view.setUint32(4, idx.byteLength, true);
  if (col) view.setUint32(8, col.byteLength, true);
  out.set(new Uint8Array(pos.buffer), header);
  out.set(new Uint8Array(idx.buffer), header + pos.byteLength);
  if (col) out.set(new Uint8Array(col.buffer), header + pos.byteLength + idx.byteLength);
  return out;
}

/** A GLB around a JSON chunk and a binary one, so a test can state the numbers a file's own JSON claims. */
function glb(gltf: unknown, bin = new Uint8Array(0)): Uint8Array {
  const pad = (bytes: Uint8Array, filler: number) => {
    const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(filler);
    out.set(bytes);
    return out;
  };
  const json = pad(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const chunk = pad(bin, 0);
  const out = new Uint8Array(28 + json.length + chunk.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  view.setUint32(20 + json.length, chunk.length, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  out.set(chunk, 28 + json.length);
  return out;
}

/** One triangle mesh read through one accessor, whose claims about the data each test sets. */
const scene = (accessor: Record<string, unknown>, view: Record<string, unknown> = {}) => ({
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ mode: 4, attributes: { POSITION: 0 } }] }],
  accessors: [{ type: "VEC3", componentType: 5126, bufferView: 0, ...accessor }],
  bufferViews: [{ buffer: 0, byteOffset: 0, ...view }],
});

const extents = (triangles: number[]) =>
  [0, 1, 2].map((axis) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = axis; i < triangles.length; i += 3) {
      lo = Math.min(lo, triangles[i]);
      hi = Math.max(hi, triangles[i]);
    }
    return hi - lo;
  });

describe("OwlCAD geometry", () => {
  it("reads every triangle of a library part's GLB", () => {
    // The site's own meshStats for this part say 552 triangles.
    expect(glbTriangles(partGlb()).length / 9).toBe(552);
  });

  it("places a part as OwlCAD does: Z-up, its longest side 40 mm", () => {
    const raw = extents(glbTriangles(partGlb()));
    const fitted = extents(fitPartTriangles(glbTriangles(partGlb())));
    expect(Math.max(...fitted)).toBeCloseTo(40, 5);
    // glTF's (x, y, z) becomes (x, -z, y), so the raw Y and Z extents swap round.
    const scale = 40 / Math.max(...raw);
    expect(fitted[0]).toBeCloseTo(raw[0] * scale, 4);
    expect(fitted[1]).toBeCloseTo(raw[2] * scale, 4);
    expect(fitted[2]).toBeCloseTo(raw[1] * scale, 4);
  });

  it("leaves a part alone when it has no size to scale to", () => {
    // A GLB of a single degenerate triangle: dividing by its longest side would be dividing by zero.
    expect(fitPartTriangles([0, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual([0, -0, 0, 0, -0, 0, 0, -0, 0]);
  });

  it("decodes a packed mesh, with and without colours", () => {
    const positions = [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10];
    const indices = [0, 1, 2, 0, 1, 3];
    expect(packedMeshTriangles(packed(positions, indices))).toEqual([
      0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10,
    ]);
    // A mesh with a colour per vertex has a third length in its header, and the same geometry.
    const colours = Array.from({ length: positions.length }, () => 1);
    expect(packedMeshTriangles(packed(positions, indices, colours))).toEqual(
      packedMeshTriangles(packed(positions, indices)),
    );
  });

  it("refuses a packed mesh whose header doesn't match its bytes", () => {
    const good = packed([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    expect(() => packedMeshTriangles(good.subarray(0, good.length - 4))).toThrow(/corrupt|past/i);
    expect(() => packedMeshTriangles(new Uint8Array(4))).toThrow(/shorter than its own header/i);
  });

  it("refuses a packed mesh pointing past its own vertices", () => {
    expect(() => packedMeshTriangles(packed([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 9]))).toThrow(/past its own/i);
  });

  it("writes a binary STL with a normal per facet", () => {
    const stl = trianglesToStl([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(stl.length).toBe(84 + 50);
    expect(stl.readUInt32LE(80)).toBe(1);
    // That triangle lies in the XY plane wound anticlockwise, so its normal is +Z.
    expect([stl.readFloatLE(84), stl.readFloatLE(88), stl.readFloatLE(92)]).toEqual([0, 0, 1]);
  });

  it("gives a degenerate triangle a zero normal rather than NaN", () => {
    const stl = trianglesToStl([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([stl.readFloatLE(84), stl.readFloatLE(88), stl.readFloatLE(92)]).toEqual([0, 0, 0]);
  });

  it("refuses a GLB accessor claiming more elements than its data holds", () => {
    // Three VEC3 floats of data behind a count of ninety million. The output array is sized from that count, so the
    // claim has to be turned down before anything is allocated for it, not by the read that would run into the end.
    const bin = new Uint8Array(36);
    expect(() => glbTriangles(glb(scene({ count: 90_000_000 }, { byteLength: bin.length }), bin))).toThrow(
      /past the end/i,
    );
    expect(glbTriangles(glb(scene({ count: 3 }, { byteLength: bin.length }), bin))).toHaveLength(9);
  });

  it("refuses a GLB that interleaves its geometry tighter than one element", () => {
    // A VEC3 of floats is 12 bytes, so a stride of 4 reads each element over the two that follow -- within the
    // chunk, and so past no end, but overlapping nonsense all the same.
    const bin = new Uint8Array(36);
    expect(() => glbTriangles(glb(scene({ count: 3 }, { byteLength: bin.length, byteStride: 4 }), bin))).toThrow(
      /tighter than it fits/i,
    );
  });

  it("refuses something that isn't a GLB", () => {
    expect(() => glbTriangles(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/isn't a GLB/i);
  });
});
