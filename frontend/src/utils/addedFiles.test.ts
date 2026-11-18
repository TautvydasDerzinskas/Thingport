import { describe, expect, it } from "vitest";
import {
  batchesByName,
  holdsBackSliced,
  isModelFileName,
  isPreparedName,
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
    // As the server keeps the name: spaces at either end and control characters dropped.
    expect(isPreparedName(" frog.gcode \u0000")).toBe(true);
    expect(isModelFileName("A.3mf ")).toBe(true);
    // So a sliced 3MF named with a space after it goes among the model's files, as the server would take "A.3mf",
    // rather than to the attachments, where its G-code would make it the prepared print.
    const { model, supporting } = sortAddedFiles(named("A.3mf ", "B.gcode", "photo.png "), "supporting");
    expect(names(model)).toEqual(["A.3mf "]);
    expect(names(supporting)).toEqual(["B.gcode", "photo.png "]);
  });

  it("keeps any picture a model can be made of with the model files, a GIF and an SVG too", () => {
    const { model, supporting } = sortAddedFiles(named("diagram.gif", "logo.svg", "notes.pdf"), "model");
    expect(names(model)).toEqual(["diagram.gif", "logo.svg"]);
    expect(names(supporting)).toEqual(["notes.pdf"]);
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

describe("the sliced prints after one whose upload failed", () => {
  it("wait when it may be the prepared print now and none before it is sure to be", () => {
    // No answer at all, or one after the server failed: it may be in.
    expect(holdsBackSliced("A.gcode", null, false)).toBe(true);
    expect(holdsBackSliced("A.gcode.3mf", 500, false)).toBe(true);
    expect(holdsBackSliced("A.bgcode", 502, false)).toBe(true);
    // Kept by the server as "A.gcode", a sliced print all the same.
    expect(holdsBackSliced("A.gcode ", null, false)).toBe(true);
  });

  it("go on when the server turned it away, when it isn't sliced, or when one before it is in", () => {
    expect(holdsBackSliced("A.gcode", 413, false)).toBe(false);
    expect(holdsBackSliced("A.gcode", 400, false)).toBe(false);
    expect(holdsBackSliced("guide.pdf", null, false)).toBe(false);
    expect(holdsBackSliced("frog.3mf", 500, false)).toBe(false);
    // The rest are kept beside the one that's in, whatever this one did.
    expect(holdsBackSliced("A.gcode", null, true)).toBe(false);
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

  it("packs a .gltf named with a space after it, as the server keeps and packs it, and stores it as a .glb", async () => {
    const files = [scene("scene.gltf ", "scene.bin"), file("scene.bin")];
    const { model, supporting } = await withGltfFiles(sortAddedFiles(files, "model"), (each) => each);
    expect(names(model)).toEqual(["scene.gltf ", "scene.bin"]);
    expect(names(supporting)).toEqual([]);
    expect(storedModelFileName("scene.gltf ")).toBe("scene.glb");
  });

  it('takes a file named only ".gltf " for no scene, as the server does', async () => {
    const sorted = sortAddedFiles([scene(".gltf ", "mesh.bin"), file("mesh.bin")], "model");
    expect(names(sorted.model)).toEqual([]);
    expect(names((await withGltfFiles(sorted, (each) => each)).model)).toEqual([]);
  });

  it("names a file two of the addition could be, though the scene names it in a folder, and takes neither", async () => {
    const files = [
      scene("scene.gltf", "scene.bin", "textures/base.png"),
      file("scene.bin"),
      file("base.png", "one"),
      file("base.png", "two"),
    ];
    const { packedWith, ambiguous } = await withGltfFiles(sortAddedFiles(files, "model"), (each) => each);
    expect(ambiguous).toEqual(["base.png"]);
    expect(names(packedWith.get(files[0]) ?? [])).toEqual(["scene.bin"]);
  });

  it("takes one file given twice as one, not as two it could be", async () => {
    const texture = file("base.png", "one");
    const files = [scene("scene.gltf", "scene.bin", "base.png"), file("scene.bin"), texture, texture];
    const { packedWith, ambiguous } = await withGltfFiles(sortAddedFiles(files, "model"), (each) => each);
    expect(ambiguous).toEqual([]);
    expect(names(packedWith.get(files[0]) ?? [])).toEqual(["scene.bin", "base.png"]);
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
