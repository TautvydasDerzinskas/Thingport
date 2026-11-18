import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { createPrint, keepSupportingFiles, type NewPlateInput } from "../src/services/printCreation";
import {
  downloadSupportingFile,
  downloadSupportingFiles,
  fetchDesignRawFiles,
  withDesignRawFiles,
  modelFilesFromZip,
  supportingFilesFromZip,
} from "../src/services/importService";
import { replaceModelPlates } from "../src/services/modelFilesReplace";
import { modelFolderUnits } from "../src/services/modelFolders";
import { setImportSupportingFiles, setPhotosPerModel } from "../src/services/settingsService";
import {
  isSupportingImportFile,
  SUPPORTING_FILES_PER_MODEL,
  supportingImportName,
  withoutModelsSharedTop,
  type SupportingLimits,
} from "../src/services/supportingImports";
import {
  extractZipEntriesToFolderModels,
  extractZipEntriesToOneModel,
  extractZipEntriesToPrints,
} from "../src/services/zipService";
import { STORAGE } from "../src/config";

// Small limits stand in for the admin's sizes, which are megabytes: undefined leaves the setting to say.
const limits = vi.hoisted(() => ({ value: undefined as SupportingLimits | null | undefined, fail: false }));
vi.mock("../src/services/supportingImports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supportingImports")>();
  return {
    ...actual,
    supportingLimits: async () => {
      if (limits.fail) throw new Error("the settings couldn't be read");
      return limits.value !== undefined ? limits.value : actual.supportingLimits();
    },
  };
});
// The zip reader as it is, unless told otherwise: the entry named `failing` can't be read, the listing numbered
// `listFailsAt` from when it was set fails, and every entry written out is noted with where it went.
const zipReads = vi.hoisted(() => ({
  failing: null as string | null,
  listFailsAt: null as number | null,
  lists: 0,
  written: [] as { entry: string; to: string }[],
}));
vi.mock("../src/utils/zipReader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils/zipReader")>();
  return {
    ...actual,
    listZipEntries: async (...args: Parameters<typeof actual.listZipEntries>) => {
      zipReads.lists += 1;
      if (zipReads.listFailsAt !== null && zipReads.lists === zipReads.listFailsAt) {
        throw new Error("the zip couldn't be listed");
      }
      return actual.listZipEntries(...args);
    },
    extractZipEntryToFile: async (...args: Parameters<typeof actual.extractZipEntryToFile>) => {
      zipReads.written.push({ entry: args[1], to: args[2] });
      if (zipReads.failing && args[1].endsWith(zipReads.failing)) throw new Error("invalid stored block lengths");
      return actual.extractZipEntryToFile(...args);
    },
  };
});
// The next keeping of a new model's description pictures fails, once.
const pictures = vi.hoisted(() => ({ localizeFails: false }));
vi.mock("../src/services/descriptionImageService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/descriptionImageService")>();
  return {
    ...actual,
    localizeDescriptionImages: async (...args: Parameters<typeof actual.localizeDescriptionImages>) => {
      if (!pictures.localizeFails) return actual.localizeDescriptionImages(...args);
      pictures.localizeFails = false;
      throw new Error("the description's pictures couldn't be read");
    },
  };
});

const app = createApp();
let userId: string;
let token: string;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "supporting-imports-"));
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Imports", email: `supporting-imports-${Date.now()}@example.com`, password: "password123" });
  userId = res.body.user.id;
  token = res.body.token;
  // The setting's routes are an admin's.
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
});

afterEach(async () => {
  limits.value = undefined;
  limits.fail = false;
  pictures.localizeFails = false;
  zipReads.failing = null;
  zipReads.listFailsAt = null;
  zipReads.written = [];
  await prisma.setting.deleteMany({ where: { key: "import_supporting_files" } });
});

const temp = (name: string, contents: string | Buffer) => {
  const p = path.join(fs.mkdtempSync(path.join(dir, "f-")), name);
  fs.writeFileSync(p, contents);
  return p;
};
const input = (name: string, contents: string | Buffer, extra: Partial<NewPlateInput> = {}): NewPlateInput => ({
  filename: name,
  tempFilePath: temp(name, contents),
  ...extra,
});
const zipOf = async (files: Record<string, string | Buffer>) => {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
  const p = path.join(fs.mkdtempSync(path.join(dir, "z-")), "model.zip");
  fs.writeFileSync(p, await zip.generateAsync({ type: "nodebuffer" }));
  return p;
};
// A glTF scene of one triangle, its buffer in `bin`, and a texture at `image` when given.
const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
const gltfScene = (bin: string, image?: string) =>
  JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: bin, byteLength: positions.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    ...(image ? { images: [{ uri: image }] } : {}),
  });
const filesOf = async (printId: string) =>
  (await prisma.printFile.findMany({ where: { printId }, orderBy: [{ folder: "asc" }, { filename: "asc" }] })).map(
    (file) => [file.folder, file.filename, file.role],
  );
const remove = (inputs: NewPlateInput[]) => inputs.forEach((each) => fs.rmSync(each.tempFilePath!, { force: true }));

describe("which of a site's files a model keeps beside it", () => {
  it("keeps documents, sources and sliced files, and none of what a plate takes, pictures, scenes or programs", () => {
    for (const name of ["guide.pdf", "notes.txt", "parts.csv", "README", "sliced.gcode", "lid.f3d", "docs/a.md"]) {
      expect([name, isSupportingImportFile(name)]).toEqual([name, true]);
    }
    for (const name of ["body.stl", "lid.step", "model.scad", "all.zip", "photo.png", "scene.fbx", "setup.exe"]) {
      expect([name, isSupportingImportFile(name)]).toEqual([name, false]);
    }
    for (const name of [".DS_Store", "._guide.pdf", "Thumbs.db"]) expect(isSupportingImportFile(name)).toBe(false);
  });

  it("places a document beside the model's files, keeping what of its folder isn't theirs", () => {
    const placed = withoutModelsSharedTop([
      { folder: "Frog/STL" },
      { folder: "Frog/STL" },
      { folder: "Frog/docs", supporting: true },
      { folder: "Frog/STL", supporting: true },
      { folder: null, supporting: true },
    ]);
    expect(placed.map((file) => file.folder)).toEqual([null, null, "docs", null, null]);
  });

  it("names a site's own licence at the top so it sits beside the LICENSE.txt Thingport writes", () => {
    expect(supportingImportName("LICENSE.txt", null)).toBe("LICENSE (original).txt");
    expect(supportingImportName("license.txt", undefined)).toBe("LICENSE (original).txt");
    expect(supportingImportName("LICENSE.txt", "docs")).toBe("LICENSE.txt");
  });
});

describe("a model made with a site's other files", () => {
  it("makes plates of its own files only, and keeps the rest as supporting files, once each", async () => {
    const inputs = [
      input("body.stl", "solid body endsolid"),
      input("guide.pdf", "%PDF-1.4 guide", { supporting: true, folder: "docs" }),
      input("guide.pdf", "%PDF-1.4 the same again", { supporting: true, folder: "docs" }),
      // Sliced for the designer's printer: kept, not the owner's prepared print.
      input("sliced.gcode", "; sliced\nG28\n", { supporting: true }),
      input("LICENSE.txt", "MIT", { supporting: true }),
    ];
    const { print, plates } = await createPrint(userId, { title: "Kept" }, "Kept", inputs);
    remove(inputs);
    expect(plates.map((plate) => plate.filename)).toEqual(["body.stl"]);
    expect(await filesOf(print.id)).toEqual([
      ["docs", "guide.pdf", "SUPPORTING"],
      [null, "LICENSE (original).txt", "SUPPORTING"],
      [null, "sliced.gcode", "SUPPORTING"],
    ]);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedFileId).toBeNull();
  });

  it("keeps the model when what it keeps can't be read, and none of the site's other files", async () => {
    const inputs = [
      input("body.stl", "solid body endsolid"),
      input("guide.pdf", "%PDF-1.4 guide", { supporting: true }),
    ];
    // The read of what the model keeps already, which its allowance starts from, fails once.
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    let failed = false;
    const spy = vi.spyOn(prisma.printFile, "findMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      const select = args?.select as { size?: boolean } | undefined;
      if (!failed && select?.size) {
        failed = true;
        return Promise.reject(new Error("the database went away for a moment"));
      }
      return findMany(args);
    }) as never);
    let made: Awaited<ReturnType<typeof createPrint>>;
    try {
      made = await createPrint(userId, { title: "Unread" }, "Unread", inputs);
    } finally {
      spy.mockRestore();
      remove(inputs);
    }
    expect(failed).toBe(true);
    expect(made.plates.map((plate) => plate.filename)).toEqual(["body.stl"]);
    expect(await filesOf(made.print.id)).toEqual([]);
  });

  it("keeps none when an admin turned them off, and only what the limits allow otherwise", async () => {
    await setImportSupportingFiles("off");
    const off = [input("a.stl", "solid a endsolid"), input("guide.pdf", "%PDF", { supporting: true })];
    expect(await filesOf((await createPrint(userId, { title: "Off" }, "Off", off)).print.id)).toEqual([]);
    remove(off);

    // Ten bytes a file, fifteen in all: the big one is left out, and the third doesn't fit beside the second.
    limits.value = { perFile: 10, perModel: 15 };
    const capped = [
      input("a.stl", "solid a endsolid"),
      input("big.txt", "x".repeat(11), { supporting: true }),
      input("one.txt", "x".repeat(8), { supporting: true }),
      input("two.txt", "x".repeat(8), { supporting: true }),
    ];
    const { print } = await createPrint(userId, { title: "Capped" }, "Capped", capped);
    remove(capped);
    expect((await filesOf(print.id)).map(([, name]) => name)).toEqual(["one.txt"]);
  });

  it("keeps no more files beside a model than it may have, however small they are", async () => {
    const made = [input("c.stl", "solid c endsolid")];
    const { print } = await createPrint(userId, { title: "Many" }, "Many", made);
    remove(made);
    const many = Array.from({ length: SUPPORTING_FILES_PER_MODEL + 5 }, (_, index) =>
      input(`note-${index}.txt`, "x", { supporting: true }),
    );
    expect(await keepSupportingFiles(userId, print.id, many)).toBe(SUPPORTING_FILES_PER_MODEL);
    remove(many);
    expect(await prisma.printFile.count({ where: { printId: print.id, role: "SUPPORTING" } })).toBe(
      SUPPORTING_FILES_PER_MODEL,
    );
  });

  it("counts what a model keeps already against its limit, when a later profile brings more", async () => {
    limits.value = { perFile: 10, perModel: 25 };
    const made = [
      input("a.stl", "solid a endsolid"),
      input("one.txt", "x".repeat(10), { supporting: true }),
      input("two.txt", "x".repeat(10), { supporting: true }),
    ];
    const { print } = await createPrint(userId, { title: "Later" }, "Later", made);
    remove(made);
    const later = [input("three.txt", "x".repeat(10), { supporting: true })];
    expect(await keepSupportingFiles(userId, print.id, later)).toBe(0);
    remove(later);
    expect((await filesOf(print.id)).map(([, name]) => name)).toEqual(["one.txt", "two.txt"]);
  });

  it("keeps to a model's limit when two imports bring its files at once", async () => {
    const made = [input("b.stl", "solid b endsolid")];
    const { print } = await createPrint(userId, { title: "At once" }, "At once", made);
    remove(made);
    limits.value = { perFile: 10, perModel: 15 };
    const first = [input("one.txt", "x".repeat(10), { supporting: true })];
    const second = [input("two.txt", "x".repeat(10), { supporting: true })];
    const kept = await Promise.all([
      keepSupportingFiles(userId, print.id, first),
      keepSupportingFiles(userId, print.id, second),
    ]);
    remove([...first, ...second]);
    expect(kept.toSorted()).toEqual([0, 1]);
    expect(await prisma.printFile.count({ where: { printId: print.id } })).toBe(1);
  });

  it("brings a supporting file back on a repair, where it went with the plates", async () => {
    const made = [input("hook.stl", "solid hook endsolid"), input("guide.pdf", "%PDF one", { supporting: true })];
    const { print } = await createPrint(userId, { title: "Repaired" }, "Repaired", made);
    remove(made);
    const guide = await prisma.printFile.findFirstOrThrow({ where: { printId: print.id, filename: "guide.pdf" } });
    fs.rmSync(path.join(STORAGE, guide.storagePath));

    const again = [input("hook.stl", "solid hook endsolid"), input("guide.pdf", "%PDF one", { supporting: true })];
    await replaceModelPlates(userId, print.id, again);
    remove(again);
    const back = await prisma.printFile.findFirstOrThrow({ where: { printId: print.id, filename: "guide.pdf" } });
    expect(fs.existsSync(path.join(STORAGE, back.storagePath))).toBe(true);
    expect(await prisma.printFile.count({ where: { printId: print.id } })).toBe(1);
  });
});

describe("one model of a zip from a link", () => {
  /** A 3MF a slicer wrote: its plate's G-code inside. */
  const sliced3mf = async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      '<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
    );
    zip.file("Metadata/plate_1.gcode", "; printer_model = Bambu Lab P1S\nG28\n");
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const plateNames = (print: { plates: { filename: string }[] }) => print.plates.map((plate) => plate.filename);

  it("keeps a sliced 3MF beside the model's files as a supporting file, and prints from one that's alone", async () => {
    const zip = await zipOf({ "body.stl": "solid body endsolid", "body.gcode.3mf": await sliced3mf() });
    const [beside] = (await extractZipEntriesToOneModel(userId, zip, "kit.zip", ["body.stl", "body.gcode.3mf"], {}))
      .prints;
    expect(plateNames(beside)).toEqual(["body.stl"]);
    expect(await filesOf(beside.id)).toEqual([[null, "body.gcode.3mf", "SUPPORTING"]]);
    const alone = await zipOf({ "job.gcode.3mf": await sliced3mf() });
    const [only] = (await extractZipEntriesToOneModel(userId, alone, "job.zip", ["job.gcode.3mf"], {})).prints;
    expect(plateNames(only)).toEqual(["job.gcode.3mf"]);
  });

  it("makes a model of a design or a picture with no model file, but none of documents alone", async () => {
    for (const [name, contents] of [
      ["cut.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>"],
      ["spin.gif", "GIF89a"],
    ]) {
      const zip = await zipOf({ [name]: contents, "notes.txt": "cut at 3 mm" });
      const [made] = (await extractZipEntriesToOneModel(userId, zip, "kit.zip", [name, "notes.txt"], {})).prints;
      expect(plateNames(made)).toEqual([name]);
      expect(await filesOf(made.id)).toEqual([[null, "notes.txt", "SUPPORTING"]]);
    }
    const documents = await zipOf({ "notes.txt": "nothing to print" });
    await expect(extractZipEntriesToOneModel(userId, documents, "notes.zip", ["notes.txt"], {})).rejects.toThrow(
      "None of the picked files can be a model",
    );
  });

  it("packs a glTF scene with the files it points at into one .glb, as an upload does", async () => {
    const texture = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#808080" } })
      .png()
      .toBuffer();
    const scene = gltfScene("mesh.bin", "textures/skin.png");
    const names = ["Frog/scene.gltf", "Frog/mesh.bin", "Frog/textures/skin.png", "Frog/notes.txt"];
    const zip = await zipOf({
      [names[0]]: scene,
      [names[1]]: positions,
      [names[2]]: texture,
      [names[3]]: "print upright",
    });
    const [made] = (await extractZipEntriesToOneModel(userId, zip, "frog.zip", names, {})).prints;
    expect(plateNames(made)).toEqual(["scene.glb"]);
    // Its buffer and texture are inside it, neither a supporting file nor a photo.
    expect(await filesOf(made.id)).toEqual([[null, "notes.txt", "SUPPORTING"]]);
    expect(made.previewImages.filter((image) => !image.generated)).toEqual([]);
    const glb = fs.readFileSync(path.join(STORAGE, made.plates[0].storagePath));
    expect(glb.subarray(0, 4).toString()).toBe("glTF");
  });

  it("keeps the model and says so when a step after it's stored fails", async () => {
    const zip = await zipOf({ "solo.stl": "solid solo endsolid" });
    pictures.localizeFails = true;
    const { prints } = await extractZipEntriesToOneModel(userId, zip, "solo.zip", ["solo.stl"], {});
    expect(pictures.localizeFails).toBe(false);
    expect(plateNames(prints[0])).toEqual(["solo.stl"]);
    expect(await prisma.print.count({ where: { id: prints[0].id } })).toBe(1);
  });
});

describe("a site's zip", () => {
  const kit = {
    "Frog/STL/body.stl": "solid body endsolid",
    "Frog/STL/notes.txt": "print upright",
    "Frog/docs/guide.pdf": "%PDF-1.4 guide",
    "Frog/photo.png": "not really a png",
    "Frog/scene.fbx": "a scene",
    "LICENSE.txt": "MIT",
  };

  it("gives its other files where its model files are, beside them, and leaves pictures and scenes out", async () => {
    const zip = await zipOf(kit);
    const plates = await modelFilesFromZip(zip);
    const supporting = await supportingFilesFromZip(zip);
    remove([...plates, ...supporting]);
    expect(plates.map((each) => [each.folder ?? null, each.filename])).toEqual([[null, "body.stl"]]);
    expect(supporting.map((each) => [each.folder ?? null, each.filename, each.supporting])).toEqual([
      [null, "notes.txt", true],
      ["docs", "guide.pdf", true],
      [null, "LICENSE.txt", true],
    ]);
  });

  it("opens a zip that only wraps the model's own, for its other files as for its model files", async () => {
    const inner = fs.readFileSync(await zipOf(kit));
    const zip = await zipOf({ "Frog.zip": inner });
    const supporting = await supportingFilesFromZip(zip);
    remove(supporting);
    expect(supporting.map((each) => each.filename).toSorted()).toEqual(["LICENSE.txt", "guide.pdf", "notes.txt"]);
    // And the files beside the archive it wraps, kept with them.
    const beside = await supportingFilesFromZip(await zipOf({ "Frog.zip": inner, "Read me first.pdf": "%PDF-1.4" }));
    remove(beside);
    expect(beside.map((each) => each.filename).toSorted()).toEqual([
      "LICENSE.txt",
      "Read me first.pdf",
      "guide.pdf",
      "notes.txt",
    ]);
  });

  it("places the other files of a zip wrapped twice where it places its model files", async () => {
    const inner = fs.readFileSync(await zipOf({ "frog.stl": "solid frog endsolid", "docs/guide.pdf": "%PDF-1.4" }));
    const middle = fs.readFileSync(await zipOf({ "C.zip": inner }));
    const zip = await zipOf({ "B.zip": middle });
    const plates = await modelFilesFromZip(zip);
    const supporting = await supportingFilesFromZip(zip);
    remove([...plates, ...supporting]);
    expect(plates.map((each) => [each.folder ?? null, each.filename])).toEqual([[null, "frog.stl"]]);
    expect(supporting.map((each) => [each.folder ?? null, each.filename])).toEqual([["docs", "guide.pdf"]]);
  });

  it("keeps the files of zips beside the model's own zip apart, each in its zip's folder", async () => {
    const frog = fs.readFileSync(await zipOf({ "frog.stl": "solid frog endsolid" }));
    const a = fs.readFileSync(await zipOf({ "guide.pdf": "%PDF-1.4 a" }));
    const b = fs.readFileSync(await zipOf({ "guide.pdf": "%PDF-1.4 b" }));
    const supporting = await supportingFilesFromZip(await zipOf({ "Frog.zip": frog, "A.zip": a, "B.zip": b }));
    remove(supporting);
    expect(supporting.map((each) => [each.folder ?? null, each.filename]).toSorted()).toEqual([
      ["A", "guide.pdf"],
      ["B", "guide.pdf"],
    ]);
  });

  it("keeps the files read before one of a zip's that can't be read, and skips that one", async () => {
    const zip = await zipOf({ "a.stl": "solid a endsolid", "guide.pdf": "%PDF-1.4", "broken.txt": "unreadable" });
    zipReads.failing = "broken.txt";
    const supporting = await supportingFilesFromZip(zip);
    remove(supporting);
    expect(supporting.map((each) => each.filename)).toEqual(["guide.pdf"]);
  });

  it("removes the files it wrote out when the zip can't be listed after them", async () => {
    // The first listing finds the files to keep; the next, for whether the zip only wraps another, fails.
    const inner = fs.readFileSync(await zipOf({ "a.stl": "solid a endsolid" }));
    const zip = await zipOf({ "Docs.zip": inner, "guide.pdf": "%PDF-1.4" });
    zipReads.lists = 0;
    zipReads.listFailsAt = 2;
    expect(await supportingFilesFromZip(zip)).toEqual([]);
    const written = zipReads.written.filter((each) => each.entry === "guide.pdf");
    expect(written).toHaveLength(1);
    expect(fs.existsSync(written[0].to)).toBe(false);
  });

  it("opens no zip a model's files are in once it keeps all the files beside it that it may", async () => {
    const many = Object.fromEntries(
      Array.from({ length: SUPPORTING_FILES_PER_MODEL }, (_, index) => [`notes/${index}.txt`, "x"]),
    );
    const frog = fs.readFileSync(await zipOf({ "frog.stl": "solid frog endsolid", "guide.pdf": "%PDF-1.4" }));
    const supporting = await supportingFilesFromZip(await zipOf({ ...many, "Frog.zip": frog }));
    remove(supporting);
    expect(supporting).toHaveLength(SUPPORTING_FILES_PER_MODEL);
    expect(zipReads.written.some((each) => each.entry === "Frog.zip")).toBe(false);
  });

  it("writes out no more of a zip's files than a model may keep beside it, however small they are", async () => {
    const many = Object.fromEntries(
      Array.from({ length: SUPPORTING_FILES_PER_MODEL + 20 }, (_, index) => [`notes/${index}.txt`, "x"]),
    );
    const supporting = await supportingFilesFromZip(await zipOf({ "a.stl": "solid a endsolid", ...many }));
    remove(supporting);
    expect(supporting).toHaveLength(SUPPORTING_FILES_PER_MODEL);
  });

  it("opens a zip beside a script for the files beside its model files, as it does for those", async () => {
    const parts = fs.readFileSync(await zipOf({ "part.stl": "solid part endsolid", "guide.pdf": "%PDF-1.4 guide" }));
    const zip = await zipOf({ "source.scad": "cube(10);", "parts.zip": parts });
    const plates = await modelFilesFromZip(zip);
    const supporting = await supportingFilesFromZip(zip);
    remove([...plates, ...supporting]);
    expect(plates.map((each) => [each.folder ?? null, each.filename])).toEqual([["parts", "part.stl"]]);
    expect(supporting.map((each) => [each.folder ?? null, each.filename])).toEqual([["parts", "guide.pdf"]]);
  });

  it("doesn't open a zip beside the model's files for them, and keeps no more than the limits allow", async () => {
    const zip = await zipOf({ "a.stl": "solid a endsolid", "docs.zip": fs.readFileSync(await zipOf(kit)) });
    expect(await supportingFilesFromZip(zip)).toEqual([]);

    limits.value = { perFile: 14, perModel: 1000 };
    const capped = await supportingFilesFromZip(await zipOf(kit));
    remove(capped);
    // guide.pdf is fourteen bytes and fits; nothing past that.
    expect(capped.map((each) => each.filename).toSorted()).toEqual(["LICENSE.txt", "guide.pdf", "notes.txt"]);
    limits.value = { perFile: 5, perModel: 1000 };
    const smaller = await supportingFilesFromZip(await zipOf(kit));
    remove(smaller);
    expect(smaller.map((each) => each.filename)).toEqual(["LICENSE.txt"]);
  });
});

describe("a file a site gives beside a model's own", () => {
  const site = (hostname: string) => hostname === "example.com";
  const originalFetch = global.fetch;
  const served = (files: Record<string, string | Buffer>) => {
    const fetchMock = vi.fn<(target: string | URL | Request) => Promise<Response>>(async (target) => {
      const body = files[new URL(String(target instanceof Request ? target.url : target)).pathname];
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body, { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };
  const named = (inputs: NewPlateInput[]) =>
    inputs.map((each) => [each.folder ?? null, each.filename, each.supporting]);
  const at = (name: string) => ({ url: `https://example.com/${name}`, name });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps a document, and of a zip only the files beside its model files, never more plates", async () => {
    const zip = await new JSZip()
      .file("Frog/frog.stl", "solid frog")
      .file("Frog/docs/guide.pdf", "%PDF-1.4")
      .file("Frog/side.png", "png")
      .generateAsync({ type: "nodebuffer" });
    const cut = await new JSZip().file("frog.dxf", "0\nSECTION").generateAsync({ type: "nodebuffer" });
    served({
      "/guide.pdf": "%PDF-1.4",
      "/README": "print the lid first",
      "/all.zip": zip,
      "/dxf.zip": cut,
      "/frog.stl": "solid frog",
    });
    expect(named(await downloadSupportingFile(at("guide.pdf"), site))).toEqual([[null, "guide.pdf", true]]);
    expect(named(await downloadSupportingFile(at("README"), site))).toEqual([[null, "README", true]]);
    expect(named(await downloadSupportingFile(at("all.zip"), site))).toEqual([["docs", "guide.pdf", true]]);
    // A zip of a format the site offers the model in besides: its cut file, as a supporting one.
    expect(named(await downloadSupportingFile(at("dxf.zip"), site))).toEqual([[null, "frog.dxf", true]]);
    // A model file asked for this way stays out: the model's own files come another way.
    expect(await downloadSupportingFile(at("frog.stl"), site)).toEqual([]);
  });

  it("gives none, never failing the import, when the admin's limits can't be read", async () => {
    served({ "/guide.pdf": "%PDF-1.4" });
    limits.fail = true;
    expect(await downloadSupportingFile(at("guide.pdf"), site)).toEqual([]);
  });

  it("opens a zip larger than one file may be, for files in it that each fit", async () => {
    const zip = await new JSZip()
      .file("a.txt", "a".repeat(60))
      .file("b.txt", "b".repeat(60))
      .generateAsync({ type: "nodebuffer" });
    expect(zip.length).toBeGreaterThan(100);
    served({ "/docs.zip": zip });
    limits.value = { perFile: 100, perModel: 1000 };
    const kept = await downloadSupportingFile(at("docs.zip"), site);
    remove(kept);
    expect(kept.map((each) => each.filename).toSorted()).toEqual(["a.txt", "b.txt"]);
  });

  it("holds a design's raw files, fetched for its supporting files alone, to what a model may keep of them", async () => {
    const zip = await new JSZip()
      .file("frog.stl", "solid frog ".repeat(40))
      .file("frog.scad", "cube(1);")
      .file("guide.pdf", "%PDF-1.4")
      .generateAsync({ type: "nodebuffer" });
    served({ "/raw.zip": zip });
    const raw = "https://example.com/raw.zip";
    limits.value = { perFile: 100, perModel: zip.length - 1 };
    expect(await fetchDesignRawFiles({ supportingZipUrl: raw })).toEqual({ sources: [], supporting: [] });
    limits.value = { perFile: 100, perModel: zip.length + 100 };
    const kept = (await fetchDesignRawFiles({ supportingZipUrl: raw })).supporting;
    remove(kept);
    expect(kept.map((each) => each.filename)).toEqual(["guide.pdf"]);
    // Fetched for the scripts it holds as well, it may be as large as any download.
    limits.value = { perFile: 100, perModel: zip.length - 1 };
    const both = await fetchDesignRawFiles({
      parametricSource: { filenames: ["frog.scad"], withheld: false, zipUrl: raw },
      supportingZipUrl: raw,
    });
    remove([...both.sources, ...both.supporting]);
    expect(both.sources.map((each) => each.filename)).toEqual(["frog.scad"]);
    expect(both.supporting.map((each) => each.filename)).toEqual(["guide.pdf"]);
  });

  it("fetches a site's files one at a time, and none once what a model keeps of them is taken", async () => {
    let inFlight = 0;
    let most = 0;
    const asked: string[] = [];
    global.fetch = (async (target: string | URL | Request) => {
      asked.push(new URL(String(target instanceof Request ? target.url : target)).pathname);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return new Response("x".repeat(60), { status: 200 });
    }) as typeof fetch;
    // Sixty bytes a file and a hundred and twenty in all: two fill it.
    limits.value = { perFile: 100, perModel: 120 };
    const kept = await downloadSupportingFiles([at("a.pdf"), at("b.pdf"), at("c.pdf"), at("d.pdf")], site);
    remove(kept);
    expect(kept.map((each) => each.filename)).toEqual(["a.pdf", "b.pdf"]);
    expect(asked).toEqual(["/a.pdf", "/b.pdf"]);
    expect(most).toBe(1);
    // With room for less than a file, one that doesn't fit what's left is skipped, and counts for nothing.
    limits.value = { perFile: 100, perModel: 150 };
    asked.length = 0;
    const roomy = await downloadSupportingFiles([at("a.pdf"), at("b.pdf"), at("c.pdf")], site);
    remove(roomy);
    expect(roomy.map((each) => each.filename)).toEqual(["a.pdf", "b.pdf"]);
    expect(asked).toEqual(["/a.pdf", "/b.pdf", "/c.pdf"]);
  });

  it("fetches a design's scripts where its raw files gave the files beside the model but no script", async () => {
    const scripts = await new JSZip()
      .file("frog.scad", "cube(1);")
      .file("guide.pdf", "%PDF-1.4 again")
      .file("notes.txt", "print upright")
      .generateAsync({ type: "nodebuffer" });
    served({ "/scripts.zip": scripts });
    const meta = {
      parametricSource: { filenames: ["frog.scad"], withheld: false, zipUrl: "https://example.com/scripts.zip" },
      supportingZipUrl: "https://example.com/raw.zip",
    };
    const given = [input("guide.pdf", "%PDF-1.4", { supporting: true })];
    const { sources, supporting } = await withDesignRawFiles(meta, [], given);
    remove([...sources, ...supporting]);
    expect(sources.map((each) => each.filename)).toEqual(["frog.scad"]);
    // The guide the raw files gave stays, and the scripts' zip adds only what they didn't.
    expect(supporting.map((each) => each.filename)).toEqual(["guide.pdf", "notes.txt"]);
    expect(supporting[0]).toBe(given[0]);
    // With scripts already, nothing is fetched.
    const fetchMock = served({});
    const script = [input("frog.scad", "cube(1);")];
    expect(await withDesignRawFiles(meta, script, given)).toEqual({ sources: script, supporting: given });
    remove([...script, ...given]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips what isn't on the site's hosts, what fails, what's over the limit, and asks nothing when kept off", async () => {
    const fetchMock = served({ "/guide.pdf": "%PDF-1.4 a longer guide" });
    expect(await downloadSupportingFile({ url: "https://example.org/guide.pdf", name: "guide.pdf" }, site)).toEqual([]);
    expect(await downloadSupportingFile(at("missing.pdf"), site)).toEqual([]);
    limits.value = { perFile: 8, perModel: 20 };
    expect(await downloadSupportingFile(at("guide.pdf"), site)).toEqual([]);
    limits.value = null;
    fetchMock.mockClear();
    expect(await downloadSupportingFile(at("guide.pdf"), site)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a zip from a link, by how its files become models", () => {
  let photo: Buffer;
  beforeAll(async () => {
    photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0a0" } })
      .png()
      .toBuffer();
  });
  const tree = () => ({
    "Kit/A/a.stl": "solid a endsolid",
    "Kit/A/docs/guide.pdf": "%PDF-1.4 guide",
    "Kit/A/side.png": photo,
    "Kit/B/b.stl": "solid b endsolid",
    "Kit/loose.stl": "solid loose endsolid",
    "Kit/readme.pdf": "%PDF-1.4 readme",
  });

  it("one model: every picked file, model files as plates, pictures as photos and the rest beside them", async () => {
    const zip = await zipOf(tree());
    const { prints, failed } = await extractZipEntriesToOneModel(userId, zip, "Kit.zip", Object.keys(tree()), {});
    expect(failed).toEqual([]);
    const [model] = prints;
    expect(model.title).toBe("Kit");
    expect(model.plates.map((plate) => [plate.folder, plate.filename])).toEqual([
      ["A", "a.stl"],
      ["B", "b.stl"],
      [null, "loose.stl"],
    ]);
    expect(await filesOf(model.id)).toEqual([
      ["A/docs", "guide.pdf", "SUPPORTING"],
      [null, "readme.pdf", "SUPPORTING"],
    ]);
    expect(model.previewImages.length).toBeGreaterThanOrEqual(1);
  });

  it("one model of a script and pictures is a model of its pictures, the script kept beside them", async () => {
    const files = { "design.scad": "cube(10);", "preview.png": photo };
    const { prints } = await extractZipEntriesToOneModel(
      userId,
      await zipOf(files),
      "Design.zip",
      Object.keys(files),
      {},
    );
    expect(prints[0].plates.map((plate) => plate.filename)).toEqual(["preview.png"]);
    expect(await filesOf(prints[0].id)).toEqual([[null, "design.scad", "SUPPORTING"]]);
  });

  it("one model keeps no more of a zip's pictures than the admin's photos per model", async () => {
    const files = { "a.stl": "solid a endsolid", "one.png": photo, "two.png": photo, "three.png": photo };
    await setPhotosPerModel(1);
    try {
      const { prints } = await extractZipEntriesToOneModel(
        userId,
        await zipOf(files),
        "Few.zip",
        Object.keys(files),
        {},
      );
      expect(prints[0].previewImages).toHaveLength(1);
    } finally {
      await setPhotosPerModel(null);
    }
  });

  it("one model leaves a picked zip inside the zip unopened, and says so", async () => {
    const files = { ...tree(), "Kit/parts.zip": fs.readFileSync(await zipOf({ "p.stl": "solid p endsolid" })) };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToOneModel(userId, zip, "Kit.zip", Object.keys(files), {});
    expect(failed).toEqual(["Kit/parts.zip"]);
    expect(prints[0].plates.map((plate) => plate.filename)).toEqual(["a.stl", "b.stl", "loose.stl"]);
  });

  it("leaves no temp files behind when the disk fills partway through reading the picked files", async () => {
    const zip = await zipOf(tree());
    const real = fs.promises.writeFile.bind(fs.promises);
    const tried: string[] = [];
    const write = vi.spyOn(fs.promises, "writeFile").mockImplementation(async (file, data, options) => {
      if (typeof file === "string" && path.basename(file).startsWith("thingport-zip-")) {
        tried.push(file);
        if (tried.length === 2) {
          await real(file, "partial");
          throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
        }
      }
      return real(file, data, options);
    });
    try {
      await expect(extractZipEntriesToOneModel(userId, zip, "Kit.zip", Object.keys(tree()), {})).rejects.toThrow(
        "no space left",
      );
    } finally {
      write.mockRestore();
    }
    expect(tried).toHaveLength(2);
    expect(tried.filter((file) => fs.existsSync(file))).toEqual([]);
  });

  it("one model of documents alone is refused: there's nothing in them to print", async () => {
    const zip = await zipOf(tree());
    await expect(extractZipEntriesToOneModel(userId, zip, "Kit.zip", ["Kit/readme.pdf"], {})).rejects.toThrow(
      /None of the picked files can be a model/,
    );
  });

  it("a model per folder: each folder with model files, its subfolders' documents with it, the rest per file", async () => {
    // Beside the tree, at the top: in no folder, so each is a model of its own, as a model per file makes it.
    const files = { ...tree(), "top.stl": "solid top endsolid", "top.pdf": "%PDF-1.4 top" };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    // Kit holds a model file itself (loose.stl), so it's a model too, with its readme. By title: Kit is at the top,
    // beside the models other tests here named Kit, so its name is made unique.
    expect(prints.map((print) => print.title ?? print.name).toSorted()).toEqual(["A", "B", "Kit", "top"]);
    const byName = (name: string) => prints.find((print) => (print.title ?? print.name) === name)!.id;
    expect(await filesOf(byName("A"))).toEqual([["docs", "guide.pdf", "SUPPORTING"]]);
    expect(await filesOf(byName("Kit"))).toEqual([[null, "readme.pdf", "SUPPORTING"]]);
    // A document on its own can't be a model.
    expect(failed).toEqual(["top.pdf"]);
  });

  it("a model per folder counts its progress in models, the files on their own among them", async () => {
    const files = { ...tree(), "top.stl": "solid top endsolid", "top.pdf": "%PDF-1.4 top" };
    const zip = await zipOf(files);
    const calls: number[][] = [];
    const picked = [...Object.keys(files), "Kit/missing.stl"];
    await extractZipEntriesToFolderModels(userId, zip, picked, {}, (...counts) => calls.push(counts));
    // missing.stl isn't in the zip; Kit/A, Kit/B and Kit are models; top.stl and top.pdf each stand alone, and the
    // PDF can't be a model.
    expect(calls).toEqual([
      [1, 6, 0, 1],
      [2, 6, 1, 1],
      [3, 6, 2, 1],
      [4, 6, 3, 1],
      [5, 6, 4, 1],
      [6, 6, 4, 2],
    ]);
  });

  it("a model per folder makes one model of a folder holding a glTF scene, packed with its files", async () => {
    const files = {
      "Glade/scene.gltf": gltfScene("mesh.bin"),
      "Glade/mesh.bin": positions,
      "Glade/notes.txt": "upright",
    };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    expect(failed).toEqual([]);
    expect(prints.map((print) => print.plates.map((plate) => plate.filename))).toEqual([["scene.glb"]]);
    expect(await filesOf(prints[0].id)).toEqual([[null, "notes.txt", "SUPPORTING"]]);
  });

  it("a model per folder packs a scene with a picked file from outside its folder, which stays where it is", async () => {
    const files = {
      "Models/A/scene.gltf": gltfScene("../../Shared/mesh.bin"),
      "Models/A/notes.txt": "upright",
      "Shared/mesh.bin": positions,
    };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    expect(prints.map((print) => print.plates.map((plate) => plate.filename))).toEqual([["scene.glb"]]);
    // The buffer is no file of A's: it goes as a file on its own does, which it can't be a model of.
    expect(failed).toEqual(["Shared/mesh.bin"]);
  });

  it("a model per folder packs a scene with a file of a model stored before it", async () => {
    const files = {
      "Models/A/a.stl": "solid a endsolid",
      "Models/A/mesh.bin": positions,
      "Models/B/scene.gltf": gltfScene("../A/mesh.bin"),
    };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    expect(failed).toEqual([]);
    expect(prints.map((print) => print.plates.map((plate) => plate.filename))).toEqual([["a.stl"], ["scene.glb"]]);
    // A keeps the buffer beside it, and B's scene has it packed in.
    expect(await filesOf(prints[0].id)).toEqual([[null, "mesh.bin", "SUPPORTING"]]);
  });

  it("a model per folder keeps a file at the top that it made a model of, though a step after storing it fails", async () => {
    const zip = await zipOf({ "root.stl": "solid root endsolid" });
    pictures.localizeFails = true;
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, ["root.stl"], {});
    expect(pictures.localizeFails).toBe(false);
    expect(failed).toEqual([]);
    expect(prints.map((print) => print.plates.map((plate) => plate.filename))).toEqual([["root.stl"]]);
  });

  it("a model per folder keeps a subfolder of scripts with the model above it", async () => {
    const files = { "Gear/gear.stl": "solid gear endsolid", "Gear/source/gear.scad": "cylinder(10);" };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    expect(failed).toEqual([]);
    expect(prints.map((print) => print.name)).toEqual(["Gear"]);
    expect(await filesOf(prints[0].id)).toEqual([["source", "gear.scad", "SUPPORTING"]]);
  });

  it("a model per folder files each model in the folders above its own", async () => {
    const files = { "Shelf/Fan Duct/duct.stl": "solid duct endsolid", "Clip/clip.stl": "solid clip endsolid" };
    const zip = await zipOf(files);
    const { prints } = await extractZipEntriesToFolderModels(userId, zip, Object.keys(files), {});
    const categoryOf = async (name: string) => {
      const { categoryId } = prints.find((print) => print.name === name)!;
      return categoryId && (await prisma.category.findUniqueOrThrow({ where: { id: categoryId } })).name;
    };
    expect(await categoryOf("Fan Duct")).toBe("Shelf");
    expect(await categoryOf("Clip")).toBeNull();
  });

  it("a model per file makes models of the model files, and leaves documents out", async () => {
    const zip = await zipOf(tree());
    const { prints, failed } = await extractZipEntriesToPrints(userId, zip, ["Kit/loose.stl", "Kit/readme.pdf"], {});
    expect(prints.map((print) => print.name)).toEqual(["loose"]);
    expect(failed).toEqual(["Kit/readme.pdf"]);
  });
});

describe("the folders a model is made of", () => {
  it("takes folders with model files as models, their subfolders with them, in the order they come", () => {
    const files = ["Kit/A/a.stl", "Kit/A/docs/g.pdf", "loose.stl", "Kit/B/b.stl", "Kit/readme.pdf"];
    const units = modelFolderUnits(
      files,
      (file) => file.split("/").slice(0, -1).join("/"),
      (file) => file.endsWith(".stl"),
    );
    expect(units).toEqual([
      {
        kind: "model",
        folder: "Kit/A",
        files: ["Kit/A/a.stl"],
        attached: [{ item: "Kit/A/docs/g.pdf", folder: "docs" }],
      },
      { kind: "file", item: "loose.stl" },
      { kind: "model", folder: "Kit/B", files: ["Kit/B/b.stl"], attached: [] },
      { kind: "file", item: "Kit/readme.pdf" },
    ]);
  });
});

describe("the admin's setting", () => {
  const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);

  it("starts at 100 MB, takes what's offered, and refuses anything else", async () => {
    expect((await auth(request(app).get("/api/settings/import-supporting-files"))).body).toEqual({ limit: 100 });
    const off = await auth(request(app).post("/api/settings/import-supporting-files")).send({ limit: "off" });
    expect(off.body).toEqual({ limit: "off" });
    expect((await auth(request(app).get("/api/settings/import-supporting-files"))).body).toEqual({ limit: "off" });
    expect((await auth(request(app).post("/api/settings/import-supporting-files")).send({ limit: 42 })).status).toBe(
      400,
    );
  });
});
