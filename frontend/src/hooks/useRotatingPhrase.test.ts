import { describe, expect, it } from "vitest";
import { nextRandomIndex } from "./useRotatingPhrase";

describe("nextRandomIndex", () => {
  it("never repeats the current phrase and can reach every other one", () => {
    const count = 5;
    for (let current = 0; current < count; current++) {
      const reached = new Set<number>();
      for (let step = 0; step < count - 1; step++) {
        const next = nextRandomIndex(current, count, () => step / (count - 1));
        expect(next).not.toBe(current);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
        reached.add(next);
      }
      expect(reached.size).toBe(count - 1);
    }
  });

  it("stays on the only phrase there is", () => {
    expect(nextRandomIndex(0, 1)).toBe(0);
    expect(nextRandomIndex(0, 0)).toBe(0);
  });
});
