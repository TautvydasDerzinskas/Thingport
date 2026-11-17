import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { makePrint, register, tempFile, uniqueImage, upload } from "./helpers/fileReuse";
import { modelFilesMissing, scanMissingFiles } from "../src/services/missingFilesService";
import { replaceModelPlates } from "../src/services/modelFilesReplace";
import { replaceModelFiles } from "../src/services/importService";
import { addPreviewImage } from "../src/services/previewImageService";
import { licenseData } from "../src/services/licenseService";
import { syncLicenseFile } from "../src/services/licenseFile";
import { getLicenseFiles, setLicenseFiles } from "../src/services/settingsService";
import { batchFileSaver, removeMissingPrintFiles, saveFileFromTemp } from "../src/services/printFileService";
import { withStorageLock } from "../src/utils/storageLock";

// Finding the models whose files are gone, and the repair that deletes them. Re-importing is not covered here: it
// talks to the providers, which the import suites stand up their own servers for.

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let dir: string;
let owner: { id: string; token: string };

async function waitForRun(token: string) {
  for (let i = 0; i < 200; i++) {
    const res = await request(app).get("/api/prints/repair/run").set(auth(token));
    if (!res.body.run?.running) return res;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the repair run did not finish");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-missing-files-"));
  owner = await register(app, "missing-files", "Owner");
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("models whose files are gone", () => {
  it("counts only the models with no file left, and says they have nothing to fetch from", async () => {
    const broken = await makePrint(dir, owner.id, "Broken");
    const whole = await makePrint(dir, owner.id, "Whole");
    // The accident: the file goes, the row stays.
    fs.rmSync(path.join(STORAGE, broken.plate.storagePath), { force: true });

    const scan = await scanMissingFiles(owner.id);
    expect(scan.broken.map((model) => model.id)).toEqual([broken.print.id]);
    expect(scan.total).toBeGreaterThanOrEqual(2);
    // An upload has no provider to ask for its file again.
    expect(scan.broken[0].route).toBe("none");
    expect(scan.broken[0].sourceUrl).toBeNull();

    expect(await modelFilesMissing([whole.plate])).toBe(false);
    expect(await modelFilesMissing([])).toBe(false);
  });

  it("reports the count over the API, and prompts only once it's a fair share of the library", async () => {
    const res = await request(app).get("/api/prints/missing-files?refresh=1").set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.broken).toBe(1);
    expect(res.body.no_source).toBe(1);
    expect(res.body.by_provider).toEqual([{ provider: null, count: 1 }]);
    // One model of two is a fair share, but one lost file is not an accident worth interrupting over.
    expect(res.body.prompt).toBe(false);
  });

  it("deletes the models with no files and leaves the rest alone", async () => {
    const before = await prisma.print.count({ where: { userId: owner.id } });
    const started = await request(app).post("/api/prints/repair").set(auth(owner.token)).send({ action: "delete" });
    expect(started.status).toBe(200);
    expect(started.body.run.action).toBe("delete");

    const finished = await waitForRun(owner.token);
    expect(finished.body.run.deleted).toBe(1);
    expect(finished.body.run.failed).toBe(0);
    expect(await prisma.print.count({ where: { userId: owner.id } })).toBe(before - 1);

    const after = await request(app).get("/api/prints/missing-files").set(auth(owner.token));
    expect(after.body.broken).toBe(0);
  });

  it("puts the plates back when a replacement fails halfway, so the model is still found", async () => {
    const model = await makePrint(dir, owner.id, "Halfway");
    // A model can lose its plate files alone: its supporting files are still there, and still its own afterwards.
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "keep me");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });

    await expect(
      replaceModelPlates(owner.id, model.print.id, [
        { filename: "first.stl", tempFilePath: tempFile(dir, "solid first\nendsolid\n") },
        // Nothing at this path, so the second plate throws where the first has already been stored.
        { filename: "second.stl", tempFilePath: path.join(dir, "not-here.stl") },
      ]),
    ).rejects.toThrow(/ENOENT/);

    const plates = await prisma.plate.findMany({ where: { printId: model.print.id } });
    expect(plates.map((plate) => plate.id)).toEqual([model.plate.id]);
    expect(plates[0].storagePath).toBe(model.plate.storagePath);
    expect(await prisma.printFile.findUnique({ where: { id: note.id } })).not.toBeNull();
    expect(fs.existsSync(path.join(STORAGE, note.storagePath))).toBe(true);
    // As broken as it was, rather than a model with no plates at all -- which the scan passes over, leaving it
    // beyond repair.
    const scan = await scanMissingFiles(owner.id);
    expect(scan.broken.map((broken) => broken.id)).toContain(model.print.id);
  });

  it("keeps the files still on disk, drops those that went with the plates, and writes LICENSE.txt again", async () => {
    const licenseFilesBefore = await getLicenseFiles();
    await setLicenseFiles(true);
    try {
      const model = await makePrint(dir, owner.id, "Keeps its files");
      await prisma.print.update({
        where: { id: model.print.id },
        data: licenseData({ id: "CC-BY-4.0", raw: "BY" }, "user", null),
      });
      await syncLicenseFile(model.print.id);
      // The owner's notes and sliced print, which no source can give back, beside a guide whose file went too.
      const note = await upload(dir, owner.id, model.print.id, "notes.txt", "keep me");
      const sliced = await upload(dir, owner.id, model.print.id, "ready.gcode", "; sliced\nG28\n");
      const guide = await upload(dir, owner.id, model.print.id, "guide.pdf", "%PDF-1.4\n");
      const license = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, role: "LICENSE" } });
      for (const gone of [model.plate.storagePath, guide.storagePath, license.storagePath]) {
        fs.rmSync(path.join(STORAGE, gone), { force: true });
      }

      const { plates } = await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
      ]);

      expect(plates.map((plate) => plate.filename)).toEqual(["fetched.stl"]);
      const files = await prisma.printFile.findMany({ where: { printId: model.print.id } });
      expect(files.map((file) => file.id)).toEqual(expect.arrayContaining([note.id, sliced.id]));
      expect(files.some((file) => file.id === guide.id)).toBe(false);
      for (const kept of [note, sliced]) expect(fs.existsSync(path.join(STORAGE, kept.storagePath))).toBe(true);
      const print = await prisma.print.findUniqueOrThrow({ where: { id: model.print.id } });
      expect(print.preparedFileId).toBe(sliced.id);
      const rewritten = files.filter((file) => file.role === "LICENSE");
      expect(rewritten).toHaveLength(1);
      expect(fs.existsSync(path.join(STORAGE, rewritten[0].storagePath))).toBe(true);
    } finally {
      await setLicenseFiles(licenseFilesBefore);
    }
  });

  it("leaves a file a move is carrying, rather than taking it for gone", async () => {
    const model = await makePrint(dir, owner.id, "Moving");
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "on its way");
    const movedTo = note.storagePath.replace(/notes\.txt$/, "moved notes.txt");
    // A move as a rename of the model makes one, under the storage lock: the file goes first, its row after.
    let reachMidway!: () => void;
    let finishMove!: () => void;
    const midway = new Promise<void>((resolve) => (reachMidway = resolve));
    const move = withStorageLock(async () => {
      fs.renameSync(path.join(STORAGE, note.storagePath), path.join(STORAGE, movedTo));
      reachMidway();
      await new Promise<void>((resolve) => (finishMove = resolve));
      await prisma.printFile.update({ where: { id: note.id }, data: { storagePath: movedTo } });
    });
    await midway;

    // The row still names where the file was: read now, it would be taken for gone.
    const removal = removeMissingPrintFiles(model.print.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    finishMove();
    await move;
    await removal;

    const row = await prisma.printFile.findUnique({ where: { id: note.id } });
    expect(row?.storagePath).toBe(movedTo);
  });

  it("keeps a file's row, and stops, when checking it fails for another reason than its being gone", async () => {
    const model = await makePrint(dir, owner.id, "Unreadable");
    await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "still here"), "kept.txt", null);
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "kept.txt" } });
    const where = path.resolve(STORAGE, row.storagePath);
    // A network volume gone flaky: the file is there, but checking it answers EIO.
    const access = fsPromises.access.bind(fsPromises);
    const spy = vi.spyOn(fsPromises, "access").mockImplementation(async (file, mode) => {
      if (path.resolve(String(file)) === where) {
        throw Object.assign(new Error(`EIO: i/o error, access '${where}'`), { code: "EIO" });
      }
      return access(file, mode);
    });
    try {
      await expect(removeMissingPrintFiles(model.print.id)).rejects.toMatchObject({ code: "EIO" });
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.printFile.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("leaves a file still being saved, rather than taking it for gone", async () => {
    const model = await makePrint(dir, owner.id, "Saving");
    // Its row has its place before the file is put there: a sweep in between, as a repair makes, comes here.
    const update = prisma.printFile.update.bind(prisma.printFile);
    let swept = false;
    const spy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      const updated = await update(args);
      if (!swept && typeof args.data.storagePath === "string") {
        swept = true;
        await removeMissingPrintFiles(model.print.id);
      }
      return updated;
    }) as never);
    try {
      await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "attached mid-repair"), "late.txt", null);
    } finally {
      spy.mockRestore();
    }
    expect(swept).toBe(true);
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "late.txt" } });
    expect(fs.existsSync(path.join(STORAGE, row.storagePath))).toBe(true);

    // One only just made, its place not claimed yet, is left too.
    const fresh = await prisma.printFile.create({
      data: {
        printId: model.print.id,
        filename: "fresh.txt",
        mime: "text/plain",
        role: "SUPPORTING",
        storagePath: "pending",
      },
    });
    try {
      await removeMissingPrintFiles(model.print.id);
      expect(await prisma.printFile.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    } finally {
      await prisma.printFile.deleteMany({ where: { id: fresh.id } });
    }
  });

  it("gives a batch's first sliced file the prepared slot, though another upload filled it as the batch saved", async () => {
    const model = await makePrint(dir, owner.id, "Batch");
    const save = batchFileSaver(owner.id, model.print.id);
    const update = prisma.printFile.update.bind(prisma.printFile);
    let raced = false;
    const spy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      const updated = await update(args);
      if (!raced) {
        raced = true;
        // Another upload's sliced file, landing while the batch saves its notes.
        await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "G1 X0\n"), "elsewhere.gcode", null);
      }
      return updated;
    }) as never);
    try {
      await save(tempFile(dir, "notes"), "notes.txt", null);
    } finally {
      spy.mockRestore();
    }
    expect(raced).toBe(true);

    const saved = await save(tempFile(dir, "G1 X1\n"), "mine.gcode", null);
    const mine = await prisma.printFile.findFirstOrThrow({
      where: { printId: model.print.id, filename: "mine.gcode" },
    });
    expect(mine.role).toBe("PREPARED");
    expect(saved.preparedFileId).toBe(mine.id);
  });

  it("touches nothing when the files came back while they were being fetched", async () => {
    const model = await makePrint(dir, owner.id, "Came back");

    // The repair read the library before the download, which takes minutes: by now a Grab import of the same model,
    // or an upload, has put its files back, and taking them away for these would be the accident.
    const replaced = await replaceModelFiles(owner.id, model.print.id, {
      inputs: [{ filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") }],
      coverImageUrl: null,
      galleryImages: [],
      profiles: {},
    });

    expect(replaced).toBeNull();
    const plates = await prisma.plate.findMany({ where: { printId: model.print.id } });
    expect(plates.map((plate) => plate.id)).toEqual([model.plate.id]);
    expect(fs.existsSync(path.join(STORAGE, model.plate.storagePath))).toBe(true);
  });

  it("keeps the pictures the model has when the source's can't be fetched", async () => {
    const model = await makePrint(dir, owner.id, "Pictures");
    // The owner's own photograph of the printed model, which the source has no copy of.
    const photo = await addPreviewImage(model.print.id, await uniqueImage("jpeg"));
    expect(photo).not.toBeNull();
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });

    const replaced = await replaceModelFiles(owner.id, model.print.id, {
      inputs: [{ filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") }],
      coverImageUrl: "http://127.0.0.1:1/cover.jpg",
      galleryImages: [{ url: "http://127.0.0.1:1/one.jpg", filename: "one.jpg" }],
      profiles: {},
    });

    expect(replaced).not.toBeNull();
    // Nothing answered on either address, so the gallery is the one the owner has been looking at.
    const images = await prisma.previewImage.findMany({ where: { printId: model.print.id } });
    expect(images.map((image) => image.id)).toEqual([photo!.id]);
  });

  it("refuses an action it doesn't know, and a request with no sign-in", async () => {
    const bad = await request(app).post("/api/prints/repair").set(auth(owner.token)).send({ action: "shred" });
    expect(bad.status).toBe(400);
    const anonymous = await request(app).get("/api/prints/missing-files");
    expect(anonymous.status).toBe(401);
  });
});
