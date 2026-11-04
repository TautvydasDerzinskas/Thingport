import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import { applyCommand, CommandError } from "./commands";
import { emptyDocument, featureById, type StudioDocument } from "./document";
import { checkDesign, evaluateDesign } from "./geometry";

// Parameters and formulas, threads and paths: what lets a design be described the way an assistant reasons about it.

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

const run = (doc: StudioDocument, name: string, args: Record<string, unknown>) =>
  applyCommand(doc, name, args).document;

async function only(doc: StudioDocument) {
  const made = evaluateDesign(await wasm, doc);
  expect(made.errors).toEqual([]);
  expect(made.bodies).toHaveLength(1);
  return made.bodies[0];
}

describe("Studio parameters", () => {
  it("makes numbers follow formulas, and works them out again as a parameter changes", () => {
    let doc = run(emptyDocument(), "set_parameter", { name: "wall", value: 2 });
    doc = run(doc, "add_box", { width: 10, depth: 10, height: 10 });
    doc = run(doc, "set_expression", { feature_id: "box-1", field: "width", expression: "wall * 10 + 5" });
    doc = run(doc, "set_expression", { feature_id: "box-1", field: "position.z", expression: "wall / 2" });
    let box = featureById(doc, "box-1");
    expect(box?.type === "box" && [box.width, box.transform.position[2]]).toEqual([25, 1]);
    const changed = applyCommand(doc, "set_parameter", { name: "wall", value: 3 });
    expect(changed.summary).toBe("Set wall = 3; changed box-1 width, box-1 position.z");
    box = featureById(changed.document, "box-1");
    expect(box?.type === "box" && [box.width, box.transform.position[2]]).toEqual([35, 1.5]);
  });

  it("refuses a value a formula can't take, and a formula over a parameter that isn't there", () => {
    let doc = run(emptyDocument(), "set_parameter", { name: "size", value: 10 });
    doc = run(doc, "add_box", { width: 10, depth: 10, height: 10 });
    doc = run(doc, "set_expression", { feature_id: "box-1", field: "height", expression: "size - 5" });
    expect(() => run(doc, "set_parameter", { name: "size", value: 3 })).toThrow(
      /box-1's height \(= size - 5\) can't follow/,
    );
    expect(() => run(doc, "set_expression", { feature_id: "box-1", field: "width", expression: "wal * 2" })).toThrow(
      /no parameter called wal/,
    );
    expect(() => run(doc, "set_expression", { feature_id: "box-1", field: "radius", expression: "size" })).toThrow(
      CommandError,
    );
    expect(() => run(doc, "delete_parameter", { name: "size" })).toThrow(/size is used by box-1 height/);
    expect(() => run(doc, "set_parameter", { name: "2nd", value: 1 })).toThrow(CommandError);
  });

  it("lets a formula go when its number is given by hand", () => {
    let doc = run(emptyDocument(), "set_parameter", { name: "r", value: 4 });
    doc = run(doc, "add_cylinder", { radius: 5, height: 10 });
    doc = run(doc, "set_expression", { feature_id: "cylinder-1", field: "radius", expression: "r * 2" });
    const typed = applyCommand(doc, "update_feature", { feature_id: "cylinder-1", radius: 3 });
    expect(typed.summary).toMatch(/no longer following radius's formula/);
    expect(featureById(typed.document, "cylinder-1")?.expressions).toBeUndefined();
    // Nothing follows r now, so it can go.
    run(typed.document, "delete_parameter", { name: "r" });
  });

  it("drives a sketch shape's size, and keeps a shape's formulas with it as the shapes before it go", async () => {
    let doc = run(emptyDocument(), "set_parameter", { name: "d", value: 8 });
    doc = run(doc, "add_sketch", {
      plane: "XY",
      shapes: [
        { type: "circle", center: [0, 0], radius: 2 },
        { type: "rectangle", center: [0, 0], width: 10, height: 10 },
      ],
    });
    doc = run(doc, "set_expression", { feature_id: "sketch-1", field: "shapes.1.width", expression: "d * 3" });
    doc = run(doc, "remove_sketch_shape", { sketch_id: "sketch-1", index: 0 });
    expect(featureById(doc, "sketch-1")?.expressions).toEqual({ "shapes.0.width": "d * 3" });
    doc = run(doc, "set_parameter", { name: "d", value: 10 });
    const sketch = featureById(doc, "sketch-1");
    expect(sketch?.type === "sketch" && sketch.shapes[0]).toMatchObject({ type: "rectangle", width: 30 });
    doc = run(doc, "extrude", { sketch_id: "sketch-1", distance: 2 });
    expect((await only(doc)).volume).toBeCloseTo(30 * 10 * 2, 3);
  });
});

describe("Studio threads and paths", () => {
  it("makes a threaded rod, and taps a threaded hole a matching rod fits", async () => {
    const rod = run(emptyDocument(), "add_thread", { diameter: 8, length: 12 });
    const made = await only(rod);
    expect(made.bounds.max[2]).toBeCloseTo(12, 3);
    expect(made.bounds.max[0] - made.bounds.min[0]).toBeLessThanOrEqual(8);

    let block = run(emptyDocument(), "add_box", { width: 20, depth: 20, height: 12 });
    block = run(block, "hole", { feature_id: "box-1", point: [0, 0, 12], normal: [0, 0, 1], diameter: 8, thread: {} });
    const hole = featureById(block, "hole-2");
    expect(hole?.type === "hole" && hole.thread).toEqual({ pitch: 1.25, clearance: 0.15 });
    const tapped = await only(block);
    const plain = 20 * 20 * 12 - Math.PI * 4 * 4 * 12;
    // More is left than a plain 8 mm hole leaves: the thread's ridges.
    expect(tapped.volume).toBeGreaterThan(plain);
    expect(() =>
      run(block, "update_feature", { feature_id: "hole-2", countersink: { diameter: 12, angle: 90 } }),
    ).toThrow(/own lead-in/);
    expect(() => run(emptyDocument(), "add_thread", { diameter: 8, length: 10, pitch: 5 })).toThrow(/pitch/);
  });

  it("judges a thread for printing as the plain cylinder it's cut on, as CAD does", async () => {
    const options = { bed: [256, 256, 256] as [number, number, number], overhang: 45, minWall: 0.8 };
    const rod = run(emptyDocument(), "add_thread", { diameter: 8, length: 20 });
    expect(checkDesign(await wasm, rod, options)).toMatchObject({ problems: [] });
    let nut = run(emptyDocument(), "add_box", { width: 14, depth: 14, height: 6 });
    nut = run(nut, "hole", { feature_id: "box-1", point: [0, 0, 6], normal: [0, 0, 1], diameter: 8, thread: {} });
    expect(checkDesign(await wasm, nut, options)).toMatchObject({ problems: [] });
    // A body with no thread is judged as it is: a bridge needs support.
    let arch = run(emptyDocument(), "add_box", { width: 30, depth: 10, height: 10 });
    arch = run(arch, "add_box", { width: 20, depth: 12, height: 6, position: [0, 0, -1] });
    arch = run(arch, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["box-2"] });
    expect(checkDesign(await wasm, arch, options).problems).toEqual([expect.stringMatching(/overhang/)]);
  });

  it("sweeps a profile where it's drawn, and refuses one that's off the path's start or not square to it", async () => {
    // On XZ at y = -60, the circle 40 mm up: where the path starts, square to it.
    const drawn = (center: [number, number], offset = -60) =>
      run(emptyDocument(), "add_sketch", {
        plane: "XZ",
        offset,
        shapes: [{ type: "circle", center, radius: 3 }],
      });
    const path = [
      [0, -60, 40],
      [0, -30, 40],
      [0, -30, 70],
    ];
    const pipe = await only(run(drawn([0, 40]), "sweep", { sketch_id: "sketch-1", path }));
    const area = 0.5 * 64 * 9 * Math.sin((2 * Math.PI) / 64);
    expect(pipe.volume).toBeCloseTo(area * 60, 1);
    expect(pipe.bounds.min[1]).toBeCloseTo(-60);
    expect(pipe.bounds.max[2]).toBeCloseTo(70);
    // Drawn 10 mm beside the path, it sweeps beside it.
    const beside = await only(run(drawn([10, 40]), "sweep", { sketch_id: "sketch-1", path: path.slice(0, 2) }));
    expect([beside.bounds.min[0], beside.bounds.max[0]].map((x) => Math.round(x * 1000) / 1000)).toEqual([7, 13]);

    const off = evaluateDesign(await wasm, run(drawn([0, 40], -50), "sweep", { sketch_id: "sketch-1", path }));
    expect(off.errors[0]?.message).toMatch(/doesn't pass through the path's first point \[0, -60, 40\]: it's 10 mm/);
    const turned = evaluateDesign(
      await wasm,
      run(drawn([0, 40]), "sweep", {
        sketch_id: "sketch-1",
        path: [
          [0, -60, 40],
          [5, -30, 40],
        ],
      }),
    );
    expect(turned.errors[0]?.message).toMatch(/isn't square to the path where it starts/);
  });

  it("draws a path's outline, holes inside others cut out whichever way they're drawn", async () => {
    // A 20 mm square with a 10 mm square inside, both drawn the same way round.
    const d = "M -10 -10 H 10 V 10 H -10 Z M -5 -5 H 5 V 5 H -5 Z";
    let doc = run(emptyDocument(), "add_sketch", { plane: "XY", shapes: [{ type: "path", d }] });
    doc = run(doc, "extrude", { sketch_id: "sketch-1", distance: 1 });
    expect((await only(doc)).volume).toBeCloseTo(400 - 100, 3);
    let solid = run(emptyDocument(), "add_sketch", { plane: "XY", shapes: [{ type: "path", d, fill: "nonzero" }] });
    solid = run(solid, "extrude", { sketch_id: "sketch-1", distance: 1 });
    expect((await only(solid)).volume).toBeCloseTo(400, 3);
    expect(() =>
      run(emptyDocument(), "add_sketch", { plane: "XY", shapes: [{ type: "path", d: "M 0 0 L q 1" }] }),
    ).toThrow(/Path data can't be read/);
  });
});
