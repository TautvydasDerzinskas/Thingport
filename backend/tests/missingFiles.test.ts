import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const locks = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/utils/storageLock", async (original) => {
  const actual = await original<typeof import("../src/utils/storageLock")>();
  return {
    ...actual,
    withStorageLock: <T>(fn: () => Promise<T>) => {
      locks.calls += 1;
      return actual.withStorageLock(fn);
    },
  };
});

import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import {
  batchFileSaver,
  removeAbandonedPrintFileSaves,
  removeMissingPrintFiles,
  renameSupportingFile,
  saveFileFromTemp,
} from "../src/services/printFileService";
import { relocatePrint, relocatePrintFile } from "../src/services/printService";
import { printOutsByIds } from "../src/services/printLoader";
import { addPlatesToPrint, keepGeneratorScripts, removePlate } from "../src/services/printCreation";
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

  it("adds and removes a model's files at once without two taking one place", async () => {
    const model = await makePrint(dir, owner.id, "At once");
    const [extra] = await addPlatesToPrint(owner.id, model.print.id, [
      { filename: "extra.stl", tempFilePath: tempFile(dir, "solid e\nendsolid\n") },
    ]);
    const settled = await Promise.allSettled([
      addPlatesToPrint(owner.id, model.print.id, [
        { filename: "one.stl", tempFilePath: tempFile(dir, "solid o\nendsolid\n") },
      ]),
      addPlatesToPrint(owner.id, model.print.id, [
        { filename: "two.stl", tempFilePath: tempFile(dir, "solid t\nendsolid\n") },
      ]),
      removePlate(model.print, extra.id),
    ]);
    expect(settled.map((each) => each.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const plates = await prisma.plate.findMany({ where: { printId: model.print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.position)).toEqual([0, 1, 2]);
    expect(plates.map((plate) => plate.filename).toSorted()).toEqual(["one.stl", "own.stl", "two.stl"]);
  });

  it("finishes a repair whose sweep of the other files fails, as the scan won't offer the model again", async () => {
    const model = await makePrint(dir, owner.id, "Swept");
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "kept");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });
    // The disk fails when the sweep looks for the note.
    const access = fsPromises.access.bind(fsPromises);
    const spy = vi.spyOn(fsPromises, "access").mockImplementation((async (where: fs.PathLike, mode?: number) => {
      if (String(where).endsWith(note.storagePath)) throw Object.assign(new Error("EIO"), { code: "EIO" });
      return access(where, mode);
    }) as never);
    try {
      const { plates } = await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
        { filename: "shape.scad", tempFilePath: tempFile(dir, "cube(1);\n") },
      ]);
      expect(plates.map((plate) => plate.filename)).toEqual(["fetched.stl"]);
    } finally {
      spy.mockRestore();
    }
    // The steps after the sweep ran: the source's script is beside the model.
    const files = await prisma.printFile.findMany({ where: { printId: model.print.id } });
    expect(files.map((file) => file.filename)).toEqual(expect.arrayContaining(["notes.txt", "shape.scad"]));
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

    // One only just made, its place not claimed yet, is left too, as is one an older version made.
    const fresh = await Promise.all(
      [`pending:${randomUUID()}`, "pending"].map((storagePath) =>
        prisma.printFile.create({
          data: {
            printId: model.print.id,
            filename: "fresh.txt",
            mime: "text/plain",
            role: "SUPPORTING",
            storagePath,
            ready: storagePath === "pending",
          },
        }),
      ),
    );
    try {
      await removeMissingPrintFiles(model.print.id);
      const left = await prisma.printFile.findMany({ where: { id: { in: fresh.map((made) => made.id) } } });
      expect(left).toHaveLength(2);
    } finally {
      await prisma.printFile.deleteMany({ where: { id: { in: fresh.map((made) => made.id) } } });
    }
  });

  it("gives two saves at once a row each, though the first hasn't claimed its place yet", async () => {
    const model = await makePrint(dir, owner.id, "Together");
    // The second save starts while the first one's row still holds its placeholder.
    const update = prisma.printFile.update.bind(prisma.printFile);
    let second: unknown = null;
    const spy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      if (second === null && typeof args.data.storagePath === "string") {
        second = "started";
        second = await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "two"), "two.txt", null).then(
          () => "saved",
          (err: unknown) => err,
        );
      }
      return update(args);
    }) as never);
    try {
      await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "one"), "one.txt", null);
    } finally {
      spy.mockRestore();
    }
    expect(second).toBe("saved");
    const rows = await prisma.printFile.findMany({ where: { printId: model.print.id }, orderBy: { filename: "asc" } });
    expect(rows.map((row) => row.filename)).toEqual(["one.txt", "two.txt"]);
    for (const row of rows) expect(fs.existsSync(path.join(STORAGE, row.storagePath))).toBe(true);
  });

  it("removes at startup the rows of saves that never finished, and only those, leaving the files at their places", async () => {
    const model = await makePrint(dir, owner.id, "Cut off");
    const kept = await upload(dir, owner.id, model.print.id, "kept.txt", "stays");
    // Cut off before claiming a place, an older version's placeholder, one cut off once its file was in, and one whose
    // place a plate took meanwhile. A file at a place one claimed stays: nothing says it's the save's own.
    const claimed = `cut-${randomUUID()}/cut.txt`;
    fs.mkdirSync(path.dirname(path.join(STORAGE, claimed)), { recursive: true });
    fs.writeFileSync(path.join(STORAGE, claimed), "half");
    const left = await Promise.all(
      [`pending:${randomUUID()}`, "pending", claimed, model.plate.storagePath].map((storagePath) =>
        prisma.printFile.create({
          data: {
            printId: model.print.id,
            filename: "cut.txt",
            mime: "text/plain",
            role: "SUPPORTING",
            storagePath,
            ready: storagePath === "pending",
          },
        }),
      ),
    );
    try {
      expect(await removeAbandonedPrintFileSaves()).toBeGreaterThanOrEqual(4);
      expect(await prisma.printFile.count({ where: { id: { in: left.map((row) => row.id) } } })).toBe(0);
      expect(fs.existsSync(path.join(STORAGE, claimed))).toBe(true);
      expect(fs.existsSync(path.join(STORAGE, model.plate.storagePath))).toBe(true);
      expect(await prisma.printFile.findUnique({ where: { id: kept.id } })).not.toBeNull();
    } finally {
      // Left behind, the old placeholder would fail every later save that makes one.
      await prisma.printFile.deleteMany({ where: { id: { in: left.map((row) => row.id) } } });
    }
  });

  it("keeps a file still being saved where its save is putting it: renaming it waits, and a move passes it by", async () => {
    const model = await makePrint(dir, owner.id, "Moving");
    // Its place is claimed and its bytes aren't there yet: the file is renamed then, and the model moved.
    const update = prisma.printFile.update.bind(prisma.printFile);
    let renamed: unknown = null;
    let claimed = false;
    const spy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      const updated = await update(args);
      if (!claimed && typeof args.data.storagePath === "string") {
        claimed = true;
        renamed = await renameSupportingFile(owner.id, model.print.id, String(args.where.id), "renamed.txt").catch(
          (err: unknown) => err,
        );
        const moved = await prisma.print.update({ where: { id: model.print.id }, data: { name: "Moving away" } });
        await relocatePrint(moved, []);
      }
      return updated;
    }) as never);
    try {
      await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "on its way"), "moving.txt", null);
    } finally {
      spy.mockRestore();
    }
    expect(claimed).toBe(true);
    expect(renamed).toMatchObject({ status: 409 });
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id } });
    expect(row.filename).toBe("moving.txt");
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("on its way");
    // And once it's in, it follows the model's other files to where its new name puts them.
    expect(row.storagePath).toContain("Moving away");
  });

  it("refuses to rename a file whose save isn't done, and leaves it out of the lists", async () => {
    const model = await makePrint(dir, owner.id, "Early rename");
    const early = await prisma.printFile.create({
      data: {
        printId: model.print.id,
        filename: "early.txt",
        mime: "text/plain",
        role: "SUPPORTING",
        storagePath: `pending:${randomUUID()}`,
        ready: false,
      },
    });
    try {
      const renamed = await renameSupportingFile(owner.id, model.print.id, early.id, "later.txt").catch((err) => err);
      expect(renamed).toMatchObject({ status: 409 });
      expect((await prisma.printFile.findUniqueOrThrow({ where: { id: early.id } })).filename).toBe("early.txt");
      // Not a file anyone can have yet.
      const detail = await request(app)
        .get(`/api/print/${model.print.id}`)
        .set("Authorization", `Bearer ${owner.token}`);
      expect(detail.body.supporting_files.map((file: { id: string }) => file.id)).not.toContain(early.id);
      expect(detail.body.supporting_file_count).toBe(0);
      const listed = await request(app)
        .get(`/api/print/${model.print.id}/files`)
        .set("Authorization", `Bearer ${owner.token}`);
      expect(listed.body.map((file: { id: string }) => file.id)).not.toContain(early.id);
    } finally {
      await prisma.printFile.deleteMany({ where: { id: early.id } });
    }
  });

  it("finishes a rename whose move failed when the same name is asked for again", async () => {
    const model = await makePrint(dir, owner.id, "Half renamed");
    const note = await upload(dir, owner.id, model.print.id, "old.txt", "notes");
    // As a rename left it whose move failed: the new name in the row, the file where the old one put it.
    await prisma.printFile.update({ where: { id: note.id }, data: { filename: "new.txt" } });
    await renameSupportingFile(owner.id, model.print.id, note.id, "new.txt");
    const row = await prisma.printFile.findUniqueOrThrow({ where: { id: note.id } });
    expect(path.basename(row.storagePath)).toBe("new.txt");
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("notes");
  });

  it("keeps a saved file when the caller told of it fails", async () => {
    const model = await makePrint(dir, owner.id, "Told");
    await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "kept"), "told.txt", null, {
      onStored: () => {
        throw new Error("the caller failed");
      },
    });
    const row = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "told.txt" } });
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("kept");
  });

  it("brings a repaired model's script back over a row whose file is gone, though the sweep failed", async () => {
    const model = await makePrint(dir, owner.id, "Script back");
    const script = await upload(dir, owner.id, model.print.id, "shape.scad", "cube(1);\n");
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "kept");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });
    fs.rmSync(path.join(STORAGE, script.storagePath), { force: true });
    // The disk fails when the sweep looks for the note, so the script's row is left behind.
    const access = fsPromises.access.bind(fsPromises);
    let failed = false;
    const spy = vi.spyOn(fsPromises, "access").mockImplementation((async (where: fs.PathLike, mode?: number) => {
      if (String(where).endsWith(note.storagePath)) {
        failed = true;
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      return access(where, mode);
    }) as never);
    // Which rows went, and how: the sweep takes them together, the recovery of a script one at a time.
    const swept: string[] = [];
    const taken: string[] = [];
    const deleteMany = prisma.printFile.deleteMany.bind(prisma.printFile);
    const deleteOne = prisma.printFile.delete.bind(prisma.printFile);
    const sweepSpy = vi.spyOn(prisma.printFile, "deleteMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.deleteMany>[0],
    ) => {
      const ids = (args?.where?.id as { in?: string[] } | undefined)?.in ?? [];
      swept.push(...ids);
      return deleteMany(args);
    }) as never);
    const takeSpy = vi.spyOn(prisma.printFile, "delete").mockImplementation(((
      args: Parameters<typeof prisma.printFile.delete>[0],
    ) => {
      if (args.where.id) taken.push(args.where.id);
      return deleteOne(args);
    }) as never);
    try {
      await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
        { filename: "shape.scad", tempFilePath: tempFile(dir, "cube(2);\n") },
      ]);
    } finally {
      spy.mockRestore();
      sweepSpy.mockRestore();
      takeSpy.mockRestore();
    }
    // The sweep failed and took nothing, so the old row was there for the script's own recovery to take.
    expect(failed).toBe(true);
    expect(swept).not.toContain(script.id);
    expect(taken).toContain(script.id);
    const scripts = await prisma.printFile.findMany({ where: { printId: model.print.id, filename: "shape.scad" } });
    expect(scripts).toHaveLength(1);
    expect(fs.readFileSync(path.join(STORAGE, scripts[0].storagePath), "utf8")).toBe("cube(2);\n");
  });

  it("brings a repaired model's script back when another sweep took its old row after it was read", async () => {
    const model = await makePrint(dir, owner.id, "Script taken");
    const script = await upload(dir, owner.id, model.print.id, "shape.scad", "cube(1);\n");
    const note = await upload(dir, owner.id, model.print.id, "notes.txt", "kept");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });
    fs.rmSync(path.join(STORAGE, script.storagePath), { force: true });
    // The repair's own sweep fails, as above; another takes the script's row once the script's recovery has read it.
    const access = fsPromises.access.bind(fsPromises);
    const spy = vi.spyOn(fsPromises, "access").mockImplementation((async (where: fs.PathLike, mode?: number) => {
      if (String(where).endsWith(note.storagePath)) throw Object.assign(new Error("EIO"), { code: "EIO" });
      return access(where, mode);
    }) as never);
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    let took = false;
    const listSpy = vi.spyOn(prisma.printFile, "findMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      const rows = findMany(args);
      if (took || !args?.select?.id || !args.select.folder) return rows;
      took = true;
      return rows.then(async (found) => {
        await prisma.printFile.deleteMany({ where: { id: script.id } });
        return found;
      });
    }) as never);
    try {
      await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
        { filename: "shape.scad", tempFilePath: tempFile(dir, "cube(2);\n") },
      ]);
    } finally {
      spy.mockRestore();
      listSpy.mockRestore();
    }
    expect(took).toBe(true);
    const scripts = await prisma.printFile.findMany({ where: { printId: model.print.id, filename: "shape.scad" } });
    expect(scripts).toHaveLength(1);
    expect(fs.readFileSync(path.join(STORAGE, scripts[0].storagePath), "utf8")).toBe("cube(2);\n");
  });

  it("keeps one copy of a repaired model's script when another arrived after the model's files were read", async () => {
    const model = await makePrint(dir, owner.id, "Script arrived");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });
    // Another save of the same script lands once the script's recovery has read the model's files.
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    let arrived = false;
    const listSpy = vi.spyOn(prisma.printFile, "findMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      const rows = findMany(args);
      if (arrived || !args?.select?.id || !args.select.folder) return rows;
      arrived = true;
      return rows.then(async (found) => {
        await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "cube(3);\n"), "shape.scad", "text/plain");
        return found;
      });
    }) as never);
    try {
      await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
        { filename: "shape.scad", tempFilePath: tempFile(dir, "cube(2);\n") },
      ]);
    } finally {
      listSpy.mockRestore();
    }
    expect(arrived).toBe(true);
    const scripts = await prisma.printFile.findMany({ where: { printId: model.print.id, filename: "shape.scad" } });
    expect(scripts).toHaveLength(1);
  });

  it("moves a file whose save was done by the time a move reached it, and leaves one whose save wasn't", async () => {
    const model = await makePrint(dir, owner.id, "Listed early");
    const row = async (filename: string) => {
      const storagePath = `listed-${randomUUID()}/${filename}`;
      fs.mkdirSync(path.dirname(path.join(STORAGE, storagePath)), { recursive: true });
      fs.writeFileSync(path.join(STORAGE, storagePath), filename);
      return prisma.printFile.create({
        data: { printId: model.print.id, filename, mime: "text/plain", role: "SUPPORTING", storagePath, ready: false },
      });
    };
    // Both on their way in when the move reads the model's files; one's save is done by the time the move gets to it.
    const done = await row("done.txt");
    const saving = await row("saving.txt");
    const findUnique = prisma.printFile.findUnique.bind(prisma.printFile);
    const spy = vi
      .spyOn(prisma.printFile, "findUnique")
      .mockImplementation(((args: Parameters<typeof prisma.printFile.findUnique>[0]) =>
        args.where.id === done.id
          ? prisma.printFile.update({ where: { id: done.id }, data: { ready: true } }).then(() => findUnique(args))
          : findUnique(args)) as never);
    try {
      const moved = await prisma.print.update({ where: { id: model.print.id }, data: { name: "Listed elsewhere" } });
      await relocatePrint(moved, []);
      spy.mockRestore();
      const after = await prisma.printFile.findUniqueOrThrow({ where: { id: done.id } });
      expect(after.storagePath).toContain("Listed elsewhere");
      expect(fs.readFileSync(path.join(STORAGE, after.storagePath), "utf8")).toBe("done.txt");
      expect((await prisma.printFile.findUniqueOrThrow({ where: { id: saving.id } })).storagePath).toBe(
        saving.storagePath,
      );
    } finally {
      spy.mockRestore();
      const left = await prisma.printFile.findMany({ where: { id: { in: [done.id, saving.id] } } });
      await prisma.printFile.deleteMany({ where: { id: { in: [done.id, saving.id] } } });
      // Only the files it made: the model's own plate is beside one of them by now.
      for (const file of left) fs.rmSync(path.join(STORAGE, file.storagePath), { force: true });
    }
  });

  it("doesn't list a file whose save failed after a list read the rows, though the list answers after", async () => {
    const model = await makePrint(dir, owner.id, "Read mid-save");
    // The list reads the model's files once the save has claimed its place, and answers after the save has failed.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let readDone = () => {};
    const read = new Promise<void>((resolve) => (readDone = resolve));
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    let held = false;
    const listSpy = vi.spyOn(prisma.printFile, "findMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      const rows = findMany(args);
      if (held || args?.where?.role !== "SUPPORTING") return rows;
      held = true;
      return rows.then(async (found) => {
        readDone();
        await released;
        return found;
      });
    }) as never);
    const temp = tempFile(dir, "never whole");
    let listing: Promise<request.Response> | null = null;
    const update = prisma.printFile.update.bind(prisma.printFile);
    const claimSpy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      const updated = await update(args);
      if (!listing && typeof args.data.storagePath === "string") {
        // The upload is gone before it's put in place, so the save fails from here.
        fs.rmSync(temp, { force: true });
        listing = request(app)
          .get(`/api/print/${model.print.id}/files`)
          .set(auth(owner.token))
          .then((res) => res);
        // Bounded, so a list that never reads the rows fails the test rather than holding the save for good.
        await Promise.race([read, new Promise((resolve) => setTimeout(resolve, 5000))]);
      }
      return updated;
    }) as never);
    try {
      await expect(saveFileFromTemp(owner.id, model.print.id, temp, "lost.txt", null)).rejects.toThrow(/ENOENT/);
      release();
      const res = await listing!;
      expect(held).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body.map((file: { filename: string }) => file.filename)).not.toContain("lost.txt");
    } finally {
      release();
      await (listing as Promise<request.Response> | null)?.catch(() => undefined);
      claimSpy.mockRestore();
      listSpy.mockRestore();
    }
  });

  it("lists a prepared print that has just replaced another while the old one's file is still going", async () => {
    const model = await makePrint(dir, owner.id, "Replaced");
    await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "G1 X0\n"), "old.gcode", null);
    const old = await prisma.printFile.findFirstOrThrow({ where: { printId: model.print.id, filename: "old.gcode" } });
    // A bulk edit reads the model just as the old print's file is being removed.
    const rm = fsPromises.rm.bind(fsPromises);
    let shown: string | null | undefined;
    const spy = vi.spyOn(fsPromises, "rm").mockImplementation((async (where: fs.PathLike, options?: fs.RmOptions) => {
      if (shown === undefined && String(where) === path.join(STORAGE, old.storagePath)) {
        shown = (await printOutsByIds(owner.id, [model.print.id])).get(model.print.id)?.slicer_filename ?? null;
      }
      return rm(where, options);
    }) as never);
    try {
      await saveFileFromTemp(owner.id, model.print.id, tempFile(dir, "G1 X1\n"), "new.gcode", null);
    } finally {
      spy.mockRestore();
    }
    expect(shown).toBe("new.gcode");
  });

  it("leaves a file just saved where its model's rename took it, rather than move it back", async () => {
    const model = await makePrint(dir, owner.id, "Saved then renamed");
    // A second Notes.pdf is kept as "Notes (2).pdf", so once saved it's read as out of place.
    await upload(dir, owner.id, model.print.id, "Notes.pdf", "first");
    const second = await upload(dir, owner.id, model.print.id, "Notes.pdf", "second");
    expect(path.basename(second.storagePath)).toBe("Notes (2).pdf");
    // The model is renamed, and its files moved, between the save's read of the model and its turn at the lock.
    const findUnique = prisma.print.findUnique.bind(prisma.print);
    let renamed = false;
    const spy = vi.spyOn(prisma.print, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.print.findUnique>[0],
    ) => {
      if (renamed || args.where.id !== model.print.id) return findUnique(args);
      renamed = true;
      return findUnique(args).then(async (read) => {
        const moved = await prisma.print.update({
          where: { id: model.print.id },
          data: { name: `Renamed after saving ${randomUUID()}` },
        });
        await relocatePrint(moved, []);
        return read;
      });
    }) as never);
    try {
      await relocatePrintFile(second.id);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).toBe(true);
    const { name } = await prisma.print.findUniqueOrThrow({ where: { id: model.print.id } });
    const row = await prisma.printFile.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.storagePath).toContain(name);
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("second");
  });

  it("moves a file to where its name now puts it, though it was renamed after the move read it", async () => {
    const model = await makePrint(dir, owner.id, "Renamed on the way");
    const note = await upload(dir, owner.id, model.print.id, "draft.txt", "notes");
    // The rename's change to the row lands between the move's read of the model's files and its turn at the lock.
    const findUnique = prisma.printFile.findUnique.bind(prisma.printFile);
    let renamed = false;
    const spy = vi.spyOn(prisma.printFile, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findUnique>[0],
    ) => {
      if (renamed || args.where.id !== note.id) return findUnique(args);
      renamed = true;
      return prisma.printFile
        .update({ where: { id: note.id }, data: { filename: "guide.txt" } })
        .then(() => findUnique(args));
    }) as never);
    try {
      const moved = await prisma.print.update({
        where: { id: model.print.id },
        data: { name: `Renamed away ${randomUUID()}` },
      });
      await relocatePrint(moved, []);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).toBe(true);
    const row = await prisma.printFile.findUniqueOrThrow({ where: { id: note.id } });
    expect(path.basename(row.storagePath)).toBe("guide.txt");
    expect(fs.readFileSync(path.join(STORAGE, row.storagePath), "utf8")).toBe("notes");
  });

  it("moves a plate to where its name now puts it, though it was renamed after the move read it", async () => {
    const model = await makePrint(dir, owner.id, "Plate renamed on the way");
    const findUnique = prisma.plate.findUnique.bind(prisma.plate);
    let renamed = false;
    const spy = vi.spyOn(prisma.plate, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.plate.findUnique>[0],
    ) => {
      if (renamed || args.where.id !== model.plate.id) return findUnique(args);
      renamed = true;
      return prisma.plate
        .update({ where: { id: model.plate.id }, data: { filename: "guide.stl" } })
        .then(() => findUnique(args));
    }) as never);
    try {
      const moved = await prisma.print.update({
        where: { id: model.print.id },
        data: { name: `Plate away ${randomUUID()}` },
        include: { plates: true },
      });
      await relocatePrint(moved, moved.plates);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).toBe(true);
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: model.plate.id } });
    expect(path.basename(plate.storagePath)).toBe("guide.stl");
    expect(fs.existsSync(path.join(STORAGE, plate.storagePath))).toBe(true);
  });

  it("removes a file from where a move put it, though the move started once the removal had read its row", async () => {
    const model = await makePrint(dir, owner.id, "Removed on the way");
    const note = await upload(dir, owner.id, model.print.id, "gone.txt", "bye");
    const moved = await prisma.print.update({
      where: { id: model.print.id },
      data: { name: `Removed away ${randomUUID()}` },
    });
    const findUnique = prisma.printFile.findUnique.bind(prisma.printFile);
    let moving: Promise<unknown> | null = null;
    const spy = vi.spyOn(prisma.printFile, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findUnique>[0],
    ) => {
      if (moving || args.where.id !== note.id) return findUnique(args);
      return findUnique(args).then(async (row) => {
        // A move of the model's files starts, and asks for the storage lock: one that gets it is done before the
        // removal goes on, and one that waits for the removal's is passed.
        const since = locks.calls;
        moving = relocatePrint(moved, []);
        for (let waited = 0; locks.calls <= since && waited < 4000; waited += 10) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await Promise.race([moving, new Promise((resolve) => setTimeout(resolve, 300))]);
        return row;
      });
    }) as never);
    try {
      await request(app).delete(`/api/print/${model.print.id}/files/${note.id}`).set(auth(owner.token)).expect(200);
      await moving;
    } finally {
      spy.mockRestore();
    }
    const newPlace = path.join(STORAGE, path.dirname(path.dirname(note.storagePath)), moved.name, "gone.txt");
    expect(fs.existsSync(path.join(STORAGE, note.storagePath))).toBe(false);
    expect(fs.existsSync(newPlace)).toBe(false);
  });

  it("keeps a plate an upload adds while a repair looks at the model's files", async () => {
    const model = await makePrint(dir, owner.id, "Repaired meanwhile");
    fs.rmSync(path.join(STORAGE, model.plate.storagePath), { force: true });
    // The upload comes in after the repair saw the files gone, as it goes to take the old rows away.
    const deleteMany = prisma.plate.deleteMany.bind(prisma.plate);
    let adding: Promise<unknown> | null = null;
    const spy = vi.spyOn(prisma.plate, "deleteMany").mockImplementation(((
      args: Parameters<typeof prisma.plate.deleteMany>[0],
    ) => {
      if (adding || args?.where?.printId !== model.print.id) return deleteMany(args);
      adding = addPlatesToPrint(owner.id, model.print.id, [
        { filename: "added.stl", tempFilePath: tempFile(dir, "solid added\nendsolid\n") },
      ]);
      // One that isn't kept waiting is in before the rows go.
      return Promise.race([adding, new Promise((resolve) => setTimeout(resolve, 300))]).then(() => deleteMany(args));
    }) as never);
    try {
      await replaceModelPlates(owner.id, model.print.id, [
        { filename: "fetched.stl", tempFilePath: tempFile(dir, "solid fetched\nendsolid\n") },
      ]);
      await adding;
    } finally {
      spy.mockRestore();
    }
    const plates = await prisma.plate.findMany({ where: { printId: model.print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual(["fetched.stl", "added.stl"]);
  });

  it("keeps the extension a rename just before gave a file, for a new name asked for without one", async () => {
    const model = await makePrint(dir, owner.id, "Renamed twice");
    const note = await upload(dir, owner.id, model.print.id, "draft.txt", "notes");
    // The other rename lands after this one read the file and before it gets the lock.
    const findUnique = prisma.printFile.findUnique.bind(prisma.printFile);
    let other: Promise<void> | null = null;
    const spy = vi.spyOn(prisma.printFile, "findUnique").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findUnique>[0],
    ) => {
      if (other || args.where.id !== note.id) return findUnique(args);
      return findUnique(args).then(async (row) => {
        other = renameSupportingFile(owner.id, model.print.id, note.id, "notes.md");
        await other;
        return row;
      });
    }) as never);
    try {
      await renameSupportingFile(owner.id, model.print.id, note.id, "guide");
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.printFile.findUniqueOrThrow({ where: { id: note.id } })).filename).toBe("guide.md");
  });

  it("keeps one copy of a script two imports of a model's profiles bring at once", async () => {
    const model = await makePrint(dir, owner.id, "Two scripts");
    // The first import's last look for a copy waits for the second's to happen too, as two at once would meet there; a
    // second kept from looking until the first is done never comes, and the first goes on alone.
    const findMany = prisma.printFile.findMany.bind(prisma.printFile);
    let looks = 0;
    let second = () => {};
    const met = new Promise<void>((resolve) => (second = resolve));
    const spy = vi.spyOn(prisma.printFile, "findMany").mockImplementation(((
      args: Parameters<typeof prisma.printFile.findMany>[0],
    ) => {
      const where = args?.where as { printId?: string; filename?: unknown } | undefined;
      if (where?.printId !== model.print.id || !where.filename) return findMany(args);
      looks += 1;
      if (looks > 1) {
        second();
        return findMany(args);
      }
      return Promise.race([met, new Promise((resolve) => setTimeout(resolve, 300))]).then(() => findMany(args));
    }) as never);
    try {
      await Promise.all(
        ["cube(1);\n", "cube(2);\n"].map((body) =>
          keepGeneratorScripts(owner.id, model.print.id, [
            { filename: "model.scad", tempFilePath: tempFile(dir, body) },
          ]),
        ),
      );
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.printFile.count({ where: { printId: model.print.id, filename: "model.scad" } })).toBe(1);
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
