import { describe, expect, it } from "vitest";
import { nameMatches, nameWords } from "./printerSearch";

const finds = (query: string, name: string) => nameMatches(name, nameWords(query));

describe("Add printer's search", () => {
  it("finds a model by the start of its words", () => {
    expect(finds("k1", "Creality K1")).toBe(true);
    expect(finds("k1", "Creality K1C")).toBe(true);
    expect(finds("k1 max", "Creality K1 Max")).toBe(true);
    expect(finds("mk4", "Prusa Research MK4S")).toBe(true);
  });

  it("doesn't find a word in the middle of another", () => {
    expect(finds("k1", "Wanhao D9-300 MK1")).toBe(false);
    expect(finds("k1", "Longer LK1")).toBe(false);
  });

  it("splits names where printer names split", () => {
    expect(finds("ender 3", "Creality Ender-3 V3")).toBe(true);
    expect(finds("ender-3", "Creality Ender-3 V3")).toBe(true);
    expect(finds("v3", "Creality Ender-3 V3")).toBe(true);
  });

  it("finds makers too, in any case", () => {
    expect(finds("BAMBU", "Bambu Lab")).toBe(true);
    expect(finds("lab", "Bambu Lab")).toBe(true);
    expect(finds("", "Anything")).toBe(true);
  });
});
