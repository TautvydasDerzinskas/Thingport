import Module from "manifold-3d";
import { describe, expect, it } from "vitest";
import { applyCommand, arrangePlate, makeFitTest, previewArrangement } from "./commands";
import { emptyDocument, plateOf, studioPlates, type StudioDocument, type StudioPrintSetup } from "./document";
import { checkDesign, evaluateDesign, measureBetween, measureBounds } from "./geometry";
import { arrangeFootprints, boundsOnBed } from "./printLayout";

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

    const fit = makeFitTest(split.document, { feature_id: pin, clearances: [0.1, 0.2, 0.3] });
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

  it("turns a connector offset with its source even when the split plane's normal stays the same", async () => {
    const source = cmd(emptyDocument(), "add_box", { width: 40, depth: 10, height: 24 });
    const split = cmd(source, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 12], normal: [0, 0, 1] },
      connector: { diameter: 5, depth: 3, clearance: 0.2, offset: [10, 0], count: 1, spacing: 10 },
    });
    const rotated = cmd(split, "set_transform", { feature_id: "box-1", rotation: [0, 0, 90] });
    const result = evaluateDesign(await wasm, rotated);
    expect(result.errors).toEqual([]);
    expect(result.bodies).toHaveLength(2);
    expect(result.bodies[0].bounds.max[0]).toBeCloseTo(5);
  });

  it("engraves a narrow socket where the original crop edge has no material", async () => {
    const source = cmd(emptyDocument(), "add_box", { width: 40, depth: 6, height: 20 });
    const split = applyCommand(source, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 10], normal: [0, 0, 1] },
      connector: { diameter: 3, depth: 3, clearance: 0.2, offset: [0, 0], count: 1, spacing: 10 },
    });
    const fit = makeFitTest(split.document, { feature_id: split.created[0], clearances: [0.3] });
    const m = await wasm;
    const marked = evaluateDesign(m, fit.document, [fit.created[1]]);
    expect(marked.errors).toEqual([]);
    const sample = fit.document.features.at(-1);
    if (sample?.type !== "split" || !sample.fit_sample) throw new Error("Missing socket sample");
    sample.fit_sample.label = "";
    const unmarked = evaluateDesign(m, fit.document, [fit.created[1]]);
    expect(marked.bodies[0].volume).toBeLessThan(unmarked.bodies[0].volume - 0.5);
  });

  it("replaces a connector formula before updating its shared parameter", () => {
    let doc = cmd(emptyDocument(), "add_box", { width: 40, depth: 20, height: 20 });
    doc = cmd(doc, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 10], normal: [0, 0, 1] },
      connector: { diameter: 5, depth: 3, clearance: 0.2, offset: [0, 0], count: 2, spacing: 5.7 },
    });
    doc = cmd(doc, "set_parameter", { name: "fit", value: 0.1, unit: "mm" });
    for (const id of ["split-2", "split-3"])
      doc = cmd(doc, "set_expression", { feature_id: id, field: "connector.clearance", expression: "fit * 2" });
    doc = cmd(doc, "apply_fit_clearance", { feature_id: "split-2", clearance: 0.3, parameter: "fit" });
    for (const part of doc.features.slice(1))
      expect(part).toMatchObject({ connector: { clearance: 0.3 }, expressions: { "connector.clearance": "fit" } });
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

  it("rejects projected triangles and arrangement footprints that span a notch", async () => {
    const bed: StudioPrintSetup["bed"] = [100, 100, 100];
    const outline: StudioPrintSetup["outline"] = {
      shape: "polygon",
      points: [
        [-50, -50],
        [50, -50],
        [50, 50],
        [-20, 50],
        [-20, 20],
        [-30, 20],
        [-30, 50],
        [-50, 50],
      ],
    };
    const full = [
      { id: "wide", bound: { min: [-50, -50, 0], max: [50, 50, 5] } } satisfies Parameters<
        typeof arrangeFootprints
      >[0][number],
    ];
    expect(arrangeFootprints(full, bed, 0, outline).overflow).toEqual(["wide"]);
    expect(arrangeFootprints(full, bed, 0).overflow).toEqual([]);
    const m = await wasm;
    const doc = cmd(emptyDocument(), "add_box", { width: 20, depth: 5, height: 4, position: [-25, 30, 0] });
    expect(checkDesign(m, doc, { bed, outline, overhang: 45, minWall: 0.8 }).bodies[0].fitsBed).toBe(false);
    const moved = cmd(doc, "set_transform", { feature_id: "box-1", position: [-25, 10, 0] });
    expect(checkDesign(m, moved, { bed, outline, overhang: 45, minWall: 0.8 }).bodies[0].fitsBed).toBe(true);
  });

  it("rejects invalid printer outlines and respects the build dimensions of a valid outline", () => {
    const setup = { printer: "test", nozzle: "0.4", bed: [24, 24, 30], minWall: 0.8 };
    for (const points of [
      [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      [
        [0, 0],
        [20, 20],
        [0, 20],
        [15, 0],
      ],
    ]) {
      expect(() =>
        cmd(emptyDocument(), "set_print_setup", { setup: { ...setup, outline: { shape: "polygon", points } } }),
      ).toThrow(/simple bed outline/);
    }
    const doc = cmd(emptyDocument(), "set_print_setup", {
      setup: {
        ...setup,
        outline: {
          shape: "polygon",
          points: [
            [-20, -20],
            [20, -20],
            [20, 20],
            [0, 20],
            [0, 10],
            [-5, 10],
            [-5, 20],
            [-20, 20],
          ],
        },
      },
    });
    const { bed, outline } = doc.print_setup!;
    expect(boundsOnBed({ min: [13, 0, 0], max: [15, 2, 5] }, bed, outline)).toBe(false);
    expect(boundsOnBed({ min: [9, 0, 0], max: [12, 2, 5] }, bed, outline)).toBe(true);
  });

  it("finds a placement against a narrow polygon corridor outside the sampling grid", () => {
    const outline = {
      shape: "polygon" as const,
      points: [
        [-50, -50],
        [50, -50],
        [50, -45],
        [10, -45],
        [10, 50],
        [1, 50],
        [1, -45],
        [-50, -45],
      ],
    } satisfies StudioPrintSetup["outline"];
    const result = arrangeFootprints(
      [{ id: "part", bound: { min: [0, 0, 0], max: [8, 30, 5] } }],
      [100, 100, 100],
      0,
      outline,
    );
    expect(result.overflow).toEqual([]);
    expect(result.planes[0][0].x).toBeGreaterThanOrEqual(1);
    expect(result.planes[0][0].x).toBeLessThanOrEqual(2);
  });
});
