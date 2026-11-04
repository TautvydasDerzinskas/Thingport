import { describe, expect, it } from "vitest";
import Module from "manifold-3d";
import { alignBody, alignMeasures, applyCommand, CommandError, layFlat, layFlatTurn } from "./commands";
import { emptyDocument, featureById, type StudioDocument } from "./document";
import { describeBody, estimateTriangles, evaluateDesign, measureBounds } from "./geometry";

// Patterns, mirrors, hulls, lining bodies up and laying them flat: the commands that spare an assistant the arithmetic
// of where each copy or body goes.

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

describe("Studio patterns, hulls and placing", () => {
  it("repeats a body in a row and in a grid, as one body", async () => {
    const box = run(emptyDocument(), "add_box", { width: 10, depth: 10, height: 5 });
    const row = run(box, "linear_pattern", { feature_id: "box-1", count: 4, spacing: 15 });
    const body = await only(row);
    expect(body.volume).toBeCloseTo(4 * 500, 3);
    expect(body.bounds.max[0] - body.bounds.min[0]).toBeCloseTo(10 + 3 * 15);
    const grid = run(box, "linear_pattern", {
      feature_id: "box-1",
      count: 3,
      spacing: 20,
      grid_direction: [0, 1, 0],
      grid_count: 2,
      grid_spacing: -20,
    });
    const both = await only(grid);
    expect(both.volume).toBeCloseTo(6 * 500, 3);
    expect(both.bounds.min[1]).toBeCloseTo(-25);
    expect(() =>
      run(box, "linear_pattern", { feature_id: "box-1", count: 3, spacing: 5, grid_direction: [0, 1, 0] }),
    ).toThrow(/grid_direction, grid_count and grid_spacing together/);
    expect(() =>
      run(box, "linear_pattern", {
        feature_id: "box-1",
        count: 20,
        spacing: 20,
        grid_direction: [0, 1, 0],
        grid_count: 20,
        grid_spacing: 20,
      }),
    ).toThrow(/up to 200 copies/);
  });

  it("repeats round an axis, evenly or over an angle, and cuts holes round a flange with one subtract", async () => {
    let doc = run(emptyDocument(), "add_cylinder", { radius: 30, height: 5 });
    doc = run(doc, "add_cylinder", { radius: 2, height: 20, position: [22, 0, -5] });
    doc = run(doc, "circular_pattern", { feature_id: "cylinder-2", count: 6 });
    doc = run(doc, "boolean", { operation: "subtract", target_id: "cylinder-1", tool_ids: ["pattern-3"] });
    const flange = await only(doc);
    const disc = Math.PI * 30 * 30 * 5;
    const holes = 6 * Math.PI * 2 * 2 * 5;
    expect(flange.volume).toBeGreaterThan((disc - holes) * 0.98);
    expect(flange.volume).toBeLessThan((disc - holes) * 1.02);

    // Over 90°, three copies: at 0°, 45° and 90°, so one sits on +Y.
    let arc = run(emptyDocument(), "add_box", { width: 4, depth: 4, height: 4, position: [20, 0, 0] });
    arc = run(arc, "circular_pattern", { feature_id: "box-1", count: 3, angle: 90 });
    const spread = await only(arc);
    expect(spread.bounds.max[1]).toBeCloseTo(22);
    expect(spread.bounds.max[0]).toBeCloseTo(22);
  });

  it("mirrors a half into a whole, or keeps only the mirror image", async () => {
    const half = run(emptyDocument(), "add_box", { width: 10, depth: 6, height: 4, position: [8, 0, 0] });
    const whole = await only(run(half, "mirror", { feature_id: "box-1" }));
    expect(whole.bounds.min[0]).toBeCloseTo(-13);
    expect(whole.bounds.max[0]).toBeCloseTo(13);
    expect(whole.volume).toBeCloseTo(2 * 240, 3);
    const image = await only(
      run(half, "mirror", { feature_id: "box-1", keep_original: false, plane_point: [20, 0, 0] }),
    );
    expect(image.bounds.min[0]).toBeCloseTo(27);
    expect(image.volume).toBeCloseTo(240, 3);
  });

  it("changes a pattern's numbers, but only those its kind has, and copies it with its body", async () => {
    let doc = run(emptyDocument(), "add_box", { width: 5, depth: 5, height: 5 });
    doc = run(doc, "linear_pattern", { feature_id: "box-1", count: 2, spacing: 10 });
    doc = run(doc, "update_feature", { feature_id: "pattern-2", count: 5 });
    expect((await only(doc)).volume).toBeCloseTo(5 * 125, 3);
    expect(() => run(doc, "update_feature", { feature_id: "pattern-2", angle: 90 })).toThrow(
      /A linear pattern has no angle/,
    );
    const copied = run(doc, "duplicate_feature", { feature_id: "pattern-2", offset: [0, 50, 0] });
    const copy = featureById(copied, "pattern-4");
    expect(copy?.type === "pattern" && copy.source_id).toBe("box-3");
    expect(estimateTriangles(copied)).toBe(2 * 5 * 12);
  });

  it("hulls bodies into one convex body around them", async () => {
    let doc = run(emptyDocument(), "add_sphere", { radius: 5, position: [0, 0, 0] });
    doc = run(doc, "add_sphere", { radius: 5, position: [20, 0, 0] });
    doc = run(doc, "hull", { feature_ids: ["sphere-1", "sphere-2"] });
    const capsule = await only(doc);
    // A capsule: a ball and a cylinder 20 mm long, a little under for the balls' facets.
    const expected = (4 / 3) * Math.PI * 125 + Math.PI * 25 * 20;
    expect(capsule.volume).toBeGreaterThan(expected * 0.95);
    expect(capsule.volume).toBeLessThan(expected * 1.001);
    expect(() => run(doc, "hull", { feature_ids: ["sphere-1"] })).toThrow(/already part of hull-3/);
  });

  it("lines a body up with another: on top of it, centred, beside it with a gap, or on the bed", async () => {
    let doc = run(emptyDocument(), "add_box", { width: 40, depth: 30, height: 10, position: [5, 5, 0] });
    doc = run(doc, "add_cylinder", { radius: 4, height: 6, position: [-50, 20, 7] });
    const args = { feature_id: "cylinder-2", to_id: "box-1", x: "center", y: "center", z: "after" } as const;
    expect(alignMeasures(doc, args)).toEqual(["cylinder-2", "box-1"]);
    const bounds = measureBounds(await wasm, doc, ["cylinder-2", "box-1"]);
    const onTop = alignBody(doc, args, bounds).document;
    const placed = measureBounds(await wasm, onTop, ["cylinder-2"])["cylinder-2"];
    expect((placed.min[0] + placed.max[0]) / 2).toBeCloseTo(5);
    expect((placed.min[1] + placed.max[1]) / 2).toBeCloseTo(5);
    expect(placed.min[2]).toBeCloseTo(10);

    const beside = alignBody(doc, { feature_id: "cylinder-2", to_id: "box-1", x: "before", gap: 2 }, bounds).document;
    expect(measureBounds(await wasm, beside, ["cylinder-2"])["cylinder-2"].max[0]).toBeCloseTo(-17);
    const bed = alignBody(doc, { feature_id: "cylinder-2", z: "start" }, bounds).document;
    expect(measureBounds(await wasm, bed, ["cylinder-2"])["cylinder-2"].min[2]).toBeCloseTo(0);
    expect(() => alignMeasures(doc, { feature_id: "cylinder-2" })).toThrow(CommandError);
  });

  it("lays a body flat on a face, on the bed, the face's point staying put", async () => {
    // A wedge-ish body: a box turned 30° about Y, its tilted bottom face then pointing down and to the side.
    let doc = run(emptyDocument(), "add_box", {
      width: 20,
      depth: 10,
      height: 6,
      rotation: [0, 30, 0],
      position: [5, 0, 8],
    });
    const before = describeBody(await wasm, doc, "box-1");
    const face = before.faces.find((each) => each.normal[2] < -0.5 && Math.abs(each.normal[1]) < 0.01)!;
    const args = { feature_id: "box-1", face: { point: face.point, normal: face.normal } };
    const turned = layFlatTurn(doc, args);
    const bounds = measureBounds(await wasm, turned, ["box-1"])["box-1"];
    doc = layFlat(doc, args, bounds).document;
    const after = describeBody(await wasm, doc, "box-1");
    expect(after.bounds.min[2]).toBeCloseTo(0);
    // The face that was picked now faces straight down.
    expect(after.faces.some((each) => each.normal[2] < -0.9999 && Math.abs(each.point[2]) < 1e-3)).toBe(true);
    // Its height is the box's 6 mm, flat again.
    expect(after.bounds.max[2]).toBeCloseTo(6, 3);
  });
});
