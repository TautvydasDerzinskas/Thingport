import { describe, expect, it } from "vitest";
import { adaptedCopyFilename } from "./useAdaptedOpen";

describe("an adapted copy's file name", () => {
  it("is the file's, marked adapted, with the printer's model where it's made for one, as Grab names it", () => {
    expect(adaptedCopyFilename("benchy.3mf", "P1S")).toBe("benchy-adapted-P1S.3mf");
    expect(adaptedCopyFilename("Benchy.3MF", "X1 Carbon")).toBe("Benchy-adapted-X1-Carbon.3mf");
    expect(adaptedCopyFilename("benchy.3mf", null)).toBe("benchy-adapted.3mf");
    expect(adaptedCopyFilename("benchy.3mf", 'A1 "mini"/2')).toBe("benchy-adapted-A1-mini2.3mf");
  });
});
