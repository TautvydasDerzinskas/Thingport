import { beforeEach, describe, expect, it, vi } from "vitest";
import type { categoriesApi } from "../api/categories";
import type { printsApi } from "../api/prints";

const upload = vi.fn<typeof printsApi.upload>();
const addPreviewImages = vi.fn<typeof printsApi.addPreviewImages>();
vi.mock("../api/prints", () => ({ printsApi: { upload, addPreviewImages } }));
vi.mock("../api/categories", () => ({
  categoriesApi: {
    list: vi.fn<typeof categoriesApi.list>(async () => []),
    create: vi.fn<(name: string) => Promise<{ id: string }>>(async (name) => ({ id: `category-${name}` })),
  },
}));

const { gltfBundles, hasModelFolders, uploadEntriesToCategory, uploadFoldersAsModels } = await import("./uploadTree");

const entry = (relativePath: string, contents: string | Uint8Array = "x") => ({
  file: new File([contents as BlobPart], relativePath.split("/").pop()!),
  relativePath,
});

const gltf = (buffer = "scene.bin", image = "textures/base.png") =>
  JSON.stringify({
    asset: { version: "2.0" },
    buffers: [{ uri: buffer, byteLength: 4 }],
    images: [{ uri: image }, { uri: "data:image/png;base64,AAAA" }, { uri: "https://example.com/x.png" }],
  });

/** What one download from a 3D site unpacks to: a scene, its geometry, its textures and the licence. */
const laptop = () => [
  entry("Laptop/scene.gltf", gltf()),
  entry("Laptop/scene.bin"),
  entry("Laptop/textures/base.png"),
  entry("Laptop/textures/normal.png"),
  entry("Laptop/license.txt"),
];

const namesSent = () => upload.mock.calls.map(([files]) => (files as File[]).map((file) => file.name));

beforeEach(() => {
  upload.mockReset();
  upload.mockImplementation(async () => ({ prints: [{ id: `print-${upload.mock.calls.length}` }] }) as never);
  addPreviewImages.mockReset();
});

describe("gltfBundles", () => {
  it("finds the .bin and textures a .gltf points at, by path from its folder", async () => {
    const entries = laptop();
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual([
      "Laptop/scene.bin",
      "Laptop/textures/base.png",
    ]);
  });

  it("follows ../ and URL-encoded names, and falls back to a name only one file has", async () => {
    const entries = [
      entry("Pack/Model/scene.gltf", gltf("../shared/geo%20data.bin", "elsewhere/base.png")),
      entry("Pack/shared/geo data.bin"),
      entry("Pack/pictures/base.png"),
    ];
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual([
      "Pack/shared/geo data.bin",
      "Pack/pictures/base.png",
    ]);
  });

  it("leaves out a texture two files could be, and a .gltf that doesn't parse", async () => {
    const entries = [
      entry("M/scene.gltf", gltf("scene.bin", "base.png")),
      entry("M/scene.bin"),
      entry("M/a/base.png"),
      entry("M/b/base.png"),
      entry("Broken/broken.gltf", "{ not json"),
    ];
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual(["M/scene.bin"]);
    expect(bundles.get(entries[4])).toEqual([]);
  });
});

describe("uploading a glTF download", () => {
  it("counts a folder holding a .gltf as a model folder", () => {
    expect(hasModelFolders(laptop())).toBe(true);
  });

  it("one model per folder: the scene goes up with its files, and its textures aren't gallery pictures", async () => {
    const result = await uploadFoldersAsModels(laptop(), null);
    expect(result.failed).toEqual([]);
    // normal.png isn't one of the scene's files, so it goes up the way any loose image in a folder does.
    expect(namesSent()).toEqual([["base.png", "license.txt", "scene.bin", "scene.gltf"], ["normal.png"]]);
    expect(upload.mock.calls[0][1]).toMatchObject({ title: "Laptop", mode: "multiplate" });
    expect(addPreviewImages).not.toHaveBeenCalled();
    expect(result.uploadedEntries).toHaveLength(5);
  });

  it("sends a file two scenes in one folder share once", async () => {
    await uploadFoldersAsModels(
      [
        entry("Lamp/on.gltf", gltf("lamp.bin", "lamp.png")),
        entry("Lamp/off.gltf", gltf("lamp.bin", "lamp.png")),
        entry("Lamp/lamp.bin"),
        entry("Lamp/lamp.png"),
      ],
      null,
    );
    expect(namesSent()).toEqual([["lamp.bin", "lamp.png", "off.gltf", "on.gltf"]]);
    expect(addPreviewImages).not.toHaveBeenCalled();
  });

  it("one model per file: the scene goes up with its files, and its textures don't become models", async () => {
    const result = await uploadEntriesToCategory(laptop(), null);
    expect(result.failed).toEqual([]);
    // license.txt can't be a model on its own; normal.png, which the scene doesn't use, can.
    expect(namesSent()).toEqual([["scene.gltf", "scene.bin", "base.png"], ["normal.png"]]);
    expect(upload.mock.calls[0][1]).toMatchObject({ mode: "multiplate" });
    expect(upload.mock.calls[1][1]).not.toHaveProperty("mode");
  });
});
