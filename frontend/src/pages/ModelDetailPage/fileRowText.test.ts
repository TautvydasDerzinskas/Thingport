import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { PlateProfile } from "../../api/prints";
import { fileRowText } from "./fileRowText";

// Stub of the real English strings, enough to check what text is composed.
const t = ((key: string, o: Record<string, unknown> = {}) => {
  switch (key) {
    case "models:detail.fileMeta":
      return `File ${o.n} · ${o.type}`;
    case "models:detail.fileLabel":
      return `File ${o.n}`;
    case "models:detail.profileNozzle":
      return `${o.value} nozzle`;
    case "models:detail.profileLayer":
      return `${o.value} mm`;
    case "models:detail.profilePlates":
      return `${o.count} ${o.count === 1 ? "plate" : "plates"}`;
    default:
      return key;
  }
}) as unknown as TFunction;

const empty: PlateProfile = {
  title: null,
  printer: null,
  nozzle_mm: null,
  layer_height_mm: null,
  materials: [],
  plates: null,
  estimated_seconds: null,
  weight_g: null,
};

describe("fileRowText", () => {
  it("keeps today's text without a profile", () => {
    expect(fileRowText(t, "part.stl", 1)).toEqual({ primary: "part", secondary: "File 2 · STL" });
  });

  it("shows the profile title and chips", () => {
    const profile: PlateProfile = {
      ...empty,
      title: "0.22mm layer, 2 walls, 10% infill",
      printer: "Bambu Lab A1 mini",
      nozzle_mm: 0.4,
      layer_height_mm: 0.22,
      materials: ["PLA"],
      plates: 3,
    };
    expect(fileRowText(t, "part.3mf", 0, profile)).toEqual({
      primary: "0.22mm layer, 2 walls, 10% infill",
      secondary: "part · Bambu Lab A1 mini · 0.4 nozzle · 0.22 mm · PLA · 3 plates",
    });
  });

  it("falls back to the file name when only chips are known", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, printer: "MK4" })).toEqual({
      primary: "part",
      secondary: "MK4",
    });
  });

  it("falls back fully for an empty profile", () => {
    expect(fileRowText(t, "part.3mf", 0, empty)).toEqual(fileRowText(t, "part.3mf", 0));
  });

  it("joins materials", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, materials: ["PLA", "PETG"] }).secondary).toContain("PLA/PETG");
  });

  it("drops trailing zeros from numbers", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, nozzle_mm: 0.4, layer_height_mm: 0.2 }).secondary).toBe(
      "0.4 nozzle · 0.2 mm",
    );
  });

  it("keeps the title with today's secondary text when there are no chips", () => {
    expect(fileRowText(t, "part.3mf", 0, { ...empty, title: "Draft" })).toEqual({
      primary: "Draft",
      secondary: "part · File 1 · 3MF",
    });
  });
});
