import Module from "manifold-3d";
import { describe, expect, it } from "vitest";
import { applyCommand, arrangePlate, previewArrangement } from "./commands";
import { emptyDocument, plateOf, studioPlates, type StudioDocument } from "./document";
import { checkDesign, evaluateDesign, measureBetween, measureBounds } from "./geometry";

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

const cmd = (doc: StudioDocument, name: string, args: object) => applyCommand(doc, name, args).document;

describe("Studio print workflow", () => {
  it("makes matching, editable split connectors and cropped, engraved fit samples", async () => {
    const m = await wasm;
    const source = cmd(emptyDocument(), "add_box", { width: 60, depth: 50, height: 24 });
    const split = applyCommand(source, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 12], normal: [0, 0, 1] },
      connector: { diameter: 6, depth: 4, clearance: 0.2, offset: [0, 0], count: 2, spacing: 15 },
      separate_plates: true,
    });
    const [pin, socket] = split.created;
    const original = evaluateDesign(m, split.document);
    expect(original.errors).toEqual([]);
    expect(original.bodies.map(({ bounds, volume }) => [bounds.min[2], volume > 60 * 50 * 12])).toEqual([
      [8, true],
      [0, false],
    ]);
    expect(measureBetween(m, split.document, pin, socket).overlap).toBeCloseTo(0, 5);
    expect(studioPlates(split.document)).toHaveLength(2);

    const fit = applyCommand(split.document, "make_fit_test", { feature_id: pin, clearances: [0.1, 0.2, 0.3] });
    const { errors, bodies } = evaluateDesign(m, fit.document, fit.created);
    expect(errors).toEqual([]);
    expect(bodies).toHaveLength(4);
    for (const { bounds, volume } of bodies) {
      expect(bounds.min[2]).toBeCloseTo(0, 5);
      expect(volume).toBeGreaterThan(0);
      expect(bounds.max[0] - bounds.min[0]).toBeLessThan(16);
    }
    expect(fit.document.features.at(-1)?.name).toBe("Socket 0.3 mm");
    expect(plateOf(fit.document.features.at(-1)!)).toBe(studioPlates(fit.document).at(-1)?.id);

    const selected = cmd(fit.document, "apply_fit_clearance", {
      feature_id: pin,
      clearance: 0.3,
      parameter: "lid_fit",
    });
    const changed = cmd(selected, "set_parameter", { name: "lid_fit", value: 0.4 });
    expect(changed.features.find(({ id }) => id === socket)).toMatchObject({ connector: { clearance: 0.4 } });
    expect(changed.features.at(-1)).toMatchObject({ connector: { clearance: 0.3 } });
  });

  it("packs around a locked body and moves overflow in a single arrangement", async () => {
    const m = await wasm;
    let doc = cmd(emptyDocument(), "set_print_setup", {
      setup: { printer: "test", nozzle: "0.4", bed: [65, 40, 40], minWall: 0.8 },
    });
    for (const x of [-13, 20, 40]) doc = cmd(doc, "add_box", { width: 25, depth: 25, height: 7, position: [x, 0, 0] });
    doc = cmd(doc, "lock_plate_positions", { feature_ids: ["box-1"], locked: true });
    const args = { plate_id: "plate-1", spacing: 3 };
    const bounds = measureBounds(m, doc, ["box-1", "box-2", "box-3"]);
    const preview = previewArrangement(doc, args, bounds);
    expect(preview.overflow).toEqual([]);
    expect(preview.planes).toHaveLength(2);
    expect(() => arrangePlate(doc, args, bounds)).toThrow(/another plate/);
    const result = arrangePlate(doc, { ...args, overflow: true }, bounds);
    expect(result.document.features[0]).toEqual(doc.features[0]);
    expect(result.created).toEqual(["plate-2"]);
    expect(checkDesign(m, result.document, { ...doc.print_setup!, overhang: 45 }).problems).toEqual([]);
  });

  it("checks a round bed and reports world-space markers on thin walls", async () => {
    const m = await wasm;
    let doc = cmd(emptyDocument(), "add_box", { width: 10, depth: 10, height: 0.4, position: [38, 38, 0] });
    doc = cmd(doc, "set_print_setup", {
      setup: { printer: "delta", nozzle: "0.4", bed: [100, 100, 120], outline: { shape: "circle" }, minWall: 0.8 },
    });
    const report = checkDesign(m, doc, { ...doc.print_setup!, overhang: 45, highlight: true });
    expect(report.bodies[0].fitsBed).toBe(false);
    expect(report.problems.join(" ")).toMatch(/bed outline/);
    expect(report.bodies[0].highlights?.thinWalls.length).toBeGreaterThan(0);
    expect(report.bodies[0].highlights?.thinWalls.every(([x, y]) => x >= 33 && y >= 33)).toBe(true);
  });
});
