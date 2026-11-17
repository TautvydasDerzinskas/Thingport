import { beforeEach, describe, expect, it, vi } from "vitest";
import type { categoriesApi } from "../api/categories";
import type { Print, printsApi } from "../api/prints";

const upload = vi.fn<typeof printsApi.upload>();
const addPreviewImages = vi.fn<typeof printsApi.addPreviewImages>();
vi.mock("../api/prints", () => ({ printsApi: { upload, addPreviewImages } }));
vi.mock("../api/categories", () => ({
  categoriesApi: {
    list: vi.fn<typeof categoriesApi.list>(async () => []),
    create: vi.fn<(name: string) => Promise<{ id: string }>>(async (name) => ({ id: `category-${name}` })),
  },
}));

const { gltfBundles, hasModelFolders, uploadEntriesAsOneModel, uploadEntriesToCategory, uploadFoldersAsModels } =
  await import("./uploadTree");

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

/** A model as the server answers with one. */
const printOf = (id: string): Print => ({
  id,
  name: id,
  tags: [],
  created_at: "2026-11-17T00:00:00Z",
  plates: [],
  preview_images: [],
  supporting_file_count: 0,
  view_count: 0,
  print_count: 0,
  is_favorite: false,
});

const namesSent = () => upload.mock.calls.map(([files]) => (files as File[]).map((file) => file.name));

beforeEach(() => {
  upload.mockReset();
  upload.mockImplementation(async () => ({ prints: [printOf(`print-${upload.mock.calls.length}`)] }));
  addPreviewImages.mockReset();
  addPreviewImages.mockImplementation(async (id) => ({ print: printOf(id) }));
});

const foldersSent = () => upload.mock.calls.map(([, opts]) => opts?.folders);

describe("gltfBundles", () => {
  it("finds the .bin and textures a .gltf points at, by path from its folder", async () => {
    const entries = laptop();
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual([
      "Laptop/scene.bin",
      "Laptop/textures/base.png",
    ]);
  });

  it("follows ../ and URL-encoded names, and falls back to a name only one file in its folder has", async () => {
    const entries = [
      entry("Pack/Model/scene.gltf", gltf("../shared/geo%20data.bin", "elsewhere/base.png")),
      entry("Pack/shared/geo data.bin"),
      entry("Pack/Model/pictures/base.png"),
    ];
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual([
      "Pack/shared/geo data.bin",
      "Pack/Model/pictures/base.png",
    ]);
  });

  it("doesn't take a file of the same name from another model's folder", async () => {
    const entries = [entry("A/scene.gltf", gltf("scene.bin", "base.png")), entry("A/scene.bin"), entry("B/base.png")];
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual(["A/scene.bin"]);
  });

  it("falls back to a name anywhere in a flat pick, which has no folders", async () => {
    const entries = [
      entry("scene.gltf", gltf("geo/scene.bin", "textures/base.png")),
      entry("scene.bin"),
      entry("base.png"),
    ];
    const bundles = await gltfBundles(entries);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual(["scene.bin", "base.png"]);
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
    expect(namesSent()).toEqual([["base.png", "license.txt", "scene.bin", "scene.gltf"]]);
    expect(upload.mock.calls[0][1]).toMatchObject({ title: "Laptop", mode: "multiplate" });
    // normal.png isn't one of the scene's files: a picture in the model's subfolder, so one of its photos.
    expect(addPreviewImages.mock.calls.map(([, files]) => files.map((file) => file.name))).toEqual([["normal.png"]]);
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

describe("a model's documents", () => {
  it("one model per folder: a subfolder without model files is that model's, documents in their folder", async () => {
    const result = await uploadFoldersAsModels(
      [
        entry("Frog/frog.stl"),
        entry("Frog/docs/guide.pdf"),
        entry("Frog/docs/extra/notes.txt"),
        entry("Frog/photos/side.jpg"),
        entry("Loose/readme.pdf"),
      ],
      null,
    );
    expect(namesSent()).toEqual([["frog.stl", "guide.pdf", "notes.txt"]]);
    expect(foldersSent()).toEqual([[null, "docs", "docs/extra"]]);
    expect(addPreviewImages.mock.calls.map(([, files]) => files.map((file) => file.name))).toEqual([["side.jpg"]]);
    // In no model's folder, a document can't come in on its own: said, not dropped.
    expect(result.skipped).toEqual(["readme.pdf"]);
  });

  it("one model of all: model files and documents in their folders below the shared one, pictures as photos", async () => {
    const result = await uploadEntriesAsOneModel(
      [entry("Frog/body.stl"), entry("Frog/docs/guide.pdf"), entry("Frog/pics/side.png"), entry("Frog/.DS_Store")],
      "Frog",
      null,
    );
    expect(result.failed).toEqual([]);
    expect(namesSent()).toEqual([["body.stl", "guide.pdf"]]);
    expect(upload.mock.calls[0][1]).toMatchObject({ title: "Frog", mode: "multiplate", folders: [null, "docs"] });
    expect(addPreviewImages.mock.calls.map(([, files]) => files.map((file) => file.name))).toEqual([["side.png"]]);
  });

  it("one model of a zip found in a picked folder lands in that folder, made a category as the pick makes one", async () => {
    await uploadEntriesAsOneModel(
      [entry("Shelf/Kits/gear.stl"), entry("Shelf/Kits/Pins/pin.3mf")],
      "parts",
      null,
      undefined,
      "Shelf/Kits",
    );
    expect(upload.mock.calls[0][1]).toMatchObject({
      title: "parts",
      category_id: "category-Kits",
      folders: [null, "Pins"],
    });
  });

  it("one model of several picked files keeps the order they were picked in", async () => {
    await uploadEntriesAsOneModel([entry("lid.stl"), entry("box.stl"), entry("guide.pdf")], null, null);
    expect(namesSent()).toEqual([["lid.stl", "box.stl", "guide.pdf"]]);
  });

  it("one model of only pictures: they're its files, as an upload of pictures alone is", async () => {
    await uploadEntriesAsOneModel([entry("a.png"), entry("b.png")], null, null);
    expect(namesSent()).toEqual([["a.png", "b.png"]]);
    expect(addPreviewImages).not.toHaveBeenCalled();
  });

  it("one model per file: a document alone is said to need a model, not dropped in silence", async () => {
    const result = await uploadEntriesToCategory([entry("guide.pdf"), entry("part.stl")], null);
    expect(namesSent()).toEqual([["part.stl"]]);
    expect(result.skipped).toEqual(["guide.pdf"]);
  });

  it("one model of only what the OS leaves about sends nothing, and comes back", async () => {
    const result = await uploadEntriesAsOneModel([entry(".first.stl"), entry("Thumbs.db")], null, null);
    expect(upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uploaded: 0, failed: [], skipped: [] });
  });
});
