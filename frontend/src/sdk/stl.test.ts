import { describe, expect, it } from "vitest";
import { writeStl } from "./stl";
import type { Mesh } from "./threeMf";

/** One triangle in the z = 0 plane, wound anticlockwise seen from above, so its normal points at +Z. */
const TRIANGLE: Mesh = {
  vertices: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: Uint32Array.from([0, 1, 2]),
};

/** The triangles of a binary STL, read back out. */
function readStl(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const facets = [];
  for (let i = 0; i < count; i++) {
    const at = 84 + i * 50;
    const floats = [];
    for (let f = 0; f < 12; f++) floats.push(view.getFloat32(at + f * 4, true));
    facets.push({ normal: floats.slice(0, 3), corners: [floats.slice(3, 6), floats.slice(6, 9), floats.slice(9, 12)] });
  }
  return { count, facets, header: new TextDecoder().decode(bytes.slice(0, 9)) };
}

describe("writeStl", () => {
  it("writes the 84-byte preamble and 50 bytes per triangle", () => {
    expect(writeStl(TRIANGLE)).toHaveLength(84 + 50);
  });

  it("names itself in the header rather than leaving it blank", () => {
    expect(readStl(writeStl(TRIANGLE)).header).toBe("Thingport");
  });

  it("spells out each triangle's corners in the order they were wound", () => {
    const { count, facets } = readStl(writeStl(TRIANGLE));
    expect(count).toBe(1);
    expect(facets[0].corners).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it("works out the facet normal, rather than leaving it at zero", () => {
    expect(readStl(writeStl(TRIANGLE)).facets[0].normal).toEqual([0, 0, 1]);
  });

  it("winds the normal the other way for the opposite face", () => {
    const flipped: Mesh = { ...TRIANGLE, triangles: Uint32Array.from([0, 2, 1]) };
    const [x, y, z] = readStl(writeStl(flipped)).facets[0].normal;
    expect(z).toBe(-1);
    expect([x, y]).toEqual([0, 0]);
  });

  it("leaves a degenerate triangle's normal at zero instead of writing NaN", () => {
    const degenerate: Mesh = {
      vertices: Float64Array.from([0, 0, 0, 1, 0, 0, 1, 0, 0]),
      triangles: Uint32Array.from([0, 1, 2]),
    };
    expect(readStl(writeStl(degenerate)).facets[0].normal).toEqual([0, 0, 0]);
  });

  it("shares no vertices: two triangles come out as six corners", () => {
    const quad: Mesh = {
      vertices: Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    };
    const { count, facets } = readStl(writeStl(quad));
    expect(count).toBe(2);
    expect(facets.flatMap((facet) => facet.corners)).toHaveLength(6);
    // Both halves of a flat quad face the same way.
    expect(facets[1].normal).toEqual(facets[0].normal);
  });

  it("refuses a mesh with nothing in it", () => {
    expect(() => writeStl({ vertices: new Float64Array(), triangles: new Uint32Array() })).toThrow(/nothing/i);
  });
});
