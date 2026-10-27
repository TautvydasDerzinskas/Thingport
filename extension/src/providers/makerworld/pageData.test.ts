import { describe, expect, it } from "vitest";
import { makerworldScripts, type MakerworldDesign } from "./pageData";

// The shape MakerWorld's own page data uses: designExtension.model_files, one entry per file, a .scad among
// them where the model was generated from one, and `protected` set on the ones its creator holds back.
const design = (files: unknown[]): MakerworldDesign => ({ id: 1, designExtension: { model_files: files } });

describe("makerworldScripts", () => {
  it("finds nothing on a model with no script at all", () => {
    expect(makerworldScripts(design([{ modelName: "bauble.3mf", modelType: "3mf" }]))).toBeNull();
    expect(makerworldScripts({ id: 1 })).toBeNull();
    expect(makerworldScripts(design([]))).toBeNull();
  });

  it("reads a shared script as one that can come along", () => {
    const found = makerworldScripts(design([{ modelName: "Bauble.scad", modelType: "scad" }]));
    expect(found).toEqual({ filenames: ["Bauble.scad"], withheld: false });
  });

  it("reads a script the creator held back", () => {
    const found = makerworldScripts(design([{ modelName: "Bauble.scad", modelType: "scad", protected: true }]));
    expect(found).toEqual({ filenames: ["Bauble.scad"], withheld: true });
  });

  it("counts the model as shared while any one of its scripts is", () => {
    const found = makerworldScripts(
      design([
        { modelName: "a.scad", modelType: "scad", protected: true },
        { modelName: "b.scad", modelType: "scad" },
      ]),
    );
    expect(found).toEqual({ filenames: ["a.scad", "b.scad"], withheld: false });
  });

  it("knows a script by its name where the type doesn't say", () => {
    expect(makerworldScripts(design([{ modelName: "Bauble.SCAD", protected: true }]))?.withheld).toBe(true);
  });

  it("ignores the model's printable files when deciding", () => {
    const found = makerworldScripts(
      design([
        { modelName: "plate.3mf", modelType: "3mf" },
        { modelName: "Bauble.scad", modelType: "scad", protected: true },
      ]),
    );
    expect(found).toEqual({ filenames: ["Bauble.scad"], withheld: true });
  });

  it("survives page data that isn't shaped as expected", () => {
    expect(makerworldScripts(design([null, 7, "x"]))).toBeNull();
    expect(makerworldScripts({ id: 1, designExtension: { model_files: undefined } })).toBeNull();
  });
});
