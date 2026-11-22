import { describe, expect, it } from "vitest";
import { zipFileCount } from "./useDownloadPrint";

describe("zipFileCount", () => {
  const model = (
    plates: number,
    supporting: number,
    prepared: "file" | "first plate" | null = null,
    licensed = false,
  ) => ({
    // Only what the count reads: how many plates, not what they are.
    plates: Array.from({ length: plates }, (_, index) => index),
    supporting_file_count: supporting,
    // A prepared print that's a file of its own can be removed; one that's the sliced first plate can't.
    prepared_print: prepared ? { removable: prepared === "file" } : null,
    license: licensed ? { id: "CC0-1.0" } : null,
  });

  it("counts what the zip holds: plates, supporting files, the prepared print and LICENSE.txt", () => {
    // Issue #376's model: six model files and a PDF.
    expect(zipFileCount(model(6, 1))).toBe(7);
    expect(zipFileCount(model(6, 1, "file", true))).toBe(9);
    expect(zipFileCount(model(2, 0))).toBe(2);
  });

  it("counts a sliced first plate once, as a plate", () => {
    expect(zipFileCount(model(2, 0, "first plate"))).toBe(2);
    expect(zipFileCount(model(1, 0, "first plate", true))).toBe(0);
  });

  it("offers a zip for one plate only with something to put beside it", () => {
    expect(zipFileCount(model(1, 1))).toBe(2);
    expect(zipFileCount(model(1, 0, "file"))).toBe(2);
    expect(zipFileCount(model(1, 0, null, true))).toBe(0);
    expect(zipFileCount(model(1, 0))).toBe(0);
  });
});
