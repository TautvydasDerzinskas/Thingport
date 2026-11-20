import { describe, expect, it } from "vitest";
import { bytesFromSizeText } from "../src/utils/sizeText";

describe("a size as a site writes it", () => {
  it("reads back into bytes, whatever the unit's case or the thousands' commas", () => {
    expect(bytesFromSizeText("25.4 MB")).toBe(Math.round(25.4 * 1024 ** 2));
    expect(bytesFromSizeText("19.48 kB")).toBe(Math.round(19.48 * 1024));
    expect(bytesFromSizeText("1,200 KB")).toBe(1200 * 1024);
    expect(bytesFromSizeText("512 bytes")).toBe(512);
    expect(bytesFromSizeText("1.42 GB")).toBe(Math.round(1.42 * 1024 ** 3));
  });

  it("is null for what isn't a size", () => {
    expect(bytesFromSizeText(null)).toBeNull();
    expect(bytesFromSizeText("")).toBeNull();
    expect(bytesFromSizeText("large")).toBeNull();
    expect(bytesFromSizeText("12 parsecs")).toBeNull();
  });
});
