import { describe, expect, it } from "vitest";
import { applyCommand } from "../../studio/commands";
import { emptyDocument, type StudioDocument } from "../../studio/document";
import { savedPlateLocation } from "./studioPlate";

const cmd = (doc: StudioDocument, name: string, args: object) => applyCommand(doc, name, args).document;
const box = (doc: StudioDocument, plate: string) =>
  cmd(doc, "add_box", { plate_id: plate, width: 10, depth: 10, height: 10 });

/** Profile 1: plate-1 (a box). Profile 2: plate-2 (empty), plate-3 (a box), plate-4 (a box). */
function twoProfiles(): StudioDocument {
  let doc = box(emptyDocument(), "plate-1");
  doc = cmd(doc, "create_profile", { name: "Second" });
  for (const name of ["Empty", "Lid", "Base"]) doc = cmd(doc, "create_plate", { name, profile_id: "profile-2" });
  return box(box(doc, "plate-3"), "plate-4");
}

describe("where a saved design's plate ends up", () => {
  it("is its profile's 3MF, and its place among that profile's saved plates", () => {
    const doc = twoProfiles();
    expect(savedPlateLocation(doc, "plate-1")).toEqual({ file: 0, plate: 1 });
    // The empty plate isn't saved, so plate-3 is the second 3MF's first plate.
    expect(savedPlateLocation(doc, "plate-3")).toEqual({ file: 1, plate: 1 });
    expect(savedPlateLocation(doc, "plate-4")).toEqual({ file: 1, plate: 2 });
  });

  it("knows no place for a plate the save leaves out", () => {
    const doc = twoProfiles();
    expect(savedPlateLocation(doc, "plate-2")).toBeNull();
    expect(
      savedPlateLocation(cmd(doc, "set_plate_visibility", { plate_id: "plate-1", visible: false }), "plate-1"),
    ).toBeNull();
  });

  it("counts files from the first profile that saves anything", () => {
    // With profile 1 hidden, profile 2's 3MF is the model's first file.
    const doc = cmd(twoProfiles(), "set_plate_visibility", { plate_id: "plate-1", visible: false });
    expect(savedPlateLocation(doc, "plate-4")).toEqual({ file: 0, plate: 2 });
  });
});
