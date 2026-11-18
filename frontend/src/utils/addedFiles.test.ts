import { describe, expect, it } from "vitest";
import {
  batchesByName,
  isModelFileName,
  isPreparedName,
  mayHoldPrepared,
  sortAddedFiles,
  storedModelFileName,
  withGltfFiles,
} from "./addedFiles";

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

describe("a .gltf added with the files it points at", () => {
  const file = (name: string, body = "") => new File([body], name);
  const scene = (name: string, bin: string, image?: string) =>
    file(name, JSON.stringify({ buffers: [{ uri: bin }], images: image ? [{ uri: image }] : [] }));

  it("takes its .bin and textures up with it, from wherever they were sorted, and leaves the rest", async () => {
    const files = [
      scene("scene.gltf", "scene.bin", "wood.png"),
      file("scene.bin"),
      file("wood.png"),
      file("notes.txt"),
    ];
    const sorted = sortAddedFiles(files, "model");
    const { model, supporting, packedWith } = await withGltfFiles(sorted, (each) => each);
    expect(names(model)).toEqual(["scene.gltf", "scene.bin", "wood.png"]);
    expect(names(supporting)).toEqual(["notes.txt"]);
    expect(names(packedWith.get(files[0]) ?? [])).toEqual(["scene.bin", "wood.png"]);
  });

  it("sends a file two scenes share once, though each holds it, and changes nothing without a .gltf", async () => {
    const files = [scene("a.gltf", "shared.bin"), scene("b.gltf", "shared.bin"), file("shared.bin")];
    const { model, packedWith } = await withGltfFiles(sortAddedFiles(files, "supporting"), (each) => each);
    expect(names(model)).toEqual(["a.gltf", "shared.bin", "b.gltf"]);
    expect(names(packedWith.get(files[1]) ?? [])).toEqual(["shared.bin"]);
    const plain = sortAddedFiles([file("part.stl"), file("guide.pdf")], "model");
    expect(await withGltfFiles(plain, (each) => each)).toMatchObject(plain);
  });

  it("is stored as a .glb", () => {
    expect(storedModelFileName("Scene.GLTF")).toBe("Scene.glb");
    expect(storedModelFileName("part.stl")).toBe("part.stl");
  });
});

describe("model files sent in requests", () => {
  const file = (name: string) => new File([name], name);
  it("sends files of one name apart, in their order, and a file items share together", () => {
    const [a, aBin, b, bBin, part, shared] = ["a.gltf", "scene.bin", "b.gltf", "scene.bin", "part.stl", "wood.png"].map(
      file,
    );
    const items = [
      { name: "a", files: [a, aBin, shared] },
      { name: "part", files: [part] },
      { name: "b", files: [b, bBin, shared] },
    ];
    expect(batchesByName(items, (item) => item.files).map((batch) => batch.map((item) => item.name))).toEqual([
      ["a", "part"],
      ["b"],
    ]);
    const together = [items[0], { name: "c", files: [file("c.gltf"), aBin, shared] }];
    expect(batchesByName(together, (item) => item.files)).toHaveLength(1);
  });
});
