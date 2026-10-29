import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { isColored, layoutRow, meshBounds, offToThreeMf, parseOff, writeThreeMf } from "./threeMf";

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
    // Named, so what is drawn in the reader's colour can be told from what the script painted: the stand-in's
    // own grey can't say it, since a script may ask for that grey.
    expect(mixed.uncolored).toBe(uncolored);
  });

  it("tells the stand-in for uncoloured faces from the same grey a script asked for", () => {
    const grey = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 204 204 204\n3 1 3 2\n");
    const [painted, left] = Array.from(grey.colors!);
    expect(grey.palette![painted]).toBe("#cccccc");
    expect(grey.palette![left]).toBe("#cccccc");
    // Two entries of one colour: the script's, and the one the faces it left fall to.
    expect(painted).not.toBe(left);
    expect(grey.uncolored).toBe(left);
  });

  it("names no stand-in for a model whose every face the script coloured", () => {
    const all = parseOff("OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 0 255 0\n");
    expect(all.uncolored).toBeUndefined();
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

  it("writes a coloured mesh as a colour group each triangle points at", () => {
    // Two triangles, two colours.
    const off = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 0 128 64\n";
    const xml = model(offToThreeMf(off));

    expect(xml).toContain('<m:color color="#FF0000FF"/>');
    expect(xml).toContain('<m:color color="#008040FF"/>');
    // The Materials extension has to be declared, and Bambu Studio -- which is the reason the colours are
    // written as a colorgroup rather than as base materials -- matches on the `m:` prefix itself.
    expect(xml).toContain('xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"');
    // The object points at the group, and each triangle at its own colour in it. Which ids those are is
    // the writer's own business -- what matters is that they agree, and that the group comes first, since
    // 3MF wants a resource defined before anything names it.
    const group = xml.match(/<m:colorgroup id="(\d+)">/)?.[1];
    expect(group).toBeDefined();
    expect(xml).toContain(`pid="${group}" pindex="0"`);
    expect(xml.indexOf("<m:colorgroup")).toBeLessThan(xml.indexOf("<object"));
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2" p1="0"');
    expect(xml).toContain('<triangle v1="1" v2="3" v3="2" p1="1"');
  });

  // Bambu Studio and PrusaSlicer both ignore `pid`/`p1`; painting is the only colour either reads off a
  // triangle, so the same assignment goes out a second time in their spelling.
  it("paints each triangle with the filament its colour is, for the slicers that read only that", () => {
    const off = "OFF\n5 3 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n2 2 0\n3 0 1 2 255 0 0\n3 1 3 2 0 128 64\n3 2 3 4 0 0 255\n";
    const xml = model(offToThreeMf(off));

    expect(xml).toContain('xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"');
    // "4", "8" and "0C" are filaments 1, 2 and 3 in the triangle-selector code both slicers use.
    expect(xml).toContain('p1="0" paint_color="4" slic3rpe:mmu_segmentation="4"');
    expect(xml).toContain('p1="1" paint_color="8" slic3rpe:mmu_segmentation="8"');
    expect(xml).toContain('p1="2" paint_color="0C" slic3rpe:mmu_segmentation="0C"');
  });

  it("leaves a mesh the script never coloured exactly as it was, with no colours at all", () => {
    const xml = model(offToThreeMf(CUBE_OFF));
    expect(xml).not.toContain("colorgroup");
    expect(xml).not.toContain("xmlns:m=");
    expect(xml).not.toContain("p1=");
    expect(xml).not.toContain("paint_color");
    expect(xml).toMatch(/<object id="\d+" type="model">/);
  });

  it("writes one explicit colour as the object's own rather than per triangle", () => {
    const off = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 255 0 0\n";
    const xml = model(offToThreeMf(off));

    expect(xml).toContain('<m:color color="#FF0000FF"/>');
    const only = xml.match(/<m:colorgroup id="(\d+)">/)?.[1];
    expect(xml).toContain(`pid="${only}" pindex="0"`);
    // `pindex` already names it for every triangle, so repeating it on each would only grow the file.
    expect(xml).not.toContain("p1=");
    expect(xml).not.toContain("paint_color");
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

describe("writeThreeMf, several parts", () => {
  const cube = () => parseOff(CUBE_OFF);
  const red = () => parseOff("OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 255 0 0\n");
  const blue = () => parseOff("OFF\n3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 0 0 255\n");

  it("writes an object and a build item for each part", () => {
    const xml = model(writeThreeMf([{ mesh: cube() }, { mesh: cube() }, { mesh: cube() }]));
    expect(xml.match(/<object /g)).toHaveLength(3);
    expect(xml.match(/<item /g)).toHaveLength(3);
  });

  it("gives every object its own id, and points each build item at one", () => {
    const xml = model(writeThreeMf([{ mesh: cube() }, { mesh: cube() }]));
    const ids = [...xml.matchAll(/<object id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(xml).toContain(`<item objectid="${id}"`);
  });

  it("names an object, so a slicer's list can say how many of it to print", () => {
    const xml = model(writeThreeMf([{ mesh: cube(), name: "8x8 Core Tile x4" }]));
    expect(xml).toContain('name="8x8 Core Tile x4"');
  });

  it("escapes a name that would otherwise break the XML", () => {
    const xml = model(writeThreeMf([{ mesh: cube(), name: 'Tile <"4">' }]));
    expect(xml).toContain("Tile &lt;&quot;4&quot;&gt;");
    expect(xml).not.toContain('<"4">');
  });

  it("places a part with a move, and leaves one without `at` where its mesh already is", () => {
    const xml = model(writeThreeMf([{ mesh: cube(), at: { x: 10, y: 20 } }, { mesh: cube() }]));
    expect(xml).toContain('transform="1 0 0 0 1 0 0 0 1 10 20 0"');
    expect(xml.match(/<item objectid="\d+"\/>/g)).toHaveLength(1);
  });

  it("keeps each part's colours to itself, in its own group", () => {
    const xml = model(writeThreeMf([{ mesh: red() }, { mesh: blue() }]));
    const groups = [...xml.matchAll(/<m:colorgroup id="(\d+)">/g)].map((m) => m[1]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups).size).toBe(2);
    expect(xml).toContain('<m:color color="#FF0000FF"/>');
    expect(xml).toContain('<m:color color="#0000FFFF"/>');
    for (const id of groups) expect(xml).toContain(`pid="${id}" pindex="0"`);
  });

  it("writes an uncoloured part beside a coloured one without giving it a colour", () => {
    const xml = model(writeThreeMf([{ mesh: cube() }, { mesh: red() }]));
    expect(xml.match(/<m:colorgroup /g)).toHaveLength(1);
    expect(xml.match(/<object /g)).toHaveLength(2);
    expect(xml.match(/pid="/g)).toHaveLength(1);
  });

  it("still takes a single mesh, as everything that saves one model does", () => {
    const xml = model(writeThreeMf(cube(), { name: "One" }));
    expect(xml.match(/<object /g)).toHaveLength(1);
    expect(xml).toContain('<metadata name="Title">One</metadata>');
  });

  it("says so when there is nothing to save", () => {
    expect(() => writeThreeMf([])).toThrow(/nothing in the model/i);
    const empty = { vertices: new Float64Array(), triangles: new Uint32Array() };
    expect(() => writeThreeMf([{ mesh: empty }])).toThrow(/nothing in the model/i);
  });
});

describe("layoutRow", () => {
  const cube = () => parseOff(CUBE_OFF); // 10 x 20 x 30, with a corner on the origin

  it("stands each part on z = 0 and sets it down beside the one before", () => {
    const [first, second] = layoutRow([{ mesh: cube() }, { mesh: cube() }], { gap: 5 });
    expect(first.at).toEqual({ x: 0, y: 0, z: 0 });
    // the cube is 10 wide, so the next starts at 10 + the gap
    expect(second.at).toEqual({ x: 15, y: 0, z: 0 });
  });

  it("moves a part that sits away from the origin back onto it", () => {
    const mesh = parseOff("OFF\n3 1 0\n100 50 7\n110 50 7\n100 60 7\n3 0 1 2\n");
    const [only] = layoutRow([{ mesh }]);
    expect(only.at).toEqual({ x: -100, y: -50, z: -7 });
  });

  it("keeps what each part already said about itself", () => {
    const [only] = layoutRow([{ mesh: cube(), name: "Tile" }]);
    expect(only.name).toBe("Tile");
  });
});

describe("meshBounds", () => {
  it("measures a mesh in millimetres", () => {
    expect(meshBounds(parseOff(CUBE_OFF))).toEqual({ min: [0, 0, 0], max: [10, 20, 30] });
  });
});
