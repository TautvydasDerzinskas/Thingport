import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import * as THREE from "three";
import { parseTransform3MF, readBaseMaterials, readTriangleMaterial, resolveInternalComponents } from "./bambuThreeMf";
import { offToThreeMf } from "../sdk/threeMf";

// Both readers only ever ask a node for an attribute or for its children by tag, so plain objects stand in for
// the DOM: the frontend's tests run in node, which has no DOMParser to build real ones with.
type Stub = { getAttribute(name: string): string | null; getElementsByTagName(tag: string): Stub[] };

const node = (attrs: Record<string, string>, children: Record<string, Stub[]> = {}): Stub => ({
  getAttribute: (name) => attrs[name] ?? null,
  getElementsByTagName: (tag) => children[tag] ?? [],
});

/** A `<basematerials id>` holding one `<base displaycolor>` per colour; null for an entry with no colour at all. */
const group = (id: string, colors: (string | null)[]): Stub =>
  node({ id }, { base: colors.map((color) => node(color === null ? {} : { displaycolor: color })) });

/** An `<m:colorgroup id>` holding one `<m:color color>` per colour, which is what Thingport writes. */
const colorGroup = (id: string, colors: (string | null)[]): Stub =>
  node({ id }, { "m:color": colors.map((color) => node(color === null ? {} : { color })) });

const docOf = (...groups: Stub[]) =>
  node({}, { basematerials: groups }) as unknown as Parameters<typeof readBaseMaterials>[0];

const colorDocOf = (...groups: Stub[]) =>
  node({}, { "m:colorgroup": groups }) as unknown as Parameters<typeof readBaseMaterials>[0];

const triangle = (attrs: Record<string, string>) => node(attrs) as unknown as Element;

describe("parseTransform3MF", () => {
  it("moves a point as a row vector, the way a 3MF writes a turn, the move last", () => {
    // A quarter turn anticlockwise about Z, then 5 mm along x: x goes to y, and y to -x.
    const matrix = parseTransform3MF("0 1 0 -1 0 0 0 0 1 5 0 0");
    expect(new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).toArray()).toEqual([5, 1, 0]);
    expect(new THREE.Vector3(0, 1, 0).applyMatrix4(matrix).toArray()).toEqual([4, 0, 0]);
  });

  it("is no change without a transform", () => {
    expect(parseTransform3MF(null).equals(new THREE.Matrix4())).toBe(true);
  });
});

describe("readBaseMaterials", () => {
  it("flattens a group's colours and says where each one landed", () => {
    const materials = readBaseMaterials(docOf(group("2", ["#FF0000", "#008040"])))!;

    expect(materials.colors).toEqual(["#ff0000", "#008040"]);
    expect(materials.slotOf("2", 0)).toBe(0);
    expect(materials.slotOf("2", 1)).toBe(1);
  });

  it("drops the alpha a displaycolor may carry", () => {
    expect(readBaseMaterials(docOf(group("2", ["#0A141EFF", "#c86432aa"])))!.colors).toEqual(["#0a141e", "#c86432"]);
  });

  it("says a file has no materials rather than handing back an empty palette", () => {
    // Nothing to read from leaves the filament list alone, so the viewer can still colour the model itself.
    expect(readBaseMaterials(docOf())).toBeNull();
    expect(readBaseMaterials(docOf(group("2", [])))).toBeNull();
    expect(readBaseMaterials(docOf(group("2", ["", "not a colour", "#12345"])))).toBeNull();
  });

  it("keeps an unreadable entry from shifting the ones after it", () => {
    // Read as a plain run of colours, the red would answer for index 1 and every triangle after it would be
    // painted with its neighbour's colour.
    const materials = readBaseMaterials(docOf(group("2", ["#00ff00", null, "#ff0000"])))!;

    expect(materials.colors).toEqual(["#00ff00", "#ff0000"]);
    expect(materials.slotOf("2", 0)).toBe(0);
    expect(materials.slotOf("2", 1)).toBeNull();
    expect(materials.slotOf("2", 2)).toBe(1);
  });

  it("keeps several groups apart in one list", () => {
    const materials = readBaseMaterials(docOf(group("2", ["#ff0000"]), group("5", ["#00ff00", "#0000ff"])))!;

    expect(materials.colors).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(materials.slotOf("5", 0)).toBe(1);
    expect(materials.slotOf("5", 1)).toBe(2);
  });

  it("names no colour for a group or an index the file hasn't got", () => {
    const materials = readBaseMaterials(docOf(group("2", ["#ff0000"])))!;

    expect(materials.slotOf("2", 7)).toBeNull();
    expect(materials.slotOf("9", 0)).toBeNull();
    // An object or triangle pointing at nothing: its own colour is what it was given, not the first material.
    expect(materials.slotOf(null, 0)).toBeNull();
  });

  it("ignores a group with no id, which nothing could point at anyway", () => {
    expect(readBaseMaterials(docOf(node({}, { base: [node({ displaycolor: "#ff0000" })] })))).toBeNull();
  });

  // The Materials extension's group, which is the one slicers read and so the one Thingport writes; a 3MF from
  // elsewhere may still use base materials, so both are taken.
  it("reads a colour group the same way as base materials", () => {
    const materials = readBaseMaterials(colorDocOf(colorGroup("1", ["#FF0000", "#008040FF"])))!;

    expect(materials.colors).toEqual(["#ff0000", "#008040"]);
    expect(materials.slotOf("1", 0)).toBe(0);
    expect(materials.slotOf("1", 1)).toBe(1);
  });
});

describe("readTriangleMaterial", () => {
  const materials = readBaseMaterials(docOf(group("2", ["#ff0000", "#00ff00"]), group("3", ["#0000ff"])))!;

  it("reads a triangle's p1 against the group its object points at", () => {
    const slotOf = readTriangleMaterial(materials, "2");

    expect(slotOf(triangle({ p1: "0" }))).toBe(0);
    expect(slotOf(triangle({ p1: "1" }))).toBe(1);
  });

  it("lets a triangle name a group of its own", () => {
    expect(readTriangleMaterial(materials, "2")(triangle({ pid: "3", p1: "0" }))).toBe(2);
  });

  it("names no colour for a triangle without a p1, so it keeps its object's", () => {
    const slotOf = readTriangleMaterial(materials, "2");

    expect(slotOf(triangle({}))).toBeNull();
    expect(slotOf(triangle({ p1: "" }))).toBeNull();
  });

  it("names no colour when neither the triangle nor its object points at a group", () => {
    expect(readTriangleMaterial(materials, null)(triangle({ p1: "0" }))).toBeNull();
  });
});

describe("the customizer's own files", () => {
  // The seam the two modules meet at: the writer picks the group id, the entry order and the colour format, and
  // this reader has to agree with all three or a saved generated model comes back in one colour.
  it("reads back the materials the customizer's writer emits", () => {
    const off = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 0 128 64\n";
    const xml = strFromU8(unzipSync(offToThreeMf(off))["3D/3dmodel.model"]);

    const pid = xml.match(/<object [^>]*\bpid="([^"]+)"/)![1];
    const written = [...xml.matchAll(/<m:color color="([^"]+)"/g)].map((m) => m[1]);
    const materials = readBaseMaterials(colorDocOf(colorGroup(pid, written)))!;

    expect(materials.colors).toEqual(["#ff0000", "#008040"]);
    // Each triangle's p1, as written, names its own colour.
    const slotOf = readTriangleMaterial(materials, pid);
    const written1 = [...xml.matchAll(/<triangle [^>]*\bp1="([^"]+)"/g)].map((m) => m[1]);
    expect(written1.map((p1) => slotOf(triangle({ p1 })))).toEqual([0, 1]);
  });
});

describe("resolveInternalComponents", () => {
  const mesh = (extruder: number, ownColor = false) => ({
    vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0],
    triangles: [0, 1, 2],
    extruder,
    ownColor,
  });
  const moveX = (x: number) => new THREE.Matrix4().makeTranslation(x, 0, 0);

  it("gives a wrapper the meshes of the object its component names, placed by the component", () => {
    // Bambu Studio's layout: the mesh is object 1, and the build places object 2, which only wraps it.
    const objects = new Map([
      ["1", { meshes: [mesh(0)] }],
      ["2", { meshes: [] as ReturnType<typeof mesh>[] }],
    ]);
    resolveInternalComponents(objects, new Map([["2", [{ refId: "1", transform: moveX(5), extruder: 0 }]]]));
    expect(objects.get("2")?.meshes.map((placed) => placed.vertices)).toEqual([[5, 0, 0, 15, 0, 0, 5, 10, 0]]);
    expect(objects.get("1")?.meshes[0].vertices).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  });

  it("keeps a painted mesh's colours, and gives the rest the component's filament", () => {
    const objects = new Map([
      ["1", { meshes: [mesh(2, true), mesh(0)] }],
      ["2", { meshes: [] as ReturnType<typeof mesh>[] }],
    ]);
    resolveInternalComponents(objects, new Map([["2", [{ refId: "1", transform: null, extruder: 3 }]]]));
    expect(objects.get("2")?.meshes.map((placed) => placed.extruder)).toEqual([2, 3]);
  });

  it("follows a wrapper of a wrapper once, and stops a file that references itself", () => {
    const objects = new Map([
      ["1", { meshes: [mesh(0)] }],
      ["2", { meshes: [] as ReturnType<typeof mesh>[] }],
      ["3", { meshes: [] as ReturnType<typeof mesh>[] }],
      ["4", { meshes: [mesh(1)] }],
    ]);
    resolveInternalComponents(
      objects,
      new Map([
        ["2", [{ refId: "1", transform: moveX(1), extruder: 0 }]],
        ["3", [{ refId: "2", transform: moveX(1), extruder: 0 }]],
        ["4", [{ refId: "4", transform: null, extruder: 1 }]],
      ]),
    );
    expect(objects.get("3")?.meshes.map((placed) => placed.vertices[0])).toEqual([2]);
    // Its own mesh, then a copy per level of the loop until the depth limit.
    expect(objects.get("4")?.meshes).toHaveLength(9);
  });

  it("refuses a chain that copies its meshes past what the browser can hold", () => {
    const big = {
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: Array.from({ length: 3_000_000 }, () => 0),
      extruder: 0,
    };
    const objects = new Map([
      ["1", { meshes: [big] }],
      ["2", { meshes: [] as (typeof big)[] }],
    ]);
    const refs = Array.from({ length: 10 }, () => ({ refId: "1", transform: null, extruder: 0 }));
    expect(() => resolveInternalComponents(objects, new Map([["2", refs]]))).toThrow(/too many times over/);
  });

  it("refuses objects of nothing but components naming each other, which spend no triangles however often", () => {
    // Five components each, to the depth limit: hundreds of thousands of steps, and not one mesh.
    const objects = new Map([["1", { meshes: [] as ReturnType<typeof mesh>[] }]]);
    const refs = Array.from({ length: 5 }, () => ({ refId: "1", transform: null, extruder: 0 }));
    expect(() => resolveInternalComponents(objects, new Map([["1", refs]]))).toThrow(/too many times over/);
  });
});
