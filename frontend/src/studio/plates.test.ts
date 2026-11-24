import Module from "manifold-3d";
import { describe, expect, it } from "vitest";
import { applyCommand, CommandError } from "./commands";
import {
  emptyDocument,
  exportsSomething,
  hiddenPlates,
  LIMITS,
  picturablePlates,
  studioPlates,
  type StudioDocument,
} from "./document";
import { checkDesign } from "./geometry";

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

const cmd = (doc: StudioDocument, name: string, args: object) => applyCommand(doc, name, args).document;
const ids = (doc: StudioDocument) => studioPlates(doc).map((plate) => plate.id);

/** Three plates, a box on plate-2. */
function threePlates() {
  let doc = cmd(emptyDocument(), "create_plate", { name: "Lids" });
  doc = cmd(doc, "create_plate", { name: "Tests" });
  return cmd(doc, "add_box", { plate_id: "plate-2", width: 10, depth: 10, height: 10 });
}

describe("plate order", () => {
  it("moves a plate to a position and keeps the others' order, ids, names and bodies", () => {
    const doc = threePlates();
    const moved = cmd(doc, "move_plate", { plate_id: "plate-3", position: 1 });
    expect(ids(moved)).toEqual(["plate-3", "plate-1", "plate-2"]);
    expect(studioPlates(moved).map((plate) => plate.name)).toEqual(["Tests", "Plate 1", "Lids"]);
    expect(moved.features[0].plate_id).toBe("plate-2");
    expect(ids(cmd(moved, "move_plate", { plate_id: "plate-3", position: 3 }))).toEqual([
      "plate-1",
      "plate-2",
      "plate-3",
    ]);
  });

  it("refuses a position past the last plate and a plate that isn't there", () => {
    const doc = threePlates();
    expect(() => applyCommand(doc, "move_plate", { plate_id: "plate-1", position: 4 })).toThrow(
      /has 3 plates, so position goes up to 3/,
    );
    expect(() => applyCommand(doc, "move_plate", { plate_id: "plate-9", position: 1 })).toThrow(CommandError);
    expect(() => applyCommand(emptyDocument(), "move_plate", { plate_id: "plate-1", position: 2 })).toThrow(
      /has 1 plate,/,
    );
  });

  it("deletes a plate with everything on it, and what that's made from", () => {
    let doc = cmd(threePlates(), "add_cylinder", { plate_id: "plate-2", radius: 2, height: 20 });
    doc = cmd(doc, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["cylinder-2"] });
    doc = cmd(doc, "add_box", { width: 5, depth: 5, height: 5 });
    doc = cmd(doc, "lock_plate_positions", { feature_ids: ["boolean-3", "box-4"], locked: true });
    const deleted = applyCommand(doc, "delete_plate", { plate_id: "plate-2" });
    expect(deleted.summary).toBe("Deleted plate-2 and the 3 features on it");
    expect(ids(deleted.document)).toEqual(["plate-1", "plate-3"]);
    expect(deleted.document.features.map((feature) => feature.id)).toEqual(["box-4"]);
    expect(deleted.document.locked_layout).toEqual(["box-4"]);
  });

  it("preserves inputs used by surviving bodies when deleting a plate", () => {
    let doc = cmd(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    doc = cmd(doc, "split", {
      feature_id: "box-1",
      plane: { point: [0, 0, 5], normal: [0, 0, 1] },
      separate_plates: true,
    });
    expect(ids(doc)).toEqual(["plate-1", "plate-2"]);
    const deleted = applyCommand(doc, "delete_plate", { plate_id: "plate-2" });
    expect(ids(deleted.document)).toEqual(["plate-1"]);
    // The second half on plate-2 is removed, but the first half and its source_id box-1 survive.
    const featureIds = deleted.document.features.map((feature) => feature.id);
    expect(featureIds).toContain("split-2");
    expect(featureIds).toContain("box-1");
    expect(featureIds).not.toContain("split-3");
  });

  it("deletes a plate still to load from a 3MF without loading it", () => {
    const doc = threePlates();
    doc.plates![2].source = { archive_id: "a".repeat(24), index: 1, model: undefined as never };
    expect(ids(cmd(doc, "delete_plate", { plate_id: "plate-3" }))).toEqual(["plate-1", "plate-2"]);
  });

  it("still keeps plate-1 once it's no longer first", () => {
    const moved = cmd(threePlates(), "move_plate", { plate_id: "plate-1", position: 3 });
    expect(() => applyCommand(moved, "delete_plate", { plate_id: "plate-1" })).toThrow(/plate-1 cannot be deleted/);
    expect(ids(cmd(moved, "delete_plate", { plate_id: "plate-3" }))).toEqual(["plate-2", "plate-1"]);
  });
});

describe("hidden plates", () => {
  it("hides and shows a plate, the flag absent while shown", () => {
    const hidden = cmd(threePlates(), "set_plate_visibility", { plate_id: "plate-2", visible: false });
    expect(studioPlates(hidden)[1]).toMatchObject({ id: "plate-2", hidden: true });
    expect([...hiddenPlates(hidden)]).toEqual(["plate-2"]);
    // Its bodies keep their own visibility.
    expect(hidden.features[0].visible).toBe(true);
    const shown = cmd(hidden, "set_plate_visibility", { plate_id: "plate-2", visible: true });
    expect(studioPlates(shown)[1]).not.toHaveProperty("hidden");
    expect(hiddenPlates(shown).size).toBe(0);
  });

  it("hides plate-1 in a design that never listed its plates", () => {
    const doc = cmd(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    const hidden = cmd(doc, "set_plate_visibility", { plate_id: "plate-1", visible: false });
    expect(hidden.plates).toEqual([{ id: "plate-1", name: "Plate 1", hidden: true }]);
    expect(exportsSomething(doc)).toBe(true);
    expect(exportsSomething(hidden)).toBe(false);
  });

  it("keeps a hidden plate's moves and hidden flag together", () => {
    let doc = cmd(threePlates(), "set_plate_visibility", { plate_id: "plate-3", visible: false });
    doc = cmd(doc, "move_plate", { plate_id: "plate-3", position: 1 });
    expect(studioPlates(doc)[0]).toMatchObject({ id: "plate-3", name: "Tests", hidden: true });
  });

  it("leaves a hidden plate's bodies out of the print check", async () => {
    // A box far off the bed on plate-2.
    let doc = cmd(threePlates(), "set_transform", { feature_id: "box-1", position: [500, 0, 0] });
    doc = cmd(doc, "add_box", { width: 10, depth: 10, height: 10 });
    const options = { bed: [256, 256, 256] as [number, number, number], minWall: 0.8, overhang: 45 };
    const m = await wasm;
    expect(checkDesign(m, doc, options).bodies.map((body) => body.id)).toEqual(["box-1", "box-2"]);
    const hidden = cmd(doc, "set_plate_visibility", { plate_id: "plate-2", visible: false });
    const report = checkDesign(m, hidden, options);
    expect(report.bodies.map((body) => body.id)).toEqual(["box-2"]);
    expect(report.problems.join(" ")).not.toMatch(/box-1/);
  });
});

describe("picturable plates", () => {
  it("offers the shown, loaded plates with a visible body, in the plates' order", () => {
    let doc = cmd(threePlates(), "add_box", { plate_id: "plate-3", width: 10, depth: 10, height: 10 });
    expect(picturablePlates(doc)).toEqual(["plate-2", "plate-3"]);
    doc = cmd(doc, "move_plate", { plate_id: "plate-3", position: 1 });
    expect(picturablePlates(doc)).toEqual(["plate-3", "plate-2"]);
    doc = cmd(doc, "set_plate_visibility", { plate_id: "plate-2", visible: false });
    expect(picturablePlates(doc)).toEqual(["plate-3"]);
    doc = cmd(doc, "set_visibility", { feature_id: "box-2", visible: false });
    expect(picturablePlates(doc)).toEqual([]);
  });
});

describe("design size", () => {
  it(`holds up to ${LIMITS.features} features`, () => {
    expect(LIMITS.features).toBe(500);
    let doc = emptyDocument();
    for (let i = 0; i < LIMITS.features; i++) doc = cmd(doc, "add_box", { width: 1, depth: 1, height: 1 });
    expect(doc.features).toHaveLength(500);
    expect(() => applyCommand(doc, "add_box", { width: 1, depth: 1, height: 1 })).toThrow(/up to 500 features/);
  });
});
