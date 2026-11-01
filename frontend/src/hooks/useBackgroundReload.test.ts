import { describe, expect, it } from "vitest";
import { keepLoaded } from "./useBackgroundReload";

describe("keepLoaded", () => {
  it("asks for a page, or for as many as are showing when that's more", () => {
    expect(keepLoaded(40, 0)).toBe(40);
    expect(keepLoaded(40, 25)).toBe(40);
    expect(keepLoaded(40, 120)).toBe(120);
  });

  it("stays within what the server allows", () => {
    expect(keepLoaded(40, 4000)).toBe(1000);
  });
});
