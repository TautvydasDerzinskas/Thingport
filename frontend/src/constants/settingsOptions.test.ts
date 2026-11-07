import { describe, expect, it } from "vitest";
import { normalizeTargetFor } from "./settingsOptions";

describe("normalizeTargetFor", () => {
  it("gives only Snapmaker Orca the Orca target", () => {
    expect(normalizeTargetFor("snapmaker-orca")).toBe("orca");
    for (const id of ["elegooslicer", "crealityprintlink", "prusaslicer", "cura", "", null, undefined])
      expect(normalizeTargetFor(id)).toBe("flat");
  });
});
