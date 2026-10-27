import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { offToThreeMf, parseOff, writeThreeMf } from "./threeMf";

// The OFF below is exactly what the engine writes for `cube([10,20,30]);` -- six quads, not twelve triangles,
// which is the whole reason this has to triangulate rather than copy.
const CUBE_OFF = `OFF
8 6 0
0 0 0
10 0 0
0 20 0
10 20 0
0 0 30
10 0 30
0 20 30
10 20 30
4 4 5 7 6
4 2 3 1 0
4 0 1 5 4
4 1 3 7 5
4 3 2 6 7
4 2 0 4 6
`;

const model = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);

describe("parseOff", () => {
  it("reads the vertices and fans each polygon into triangles", () => {
    const mesh = parseOff(CUBE_OFF);

    expect(mesh.vertices.length).toBe(8 * 3);
    expect(Array.from(mesh.vertices.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(mesh.vertices.slice(21))).toEqual([10, 20, 30]);
    // Six quads, two triangles each.
    expect(mesh.triangles.length).toBe(6 * 2 * 3);
    expect(Array.from(mesh.triangles.slice(0, 6))).toEqual([4, 5, 7, 4, 7, 6]);
  });

  it("ignores comments and blank lines", () => {
    const mesh = parseOff("OFF\n# a comment\n\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n");
    expect(mesh.triangles.length).toBe(3);
  });

  it("says so when handed something that isn't OFF", () => {
    expect(() => parseOff("solid thing\nendsolid thing\n")).toThrow(/isn't OFF/);
  });
});

describe("writeThreeMf", () => {
  it("writes a zip a slicer would recognise as a 3MF", () => {
    const bytes = offToThreeMf(CUBE_OFF, { name: "Test cube" });
    const entries = unzipSync(bytes);

    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // "PK"
    expect(Object.keys(entries).toSorted()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"]);
    expect(strFromU8(entries["[Content_Types].xml"])).toContain("3dmanufacturing-3dmodel+xml");
    expect(strFromU8(entries["_rels/.rels"])).toContain("/3D/3dmodel.model");
  });

  it("lists every vertex once and every triangle that uses it", () => {
    const xml = model(offToThreeMf(CUBE_OFF));

    expect(xml.match(/<vertex /g)).toHaveLength(8);
    expect(xml.match(/<triangle /g)).toHaveLength(12);
    expect(xml).toContain('<vertex x="10" y="20" z="30"/>');
    expect(xml).toContain("<build>");
  });

  it("escapes a name that would otherwise break the XML", () => {
    const xml = model(offToThreeMf(CUBE_OFF, { name: 'Rick & Morty <"tag">' }));
    expect(xml).toContain("Rick &amp; Morty &lt;&quot;tag&quot;&gt;");
    expect(xml).not.toContain('<"tag">');
  });

  it("trims coordinates rather than carrying a float's full tail", () => {
    const xml = model(offToThreeMf("OFF\n3 1 0\n0.1234567891 0 0\n1 0 0\n0 1 0\n3 0 1 2\n"));
    expect(xml).toContain('x="0.12346"');
  });

  it("refuses to write a model with nothing in it", () => {
    expect(() => writeThreeMf({ vertices: new Float64Array(), triangles: new Uint32Array() })).toThrow(/nothing/);
  });
});
