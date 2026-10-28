import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { isColored, offToThreeMf, parseOff, writeThreeMf } from "./threeMf";

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

  // A script that uses color() makes the engine write each face's red, green and blue after its corners. Read
  // as one run of numbers rather than line by line, the first colour is taken for the next face's corner count
  // and every triangle after it is nonsense -- without anything failing, since the numbers still parse.
  it("ignores the colour the engine writes after a face's corners", () => {
    const coloured = `OFF
4 2 0
0 0 0
1 0 0
0 1 0
1 1 0
3 0 1 2 255 255 255
3 1 3 2 0 128 64
`;
    const mesh = parseOff(coloured);

    expect(Array.from(mesh.triangles)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(mesh.vertices.length).toBe(12);
    // Kept, as a palette with an index per triangle.
    expect(mesh.palette).toEqual(["#ffffff", "#008040"]);
    expect(Array.from(mesh.colors!)).toEqual([0, 1]);
  });

  it("carries no palette for a model the script never coloured", () => {
    const plain = parseOff("OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n");
    expect(plain.palette).toBeUndefined();
    expect(plain.colors).toBeUndefined();
  });

  it("keeps the one colour a script painted the whole model in", () => {
    // `color("red") cube();` -- one entry, but a colour the script asked for, and the only thing that says the
    // model isn't meant to be drawn in the theme's own.
    const same = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 255 0 0\n");
    expect(same.palette).toEqual(["#ff0000"]);
    expect(Array.from(same.colors!)).toEqual([0, 0]);
    expect(isColored(same)).toBe(true);
  });

  it("gives every piece of a fanned polygon the face's own colour", () => {
    // One quad, one colour, fanned into two triangles.
    const quad = parseOff("OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3 10 20 30\n");
    expect(quad.triangles.length).toBe(6);
    expect(Array.from(quad.colors!)).toEqual([0, 0]);
    // With a second, differently coloured face the palette appears and both halves of the quad share entry 0.
    const two = parseOff("OFF\n5 2 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n2 2 0\n4 0 1 2 3 10 20 30\n3 1 4 2 200 100 50\n");
    expect(two.palette).toEqual(["#0a141e", "#c86432"]);
    expect(Array.from(two.colors!)).toEqual([0, 0, 1]);
  });

  it("keeps a face the script never coloured apart from the ones it did", () => {
    // `cube(); color("red") sphere();` -- the cube's faces carry no colour at all. Taking the first entry
    // for them would paint them red, which is a colour the script never asked for.
    const mixed = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2\n3 1 3 2 255 0 0\n");
    expect(mixed.palette).toHaveLength(2);
    expect(mixed.palette).toContain("#ff0000");
    const [uncolored, red] = Array.from(mixed.colors!);
    expect(uncolored).not.toBe(red);
    expect(mixed.palette![red]).toBe("#ff0000");
  });

  it("reads 0-1 colour channels as well as 0-255 ones", () => {
    const fractions = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 1 0 0\n3 1 3 2 0.2 0.4 0.8\n");
    // The first face's "1 0 0" is whole numbers, so it stays 0-255 -- it is the fractional face that sets the
    // scale, and OFF gives no other way to tell 1 from 1.0.
    expect(fractions.palette).toEqual(["#010000", "#3366cc"]);
  });

  it("ignores an alpha channel after the colour", () => {
    const rgba = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0 128\n3 1 3 2 0 255 0 255\n");
    expect(rgba.palette).toEqual(["#ff0000", "#00ff00"]);
  });

  it("reads a header that keeps its counts on the same line", () => {
    expect(parseOff("OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n").triangles.length).toBe(3);
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

  it("writes a coloured mesh as base materials each triangle points at", () => {
    // Two triangles, two colours.
    const off = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 0 128 64\n";
    const xml = model(offToThreeMf(off));

    expect(xml).toContain('<basematerials id="2">');
    expect(xml).toContain('<base name="Colour 1" displaycolor="#FF0000FF"/>');
    expect(xml).toContain('<base name="Colour 2" displaycolor="#008040FF"/>');
    // The object points at the group, and each triangle at its own material in it.
    expect(xml).toContain('<object id="1" type="model" pid="2" pindex="0">');
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2" p1="0"/>');
    expect(xml).toContain('<triangle v1="1" v2="3" v3="2" p1="1"/>');
  });

  it("leaves a mesh the script never coloured exactly as it was, with no materials at all", () => {
    const xml = model(offToThreeMf(CUBE_OFF));
    expect(xml).not.toContain("basematerials");
    expect(xml).not.toContain("p1=");
    expect(xml).toContain('<object id="1" type="model">');
  });

  it("writes one explicit colour as the object's own material rather than per triangle", () => {
    const off = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 255 0 0\n";
    const xml = model(offToThreeMf(off));

    expect(xml).toContain('<base name="Colour 1" displaycolor="#FF0000FF"/>');
    expect(xml).toContain('<object id="1" type="model" pid="2" pindex="0">');
    // `pindex` already names it for every triangle, so repeating it on each would only grow the file.
    expect(xml).not.toContain("p1=");
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
