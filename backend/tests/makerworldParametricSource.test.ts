import { describe, expect, it } from "vitest";
import { makerworldMetaFromDesign } from "../src/providers/makerworld/pageData";

// The shapes here are MakerWorld's own, taken from design-service answers: 831106 (a Parametric Model Maker
// keychain whose source is shared), 3082544 (five protected sources) and an ordinary model with no .scad.

const designWith = (modelFiles: unknown[], rest: Record<string, unknown> = {}) => ({
  title: "Example",
  designExtension: { model_files: modelFiles },
  ...rest,
});

const scadFile = (modelName: string, isProtected: boolean) => ({
  modelName,
  modelType: "scad",
  modelUrl: "",
  scadStatus: 2,
  protected: isProtected,
});

describe("makerworldMetaFromDesign: generator scripts", () => {
  it("reads a shared source and says it isn't withheld", () => {
    const meta = makerworldMetaFromDesign(
      designWith([scadFile("keychain_customizable.scad", false)], { categoryByMakerLab: "Parametric Model Maker" }),
    );

    expect(meta.parametricSource).toEqual({ filenames: ["keychain_customizable.scad"], withheld: false });
  });

  it("marks a design whose every source is protected as withheld", () => {
    const meta = makerworldMetaFromDesign(
      designWith([
        scadFile("ElectronicsPanelGenerator.scad", true),
        scadFile("ElectronicsPanelGenerator V2.scad", true),
      ]),
    );

    expect(meta.parametricSource).toEqual({
      filenames: ["ElectronicsPanelGenerator.scad", "ElectronicsPanelGenerator V2.scad"],
      withheld: true,
    });
  });

  it("is not withheld while one source is still shared, since the zip will carry that one", () => {
    const meta = makerworldMetaFromDesign(designWith([scadFile("open.scad", false), scadFile("closed.scad", true)]));

    expect(meta.parametricSource?.withheld).toBe(false);
  });

  it("goes by the files, not by categoryByMakerLab, which plenty of such designs leave empty", () => {
    const meta = makerworldMetaFromDesign(
      designWith([scadFile("BeamGenerator.scad", false)], {
        categoryByMakerLab: "",
      }),
    );

    expect(meta.parametricSource?.filenames).toEqual(["BeamGenerator.scad"]);
  });

  it("recognises a source the file list doesn't type, by its extension", () => {
    const meta = makerworldMetaFromDesign(
      designWith([{ modelName: "generator.scad", modelType: "", protected: false }]),
    );

    expect(meta.parametricSource?.filenames).toEqual(["generator.scad"]);
  });

  it("leaves an ordinary model without one", () => {
    const meta = makerworldMetaFromDesign(
      designWith([{ modelName: "bracket.stl", modelType: "stl", protected: false }]),
    );

    expect(meta.parametricSource).toBeUndefined();
    expect(makerworldMetaFromDesign({ title: "No extension" }).parametricSource).toBeUndefined();
  });
});
