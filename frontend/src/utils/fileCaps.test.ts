import { describe, expect, it } from "vitest";
import type { Plate } from "../api/prints";
import { legacyCaps, legacyPartnerCaps, plateCaps } from "./fileCaps";

// What an older backend's payload, with no caps, is offered: what the app offered before, frozen.

const NONE = { preview3d: false, openInSlicer: false, openInStudio: false, customize: false, view: null };

describe("legacyCaps", () => {
  it("draws and opens in Studio the plates the 3D viewer read, and offered every plate to the slicer", () => {
    for (const name of ["Part.stl", "Part.3MF", "Part.step", "Part.stp", "Part.obj", "Part.glb", "Plate.gcode.3mf"]) {
      expect(legacyCaps(name, "plate")).toEqual({ ...NONE, preview3d: true, openInSlicer: true, openInStudio: true });
    }
    for (const name of ["Part.f3d", "Parts.zip", "Photo.png", "Laser.lbrn2"]) {
      expect(legacyCaps(name, "plate")).toEqual({ ...NONE, openInSlicer: true });
    }
  });

  it("offered the prepared print to the slicer, and nothing of a file kept beside the plates", () => {
    expect(legacyCaps("Tower.gco", "prepared")).toEqual({ ...NONE, openInSlicer: true });
    expect(legacyCaps("Box.scad", "supporting")).toEqual(NONE);
  });
});

describe("plateCaps", () => {
  it("takes what the server says, and stands in only where it says nothing", () => {
    const told = { preview3d: false, openInSlicer: false, openInStudio: false, customize: false };
    expect(plateCaps({ filename: "Part.stl", caps: told } as Pick<Plate, "filename" | "caps">)).toBe(told);
    expect(plateCaps({ filename: "Part.stl" })).toEqual({
      ...NONE,
      preview3d: true,
      openInSlicer: true,
      openInStudio: true,
    });
  });
});

describe("legacyPartnerCaps", () => {
  it("offered a slicer only the 3D files the partner page knew, and downloads for the rest", () => {
    expect(legacyPartnerCaps("Bin.3mf").openInSlicer).toBe(true);
    for (const name of ["Part.glb", "Tower.gcode", "Guide.pdf"])
      expect(legacyPartnerCaps(name).openInSlicer).toBe(false);
  });
});
