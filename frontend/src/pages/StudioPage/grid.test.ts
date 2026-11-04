import { describe, expect, it } from "vitest";
import { GRID_DEFAULTS } from "../../hooks/useStudioSettings";
import { gridLevels, type GridLevels } from "./grid";

// The grid's spacing as the zoom changes, as CAD's adaptive grid steps.

/** How strong the lines `spacing` mm apart are drawn: the strongest level they belong to. */
const strength = (levels: GridLevels, spacing: number) =>
  Math.max(
    ...[0, 1, 2].map((level) => {
      const step = levels.step * levels.factor ** level;
      const ratio = spacing / step;
      return Math.abs(ratio - Math.round(ratio)) < 1e-6 && Math.round(ratio) >= 1 ? levels.alphas[level] : 0;
    }),
  );

describe("Studio's grid", () => {
  it("steps by tens in millimetres, its fine lines fading in as they open up", () => {
    // 10 px to a millimetre: 1 mm lines, still faint, so points snap to the centimetres.
    const far = gridLevels(GRID_DEFAULTS, "mm", 0.1);
    expect(far).toMatchObject({ step: 1, factor: 10, snap: 10 });
    expect(far.alphas[0]).toBeLessThan(0.1);
    // 20 px to a millimetre: the millimetres show, and are snapped to.
    const near = gridLevels(GRID_DEFAULTS, "mm", 0.05);
    expect(near).toMatchObject({ step: 1, snap: 1, alphas: [0.45, 1, 1] });
    // Zoomed out, the steps grow.
    expect(gridLevels(GRID_DEFAULTS, "mm", 2).step).toBe(100);
  });

  it("hands over between steps without a line jumping", () => {
    for (const units of ["mm", "in"] as const) {
      const switchAt = (units === "in" ? 25.4 : 10) / 8;
      const before = gridLevels(GRID_DEFAULTS, units, switchAt * 0.9999);
      const after = gridLevels(GRID_DEFAULTS, units, switchAt * 1.0001);
      expect(after.step).toBeGreaterThan(before.step);
      for (const spacing of [before.step, after.step, after.step * after.factor])
        expect(strength(after, spacing)).toBeCloseTo(strength(before, spacing), 2);
    }
  });

  it("steps by fours in inches, from sixteenths up", () => {
    const levels = gridLevels(GRID_DEFAULTS, "in", 0.15);
    expect(levels.step).toBeCloseTo(25.4 / 16);
    expect(levels.factor).toBe(4);
  });

  it("is denser at Fine than at Coarse", () => {
    const fine = gridLevels({ ...GRID_DEFAULTS, density: "fine" }, "mm", 0.2);
    const coarse = gridLevels({ ...GRID_DEFAULTS, density: "coarse" }, "mm", 0.2);
    expect(fine.step).toBeLessThan(coarse.step);
  });

  it("keeps a fixed spacing, its minor lines fading out rather than shimmering when they're too close", () => {
    const fixed = { ...GRID_DEFAULTS, spacing: "fixed" as const, major: 10, subdivisions: 5 };
    expect(gridLevels(fixed, "mm", 0.1)).toMatchObject({ step: 2, factor: 5, snap: 2 });
    const dense = gridLevels(fixed, "mm", 1);
    expect(dense.alphas[0]).toBe(0);
    expect(dense.snap).toBe(10);
  });
});
