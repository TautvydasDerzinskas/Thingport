import { describe, expect, it } from "vitest";
import Module, { type Manifold } from "manifold-3d";
import { addMesh, addParts, applyCommand, type StudioCommandArgs, type StudioCommandName } from "./commands";
import { emptyDocument, topLevel, type MeshData, type StudioDocument } from "./document";
import { describeBody, evaluateDesign, measureParts, prepareMesh, type MeshLookup } from "./geometry";

// Each phase 3 operation against geometry worked out another way: a formula, or the same shape made by another route.

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

function run<N extends StudioCommandName>(doc: StudioDocument, name: N, args: StudioCommandArgs<N>) {
  return applyCommand(doc, name, args).document;
}

async function body(doc: StudioDocument, id: string, meshes?: MeshLookup) {
  const { bodies, errors } = evaluateDesign(await wasm, doc, undefined, meshes);
  const error = errors.find((each) => each.id === id);
  if (error) throw new Error(error.message);
  const found = bodies.find((each) => each.id === id);
  if (!found) throw new Error(`${id} wasn't made`);
  return found;
}

async function problem(doc: StudioDocument, id: string, meshes?: MeshLookup): Promise<string | undefined> {
  return evaluateDesign(await wasm, doc, undefined, meshes).errors.find((each) => each.id === id)?.message;
}

/** separate_parts as the server runs it: the body measured, then the parts added. */
async function separate(doc: StudioDocument, id: string, meshes?: MeshLookup) {
  return addParts(doc, { feature_id: id }, measureParts(await wasm, doc, id, meshes)).document;
}

/** Solids' triangles as a file has them, nine numbers each, with nothing joined between them. */
function fileOf(solids: Manifold[], skip?: (normal: number[]) => boolean): Float32Array {
  const out: number[] = [];
  for (const solid of solids) {
    const mesh = solid.getMesh();
    const at = (i: number) => [0, 1, 2].map((k) => mesh.vertProperties[i * mesh.numProp + k]);
    for (let t = 0; t < mesh.triVerts.length; t += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => at(mesh.triVerts[t + k]));
      const n = [
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      ];
      if (!skip?.(n)) out.push(...a, ...b, ...c);
    }
  }
  return new Float32Array(out);
}

/** A design with one imported model of these triangles, and where its mesh is. */
async function imported(triangles: Float32Array) {
  const prepared = prepareMesh(await wasm, triangles);
  const assetId = "a".repeat(24);
  const doc = addMesh(
    emptyDocument(),
    {
      asset_id: assetId,
      solid: prepared.solid,
      triangles: prepared.mesh.indices.length / 3,
      size: prepared.size,
      parts: prepared.parts,
      source: { model_id: "m", file_id: "f", file_name: "parts.stl", model_title: "Parts" },
    },
    {},
  ).document;
  const meshes: MeshLookup = (id: string): MeshData | undefined => (id === assetId ? prepared.mesh : undefined);
  return { doc, meshes, prepared };
}

const box = (w = 20, d = 20, h = 10) => run(emptyDocument(), "add_box", { width: w, depth: d, height: h });

/** The box's edges as studio_inspect_body names them, picked by a test on their ends. */
async function edgesOf(doc: StudioDocument, id: string, keep: (a: number[], b: number[]) => boolean) {
  const described = describeBody(await wasm, doc, id);
  return described.edges.filter((edge) => keep(edge.a, edge.b)).map(({ a, b }) => ({ a, b }));
}

const near = (actual: number, expected: number, share = 0.01) =>
  expect(Math.abs(actual - expected) / expected, `${actual} vs ${expected}`).toBeLessThan(share);

describe("Studio operations", () => {
  it("describes a box as six faces and twelve outside edges", async () => {
    const described = describeBody(await wasm, box(), "box-1");
    expect(described.faces).toHaveLength(6);
    expect(described.edges).toHaveLength(12);
    expect(described.edges.every((edge) => edge.convex && edge.angle === 90)).toBe(true);
    const top = described.faces.find((face) => face.normal[2] === 1)!;
    expect(top).toMatchObject({ area: 400 });
    expect(top.point[2]).toBe(10);
  });

  it("pulls and pushes a face, and finds it again after the body moves", async () => {
    const top = { point: [0, 0, 10] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    let doc = run(box(), "press_pull", { feature_id: "box-1", face: top, distance: 5 });
    near((await body(doc, "press_pull-2")).volume, 6000);
    doc = run(doc, "update_feature", { feature_id: "press_pull-2", distance: -3 });
    near((await body(doc, "press_pull-2")).volume, 2800);
    // The box moves inside the feature; the face it points at goes with it.
    doc = run(doc, "set_transform", { feature_id: "box-1", position: [30, 0, 0] });
    const moved = await body(doc, "press_pull-2");
    near(moved.volume, 2800);
    expect(moved.bounds.min[0]).toBeCloseTo(20);
  });

  it("rounds a box's top edges as an extrude rounds its top, and its corners as a ball", async () => {
    const top4 = await edgesOf(box(), "box-1", (a, b) => a[2] === 10 && b[2] === 10);
    expect(top4).toHaveLength(4);
    const rounded = await body(run(box(), "fillet", { feature_id: "box-1", edges: top4, radius: 2 }), "fillet-2");
    let extruded = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "rectangle", center: [0, 0], width: 20, height: 20 }],
    });
    extruded = run(extruded, "extrude", { sketch_id: "sketch-1", distance: 10, top_edge: { type: "fillet", size: 2 } });
    near(rounded.volume, (await body(extruded, "extrude-2")).volume, 0.002);

    // Every edge: the closed form of a box rounded all over.
    const all = await edgesOf(box(), "box-1", () => true);
    const ball = await body(run(box(), "fillet", { feature_id: "box-1", edges: all, radius: 2 }), "fillet-2");
    const [a, b, c, r] = [16, 16, 6, 2];
    near(
      ball.volume,
      a * b * c + 2 * r * (a * b + b * c + a * c) + Math.PI * r * r * (a + b + c) + (4 / 3) * Math.PI * r ** 3,
      0.01,
    );
  });

  it("bevels as a chamfered extrude, and refuses what can't be blended or doesn't fit", async () => {
    const top4 = await edgesOf(box(), "box-1", (a, b) => a[2] === 10 && b[2] === 10);
    const bevelled = await body(run(box(), "chamfer", { feature_id: "box-1", edges: top4, distance: 2 }), "chamfer-2");
    let extruded = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "rectangle", center: [0, 0], width: 20, height: 20 }],
    });
    extruded = run(extruded, "extrude", {
      sketch_id: "sketch-1",
      distance: 10,
      top_edge: { type: "chamfer", size: 2 },
    });
    near(bevelled.volume, (await body(extruded, "extrude-2")).volume, 0.001);

    const tooBig = run(box(), "fillet", { feature_id: "box-1", edges: top4, radius: 12 });
    expect(await problem(tooBig, "fillet-2")).toMatch(/too big/);

    // A boss on a plate: an outside edge and an inside edge meeting at a corner.
    let boss = run(box(40, 40, 5), "add_box", { width: 10, depth: 10, height: 10, position: [0, 0, 5] });
    boss = run(boss, "boolean", { operation: "union", target_id: "box-1", tool_ids: ["box-2"] });
    const edges = await edgesOf(boss, "boolean-3", () => true);
    const vertical = edges.find((e) => e.a[0] === 5 && e.a[1] === 5 && e.a[2] !== e.b[2])!;
    const base = edges.find((e) => e.a[2] === 5 && e.b[2] === 5 && e.a[0] === 5 && e.b[0] === 5)!;
    const mixed = run(boss, "fillet", { feature_id: "boolean-3", edges: [vertical, base], radius: 1 });
    expect(await problem(mixed, "fillet-4")).toMatch(/outside edge and an inside edge/);
    // The inside edges alone are filled.
    const inside = edges.filter((e) => e.a[2] === 5 && e.b[2] === 5 && Math.abs(e.a[0]) <= 5 && Math.abs(e.a[1]) <= 5);
    expect(inside).toHaveLength(4);
    const filled = await body(run(boss, "fillet", { feature_id: "boolean-3", edges: inside, radius: 2 }), "fillet-4");
    expect(filled.volume).toBeGreaterThan(40 * 40 * 5 + 1000);
  });

  it("drills holes: through, to a depth, counterbored and countersunk", async () => {
    const at = {
      feature_id: "box-1",
      point: [0, 0, 10] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
    };
    const through = await body(run(box(), "hole", { ...at, diameter: 6 }), "hole-2");
    expect(through.bounds.max[2]).toBeCloseTo(10);
    near(through.volume, 4000 - Math.PI * 9 * 10, 0.002);
    const blind = await body(run(box(), "hole", { ...at, diameter: 6, depth: 4 }), "hole-2");
    near(blind.volume, 4000 - Math.PI * 9 * 4, 0.002);
    const bored = await body(
      run(box(), "hole", { ...at, diameter: 4, counterbore: { diameter: 8, depth: 3 } }),
      "hole-2",
    );
    near(bored.volume, 4000 - Math.PI * 4 * 10 - Math.PI * (16 - 4) * 3, 0.003);
    const sunk = await body(
      run(box(), "hole", { ...at, diameter: 4, countersink: { diameter: 8, angle: 90 } }),
      "hole-2",
    );
    // A 90° cone from radius 4 down to 2 is 2 mm deep.
    const cone = (Math.PI * 2 * (16 + 8 + 4)) / 3;
    near(sunk.volume, 4000 - Math.PI * 4 * 8 - cone, 0.003);
  });

  it("hollows a box to walls exactly as thick as asked, and leaves its top open", async () => {
    const cube = box(20, 20, 20);
    const closed = await body(run(cube, "shell", { feature_id: "box-1", thickness: 2 }), "shell-2");
    near(closed.volume, 8000 - 16 ** 3, 1e-6);
    const tray = await body(
      run(cube, "shell", { feature_id: "box-1", thickness: 2, open_faces: [{ point: [0, 0, 20], normal: [0, 0, 1] }] }),
      "shell-2",
    );
    near(tray.volume, 8000 - 16 * 16 * 18, 1e-6);
    expect(tray.bounds).toEqual(closed.bounds);
  });

  it("rounds a hollow round an inside corner, as far from it as from the faces", async () => {
    // An L: a 20 mm cube with a 10 mm square notch down its height.
    let doc = run(box(20, 20, 20), "add_box", { width: 10, depth: 10, height: 30, position: [5, 5, -5] });
    doc = run(doc, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["box-2"] });
    doc = run(doc, "shell", { feature_id: "boolean-3", thickness: 1.5 });
    // The hollow's section: 17 mm square, less the notch grown by 1.5 mm with its corner rounded to 1.5 mm.
    const section = 17 ** 2 - (10 ** 2 - 1.5 ** 2 * (1 - Math.PI / 4));
    const shelled = await body(doc, "shell-4");
    near(shelled.volume, 6000 - section * 17, 1e-3);
    expect(shelled.bounds).toEqual({ min: [-10, -10, 0], max: [10, 10, 20] });
  });

  it("leaves open a face beside a rounded edge, and says when the walls would close it", async () => {
    const cube = box(20, 20, 20);
    const top4 = await edgesOf(cube, "box-1", (a, b) => a[2] === 20 && b[2] === 20);
    const rounded = run(cube, "fillet", { feature_id: "box-1", edges: top4, radius: 3 });
    const closed = await body(run(rounded, "shell", { feature_id: "fillet-2", thickness: 1.5 }), "shell-3");
    const side = { point: [10, 0, 8] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };
    const open = await body(
      run(rounded, "shell", { feature_id: "fillet-2", thickness: 1.5, open_faces: [side] }),
      "shell-3",
    );
    // The side's wall goes: 17 mm across between the front and back walls, from the floor up to where the rounding
    // starts, less a sliver where the rounding's first facet leans in and its wall dips below that.
    near(closed.volume - open.volume, 17 * (17 - 1.5) * 1.5, 0.006);

    // A fin 2 mm thin is all wall at 1.5 mm, so its end can't be opened.
    let finned = run(cube, "add_box", { width: 10, depth: 2, height: 10, position: [15, 0, 0] });
    finned = run(finned, "boolean", { operation: "union", target_id: "box-1", tool_ids: ["box-2"] });
    const end = { point: [20, 0, 5] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };
    finned = run(finned, "shell", { feature_id: "boolean-3", thickness: 1.5, open_faces: [end] });
    expect(await problem(finned, "shell-4")).toMatch(/close it/);
    expect(await problem(run(cube, "shell", { feature_id: "box-1", thickness: 10 }), "shell-2")).toMatch(/would fill/);
  });

  it("splits by a plane into two editable bodies, and by another body leaving it be", async () => {
    let doc = run(box(), "split", { feature_id: "box-1", plane: { point: [0, 0, 4], normal: [0, 0, 1] } });
    expect(topLevel(doc).map((f) => f.id)).toEqual(["split-2", "split-3"]);
    near((await body(doc, "split-2")).volume, 2400);
    near((await body(doc, "split-3")).volume, 1600);
    doc = run(box(), "add_cylinder", { radius: 5, height: 30, position: [0, 0, -10] });
    doc = run(doc, "split", { feature_id: "box-1", tool_id: "cylinder-2" });
    expect(topLevel(doc).map((f) => f.id)).toEqual(["cylinder-2", "split-4", "split-5"]);
    const inside = await body(doc, "split-4");
    const outside = await body(doc, "split-5");
    near(inside.volume + outside.volume, 4000, 0.001);
    near(inside.volume, Math.PI * 25 * 10, 0.01);
  });

  it("tapers and rounds extrudes, and refuses a taper the shape can't take", async () => {
    let doc = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "rectangle", center: [0, 0], width: 20, height: 20, corner_radius: 3 }],
    });
    doc = run(doc, "extrude", { sketch_id: "sketch-1", distance: 10, taper: 10 });
    const inset = 10 * Math.tan((10 * Math.PI) / 180);
    const tapered = await body(doc, "extrude-2");
    expect(tapered.bounds.max[2]).toBeCloseTo(10);
    const top = describeBody(await wasm, doc, "extrude-2").faces.find((face) => face.normal[2] === 1)!;
    // A rounded square's area, inset all round.
    const area = (side: number, r: number) => side * side - (4 - Math.PI) * r * r;
    near(top.area, area(20 - 2 * inset, Math.max(0, 3 - inset)), 0.02);
    const steep = run(doc, "update_feature", { feature_id: "extrude-2", taper: 50 });
    expect(await problem(steep, "extrude-2")).toMatch(/too big/);
    // Symmetric, and the other way.
    const both = await body(
      run(doc, "update_feature", { feature_id: "extrude-2", taper: 0, symmetric: true }),
      "extrude-2",
    );
    expect([both.bounds.min[2], both.bounds.max[2]]).toEqual([-5, 5]);
    const down = await body(
      run(doc, "update_feature", { feature_id: "extrude-2", taper: 0, distance: -4 }),
      "extrude-2",
    );
    expect(down.bounds.min[2]).toBeCloseTo(-4);
  });

  it("revolves about either axis, and cuts with what it makes", async () => {
    let doc = run(emptyDocument(), "add_sketch", {
      plane: "XZ",
      shapes: [{ type: "rectangle", center: [15, 0], width: 10, height: 4 }],
    });
    doc = run(doc, "revolve", { sketch_id: "sketch-1", axis: "v" });
    // Pappus: the section's area times the way round its centroid goes.
    near((await body(doc, "revolve-2")).volume, 2 * Math.PI * 15 * 40, 0.01);
    const half = await body(run(doc, "update_feature", { feature_id: "revolve-2", angle: 180 }), "revolve-2");
    near(half.volume, Math.PI * 15 * 40, 0.01);
    let crossing = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "rectangle", center: [0, 0], width: 10, height: 4 }],
    });
    crossing = run(crossing, "revolve", { sketch_id: "sketch-1", axis: "v" });
    expect(await problem(crossing, "revolve-2")).toMatch(/crosses the axis/);

    // A groove turned into a cylinder.
    let groove = run(emptyDocument(), "add_cylinder", { radius: 10, height: 20 });
    groove = run(groove, "add_sketch", {
      plane: "XZ",
      shapes: [{ type: "rectangle", center: [10, 10], width: 2, height: 2 }],
    });
    groove = run(groove, "revolve", { sketch_id: "sketch-2", axis: "v", operation: "cut", target_id: "cylinder-1" });
    expect(topLevel(groove).map((f) => f.id)).toEqual(["boolean-4"]);
    expect((await body(groove, "boolean-4")).volume).toBeLessThan(Math.PI * 100 * 20 - 100);
  });

  it("rounds a cylinder's rims, sketches on a face, scales, and keeps tools", async () => {
    const rim = await body(
      run(emptyDocument(), "add_cylinder", { radius: 10, height: 20, top_edge: { type: "fillet", size: 2 } }),
      "cylinder-1",
    );
    // Pappus again, for the corner a quarter circle takes off: (4 - π) r² at 0.2234 r in from the rim.
    const ring = 2 * Math.PI * (10 - 0.2234 * 2) * (4 - Math.PI);
    near(rim.volume, Math.PI * 100 * 20 - ring, 0.01);

    let doc = run(box(), "add_sketch", {
      face: { point: [0, 0, 10], normal: [0, 0, 1] },
      shapes: [{ type: "circle", center: [0, 0], radius: 5 }],
    });
    doc = run(doc, "extrude", { sketch_id: "sketch-2", distance: 5, operation: "join", target_id: "box-1" });
    near((await body(doc, "boolean-4")).volume, 4000 + Math.PI * 25 * 5, 0.01);

    near((await body(run(box(), "scale_feature", { feature_id: "box-1", factor: 2 }), "box-1")).volume, 32000);

    let kept = run(box(), "add_box", { width: 5, depth: 5, height: 30, position: [0, 0, -10] });
    kept = run(kept, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["box-2"], keep_tools: true });
    expect(topLevel(kept).map((f) => f.id)).toEqual(["box-2", "boolean-4"]);
  });

  it("separates the pieces a cut leaves into bodies of their own, found again after an edit", async () => {
    // A 30 mm bar with its middle cut out: two 10 mm cubes.
    let cut = run(box(30, 10, 10), "add_box", { width: 10, depth: 20, height: 20, position: [0, 0, -5] });
    cut = run(cut, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["box-2"] });
    const doc = await separate(cut, "boolean-3");
    expect(topLevel(doc).map((f) => f.id)).toEqual(["part-4", "part-5"]);
    const left = await body(doc, "part-4");
    expect(left.bounds).toEqual({ min: [-15, -5, 0], max: [-5, 5, 10] });
    near(left.volume, 1000);
    // Its own origin is its base's middle, so it turns about itself.
    expect(doc.features.find((f) => f.id === "part-4")).toMatchObject({ transform: { position: [-10, 0, 0] } });
    const turned = await body(run(doc, "set_transform", { feature_id: "part-4", rotation: [0, 0, 45] }), "part-4");
    expect((turned.bounds.min[0] + turned.bounds.max[0]) / 2).toBeCloseTo(-10);

    // A narrower cut leaves both a little bigger, and they're still found; one that doesn't go through leaves neither.
    near((await body(run(doc, "update_feature", { feature_id: "box-2", width: 8 }), "part-4")).volume, 1100);
    const shallow = run(doc, "set_transform", { feature_id: "box-2", position: [0, 0, 5] });
    expect(await problem(shallow, "part-4")).toMatch(/isn't in boolean-3 any more/);

    // Deleting one leaves it out; deleting both gives the body back.
    let back = run(doc, "delete_feature", { feature_id: "part-4" });
    expect(topLevel(back).map((f) => f.id)).toEqual(["part-5"]);
    back = run(back, "delete_feature", { feature_id: "part-5" });
    expect(topLevel(back).map((f) => f.id)).toEqual(["boolean-3"]);
  });

  it("keeps a hollow with the part around it, and a ball rattling inside it apart", async () => {
    const hollow = run(box(20, 20, 20), "shell", { feature_id: "box-1", thickness: 2 });
    await expect(separate(hollow, "shell-2")).rejects.toThrow(/one part/);
    let rattle = run(hollow, "add_sphere", { radius: 4, position: [0, 0, 6] });
    rattle = run(rattle, "boolean", { operation: "union", target_id: "shell-2", tool_ids: ["sphere-3"] });
    rattle = await separate(rattle, "boolean-4");
    expect(topLevel(rattle).map((f) => f.id)).toEqual(["part-5", "part-6"]);
    near((await body(rattle, "part-5")).volume, 8000 - 16 ** 3, 1e-6);
    const ball = await body(run(emptyDocument(), "add_sphere", { radius: 4 }), "sphere-1");
    near((await body(rattle, "part-6")).volume, ball.volume, 1e-6);
  });

  it("separates an imported model's overlapping parts, which then join properly", async () => {
    const { Manifold } = await wasm;
    const { doc, meshes, prepared } = await imported(
      fileOf([Manifold.cube([10, 10, 10]), Manifold.cube([10, 10, 10]).translate([5, 5, 5])]),
    );
    expect(prepared).toMatchObject({ solid: true, parts: 2 });
    // Left in one body, the overlap counts twice.
    near((await body(doc, "mesh-1", meshes)).volume, 2000);
    const parts = await separate(doc, "mesh-1", meshes);
    near((await body(parts, "part-2", meshes)).volume, 1000);
    const joined = run(parts, "boolean", { operation: "union", target_id: "part-2", tool_ids: ["part-3"] });
    near((await body(joined, "boolean-4", meshes)).volume, 2000 - 125);
  });

  it("separates a mesh with gaps into its parts, and the closed ones combine", async () => {
    const { Manifold } = await wasm;
    // A tray with no top, beside a closed cube.
    const tray = fileOf([Manifold.cube([10, 10, 10])], (normal) => normal[2] > 0);
    const cube = fileOf([Manifold.cube([10, 10, 10]).translate([20, 0, 0])]);
    const { doc, meshes, prepared } = await imported(new Float32Array([...tray, ...cube]));
    expect(prepared).toMatchObject({ solid: false, parts: 2 });
    const parts = await separate(doc, "mesh-1", meshes);
    expect(parts.features.flatMap((f) => (f.type === "part" ? [f.solid] : []))).toEqual([false, true]);
    expect((await body(parts, "part-2", meshes)).volume).toBeNaN();
    near((await body(parts, "part-3", meshes)).volume, 1000);
    const more = run(parts, "add_box", { width: 5, depth: 5, height: 5, position: [15, 0, 10] });
    near(
      (
        await body(
          run(more, "boolean", { operation: "union", target_id: "part-3", tool_ids: ["box-4"] }),
          "boolean-5",
          meshes,
        )
      ).volume,
      1125,
    );
    expect(() => run(more, "boolean", { operation: "union", target_id: "part-2", tool_ids: ["box-4"] })).toThrow(
      /isn't a closed solid/,
    );
  });
});
