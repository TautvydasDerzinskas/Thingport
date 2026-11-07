import { describe, expect, it } from "vitest";
import { cameNear } from "./useInfiniteScroll";

describe("cameNear", () => {
  it("counts any record in a batch that came near", () => {
    // A new observer's first record and the scroll to the end that followed, delivered together.
    expect(cameNear([{ isIntersecting: false }, { isIntersecting: true }])).toBe(true);
    // Scrolled past the end of the grid, beside a taller panel, between two callbacks.
    expect(cameNear([{ isIntersecting: true }, { isIntersecting: false }])).toBe(true);
  });

  it("reads a single record as it is, and none as not near", () => {
    expect(cameNear([{ isIntersecting: true }])).toBe(true);
    expect(cameNear([{ isIntersecting: false }])).toBe(false);
    expect(cameNear([{ isIntersecting: false }, { isIntersecting: false }])).toBe(false);
    expect(cameNear([])).toBe(false);
  });
});
