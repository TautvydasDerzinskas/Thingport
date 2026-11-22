import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { importPrintFromUrl } from "../../src/services/importService";
import { modelFilesMissing, scanMissingFiles } from "../../src/services/missingFilesService";
import { createPrint, resolvePlateFilePath } from "../../src/services/printCreation";
import { PROFILE_FILE_VERSION } from "../../src/services/printProfileService";
import { reorganizeManagedPrints } from "../../src/services/printService";
import {
  getPreviewMode,
  getQualityChecks,
  getSocialSettings,
  setPreviewMode,
  setQualityChecks,
  setSocialSettings,
  type PreviewMode,
} from "../../src/services/settingsService";
import { checkLibraryInvariants } from "../harness/invariants";
import { faults, hits, pauseAt, track } from "../harness/lifecycle";
import { nonce, register, tempFile, upload } from "../helpers/fileReuse";
import { contentOf } from "../intake/files";
import { binary, html, installFetch } from "../providers/support";

// The services' looks at a model's files, through the file door (src/modelFiles/storageFs.ts): only a missing file
// counts as missing, a folder in a file's place isn't the file, and a look the disk fails stops what asked for it, or
// is passed over by a reader that only tries its best. Each fault is aimed at one look, by its site and its file.

// The profile import below checks the address it fetches: answered here, so nothing leaves the machine.
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

const app = createApp();

type User = { id: string; token: string };
const as = (user: User) => ({ Authorization: `Bearer ${user.token}` });
const abs = (row: { storagePath: string }) => path.join(STORAGE, row.storagePath);

let dir: string;
let previews: PreviewMode;
let qualityChecks: boolean;
const toolIds: string[] = [];
const toolFolders: string[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-door-services-"));
  // Nothing here waits for a preview made in the background, so none is made.
  previews = await getPreviewMode();
  await setPreviewMode("disabled");
  qualityChecks = await getQualityChecks();
  await setQualityChecks(true);
});

afterAll(async () => {
  await setPreviewMode(previews);
  await setQualityChecks(qualityChecks);
  await prisma.tool.deleteMany({ where: { id: { in: toolIds } } });
  for (const folder of [dir, ...toolFolders]) fs.rmSync(folder, { recursive: true, force: true });
});

/** A user of their own, so a scan or a move sees only what the test made. */
const user = (): Promise<User> => register(app, "door-services", nonce());

/** A model of `owner`'s whose plates hold bytes no other file has, made as an upload makes one. */
async function model(owner: User, filenames = ["Part.stl"]) {
  const seed = nonce();
  const inputs = await Promise.all(
    filenames.map(async (filename) => ({ filename, tempFilePath: tempFile(dir, await contentOf(filename, seed)) })),
  );
  return createPrint(owner.id, { title: `Door ${seed}` }, `Door ${seed}`, inputs, { describe: false, classify: false });
}

/** A model a tool brought, as toolsService's giveModelTo makes one: its plate reads the tool's own file, under
 *  storage/tools/, and its path in the user's folder is only reserved. */
async function toolModel(owner: User) {
  const key = nonce();
  const folder = path.join(STORAGE, "tools", `door-${key}`);
  toolFolders.push(folder);
  const source = path.join(folder, "files", "Part.stl");
  const bytes = await contentOf("Part.stl", key);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, bytes);
  const tool = await prisma.tool.create({
    data: { source: "own", scope: owner.id, slug: `door-${key}`, userId: owner.id, manifest: {}, script: "", sha: key },
  });
  toolIds.push(tool.id);
  const { print, plates } = await createPrint(
    owner.id,
    { title: `Tool ${key}` },
    `Tool ${key}`,
    [{ filename: "Part.stl", sourcePath: source }],
    { describe: false, classify: false },
  );
  await prisma.print.update({ where: { id: print.id }, data: { toolId: tool.id, toolKey: "part" } });
  return { print, plate: plates[0], source, bytes };
}

/** What `fn` throws. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("It didn't throw");
}

function readBinary(res: NodeJS.ReadableStream, done: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
}

/** The plate's download, as the model page asks for it. */
const download = (owner: User, printId: string, plate: { id: string; filename: string }) =>
  request(app)
    .get(`/api/print/${printId}/plate/${plate.id}/file/${encodeURIComponent(plate.filename)}`)
    .set(as(owner))
    .buffer(true)
    .parse(readBinary);

describe("a plate's file (plate.file)", () => {
  it("is the file when it's there, none when it's gone or a folder, and an error when the look fails", async () => {
    const owner = await user();
    const {
      plates: [plate],
    } = await model(owner);
    const file = abs(plate);
    expect(resolvePlateFilePath(plate)).toBe(file);

    faults.at("fileState:plate.file", 1, "EIO", { path: file });
    // Never "missing" for a disk that didn't answer: every caller would take it for a file that's gone.
    expect(thrownBy(() => resolvePlateFilePath(plate))).toMatchObject({ code: "EIO", path: file });

    fs.rmSync(file);
    expect(resolvePlateFilePath(plate)).toBeNull();
    fs.mkdirSync(file);
    expect(resolvePlateFilePath(plate)).toBeNull();
  });

  it("is a tool's own file, at its sourcePath only: a file planted at the path it reserves is never read", async () => {
    const owner = await user();
    const { print, plate, source, bytes } = await toolModel(owner);
    // Something else at the path a tool's plate only reserves: a file left there, say.
    fs.mkdirSync(path.dirname(abs(plate)), { recursive: true });
    fs.writeFileSync(abs(plate), "solid stray endsolid");

    expect(resolvePlateFilePath(plate)).toBe(source);
    const served = await download(owner, print.id, plate);
    expect([served.status, served.body]).toEqual([200, bytes]);
    expect(await modelFilesMissing([plate])).toBe(false);

    // With the tool's file gone, the stray one still isn't the plate's.
    fs.rmSync(source);
    expect(resolvePlateFilePath(plate)).toBeNull();
    expect((await download(owner, print.id, plate)).status).toBe(404);
    expect(await modelFilesMissing([plate])).toBe(true);
  });
});

describe("readers that only try their best", () => {
  it("open the model page when a 3MF's look fails, leaving its format for a later look", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner, ["Body.3mf"]);
    faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });

    const res = await request(app).get(`/api/print/${print.id}`).set(as(owner));

    expect(res.status).toBe(200);
    expect(res.body.plates.map((each: { id: string }) => each.id)).toEqual([plate.id]);
  });

  it("wait to read a print profile again while its file's look fails", async () => {
    const owner = await user();
    const seed = nonce();
    const {
      print,
      plates: [plate],
    } = await createPrint(
      owner.id,
      { title: `Profile ${seed}` },
      `Profile ${seed}`,
      [
        {
          filename: "Profile.stl",
          tempFilePath: tempFile(dir, await contentOf("Profile.stl", seed)),
          sourceInstanceId: "111",
        },
      ],
      { describe: false, classify: false },
    );
    // Read before, from the file as it was: one that has changed since is read again.
    await prisma.plate.update({
      where: { id: plate.id },
      data: { profile: { fileVersion: PROFILE_FILE_VERSION, fileStamp: "1:1" } },
    });
    const page = () => request(app).get(`/api/print/${print.id}`).set(as(owner));
    expect((await page()).body.profiles_pending).toBe(true);

    faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });
    const res = await page();

    expect(res.status).toBe(200);
    // Read once the disk answers for the file, as for one that's missing, rather than taken for changed.
    expect(res.body.profiles_pending).toBe(false);
  });

  it("keep the model's print facts when the look at its new first plate fails", async () => {
    const owner = await user();
    const {
      print,
      plates: [sliced, part],
    } = await model(owner, ["Sliced.gcode", "Part.stl"]);
    const facts = async () => (await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata;
    const before = await facts();
    expect(before).toMatchObject({ format: "gcode" });
    const reorder = (...plates: { id: string }[]) =>
      request(app)
        .post(`/api/print/${print.id}/plates/reorder`)
        .set(as(owner))
        .send({ plate_ids: plates.map((plate) => plate.id) });

    faults.at("fileState:plate.file", 1, "EIO", { path: abs(part) });
    // The new order is saved before the facts are read again, so failing it now would say it wasn't.
    expect((await reorder(part, sliced)).status).toBe(200);
    expect(await facts()).toEqual(before);

    // A first plate whose file is gone has none.
    expect((await reorder(sliced, part)).status).toBe(200);
    fs.rmSync(abs(part));
    expect((await reorder(part, sliced)).status).toBe(200);
    expect(await facts()).toBeNull();
  });
});

describe("callers that fail when a plate's look fails, rather than take its file for gone", () => {
  it("leave the plate unchecked, rather than record its file missing", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });

    const res = await request(app).post(`/api/print/${print.id}/quality`).set(as(owner));

    expect(res.status).toBe(200);
    // Not "checking": the check is over, and it kept nothing, so the next look checks the file again.
    expect(res.body.files).toMatchObject([{ plate_id: plate.id, status: "unchecked" }]);
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: plate.id } })).qualityCheck).toBeNull();
  });

  it("fail Studio's import, keeping studio_file_missing for a file that's gone", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const design = (await request(app).post("/api/studio/designs").set(as(owner)).send({ name: "Door" })).body;
    const importModel = () =>
      request(app)
        .post(`/api/studio/designs/${design.id}/commands`)
        .set(as(owner))
        .send({ command: "import_model", args: { model_id: print.id } });

    faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });
    expect((await importModel()).status).toBe(500);

    fs.rmSync(abs(plate));
    const gone = await importModel();
    expect([gone.status, gone.body.code]).toEqual([404, "studio_file_missing"]);
  });

  it.each([
    ["render", "Part.stl", "render.png"],
    ["3D preview", "Body.3mf", "preview.glb"],
  ])("fail a plate's %s, keeping PREVIEW_FAILED for a file that's gone", async (_kind, filename, picture) => {
    const owner = await user();
    const {
      plates: [plate],
    } = await model(owner, [filename]);
    const ask = () => request(app).get(`/api/plate/${plate.id}/${picture}`).set(as(owner));
    // Made when first asked for; nothing is made here, since the file is never read.
    await setPreviewMode("on-demand");
    try {
      faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });
      expect((await ask()).status).toBe(500);

      fs.rmSync(abs(plate));
      const gone = await ask();
      expect([gone.status, gone.body.code]).toEqual([404, "PREVIEW_FAILED"]);
    } finally {
      await setPreviewMode("disabled");
    }
  });

  it("fail a print profile's import, rather than add the profile beside the plate it matches", async () => {
    const owner = await user();
    const designId = `${Date.now()}`;
    const pageUrl = `https://makerworld.com/en/models/${designId}-door#profileId-200`;
    const fileUrl = `https://makerworld.com/files/door-${designId}.stl`;
    const bytes = await contentOf("Profile.stl", designId);
    // Imported before profiles were told apart: the plate is the profile, though nothing says so yet.
    const {
      print,
      plates: [plate],
    } = await createPrint(
      owner.id,
      { title: `Door ${designId}`, sourceProvider: "makerworld", sourceExternalId: designId },
      `Door ${designId}`,
      [{ filename: "Profile.stl", tempFilePath: tempFile(dir, bytes) }],
      { describe: false, classify: false },
    );
    const stub = installFetch((call) => {
      if (call.url.href === fileUrl) return binary(bytes);
      if (call.url.href.startsWith("https://makerworld.com/en/models/"))
        return html("<html><title>Door</title></html>");
      return undefined;
    });
    const importProfile = () =>
      importPrintFromUrl(owner.id, pageUrl, {
        url: pageUrl,
        tags: [],
        resolved_download_url: fileUrl,
        resolved_instance_id: "200",
      });
    const platesOf = async () =>
      (await prisma.plate.findMany({ where: { printId: print.id } })).map((each) => [each.id, each.sourceInstanceId]);
    try {
      faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });
      await expect(importProfile()).rejects.toMatchObject({ code: "EIO" });
      expect(await platesOf()).toEqual([[plate.id, null]]);

      // Once the disk answers, the plate is found to be the profile, and tagged with it.
      expect((await importProfile()).alreadyImported).toBe(true);
      expect(await platesOf()).toEqual([[plate.id, "200"]]);
    } finally {
      stub.restore();
    }
  });
});

describe("a free path (path.taken)", () => {
  it("stops saving a supporting file when the look at its path fails: nothing placed, no row left", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const target = path.join(path.dirname(abs(plate)), "Notes.txt");
    faults.at("fileState:path.taken", 1, "EIO", { path: target });

    const res = await request(app)
      .post(`/api/print/${print.id}/files`)
      .set(as(owner))
      .attach("file", Buffer.from("notes"), "Notes.txt");

    expect(res.status).toBe(500);
    expect(await prisma.printFile.count({ where: { printId: print.id } })).toBe(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("stops a new plate when the look at its path fails: nothing placed, no row left", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const target = path.join(path.dirname(abs(plate)), "Extra.stl");
    faults.at("fileState:path.taken", 1, "EIO", { path: target });

    const res = await request(app)
      .post(`/api/print/${print.id}/plates`)
      .set(as(owner))
      .attach("files", await contentOf("Extra.stl", nonce()), "Extra.stl");

    expect(res.status).toBe(500);
    expect((await prisma.plate.findMany({ where: { printId: print.id } })).map((each) => each.id)).toEqual([plate.id]);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("counts a folder at a path as taken, and numbers the file apart", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const taken = path.join(path.dirname(abs(plate)), "Notes.txt");
    fs.mkdirSync(taken);

    const notes = await upload(dir, owner.id, print.id, "Notes.txt", "notes");

    expect(notes.storagePath).toBe(path.join(path.dirname(plate.storagePath), "Notes (2).txt"));
    expect(fs.statSync(taken).isDirectory()).toBe(true);
  });
});

// Every file of a model into a folder named after it: what saving a new structure moves.
const BY_ID = "{category-or-folder}/{model}/{id}/{filename}";

describe("a move (move.target, move.source)", () => {
  it("stops when the look at where a file goes fails: nothing renamed or saved, and the model skipped", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const bytes = fs.readFileSync(abs(plate));
    faults.at("fileState:move.target", 1, "EIO");

    expect(await reorganizeManagedPrints(BY_ID, owner.id)).toEqual({ moved: 0, skipped: 1 });

    expect((await prisma.plate.findUniqueOrThrow({ where: { id: plate.id } })).storagePath).toBe(plate.storagePath);
    expect(fs.readFileSync(abs(plate))).toEqual(bytes);
    expect(fs.existsSync(path.join(path.dirname(abs(plate)), print.id))).toBe(false);
    expect(await checkLibraryInvariants({ userIds: [owner.id] })).toEqual([]);
  });

  it("stops when the look at a file it moves fails, rather than save a place the file never went to", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const bytes = fs.readFileSync(abs(plate));
    faults.at("fileState:move.source", 1, "EIO");

    expect(await reorganizeManagedPrints(BY_ID, owner.id)).toEqual({ moved: 0, skipped: 1 });

    expect((await prisma.plate.findUniqueOrThrow({ where: { id: plate.id } })).storagePath).toBe(plate.storagePath);
    expect(fs.readFileSync(abs(plate))).toEqual(bytes);
    expect(fs.existsSync(path.join(path.dirname(abs(plate)), print.id))).toBe(false);
    expect(await checkLibraryInvariants({ userIds: [owner.id] })).toEqual([]);
  });

  it("leaves a file in bundles/ where its row finds it when its look fails, so bundles/ is kept", async () => {
    const owner = await user();
    const { print } = await model(owner);
    // A supporting file saved before they lived beside the plates, which a move brings over.
    const relative = path.join("bundles", nonce(), "Notes.txt");
    fs.mkdirSync(path.dirname(path.join(STORAGE, relative)), { recursive: true });
    fs.writeFileSync(path.join(STORAGE, relative), "notes from before");
    const bundled = await prisma.printFile.create({
      data: { printId: print.id, role: "SUPPORTING", filename: "Notes.txt", mime: "text/plain", storagePath: relative },
    });
    try {
      faults.at("fileState:move.source", 1, "EIO", { path: path.join(STORAGE, relative) });

      // Skipped is what keeps the storage move from removing bundles/ once it's done (storageMoveService.ts).
      expect((await reorganizeManagedPrints(undefined, owner.id)).skipped).toBe(1);

      expect((await prisma.printFile.findUniqueOrThrow({ where: { id: bundled.id } })).storagePath).toBe(relative);
      expect(fs.readFileSync(path.join(STORAGE, relative), "utf8")).toBe("notes from before");
    } finally {
      // Left, it would have the next start move the whole library to bring it over.
      await prisma.printFile.delete({ where: { id: bundled.id } });
      fs.rmSync(path.dirname(path.join(STORAGE, relative)), { recursive: true, force: true });
    }
  });

  it("moves only a file: a folder at a row's path stays where it is", async () => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const notes = await upload(dir, owner.id, print.id, "Notes.txt", "notes");
    // A folder where the file should be, with something of the owner's in it.
    fs.rmSync(abs(notes));
    fs.mkdirSync(abs(notes));
    fs.writeFileSync(path.join(abs(notes), "Kept.txt"), "kept");

    await reorganizeManagedPrints(BY_ID, owner.id);

    expect(fs.readFileSync(path.join(abs(notes), "Kept.txt"), "utf8")).toBe("kept");
    expect(fs.existsSync(path.join(path.dirname(abs(plate)), print.id, "Notes.txt"))).toBe(false);
  });

  it("goes on past a file that's gone, which is no error", async () => {
    const owner = await user();
    const {
      print,
      plates: [kept, gone],
    } = await model(owner, ["Kept.stl", "Gone.stl"]);
    const bytes = fs.readFileSync(abs(kept));
    fs.rmSync(abs(gone));

    expect(await reorganizeManagedPrints(BY_ID, owner.id)).toEqual({ moved: 1, skipped: 0 });

    const moved = await prisma.plate.findUniqueOrThrow({ where: { id: kept.id } });
    expect(moved.storagePath).toBe(path.join(path.dirname(kept.storagePath), print.id, kept.filename));
    expect(fs.readFileSync(abs(moved))).toEqual(bytes);
  });

  it.each([
    ["a folder", (at: string) => fs.mkdirSync(at, { recursive: true })],
    // A rename replaces a pipe, where it can't a folder: only the look keeps it.
    [
      "a pipe",
      (at: string) => {
        fs.mkdirSync(path.dirname(at), { recursive: true });
        execFileSync("mkfifo", [at]);
      },
    ],
  ])("counts %s that turns up where a file goes as taken", async (_what, put) => {
    const owner = await user();
    const {
      print,
      plates: [plate],
    } = await model(owner);
    const bytes = fs.readFileSync(abs(plate));
    const target = path.join(path.dirname(abs(plate)), print.id, plate.filename);
    const gate = pauseAt("fileState:move.target");
    const moving = track(reorganizeManagedPrints(BY_ID, owner.id));
    await gate.reachedBy(moving);
    // Taken after the place was picked, by another move, say.
    put(target);
    gate.release();
    try {
      expect(await moving).toEqual({ moved: 0, skipped: 1 });
      expect((await prisma.plate.findUniqueOrThrow({ where: { id: plate.id } })).storagePath).toBe(plate.storagePath);
      expect(fs.readFileSync(abs(plate))).toEqual(bytes);
      expect(fs.lstatSync(target).isFile()).toBe(false);
    } finally {
      fs.rmSync(path.dirname(target), { recursive: true, force: true });
    }
  });
});

describe("the missing-files scan (scan.plate)", () => {
  it("fails when a plate's look fails, rather than offer to fetch or delete a model that may be whole", async () => {
    const owner = await user();
    const {
      plates: [plate],
    } = await model(owner);

    faults.at("fileState:scan.plate", 1, "EIO", { path: abs(plate) });
    await expect(scanMissingFiles(owner.id)).rejects.toMatchObject({ code: "EIO" });

    faults.at("fileState:scan.plate", 1, "EACCES", { path: abs(plate) });
    expect((await request(app).get("/api/prints/missing-files?refresh=1").set(as(owner))).status).toBe(500);
  });

  it("counts a folder at a plate's path as missing, as it does a file that's gone", async () => {
    const owner = await user();
    const folder = await model(owner);
    const gone = await model(owner);
    await model(owner);
    fs.rmSync(abs(folder.plates[0]));
    fs.mkdirSync(abs(folder.plates[0]));
    fs.rmSync(abs(gone.plates[0]));

    const scan = await scanMissingFiles(owner.id);

    expect(scan.broken.map((broken) => broken.id).toSorted()).toEqual([folder.print.id, gone.print.id].toSorted());
    expect(scan.total).toBe(3);
    expect(hits("fileState:scan.plate")).toBe(3);
  });
});

describe("a copy (copy.source)", () => {
  let social: boolean;
  beforeAll(async () => {
    social = (await getSocialSettings()).enabled;
    await setSocialSettings({ enabled: true });
  });
  afterAll(async () => {
    await setSocialSettings({ enabled: social });
  });

  /** A model of a new owner's with a supporting file, in one of their public collections, and a user to copy it. */
  async function sharedModel() {
    const owner = await user();
    const { print, plates } = await model(owner);
    const notes = await upload(dir, owner.id, print.id, "Notes.txt", `notes ${nonce()}`);
    const collection = await request(app)
      .post("/api/collections")
      .set(as(owner))
      .send({ name: `Door ${nonce()}`, is_public: true });
    await request(app).post(`/api/collection/${collection.body.id}/items/${print.id}`).set(as(owner));
    const viewer = await user();
    return {
      scope: { userIds: [owner.id, viewer.id] },
      plate: plates[0],
      notes,
      copy: () => request(app).post(`/api/print/${print.id}/copy`).set(as(viewer)),
      copies: () => prisma.print.count({ where: { userId: viewer.id, copiedFromId: print.id } }),
    };
  }

  it("fails, rather than refuse a supporting file as missing, when its look fails", async () => {
    const { notes, copy, copies, scope } = await sharedModel();
    faults.at("fileState:copy.source", 1, "EIO", { path: abs(notes) });

    expect((await copy()).status).toBe(500);
    expect(await copies()).toBe(0);
    expect(await checkLibraryInvariants(scope)).toEqual([]);
  });

  it("fails, rather than refuse a plate as missing, when its look fails", async () => {
    const { plate, copy, copies, scope } = await sharedModel();
    faults.at("fileState:plate.file", 1, "EIO", { path: abs(plate) });

    expect((await copy()).status).toBe(500);
    expect(await copies()).toBe(0);
    expect(await checkLibraryInvariants(scope)).toEqual([]);
  });

  it("still refuses a model whose supporting file is gone, or has a folder in its place", async () => {
    const { notes, copy, copies } = await sharedModel();
    fs.rmSync(abs(notes));
    const gone = await copy();
    expect([gone.status, gone.body.code]).toEqual([409, "copy_files_missing"]);

    fs.mkdirSync(abs(notes));
    const folder = await copy();
    expect([folder.status, folder.body.code]).toEqual([409, "copy_files_missing"]);
    expect(await copies()).toBe(0);
  });
});
