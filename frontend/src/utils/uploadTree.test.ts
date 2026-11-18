import i18next from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { categoriesApi } from "../api/categories";
import { UnauthorizedError } from "../api/client";
import type { Print, printsApi } from "../api/prints";
import en from "../i18n/locales/en.json";
import lt from "../i18n/locales/lt.json";

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
    const ambiguous = new Map<(typeof entries)[number], string[]>();
    const bundles = await gltfBundles(entries, ambiguous);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual(["M/scene.bin"]);
    expect(bundles.get(entries[4])).toEqual([]);
    expect(ambiguous.get(entries[0])).toEqual(["base.png"]);
  });

  it("finds a texture in a folder whose name starts with a space, as the scene writes it", async () => {
    const scene = entry("M/scene.gltf", gltf("scene.bin", "../%20Assets/base.png"));
    const base = entry(" Assets/base.png");
    const bundles = await gltfBundles([scene, entry("M/scene.bin"), base]);
    expect(bundles.get(scene)).toContain(base);
  });

  it("finds a file by the name it's kept by only where none has it as written, and two copies of a zip's path as two", async () => {
    const scene = entry("scene.gltf", gltf("mesh.bin", "base.png"));
    const spaced = entry("mesh.bin ");
    expect((await gltfBundles([scene, spaced])).get(scene)).toEqual([spaced]);
    const exact = entry("mesh.bin");
    expect((await gltfBundles([scene, spaced, exact])).get(scene)).toEqual([exact]);
    // A zip's second "A/mesh.bin", of other bytes, numbered apart: the scene could mean either, and takes neither.
    const zipped = entry("A/scene.gltf", gltf("mesh.bin", "base.png"));
    const unclear = new Map<ReturnType<typeof entry>, string[]>();
    const bundles = await gltfBundles(
      [zipped, entry("A/mesh.bin"), { ...entry("A/mesh (2).bin"), zipPath: "A/mesh.bin" }],
      unclear,
    );
    expect(bundles.get(zipped)).toEqual([]);
    expect(unclear.get(zipped)).toEqual(["mesh.bin"]);
  });

  it("takes neither of two files at the place a scene names, as in a flat pick of two of one name", async () => {
    const entries = [entry("scene.gltf", gltf("scene.bin", "base.png")), entry("scene.bin"), entry("base.png", "one")];
    entries.push(entry("base.png", "two"));
    const ambiguous = new Map<(typeof entries)[number], string[]>();
    const bundles = await gltfBundles(entries, ambiguous);
    expect(bundles.get(entries[0])?.map((e) => e.relativePath)).toEqual(["scene.bin"]);
    expect(ambiguous.get(entries[0])).toEqual(["base.png"]);
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

  it("one model per folder: a scene's files go up in their folder below the model's, so two of one name stay apart", async () => {
    await uploadFoldersAsModels(
      [
        entry("Robot/robot.gltf", gltf("robot.bin", "textures/body.png")),
        entry("Robot/robot.bin"),
        entry("Robot/textures/body.png", "the body"),
        entry("Robot/variant.gltf", gltf("robot.bin", "variant/body.png")),
        entry("Robot/variant/body.png", "the variant"),
      ],
      null,
    );
    expect(namesSent()).toEqual([["body.png", "body.png", "robot.bin", "robot.gltf", "variant.gltf"]]);
    expect(foldersSent()).toEqual([["textures", "variant", null, null, null]]);
    // Each texture in its own folder, not swapped for the other of its name.
    const [files] = upload.mock.calls[0];
    const textures = await Promise.all(
      (files as File[]).slice(0, 2).map(async (file, index) => [await file.text(), foldersSent()[0]?.[index]]),
    );
    expect(textures).toEqual([
      ["the body", "textures"],
      ["the variant", "variant"],
    ]);
    expect(addPreviewImages).not.toHaveBeenCalled();
  });

  it("one model per folder: says where each file was in the pick, for a scene naming one outside its folder", async () => {
    await uploadFoldersAsModels(
      [entry("Pack/Model/scene.gltf", gltf("../shared/mesh.bin", "base.png")), entry("Pack/shared/mesh.bin")],
      null,
    );
    const [files, opts] = upload.mock.calls[0];
    const where = new Map((files as File[]).map((file, index) => [file.name, opts?.sourceFolders?.[index]]));
    expect(where.get("scene.gltf")).toBe("Pack/Model");
    expect(where.get("mesh.bin")).toBe("Pack/shared");
  });

  it("one model of all: says where each file was in the pick, as it keeps them below the folder they share", async () => {
    await uploadEntriesAsOneModel(
      [entry("Kit/parts/scene.gltf", gltf("../../Kit/shared/mesh.bin", "base.png")), entry("Kit/shared/mesh.bin")],
      "Kit",
      null,
    );
    const [, opts] = upload.mock.calls[0];
    expect(opts).toMatchObject({ folders: ["parts", "shared"], sourceFolders: ["Kit/parts", "Kit/shared"] });
  });

  it("leaves out a model whose scene names a file more than one picked file could be, and says which", async () => {
    await i18next.init({
      lng: "en",
      ns: ["app"],
      resources: { en: { app: en.app } },
      interpolation: { escapeValue: false },
    });
    const kit = [
      entry("Kit/scene.gltf", gltf("scene.bin", "textures/base.png")),
      entry("Kit/scene.bin"),
      entry("Kit/A/base.png"),
      entry("Kit/B/base.png"),
    ];
    const one = await uploadEntriesAsOneModel(kit, "Kit", null);
    expect(upload).not.toHaveBeenCalled();
    expect(one.failed).toEqual([expect.stringMatching(/^Kit \(base\.png .+\)$/)]);
    const each = await uploadEntriesToCategory(
      [
        entry("scene.gltf", gltf("scene.bin", "textures/base.png")),
        entry("scene.bin"),
        entry("A/base.png"),
        entry("B/base.png"),
      ],
      null,
    );
    expect(each.failed).toContainEqual(expect.stringMatching(/^scene\.gltf \(base\.png .+\)$/));
    expect(namesSent().flat()).not.toContain("scene.gltf");
  });

  it("one model per folder: leaves out a scene beside the folders whose texture is in two of them, and sends those", async () => {
    await i18next.init({
      lng: "en",
      ns: ["app"],
      resources: { en: { app: en.app } },
      interpolation: { escapeValue: false },
    });
    const result = await uploadFoldersAsModels(
      [
        entry("scene.gltf", gltf("scene.bin", "textures/base.png")),
        entry("scene.bin"),
        entry("A/a.stl"),
        entry("A/base.png"),
        entry("B/b.stl"),
        entry("B/base.png"),
      ],
      null,
    );
    // Each folder's model has taken its base.png by the time the scene goes: still, it couldn't tell which was its own.
    expect(result.failed).toContainEqual(expect.stringMatching(/^scene\.gltf \(base\.png .+\)$/));
    expect(namesSent()).toEqual([["a.stl"], ["b.stl"]]);
  });

  it("one model per file: a scene named with a space after it goes up with its files, as the server packs it", async () => {
    await uploadEntriesToCategory(
      [entry("scene.gltf ", gltf("scene.bin", "base.png")), entry("scene.bin"), entry("base.png")],
      null,
    );
    expect(namesSent()).toEqual([["scene.gltf ", "scene.bin", "base.png"]]);
  });

  it("one model per file: says where each of a scene's files was in the pick", async () => {
    await uploadEntriesToCategory(
      [
        entry("Kit/scene.gltf", gltf("left/mesh.bin", "right/mesh.bin")),
        entry("Kit/left/mesh.bin"),
        entry("Kit/right/mesh.bin"),
      ],
      null,
    );
    const [files, opts] = upload.mock.calls[0];
    expect((files as File[]).map((file) => file.name)).toEqual(["scene.gltf", "mesh.bin", "mesh.bin"]);
    expect(opts?.sourceFolders).toEqual(["Kit", "Kit/left", "Kit/right"]);
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

  it("one model of only documents: nothing goes up, and they're said to need a model, as one by one they are", async () => {
    const result = await uploadEntriesAsOneModel(
      [entry("guide.pdf"), entry("notes.txt"), entry(".DS_Store")],
      null,
      null,
    );
    expect(upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uploaded: 0, failed: [], skipped: ["guide.pdf", "notes.txt"] });
  });

  it("one model of only documents: a name with no dot is one, though it reads like an extension", async () => {
    const result = await uploadEntriesAsOneModel([entry("stl "), entry("guide.pdf")], null, null);
    expect(upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uploaded: 0, skipped: ["stl ", "guide.pdf"] });
  });

  it("one model of only what the OS leaves about sends nothing, and comes back", async () => {
    const result = await uploadEntriesAsOneModel([entry(".first.stl"), entry("Thumbs.db")], null, null);
    expect(upload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ uploaded: 0, failed: [], skipped: [] });
  });
});

describe("a model's photos", () => {
  it("names photos that failed to go up in the reader's language", async () => {
    await i18next.init({
      lng: "lt",
      ns: ["app"],
      resources: { lt: { app: lt.app } },
      interpolation: { escapeValue: false },
    });
    addPreviewImages.mockRejectedValue(new Error("Upload failed"));
    const one = await uploadEntriesAsOneModel([entry("Frog/body.stl"), entry("Frog/pics/side.png")], "Frog", null);
    expect(one.failed).toEqual(["Frog (nuotraukos)"]);
    const folders = await uploadFoldersAsModels([entry("Toad/toad.stl"), entry("Toad/side.jpg")], null);
    expect(folders.failed).toEqual(["Toad (nuotraukos)"]);
  });

  it("names a photo the gallery couldn't keep among the failures, not among those uploaded", async () => {
    addPreviewImages.mockImplementation(async (id) => ({ print: printOf(id), image_ids: ["image-1", null] }));
    const one = await uploadEntriesAsOneModel(
      [entry("Frog/body.stl"), entry("Frog/pics/side.png"), entry("Frog/pics/broken.png")],
      "Frog",
      null,
    );
    expect(one.failed).toEqual(["broken.png"]);
    expect(one.uploadedEntries.map((each) => each.relativePath)).not.toContain("Frog/pics/broken.png");
    const folders = await uploadFoldersAsModels(
      [entry("Toad/toad.stl"), entry("Toad/a.jpg"), entry("Toad/b.jpg")],
      null,
    );
    expect(folders.failed).toEqual(["b.jpg"]);
  });

  it("leave a model that went up among those uploaded, though the session ran out before its photos did", async () => {
    addPreviewImages.mockRejectedValue(new UnauthorizedError());
    const onUnauthorized = vi.fn<() => void>();
    const one = await uploadEntriesAsOneModel(
      [entry("Frog/body.stl"), entry("Frog/pics/side.png")],
      "Frog",
      null,
      onUnauthorized,
    );
    expect(one).toMatchObject({ uploaded: 1, prints: [{ id: "print-1" }] });
    // The models after it don't go up: the session is gone.
    const folders = await uploadFoldersAsModels(
      [entry("Toad/toad.stl"), entry("Toad/side.jpg"), entry("Newt/newt.stl")],
      null,
      onUnauthorized,
    );
    expect(folders).toMatchObject({ uploaded: 1, prints: [{ id: "print-2" }] });
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
  });
});
