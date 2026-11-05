import { describe, expect, it } from "vitest";
import { startingSelection } from "./zipUtils";

const entries = (...paths: string[]) => paths.map((path) => ({ path }));

describe("startingSelection", () => {
  it("ticks a zip's real files", () => {
    expect([...startingSelection(entries("hull.stl", "parts/mast.3mf", "readme.txt"))]).toEqual([
      "hull.stl",
      "parts/mast.3mf",
      "readme.txt",
    ]);
  });

  it("leaves out what the OS left in it, at any depth", () => {
    const junk = entries(
      "__MACOSX/hull.stl",
      "__MACOSX/._hull.stl",
      "parts/__MACOSX/x",
      "._hull.stl",
      "parts/._mast.stl",
    );
    expect([...startingSelection(junk)]).toEqual([]);
    expect([...startingSelection(entries(".DS_Store", "parts/.DS_Store", "Thumbs.db", "parts/desktop.ini"))]).toEqual(
      [],
    );
  });

  it("doesn't take a file for junk by a name that merely looks like it", () => {
    expect([...startingSelection(entries("MACOSX/hull.stl", "my__MACOSX/a.stl", "a._b.stl"))]).toEqual([
      "MACOSX/hull.stl",
      "my__MACOSX/a.stl",
      "a._b.stl",
    ]);
  });
});
