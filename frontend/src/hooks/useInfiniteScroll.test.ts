import { describe, expect, it } from "vitest";
import { nearNow } from "./useInfiniteScroll";

describe("nearNow", () => {
  it("goes by the latest record when a callback carries several", () => {
    // A new observer's first record and the scroll to the end that followed, delivered together.
    expect(nearNow([{ isIntersecting: false }, { isIntersecting: true }])).toBe(true);
    expect(nearNow([{ isIntersecting: true }, { isIntersecting: false }])).toBe(false);
  });

  it("reads a single record as it is, and none as not near", () => {
    expect(nearNow([{ isIntersecting: true }])).toBe(true);
    expect(nearNow([{ isIntersecting: false }])).toBe(false);
    expect(nearNow([])).toBe(false);
  });
});
