import { beforeEach, describe, expect, it, vi } from "vitest";
import type { categoriesApi as CategoriesApi } from "../api/categories";
import type { Print, printsApi } from "../api/prints";

const upload = vi.fn<typeof printsApi.upload>();
const addPreviewImages = vi.fn<typeof printsApi.addPreviewImages>();
vi.mock("../api/prints", () => ({ printsApi: { upload, addPreviewImages } }));
vi.mock("../api/categories", () => ({
  categoriesApi: {
    list: vi.fn<typeof CategoriesApi.list>(async () => []),
    create: vi.fn<typeof CategoriesApi.create>(async (name) => ({ id: `category-${name}` })),
  },
}));

const { gltfBundles, hasModelFolders, isSystemFile, uploadEntriesToCategory, uploadFoldersAsModels } =
  await import("./uploadTree");
const { buildUploadEntriesFromZip, readZipEntries, startingSelection } = await import("./zipUtils");
const { categoriesApi } = await import("../api/categories");

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

/** A model as the server answers with one: the plans only read its id. */
const printOf = (id: string): Print => ({
  id,
  name: id,
  tags: [],
  created_at: "2026-11-22T00:00:00Z",
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

// The cells of the cases table (backend/tests/intake/cases.ts) that the browser plans: the requests a folder upload, a
// pick of separate files and an unzipped zip send for the table's shapes of files, which the server then makes models
// of as the table's own cells say. Each is fed what useUploadImport feeds it: a folder pick without its system files,
// and a zip's entries as its dialog ticks them; a zip in a pick goes to that dialog, so it's only unzipped here.
// Two steps of the supporting-files work change them: the upload picker taking any file, and the server reading
// uploaded zips and planning folders, when these cells move to the backend's table.
describe("the cases the browser plans", () => {
  /** The table's shapes, by path; a nested record is a zip of those entries. */
  type Tree = { [path: string]: Tree | null };
  const SHAPES: Record<string, Tree> = {
    "1": { "Benchy.stl": null },
    "2": { "Lid.stl": null, "Base.3mf": null },
    "3": { "Frog.stl": null, "Assembly.pdf": null, "notes.txt": null },
    "4": { "Frog/frog.stl": null, "Frog/docs/guide.pdf": null, "Frog/photos/a.jpg": null, "Vase/vase.stl": null },
    "4b": {
      "Model/STL/body.stl": null,
      "Model/STL/lid.stl": null,
      "Model/Images/photo.jpg": null,
      "Model/readme.pdf": null,
    },
    "5": { "Manual.pdf": null, "readme.txt": null },
    "6": { "box.scad": null },
    "7": { "Bracket.f3d": null, "Clamp.iges": null },
    "8": { "Benchy.gcode.3mf": null, "Tower.gcode": null },
    "9": { "Benchy.stl": null, "Benchy.gcode.3mf": null, "Benchy_PLA.gcode": null, "Benchy_PETG.gcode": null },
    "10": { "photo.png": null, "art.svg": null },
    "10b": { "Vase.stl": null, "photo.jpg": null },
    "11": { "Design.zip": { "stl/body.stl": null, "source.zip": { "body.f3d": null }, "LICENSE.txt": null } },
    "12": { "scene.gltf": null, "scene.bin": null, "textures/wood.png": null },
    "13": { "Frog.stl": null, "LICENSE.txt": null },
    "14": { "Frog.stl": null, "__MACOSX/._Frog.stl": null, ".DS_Store": null, "Thumbs.db": null, "desktop.ini": null },
  };

  const contents = (path: string) => (path.endsWith(".gltf") ? gltf("scene.bin", "textures/wood.png") : path);

  async function zipOf(tree: Tree): Promise<Uint8Array<ArrayBuffer>> {
    const { strToU8, zipSync } = await import("fflate");
    const files: Record<string, Uint8Array> = {};
    for (const [path, inner] of Object.entries(tree))
      files[path] = inner ? await zipOf(inner) : strToU8(contents(path));
    return zipSync(files) as Uint8Array<ArrayBuffer>;
  }

  /** The shape's files as a pick brings them: a folder pick (any file in a folder) leaves its system files out. */
  function picked(tree: Tree) {
    const entries = Object.keys(tree).map((path) => entry(path, contents(path)));
    return entries.some((e) => e.relativePath.includes("/"))
      ? entries.filter((e) => !isSystemFile(e.file.name))
      : entries;
  }

  /** A folder upload of a shape: in a folder of its own, unless the shape is its folders. */
  const inFolder = (shape: string): Tree =>
    ["4", "4b"].includes(shape)
      ? SHAPES[shape]
      : Object.fromEntries(Object.entries(SHAPES[shape]).map(([path, inner]) => [`Design/${path}`, inner]));

  /** A zip of the shape (shape 11 is one), unzipped with every entry its dialog ticks to start with. */
  async function unzipped(shape: string) {
    const tree = shape === "11" ? (SHAPES[shape]["Design.zip"] as Tree) : SHAPES[shape];
    const zip = entry("Design.zip", await zipOf(tree));
    const { entries, data } = await readZipEntries(zip.file);
    return buildUploadEntriesFromZip(data, [...startingSelection(entries)]);
  }

  /** Each request the plan sent, in order, then what it said failed. */
  async function plan(run: () => Promise<{ failed: string[] }>) {
    const sent: string[] = [];
    upload.mockImplementation(async (files, options) => {
      const how = [
        options?.mode === "multiplate" ? "one model" : null,
        options?.title ? `titled ${options.title}` : null,
        options?.category_id ? `in ${options.category_id}` : null,
      ].filter(Boolean);
      sent.push(`upload ${files.map((file) => file.name).join(", ")}${how.length ? ` (${how.join(", ")})` : ""}`);
      return { prints: [printOf(`model ${sent.length}`)] };
    });
    addPreviewImages.mockImplementation(async (id, files) => {
      sent.push(`photos for ${id}: ${files.map((file) => file.name).join(", ")}`);
      return { print: printOf(id) };
    });
    const { failed } = await run();
    return failed.length ? [...sent, `failed: ${failed.join(", ")}`] : sent;
  }

  beforeEach(() => {
    // A folder's id is its path, so a request says where its model is filed.
    vi.mocked(categoriesApi.create).mockImplementation(async (name, _tags, parentId) => ({
      id: parentId ? `${parentId}/${name}` : name,
    }));
  });

  // "Each folder is one model" (uploadFoldersAsModels).
  // prettier-ignore
  const FOLDERS: [string, string[]][] = [
    ["1", ["upload Benchy.stl (one model, titled Design)"]],
    ["2", ["upload Base.3mf, Lid.stl (one model, titled Design)"]],
    ["3", ["upload Assembly.pdf, Frog.stl, notes.txt (one model, titled Design)"]],
    ["4", ["upload frog.stl (one model, titled Frog)", "upload vase.stl (one model, titled Vase)", "upload a.jpg (in Frog/photos)"]],
    ["4b", ["upload body.stl, lid.stl (one model, titled STL, in Model)", "upload photo.jpg (in Model/Images)"]],
    ["5", []],
    ["6", []],
    ["7", ["upload Bracket.f3d (in Design)"]],
    ["8", ["upload Benchy.gcode.3mf, Tower.gcode (one model, titled Design)"]],
    ["9", ["upload Benchy_PETG.gcode, Benchy_PLA.gcode, Benchy.gcode.3mf, Benchy.stl (one model, titled Design)"]],
    ["10", ["upload photo.png (in Design)", "upload art.svg (in Design)"]],
    ["10b", ["upload Vase.stl (one model, titled Design)", "photos for model 1: photo.jpg"]],
    ["12", ["upload scene.bin, scene.gltf, wood.png (one model, titled Design)"]],
    ["13", ["upload Frog.stl, LICENSE.txt (one model, titled Design)"]],
    ["14", ["upload Frog.stl (one model, titled Design)"]],
  ];

  // "Each model file is a separate model", or a pick of files as separate models (uploadEntriesToCategory).
  // prettier-ignore
  const FILES: [string, string[]][] = [
    ["1", ["upload Benchy.stl"]],
    ["2", ["upload Lid.stl", "upload Base.3mf"]],
    ["3", ["upload Frog.stl"]],
    ["4", ["upload frog.stl (in Frog)", "upload a.jpg (in Frog/photos)", "upload vase.stl (in Vase)"]],
    ["4b", ["upload body.stl (in Model/STL)", "upload lid.stl (in Model/STL)", "upload photo.jpg (in Model/Images)"]],
    ["5", []],
    ["6", []],
    ["7", ["upload Bracket.f3d"]],
    ["8", ["upload Benchy.gcode.3mf"]],
    ["9", ["upload Benchy.stl", "upload Benchy.gcode.3mf"]],
    ["10", ["upload photo.png", "upload art.svg"]],
    ["10b", ["upload Vase.stl", "upload photo.jpg"]],
    ["12", ["upload scene.gltf, scene.bin, wood.png (one model)"]],
    ["13", ["upload Frog.stl"]],
    ["14", ["upload Frog.stl"]],
  ];

  // "Import and unzip": the entries ticked, then a model per file (uploadEntriesToCategory).
  // prettier-ignore
  const UNZIPPED: [string, string[]][] = [
    ["1", ["upload Benchy.stl"]],
    ["2", ["upload Base.3mf", "upload Lid.stl"]],
    ["3", ["upload Frog.stl"]],
    ["5", []],
    ["6", []],
    ["7", ["upload Bracket.f3d"]],
    ["8", ["upload Benchy.gcode.3mf"]],
    ["9", ["upload Benchy.gcode.3mf", "upload Benchy.stl"]],
    ["10", ["upload art.svg", "upload photo.png"]],
    ["10b", ["upload photo.jpg", "upload Vase.stl"]],
    ["11", ["upload source.zip", "upload body.stl (in stl)"]],
    ["12", ["upload scene.gltf, scene.bin, wood.png (one model)"]],
    ["13", ["upload Frog.stl"]],
    ["14", ["upload Frog.stl"]],
  ];

  it.each(FOLDERS)("folders, shape %s", async (shape, today) => {
    expect(await plan(async () => uploadFoldersAsModels(picked(inFolder(shape)), null))).toEqual(today);
  });

  it.each(FILES)("files, shape %s", async (shape, today) => {
    expect(await plan(async () => uploadEntriesToCategory(picked(SHAPES[shape]), null))).toEqual(today);
  });

  it.each(UNZIPPED)("unzipped, shape %s", async (shape, today) => {
    expect(await plan(async () => uploadEntriesToCategory(await unzipped(shape), null))).toEqual(today);
  });
});
