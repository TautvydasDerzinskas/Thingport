import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";

// What a request adding, removing, reordering or renaming a model's plates leaves when another request changes the same
// plates at the same time, or when a step after the plates are in fails.

const stage = vi.hoisted(() => ({
  // Runs in place of the model read for a request's answer, once; `read` reads it.
  readBack: null as ((read: () => Promise<unknown>) => Promise<unknown>) | null,
  // The next reading of a file for whether it's a sliced print fails.
  readingFails: false,
  // Runs as the next reading of a file for whether it's a sliced print starts, given the file, once.
  duringReading: null as ((filePath: string) => Promise<void>) | null,
  // Runs once the next reading of a file for whether it's a sliced print is done, before its answer, once.
  afterReading: null as (() => Promise<void>) | null,
  // Runs as a new 3MF plate's format is first read, given the file, once; that reading and every one after it then
  // fail, as an unreadable file's do.
  formatFails: null as ((filePath: string) => Promise<void>) | null,
  formatFailed: false,
  // The next reading of a new 3MF plate's format finds none.
  formatGivesNone: false,
  // Each reading of a new 3MF plate's format, with the name and the file it was given.
  formatReads: [] as { filename: string; filePath: string }[],
  // Runs as the next reading of a new 3MF plate's format starts, given the file, once; the reading then goes on.
  beforeFormat: null as ((filePath: string) => Promise<void>) | null,
  // Runs once the next reading of a new 3MF plate's thumbnail pictures is done, once.
  afterThumbnail: null as (() => Promise<void>) | null,
  // The next keeping of a plate's format fails, as a database that went away would.
  keepFormatFails: false,
  // The next look for this model's pictures folder fails.
  assetHomeFailsFor: null as string | null,
  lockCalls: 0,
}));

vi.mock("../src/services/printLoader", async (original) => {
  const actual = await original<typeof import("../src/services/printLoader")>();
  return {
    ...actual,
    printOutById: (...args: Parameters<typeof actual.printOutById>) => {
      const hook = stage.readBack;
      if (!hook) return actual.printOutById(...args);
      stage.readBack = null;
      return hook(() => actual.printOutById(...args));
    },
  };
});
vi.mock("../src/services/preparedPrint", async (original) => {
  const actual = await original<typeof import("../src/services/preparedPrint")>();
  return {
    ...actual,
    inspectPreparedPrint: async (...args: Parameters<typeof actual.inspectPreparedPrint>) => {
      const hook = stage.duringReading;
      if (hook) {
        stage.duringReading = null;
        await hook(args[0]);
      }
      if (!stage.readingFails) {
        const reading = await actual.inspectPreparedPrint(...args);
        const after = stage.afterReading;
        stage.afterReading = null;
        await after?.();
        return reading;
      }
      stage.readingFails = false;
      return Promise.reject(new Error("the disk went away"));
    },
  };
});
vi.mock("../src/services/threeMfFormat", async (original) => {
  const actual = await original<typeof import("../src/services/threeMfFormat")>();
  return {
    ...actual,
    readPlateFormat: async (...args: Parameters<typeof actual.readPlateFormat>) => {
      stage.formatReads.push({ filename: String(args[0]), filePath: String(args[1]) });
      if (stage.formatGivesNone) {
        stage.formatGivesNone = false;
        return null;
      }
      const before = stage.beforeFormat;
      if (before) {
        stage.beforeFormat = null;
        await before(String(args[1]));
      }
      const hook = stage.formatFails;
      if (!hook) return actual.readPlateFormat(...args);
      if (!stage.formatFailed) {
        stage.formatFailed = true;
        await hook(String(args[1]));
      }
      throw new Error("an unreadable 3MF");
    },
    keepPlateFormat: async (...args: Parameters<typeof actual.keepPlateFormat>) => {
      if (!stage.keepFormatFails) return actual.keepPlateFormat(...args);
      stage.keepFormatFails = false;
      throw new Error("the database went away");
    },
  };
});
vi.mock("../src/services/printService", async (original) => {
  const actual = await original<typeof import("../src/services/printService")>();
  return {
    ...actual,
    read3mfThumbnails: async (...args: Parameters<typeof actual.read3mfThumbnails>) => {
      const pictures = await actual.read3mfThumbnails(...args);
      const after = stage.afterThumbnail;
      stage.afterThumbnail = null;
      await after?.();
      return pictures;
    },
  };
});
vi.mock("../src/services/modelAssets", async (original) => {
  const actual = await original<typeof import("../src/services/modelAssets")>();
  return {
    ...actual,
    printAssetHome: (...args: Parameters<typeof actual.printAssetHome>) => {
      if (stage.assetHomeFailsFor !== args[0]) return actual.printAssetHome(...args);
      stage.assetHomeFailsFor = null;
      return Promise.reject(new Error("the database went away"));
    },
  };
});
vi.mock("../src/utils/storageLock", async (original) => {
  const actual = await original<typeof import("../src/utils/storageLock")>();
  return {
    ...actual,
    withStorageLock: <T>(fn: () => Promise<T>) => {
      stage.lockCalls += 1;
      return actual.withStorageLock(fn);
    },
  };
});

import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { addPlatesToPrint, createPrint } from "../src/services/printCreation";
import { assetTarget, plateThumbFile } from "../src/services/modelAssets";
import { replaceModelPlates } from "../src/services/modelFilesReplace";
import { mergeModels } from "../src/services/modelMergeService";
import { saveFileFromTemp } from "../src/services/printFileService";
import { read3mfThumbnails, relocatePrint, saveThumbFromBytes } from "../src/services/printService";
import { addUploadedFiles } from "../src/services/uploadService";
import { withStorageLock } from "../src/utils/storageLock";
import { register } from "./helpers/fileReuse";

const app = createApp();
const stamp = Date.now();
let dir: string;
let owner: { id: string; token: string };
let count = 0;
const auth = () => ({ Authorization: `Bearer ${owner.token}` });
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const queuedAtLock = (since: number, calls: number) =>
  vi.waitFor(() => expect(stage.lockCalls).toBeGreaterThanOrEqual(since + calls), { timeout: 4000, interval: 20 });
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const stl = (name: string) => Buffer.from(`solid ${name}\nendsolid\n`);
const MODEL_XML =
  '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
  '<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/>' +
  '<vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>' +
  '</resources><build><item objectid="1"/></build></model>';

/** A .3mf in a temp file; `sliced`, with the G-code a slicer puts in one, and with `thumbnail` as its picture. */
async function threeMf(sliced: boolean, thumbnail?: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", MODEL_XML);
  if (sliced) zip.file("Metadata/plate_1.gcode", "; printer_model = Bambu Lab P1S\nG28\n");
  if (thumbnail) zip.file("Metadata/thumbnail.png", thumbnail);
  const file = path.join(dir, `part-${count++}.3mf`);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
  return file;
}

function tempStl(name: string): string {
  const file = path.join(dir, `${name}-${count++}`);
  fs.writeFileSync(file, stl(name));
  return file;
}

async function model(files: { filename: string; tempFilePath: string }[]) {
  const { print, plates } = await createPrint(owner.id, { title: `Plates ${stamp} ${count++}` }, "plates", files);
  return { print, plates };
}

const platesOf = async (printId: string) => prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });

/** Another tab's removal of a plate, sent and followed until its route has read the model, after which the next thing
 *  it does is ask for the plate order. One let through is done shortly after; one kept waiting isn't. `sent` is given
 *  the removal as soon as it's sent, for the test to see it done whatever happens. One that never got there throws, which
 *  fails the request this is called from, so that one lets go of the plate order and the removal can finish. */
async function removeMeanwhile(
  printId: string,
  plateId: string,
  sent: (removing: Promise<request.Response>) => void,
): Promise<void> {
  const findFirst = prisma.print.findFirst.bind(prisma.print);
  let reached = () => {};
  const asked = new Promise<void>((resolve) => (reached = resolve));
  let restored = false;
  const restore = () => {
    if (!restored) spy.mockRestore();
    restored = true;
  };
  const spy = vi.spyOn(prisma.print, "findFirst").mockImplementation(((
    args: Parameters<typeof prisma.print.findFirst>[0],
  ) => {
    restore();
    return findFirst(args).then((found) => {
      reached();
      return found;
    });
  }) as never);
  const removing = request(app)
    .delete(`/api/print/${printId}/plates/${plateId}`)
    .set(auth())
    .then((res) => res);
  sent(removing);
  let inTime = false;
  try {
    inTime = await Promise.race([asked.then(() => true), later(4000).then(() => false)]);
  } finally {
    restore();
  }
  if (!inTime) throw new Error("The other tab's removal never read the model");
  await Promise.race([removing, later(200)]);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-plate-batch-"));
  owner = await register(app, "plate-batch", "Owner");
});

afterEach(() => {
  stage.readBack = null;
  stage.readingFails = false;
  stage.duringReading = null;
  stage.afterReading = null;
  stage.formatFails = null;
  stage.formatFailed = false;
  stage.formatGivesNone = false;
  stage.beforeFormat = null;
  stage.afterThumbnail = null;
  stage.keepFormatFails = false;
  stage.assetHomeFailsFor = null;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a model's plates, changed by two requests at once", () => {
  it("puts a plate where its model's new name puts it, though the model was renamed while a file before it saved", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const notes = path.join(dir, `notes-${count++}`);
    fs.writeFileSync(notes, "notes");
    const update = prisma.printFile.update.bind(prisma.printFile);
    let renamed = "";
    const spy = vi.spyOn(prisma.printFile, "update").mockImplementation((async (
      args: Parameters<typeof prisma.printFile.update>[0],
    ) => {
      const updated = await update(args);
      if (!renamed && typeof args.data.storagePath === "string") {
        // Another tab renames the model, and its files move, while notes.txt, sent before lid.stl, is being saved.
        renamed = `Renamed meanwhile ${stamp}`;
        const moved = await prisma.print.update({
          where: { id: print.id },
          data: { name: renamed },
          include: { plates: true },
        });
        await relocatePrint(moved, moved.plates);
      }
      return updated;
    }) as never);
    try {
      await addUploadedFiles(owner.id, print.id, [
        { path: notes, originalname: "notes.txt" },
        { path: tempStl("lid"), originalname: "lid.stl" },
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).not.toBe("");
    const lid = (await platesOf(print.id)).find((plate) => plate.filename === "lid.stl")!;
    expect(lid.storagePath).toContain(renamed);
  });

  it("takes back every plate it added when its answer can't be read, though another tab removed one meanwhile", async () => {
    const { print, plates } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let removing: Promise<request.Response> | null = null;
    stage.readBack = async () => {
      // Another tab removes the model's own plate while this request reads its answer.
      await removeMeanwhile(print.id, plates[0].id, (sent) => (removing = sent));
      throw new Error("the database went away");
    };

    try {
      const res = await request(app)
        .post(`/api/print/${print.id}/plates`)
        .set(auth())
        .attach("files", stl("b"), "b.stl");

      expect(res.status).toBe(500);
      // It waited for the batch to be taken back, and the plate it would remove was the only one by then.
      expect((await removing!).status).toBe(409);
      expect((await platesOf(print.id)).map((plate) => plate.filename)).toEqual(["a.stl"]);
    } finally {
      await removing;
    }
  });

  it("takes back every plate it added when its answer can't be read, though its pictures' folder can't be either", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    stage.readBack = async () => {
      stage.assetHomeFailsFor = print.id;
      throw new Error("the database went away");
    };

    const res = await request(app).post(`/api/print/${print.id}/plates`).set(auth()).attach("files", stl("b"), "b.stl");

    expect(res.status).toBe(500);
    expect(stage.assetHomeFailsFor).toBeNull();
    expect((await platesOf(print.id)).map((plate) => plate.filename)).toEqual(["a.stl"]);
  });

  it("answers with every plate it made, though another tab removes one as the answer is read", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let removing: Promise<request.Response> | null = null;
    stage.readBack = async (read) => {
      const made = (await platesOf(print.id)).at(-1)!;
      await removeMeanwhile(print.id, made.id, (sent) => (removing = sent));
      return read();
    };

    try {
      const res = await request(app)
        .post(`/api/print/${print.id}/plates`)
        .set(auth())
        .attach("files", stl("b"), "b.stl");

      expect(res.status).toBe(200);
      expect(res.body.print.plates.map((plate: { id: string }) => plate.id)).toContain(res.body.plate_ids[0]);
      // The other tab's removal goes through once the answer is out.
      expect((await removing!).status).toBe(200);
    } finally {
      await removing;
    }
  });

  it("saves a new first plate's reading with the order, so asking again after it failed reads it again", async () => {
    const { print, plates } = await model([
      { filename: "sliced.3mf", tempFilePath: await threeMf(true) },
      { filename: "plain.stl", tempFilePath: tempStl("plain") },
    ]);
    const reading = (await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata;
    expect(reading).not.toBeNull();
    const order = [plates[1].id, plates[0].id];

    stage.readingFails = true;
    const failed = await request(app)
      .post(`/api/print/${print.id}/plates/reorder`)
      .set(auth())
      .send({ plate_ids: order });
    expect(failed.status).toBe(500);
    // Nothing of it saved: neither the order nor a reading.
    expect((await platesOf(print.id)).map((plate) => plate.id)).toEqual(plates.map((plate) => plate.id));
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toEqual(reading);
    const retried = await request(app)
      .post(`/api/print/${print.id}/plates/reorder`)
      .set(auth())
      .send({ plate_ids: order });
    expect(retried.status).toBe(200);

    expect((await platesOf(print.id)).map((plate) => plate.id)).toEqual(order);
    // The plain file first: there's no sliced print to read any more.
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toBeNull();
  });

  it("saves a new first plate's reading with a removal, so asking again after it failed reads it again", async () => {
    const { print, plates } = await model([
      { filename: "sliced.3mf", tempFilePath: await threeMf(true) },
      { filename: "plain.stl", tempFilePath: tempStl("plain") },
    ]);
    const reading = (await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata;
    expect(reading).not.toBeNull();
    const remove = () => request(app).delete(`/api/print/${print.id}/plates/${plates[0].id}`).set(auth());

    stage.readingFails = true;
    expect((await remove()).status).toBe(500);
    // Nothing of it saved: the plates, their places and the reading are as they were.
    const places = (list: { id: string; position: number }[]) => list.map((plate) => [plate.id, plate.position]);
    expect(places(await platesOf(print.id))).toEqual(places(plates));
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toEqual(reading);
    expect((await remove()).status).toBe(200);

    expect((await platesOf(print.id)).map((plate) => plate.filename)).toEqual(["plain.stl"]);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toBeNull();
  });

  it("reads a renamed plate again when a reorder made it first while it was being renamed", async () => {
    const { print, plates } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    // Named as a sliced print, which by its name alone it reads as.
    const [job] = await addPlatesToPrint(owner.id, print.id, [
      { filename: "job.gcode.3mf", tempFilePath: await threeMf(false) },
    ]);
    const update = prisma.plate.update.bind(prisma.plate);
    let reordered: request.Response | null = null;
    const spy = vi.spyOn(prisma.plate, "update").mockImplementation(((
      args: Parameters<typeof prisma.plate.update>[0],
    ) => {
      if (reordered || args.data.filename !== "job.3mf") return update(args);
      // The reorder lands after the rename read the plate, before it saves the new name.
      return request(app)
        .post(`/api/print/${print.id}/plates/reorder`)
        .set(auth())
        .send({ plate_ids: [job.id, plates[0].id] })
        .then((res) => {
          reordered = res;
          return update(args);
        });
    }) as never);
    try {
      const res = await request(app)
        .post(`/api/print/${print.id}/plate/${job.id}/rename`)
        .set(auth())
        .send({ filename: "job.3mf" });
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(reordered!.status).toBe(200);
    // As job.3mf, with no G-code in it, it isn't a sliced print.
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toBeNull();
  });

  it("reads a plate a reorder made first again where a move took it while it was being read", async () => {
    const { print, plates } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const [job] = await addPlatesToPrint(owner.id, print.id, [
      { filename: "job.3mf", tempFilePath: await threeMf(true) },
    ]);
    // The move's saving of where the file went waits until the reorder, having found the file gone, asks for the
    // storage lock to look where it went; one that never asks is let go after a while, and finds the old place.
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const update = prisma.plate.update.bind(prisma.plate);
    const spy = vi.spyOn(prisma.plate, "update").mockImplementation(((
      args: Parameters<typeof prisma.plate.update>[0],
    ) => {
      if (args.where.id !== job.id || typeof args.data.storagePath !== "string") return update(args);
      return gate.then(() => update(args));
    }) as never);
    let moving: Promise<unknown> | null = null;
    let watching: Promise<void> | null = null;
    stage.duringReading = async (filePath) => {
      // A rename of the model moves its files as the reorder reads its new first plate, which is gone when read.
      const moved = await prisma.print.update({
        where: { id: print.id },
        data: { name: `Read away ${stamp}` },
        include: { plates: true },
      });
      moving = relocatePrint(moved, moved.plates);
      await vi.waitFor(() => expect(fs.existsSync(filePath)).toBe(false), { timeout: 4000, interval: 10 });
      // The move holds the lock from here until its save: the next lock asked for is the reorder's second look.
      const since = stage.lockCalls;
      watching = (async () => {
        for (let waited = 0; stage.lockCalls <= since && waited < 4000; waited += 10) await later(10);
        open();
      })();
    };
    try {
      const res = await request(app)
        .post(`/api/print/${print.id}/plates/reorder`)
        .set(auth())
        .send({ plate_ids: [job.id, plates[0].id] });
      expect(res.status).toBe(200);
    } finally {
      open();
      await Promise.allSettled([watching, moving]);
      spy.mockRestore();
    }
    expect(moving).not.toBeNull();
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).not.toBeNull();
  });

  it("keeps no reading of a file that moves put where a reorder's new first plate was read, and took away again", async () => {
    const { print, plates } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const [plain, job] = await addPlatesToPrint(owner.id, print.id, [
      { filename: "plain.3mf", tempFilePath: await threeMf(false) },
      { filename: "job.3mf", tempFilePath: await threeMf(true) },
    ]);
    // Each file renamed and its row saved where it went, under the storage lock, as a move does.
    const move = (moves: [string, string][]) =>
      withStorageLock(async () => {
        for (const [plateId, storagePath] of moves) {
          const now = await prisma.plate.findUniqueOrThrow({ where: { id: plateId } });
          fs.renameSync(path.join(STORAGE, now.storagePath), path.join(STORAGE, storagePath));
          await prisma.plate.update({ where: { id: plateId }, data: { storagePath } });
        }
      });
    const aside = `${plain.storagePath}.aside`;
    // As the plain plate is read, the sliced one's file is put where it was, and once read, each goes back: the plate's
    // path is the same before and after.
    stage.duringReading = () =>
      move([
        [plain.id, aside],
        [job.id, plain.storagePath],
      ]);
    stage.afterReading = () =>
      move([
        [job.id, job.storagePath],
        [plain.id, plain.storagePath],
      ]);

    const res = await request(app)
      .post(`/api/print/${print.id}/plates/reorder`)
      .set(auth())
      .send({ plate_ids: [plain.id, plates[0].id, job.id] });
    expect(res.status).toBe(200);
    expect(stage.afterReading).toBeNull();
    // The plain plate first, which isn't sliced: no reading of the sliced one stands for it.
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).toBeNull();
    expect((await platesOf(print.id)).map((plate) => plate.id)).toEqual([plain.id, plates[0].id, job.id]);
  });

  it("reads a new 3MF plate's file where a rename moved it as it was stored", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const create = prisma.plate.create.bind(prisma.plate);
    let renamed = "";
    const spy = vi.spyOn(prisma.plate, "create").mockImplementation((async (
      args: Parameters<typeof prisma.plate.create>[0],
    ) => {
      const made = await create(args);
      if (!renamed && args.data.printId === print.id && args.data.filename === "part.3mf") {
        // Another tab renames the model as the plate's row is made, and its move takes the new plate along first.
        renamed = `Read where moved ${stamp}`;
        const moved = await prisma.print.update({
          where: { id: print.id },
          data: { name: renamed },
          include: { plates: true },
        });
        await relocatePrint(moved, moved.plates);
      }
      return made;
    }) as never);
    stage.formatReads = [];
    try {
      await addPlatesToPrint(owner.id, print.id, [{ filename: "part.3mf", tempFilePath: await threeMf(false) }]);
    } finally {
      spy.mockRestore();
    }
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    expect(renamed).not.toBe("");
    expect(part.storagePath).toContain(renamed);
    // Its format was read, from the file where it is.
    const reads = stage.formatReads.filter((read) => read.filename === "part.3mf");
    expect(reads).toHaveLength(1);
    expect(fs.existsSync(reads[0].filePath)).toBe(true);
  });

  it("reads a new 3MF plate once more where a rename moved it while it was being read", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let renamed = "";
    stage.formatReads = [];
    stage.beforeFormat = async () => {
      // Another tab renames the model, and its files move, as the new plate's format is read.
      renamed = `Moved mid-read ${stamp}`;
      const moved = await prisma.print.update({
        where: { id: print.id },
        data: { name: renamed },
        include: { plates: true },
      });
      await relocatePrint(moved, moved.plates);
    };
    await addPlatesToPrint(owner.id, print.id, [{ filename: "part.3mf", tempFilePath: await threeMf(false) }]);
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    expect(part.storagePath).toContain(renamed);
    // The first reading found the file gone; the second was where it went.
    const reads = stage.formatReads.filter((read) => read.filename === "part.3mf");
    expect(reads).toHaveLength(2);
    expect(reads[1].filePath).not.toBe(reads[0].filePath);
    expect(fs.existsSync(reads[1].filePath)).toBe(true);
  });

  it("keeps no thumbnail of another file that took a new 3MF plate's place while it was being read", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const picture = async (background: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    const other = await threeMf(false, await picture("#0000ff"));
    let left = "";
    stage.beforeFormat = async (filePath) => {
      // Another tab renames the model, and its files move, as the new plate's format is read; another model's 3MF then
      // takes the place the plate's file left.
      const moved = await prisma.print.update({
        where: { id: print.id },
        data: { name: `Took its place ${stamp}` },
        include: { plates: true },
      });
      await relocatePrint(moved, moved.plates);
      left = filePath;
      fs.mkdirSync(path.dirname(left), { recursive: true });
      fs.copyFileSync(other, left);
    };
    // Once the other file's pictures are read, the plate has no thumbnail yet: none is kept until the reading is
    // known to be its own file's, as a browser keeps one it was served.
    let early: boolean | null = null;
    stage.afterThumbnail = async () => {
      const plate = await prisma.plate.findFirstOrThrow({ where: { printId: print.id, filename: "part.3mf" } });
      const now = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
      early = fs.existsSync(assetTarget(now.assetsPath!, plateThumbFile(plate.id)));
    };
    try {
      await addPlatesToPrint(owner.id, print.id, [
        { filename: "part.3mf", tempFilePath: await threeMf(false, await picture("#ff0000")) },
      ]);
    } finally {
      stage.beforeFormat = null;
      if (left) fs.rmSync(left, { force: true });
    }
    expect(left).not.toBe("");
    expect(early).toBe(false);
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    // Its thumbnail is its own file's picture, red, not the blue of the file that took its place.
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    const [red, , blue] = (await sharp(assetTarget(assetsPath!, plateThumbFile(part.id))).stats()).channels;
    expect(red.mean).toBeGreaterThan(200);
    expect(blue.mean).toBeLessThan(50);
  });

  it("keeps no format of another file that took a new 3MF plate's place, though its own then reads as none", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const other = await threeMf(true);
    let left = "";
    stage.beforeFormat = async (filePath) => {
      // The model is renamed as the new plate's format is read, and a sliced 3MF takes the place its file left; the
      // reading again, with the lock held, then finds no format in its own.
      const moved = await prisma.print.update({
        where: { id: print.id },
        data: { name: `Format from elsewhere ${stamp}` },
        include: { plates: true },
      });
      await relocatePrint(moved, moved.plates);
      left = filePath;
      fs.mkdirSync(path.dirname(left), { recursive: true });
      fs.copyFileSync(other, left);
      stage.formatGivesNone = true;
    };
    try {
      await addPlatesToPrint(owner.id, print.id, [{ filename: "part.3mf", tempFilePath: await threeMf(false) }]);
    } finally {
      stage.beforeFormat = null;
      if (left) fs.rmSync(left, { force: true });
    }
    expect(left).not.toBe("");
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    expect(part.format).toBeNull();
  });

  it("keeps a new 3MF plate and its thumbnail though its format couldn't be kept, and reads that on the next open", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    stage.keepFormatFails = true;
    await addPlatesToPrint(owner.id, print.id, [
      { filename: "part.3mf", tempFilePath: await threeMf(false, ONE_PIXEL_PNG) },
    ]);
    expect(stage.keepFormatFails).toBe(false);
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    expect(part.format).toBeNull();
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect(fs.existsSync(assetTarget(assetsPath!, plateThumbFile(part.id)))).toBe(true);
    const opened = await request(app).get(`/api/print/${print.id}`).set(auth());
    expect(opened.status).toBe(200);
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: part.id } })).format).not.toBeNull();
  });

  it("keeps no thumbnail of another file that was in a new 3MF plate's place while it was read, its own back since", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const picture = async (background: string) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .png()
        .toBuffer();
    const other = await threeMf(false, await picture("#0000ff"));
    const rename = async (name: string) => {
      const moved = await prisma.print.update({ where: { id: print.id }, data: { name }, include: { plates: true } });
      await relocatePrint(moved, moved.plates);
    };
    let left = "";
    stage.beforeFormat = async (filePath) => {
      // Another tab renames the model as the new plate is read, so its file moves, and another model's 3MF takes the
      // place it left...
      await rename(`Away and back ${stamp}`);
      left = filePath;
      fs.mkdirSync(path.dirname(left), { recursive: true });
      fs.copyFileSync(other, left);
    };
    stage.afterThumbnail = async () => {
      // ...which leaves again once its picture is taken, and the old name is put back, bringing the plate's file back
      // to where it was read.
      fs.rmSync(left, { force: true });
      await rename(print.name);
    };
    await addPlatesToPrint(owner.id, print.id, [
      { filename: "part.3mf", tempFilePath: await threeMf(false, await picture("#ff0000")) },
    ]);
    const part = (await platesOf(print.id)).find((plate) => plate.filename === "part.3mf")!;
    expect(left).not.toBe("");
    expect(path.join(STORAGE, part.storagePath)).toBe(left);
    // Its thumbnail is its own file's picture, red, not the blue of the file that was there while it was read.
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    const [red, , blue] = (await sharp(assetTarget(assetsPath!, plateThumbFile(part.id))).stats()).channels;
    expect(red.mean).toBeGreaterThan(200);
    expect(blue.mean).toBeLessThan(50);
  });

  it("takes back the plate a failed upload added to a model that had none, so asking again adds it once", async () => {
    const name = `No plates ${stamp} ${count++}`;
    const print = await prisma.print.create({ data: { userId: owner.id, name, nameNormalized: name.toLowerCase() } });
    // The file beside the plate is gone by the time it's saved, so the upload fails once the plate is in.
    const upload = (guide: string) =>
      addUploadedFiles(owner.id, print.id, [
        { path: tempStl("body"), originalname: "body.stl", mimetype: "model/stl" },
        { path: guide, originalname: "guide.pdf", mimetype: "application/pdf" },
      ]);
    await expect(upload(path.join(dir, `gone-${count++}.pdf`))).rejects.toThrow(/ENOENT/);
    expect(await platesOf(print.id)).toEqual([]);
    const guide = path.join(dir, `guide-${count++}.pdf`);
    fs.writeFileSync(guide, "%PDF-1.4 guide");
    await upload(guide);
    expect((await platesOf(print.id)).map((plate) => plate.filename)).toEqual(["body.stl"]);
  });

  it("gives a repaired model its new first plate's reading before a merge into it can read the old one", async () => {
    // Its first plate a sliced print whose file has gone, and another model with a prepared print of its own.
    const { print, plates } = await model([{ filename: "sliced.3mf", tempFilePath: await threeMf(true) }]);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).not.toBeNull();
    fs.rmSync(path.join(STORAGE, plates[0].storagePath), { force: true });
    const other = await model([{ filename: "b.stl", tempFilePath: tempStl("b") }]);
    const gcode = path.join(dir, `b-${count++}.gcode`);
    fs.writeFileSync(gcode, "; printer_model = Bambu Lab P1S\nG28\n");
    await saveFileFromTemp(owner.id, other.print.id, gcode, "b.gcode", null);
    const prepared = (await prisma.print.findUniqueOrThrow({ where: { id: other.print.id } })).preparedFileId;
    expect(prepared).not.toBeNull();
    // The owner merges the other model into it once the repair's plates are in and it has let go of their order: at
    // the repair's next step, its look for where the old plates' pictures are.
    const findUniqueOrThrow = prisma.print.findUniqueOrThrow.bind(prisma.print);
    let merged = false;
    const spy = vi.spyOn(prisma.print, "findUniqueOrThrow").mockImplementation((async (
      args: Parameters<typeof prisma.print.findUniqueOrThrow>[0],
    ) => {
      const select = Object.keys(args.select ?? {});
      if (!merged && args.where.id === print.id && select.join() === "assetsPath") {
        merged = true;
        await mergeModels(owner.id, print.id, [other.print.id]);
      }
      return findUniqueOrThrow(args);
    }) as never);
    try {
      await replaceModelPlates(owner.id, print.id, [{ filename: "plain.stl", tempFilePath: tempStl("plain") }]);
    } finally {
      spy.mockRestore();
    }
    expect(merged).toBe(true);
    // With a plain file first, nothing stands for a prepared print, so the model took the other's as its own.
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedFileId).toBe(prepared);
    expect((await prisma.printFile.findUniqueOrThrow({ where: { id: prepared! } })).role).toBe("PREPARED");
  });

  it("puts each plate of a batch where its model's new name puts it, though the model was renamed after the first was stored", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    const create = prisma.plate.create.bind(prisma.plate);
    let renamed = "";
    const spy = vi.spyOn(prisma.plate, "create").mockImplementation((async (
      args: Parameters<typeof prisma.plate.create>[0],
    ) => {
      const made = await create(args);
      if (!renamed && args.data.printId === print.id && args.data.filename === "first.stl") {
        // Another tab renames the model, and its files move, once the first of the two is stored.
        renamed = `Renamed between ${stamp}`;
        const moved = await prisma.print.update({
          where: { id: print.id },
          data: { name: renamed },
          include: { plates: true },
        });
        await relocatePrint(moved, moved.plates);
      }
      return made;
    }) as never);
    try {
      await addPlatesToPrint(owner.id, print.id, [
        { filename: "first.stl", tempFilePath: tempStl("first") },
        { filename: "second.stl", tempFilePath: tempStl("second") },
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(renamed).not.toBe("");
    const now = await platesOf(print.id);
    expect(now.map((plate) => plate.filename)).toEqual(["a.stl", "first.stl", "second.stl"]);
    for (const plate of now) {
      expect(plate.storagePath).toContain(renamed);
      expect(fs.existsSync(path.join(STORAGE, plate.storagePath))).toBe(true);
    }
  });

  it("removes the pictures of a plate it takes back from where a move put them while it waited", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding: Promise<unknown> | null = null;
    let moving: Promise<unknown> | null = null;
    let since = 0;
    let plateId = "";
    stage.formatFails = async () => {
      const { id } = await prisma.plate.findFirstOrThrow({ where: { printId: print.id, filename: "bad.3mf" } });
      plateId = id;
      // Its thumbnail is in the model's pictures folder by the time its file turns out unreadable...
      expect(await saveThumbFromBytes(id, ONE_PIXEL_PNG)).toBe(true);
      const now = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
      expect(fs.existsSync(assetTarget(now.assetsPath!, plateThumbFile(id)))).toBe(true);
      // ...and a move of the model's pictures is waiting its turn at the lock as the plate is taken back.
      since = stage.lockCalls;
      holding = withStorageLock(() => released);
      moving = relocatePrint({ ...now, name: `Pictures moved ${stamp}` }, []);
      await queuedAtLock(since, 2);
    };

    const adding = addPlatesToPrint(owner.id, print.id, [
      { filename: "bad.3mf", tempFilePath: await threeMf(false) },
    ]).then(
      () => null,
      (err: unknown) => err,
    );
    try {
      await vi.waitFor(() => expect(holding).not.toBeNull(), { timeout: 4000, interval: 20 });
      // The plate's taking back is in line behind the move.
      await queuedAtLock(since, 3);
    } finally {
      // Let go whatever happened, or every storage step after this test would wait for it, and see what started
      // through, so none of it is still going in the next test: the adding first, as its hook is what starts the
      // other two, which are then set if they ever will be.
      release();
      await Promise.allSettled([adding]);
      await Promise.allSettled([moving, holding]);
    }

    expect(await adding).toBeInstanceOf(Error);
    await moving;
    await holding;
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect(assetsPath).toContain("Pictures moved");
    expect(fs.existsSync(assetTarget(assetsPath!, plateThumbFile(plateId)))).toBe(false);
    expect(await prisma.plate.count({ where: { id: plateId } })).toBe(0);
  });
});

// The pictures a 3MF names as its thumbnail, read before one is tried: as many as an archive names, they're held to a
// few, and to so much in all.
describe("a 3MF's thumbnail pictures", () => {
  async function threeMfWith(pictures: Record<string, Buffer>): Promise<string> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("3D/3dmodel.model", MODEL_XML);
    for (const [name, bytes] of Object.entries(pictures)) zip.file(name, bytes);
    const file = path.join(dir, `pictures-${count++}.3mf`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    return file;
  }

  it("are read best first, and no more than four of them", async () => {
    const names = [
      "Metadata/thumbnail.png",
      "3D/thumbnail.png",
      "thumbnail.png",
      "a/thumbnail.png",
      "b/thumbnail.png",
      "c/thumbnail.png",
    ];
    const file = await threeMfWith(
      Object.fromEntries(names.map((name, index) => [name, Buffer.from(`picture ${index}`)])),
    );
    const pictures = await read3mfThumbnails(file);
    expect(pictures.map((each) => each.toString())).toEqual(["picture 0", "picture 1", "picture 2", "picture 3"]);
  });

  it("come to no more than 32 MiB in all, however large the archive says each is", async () => {
    // Two of the largest a picture may be make 32 MiB exactly; a byte more is one too many.
    const largest = Buffer.alloc(16 * 1024 * 1024);
    const file = await threeMfWith({
      "Metadata/thumbnail.png": largest,
      "3D/thumbnail.png": largest,
      "thumbnail.png": Buffer.from("a"),
    });
    expect((await read3mfThumbnails(file)).map((each) => each.length)).toEqual([largest.length, largest.length]);
  });

  it("pass over one that doesn't fit what's left for a smaller one after it", async () => {
    const big = Buffer.alloc(12 * 1024 * 1024);
    const file = await threeMfWith({
      "Metadata/thumbnail.png": big,
      "3D/thumbnail.png": big,
      "thumbnail.png": big,
      "a/thumbnail.png": Buffer.from("a small picture"),
    });
    const pictures = await read3mfThumbnails(file);
    expect(pictures.map((each) => each.length)).toEqual([big.length, big.length, 15]);
  });
});
