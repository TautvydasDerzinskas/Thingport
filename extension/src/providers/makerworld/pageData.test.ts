import { describe, expect, it } from "vitest";
import { makerworldDesignForImport, makerworldScripts, type MakerworldDesign } from "./pageData";

// The shape MakerWorld's own page data uses: designExtension.model_files, one entry per file, a .scad among
// them where the model was generated from one, and `protected` set on the ones its creator holds back.
const design = (files: unknown[]): MakerworldDesign => ({ id: 1, designExtension: { model_files: files } });

const getModelFiles = (sent: Record<string, unknown> | null): unknown =>
  (sent?.designExtension as { model_files?: unknown } | undefined)?.model_files;

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

describe("makerworldDesignForImport", () => {
  // The backend reads the script off the design the extension sends, and until it did, a Grab import of a
  // generated model brought its plates and no script -- while the same model pasted as a link brought both.
  it("carries the .scad entries the backend decides from", () => {
    const sent = makerworldDesignForImport(
      design([
        { modelName: "connector.scad", modelType: "scad", protected: false, url: "https://example.test/a.scad" },
        { modelName: "connector.3mf", modelType: "3mf" },
      ]),
    );
    expect(makerworldScripts(sent as MakerworldDesign)).toEqual({ filenames: ["connector.scad"], withheld: false });
  });

  it("keeps a withheld script withheld, so the import doesn't promise one it can't fetch", () => {
    const sent = makerworldDesignForImport(design([{ modelName: "box.scad", modelType: "scad", protected: true }]));
    expect(makerworldScripts(sent as MakerworldDesign)?.withheld).toBe(true);
  });

  // An empty list is an answer, where no list is not: without one the backend reads the design from MakerWorld.
  it("says a design has no script with an empty list rather than none", () => {
    const sent = makerworldDesignForImport(design([{ modelName: "bauble.3mf", modelType: "3mf" }]));
    expect(getModelFiles(sent)).toEqual([]);
    expect(makerworldScripts(sent as MakerworldDesign)).toBeNull();
  });

  it("sends no list where the page had none to read", () => {
    expect(getModelFiles(makerworldDesignForImport({ id: 1 }))).toBeUndefined();
  });

  it("carries a script kept in one of the design's folders", () => {
    const sent = makerworldDesignForImport(
      design([
        { modelName: "", modelType: "", isDir: true, dirName: "Example STLs", children: [{ modelName: "a.stl" }] },
        {
          modelName: "",
          modelType: "",
          isDir: true,
          dirName: "SCAD File for the Parametric Model Maker",
          children: [{ modelName: "Parametric Model Maker.scad", modelType: "scad", protected: false }],
        },
      ]),
    );
    expect(makerworldScripts(sent as MakerworldDesign)).toEqual({
      filenames: ["Parametric Model Maker.scad"],
      withheld: false,
    });
  });
});
