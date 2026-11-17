import { describe, expect, it } from "vitest";
import { isModelFileName, isPreparedName, mayHoldPrepared, sortAddedFiles } from "./addedFiles";

const named = (...names: string[]) => names.map((name) => ({ name }));
const names = (files: { name: string }[]) => files.map((file) => file.name);

describe("files added to a model", () => {
  it("tells 3D files from documents, and a sliced print from both", () => {
    for (const name of [
      "Body.STL",
      "frog.3mf",
      "part.step",
      "part.stp",
      "mesh.obj",
      "scene.glb",
      "scene.gltf",
      "cut.lbrn2",
    ]) {
      expect(isModelFileName(name)).toBe(true);
    }
    for (const name of ["guide.pdf", "README.md", "source.f3d", "notes.txt", "photo.png", "frog.gcode.3mf"]) {
      expect(isModelFileName(name)).toBe(false);
    }
    expect(isPreparedName("frog.gcode.3mf")).toBe(true);
    expect(isPreparedName("frog.BGCODE")).toBe(true);
    expect(isPreparedName("frog.3mf")).toBe(false);
  });

  it("sends a document added among the model files to the supporting ones, and keeps pictures where added", () => {
    const { model, supporting } = sortAddedFiles(named("body.stl", "guide.pdf", "photo.png", "ready.gcode"), "model");
    expect(names(model)).toEqual(["body.stl", "photo.png"]);
    expect(names(supporting)).toEqual(["guide.pdf", "ready.gcode"]);
  });

  it("sends a 3D file added among the supporting files to the model files", () => {
    const { model, supporting } = sortAddedFiles(named("wiring.png", "lid.stl", "source.f3d"), "supporting");
    expect(names(model)).toEqual(["lid.stl"]);
    expect(names(supporting)).toEqual(["wiring.png", "source.f3d"]);
  });
});

describe("a sliced print whose upload failed", () => {
  it("may be in all the same, unless the server turned it away", () => {
    // No answer at all, or one after the save: the ones after it keep its place.
    expect(mayHoldPrepared("A.gcode", null)).toBe(true);
    expect(mayHoldPrepared("A.gcode.3mf", 500)).toBe(true);
    expect(mayHoldPrepared("A.bgcode", 502)).toBe(true);
    // Turned away: nothing was kept, so the next one may take the place.
    expect(mayHoldPrepared("A.gcode", 413)).toBe(false);
    expect(mayHoldPrepared("A.gcode", 400)).toBe(false);
    // Never the prepared print, whatever happened.
    expect(mayHoldPrepared("guide.pdf", null)).toBe(false);
    expect(mayHoldPrepared("frog.3mf", 500)).toBe(false);
  });
});
