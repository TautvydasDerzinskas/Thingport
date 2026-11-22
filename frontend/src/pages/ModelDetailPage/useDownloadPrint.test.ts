import { describe, expect, it } from "vitest";
import type { License, Plate, PreparedPrint } from "../../api/prints";
import { zipFileCount } from "./useDownloadPrint";

describe("zipFileCount", () => {
  const model = (plates: number, supporting: number, prepared = false, licensed = false) => ({
    plates: Array.from({ length: plates }, () => ({}) as Plate),
    supporting_file_count: supporting,
    prepared_print: prepared ? ({} as PreparedPrint) : null,
    license: licensed ? ({} as License) : null,
  });

  it("counts what the zip holds: plates, supporting files, the prepared print and LICENSE.txt", () => {
    // Issue #376's model: six model files and a PDF.
    expect(zipFileCount(model(6, 1))).toBe(7);
    expect(zipFileCount(model(6, 1, true, true))).toBe(9);
    expect(zipFileCount(model(2, 0))).toBe(2);
  });

  it("offers a zip for one plate only with something to put beside it", () => {
    expect(zipFileCount(model(1, 1))).toBe(2);
    expect(zipFileCount(model(1, 0, true))).toBe(2);
    expect(zipFileCount(model(1, 0, false, true))).toBe(0);
    expect(zipFileCount(model(1, 0))).toBe(0);
  });
});
