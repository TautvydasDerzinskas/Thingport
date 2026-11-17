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
import { modelFilesFromZip, supportingFilesFromZip } from "../src/services/importService";
import { replaceModelPlates } from "../src/services/modelFilesReplace";
import { modelFolderUnits } from "../src/services/modelFolders";
import { setImportSupportingFiles } from "../src/services/settingsService";
import {
  isSupportingImportFile,
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
const limits = vi.hoisted(() => ({ value: undefined as SupportingLimits | null | undefined }));
vi.mock("../src/services/supportingImports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/supportingImports")>();
  return {
    ...actual,
    supportingLimits: async () => (limits.value !== undefined ? limits.value : actual.supportingLimits()),
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

  it("one model leaves a picked zip inside the zip unopened, and says so", async () => {
    const files = { ...tree(), "Kit/parts.zip": fs.readFileSync(await zipOf({ "p.stl": "solid p endsolid" })) };
    const zip = await zipOf(files);
    const { prints, failed } = await extractZipEntriesToOneModel(userId, zip, "Kit.zip", Object.keys(files), {});
    expect(failed).toEqual(["Kit/parts.zip"]);
    expect(prints[0].plates.map((plate) => plate.filename)).toEqual(["a.stl", "b.stl", "loose.stl"]);
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
    // Kit holds a model file itself (loose.stl), so it's a model too, with its readme.
    expect(prints.map((print) => print.name).toSorted()).toEqual(["A", "B", "Kit", "top"]);
    const byName = (name: string) => prints.find((print) => print.name === name)!.id;
    expect(await filesOf(byName("A"))).toEqual([["docs", "guide.pdf", "SUPPORTING"]]);
    expect(await filesOf(byName("Kit"))).toEqual([[null, "readme.pdf", "SUPPORTING"]]);
    // A document on its own can't be a model.
    expect(failed).toEqual(["top.pdf"]);
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
