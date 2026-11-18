import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// What a request adding, removing, reordering or renaming a model's plates leaves when another request changes the same
// plates at the same time, or when a step after the plates are in fails.

const stage = vi.hoisted(() => ({
  // Runs in place of the model read for a request's answer, once; `read` reads it.
  readBack: null as ((read: () => Promise<unknown>) => Promise<unknown>) | null,
  // The next reading of a file for whether it's a sliced print fails.
  readingFails: false,
  // Runs as the next reading of a file for whether it's a sliced print starts, given the file, once.
  duringReading: null as ((filePath: string) => Promise<void>) | null,
  // Runs as a new 3MF plate's format is read, once, which then fails.
  formatFails: null as ((plateId: string) => Promise<void>) | null,
  // Each reading of a new 3MF plate's format, with the file it was given.
  formatReads: [] as { plateId: string; filePath: string }[],
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
      if (!stage.readingFails) return actual.inspectPreparedPrint(...args);
      stage.readingFails = false;
      return Promise.reject(new Error("the disk went away"));
    },
  };
});
vi.mock("../src/services/threeMfFormat", async (original) => {
  const actual = await original<typeof import("../src/services/threeMfFormat")>();
  return {
    ...actual,
    storePlateFormat: async (...args: Parameters<typeof actual.storePlateFormat>) => {
      stage.formatReads.push({ plateId: String(args[0]), filePath: String(args[2]) });
      const hook = stage.formatFails;
      if (!hook) return actual.storePlateFormat(...args);
      stage.formatFails = null;
      await hook(args[0]);
      throw new Error("an unreadable 3MF");
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
import { relocatePrint, saveThumbFromBytes } from "../src/services/printService";
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

/** A .3mf in a temp file; `sliced`, with the G-code a slicer puts in one. */
async function threeMf(sliced: boolean): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", MODEL_XML);
  if (sliced) zip.file("Metadata/plate_1.gcode", "; printer_model = Bambu Lab P1S\nG28\n");
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
 *  it does is ask for the plate order. One let through is done shortly after; one kept waiting isn't. */
async function removeMeanwhile(printId: string, plateId: string): Promise<{ removing: Promise<request.Response> }> {
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
  let inTime = false;
  try {
    inTime = await Promise.race([asked.then(() => true), later(4000).then(() => false)]);
  } finally {
    restore();
  }
  // One that never got there tried nothing: the test fails, once the request is done.
  if (!inTime) {
    await Promise.race([removing, later(4000)]);
    throw new Error("The other tab's removal never read the model");
  }
  await Promise.race([removing, later(200)]);
  return { removing };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-plate-batch-"));
  owner = await register(app, "plate-batch", "Owner");
});

afterEach(() => {
  stage.readBack = null;
  stage.readingFails = false;
  stage.duringReading = null;
  stage.formatFails = null;
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
      ({ removing } = await removeMeanwhile(print.id, plates[0].id));
      throw new Error("the database went away");
    };

    const res = await request(app).post(`/api/print/${print.id}/plates`).set(auth()).attach("files", stl("b"), "b.stl");

    expect(res.status).toBe(500);
    // It waited for the batch to be taken back, and the plate it would remove was the only one by then.
    expect((await removing!).status).toBe(409);
    expect((await platesOf(print.id)).map((plate) => plate.filename)).toEqual(["a.stl"]);
  });

  it("answers with every plate it made, though another tab removes one as the answer is read", async () => {
    const { print } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let removing: Promise<request.Response> | null = null;
    stage.readBack = async (read) => {
      const made = (await platesOf(print.id)).at(-1)!;
      ({ removing } = await removeMeanwhile(print.id, made.id));
      return read();
    };

    const res = await request(app).post(`/api/print/${print.id}/plates`).set(auth()).attach("files", stl("b"), "b.stl");

    expect(res.status).toBe(200);
    expect(res.body.print.plates.map((plate: { id: string }) => plate.id)).toContain(res.body.plate_ids[0]);
    // The other tab's removal goes through once the answer is out.
    expect((await removing!).status).toBe(200);
  });

  it("saves a new first plate's reading with the order, so asking again after it failed reads it again", async () => {
    const { print, plates } = await model([
      { filename: "sliced.3mf", tempFilePath: await threeMf(true) },
      { filename: "plain.stl", tempFilePath: tempStl("plain") },
    ]);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).not.toBeNull();
    const order = [plates[1].id, plates[0].id];

    stage.readingFails = true;
    const failed = await request(app)
      .post(`/api/print/${print.id}/plates/reorder`)
      .set(auth())
      .send({ plate_ids: order });
    expect(failed.status).toBe(500);
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
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).preparedMetadata).not.toBeNull();
    const remove = () => request(app).delete(`/api/print/${print.id}/plates/${plates[0].id}`).set(auth());

    stage.readingFails = true;
    expect((await remove()).status).toBe(500);
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
    expect(part.storagePath).toContain(renamed);
    // Its format was read, from the file where it is.
    const reads = stage.formatReads.filter((read) => read.plateId === part.id);
    expect(reads).toHaveLength(1);
    expect(fs.existsSync(reads[0].filePath)).toBe(true);
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
    stage.formatFails = async (id) => {
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
