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
  // Runs as a new 3MF plate's format is read, once, which then fails.
  formatFails: null as ((plateId: string) => Promise<void>) | null,
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
    inspectPreparedPrint: (...args: Parameters<typeof actual.inspectPreparedPrint>) => {
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
import { prisma } from "../src/db";
import { addPlatesToPrint, createPrint } from "../src/services/printCreation";
import { assetTarget, plateThumbFile } from "../src/services/modelAssets";
import { relocatePrint, saveThumbFromBytes } from "../src/services/printService";
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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-plate-batch-"));
  owner = await register(app, "plate-batch", "Owner");
});

afterEach(() => {
  stage.readBack = null;
  stage.readingFails = false;
  stage.formatFails = null;
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a model's plates, changed by two requests at once", () => {
  it("takes back every plate it added when its answer can't be read, though another tab removed one meanwhile", async () => {
    const { print, plates } = await model([{ filename: "a.stl", tempFilePath: tempStl("a") }]);
    let removing: Promise<request.Response> | null = null;
    stage.readBack = async () => {
      // Another tab removes the model's own plate while this request reads its answer.
      removing = request(app)
        .delete(`/api/print/${print.id}/plates/${plates[0].id}`)
        .set(auth())
        .then((res) => res);
      await Promise.race([removing, later(400)]);
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
      removing = request(app)
        .delete(`/api/print/${print.id}/plates/${made.id}`)
        .set(auth())
        .then((res) => res);
      await Promise.race([removing, later(400)]);
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
    await vi.waitFor(() => expect(holding).not.toBeNull(), { timeout: 4000, interval: 20 });
    // The plate's taking back is in line behind the move.
    await queuedAtLock(since, 3);
    release();

    expect(await adding).toBeInstanceOf(Error);
    await moving;
    await holding;
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect(assetsPath).toContain("Pictures moved");
    expect(fs.existsSync(assetTarget(assetsPath!, plateThumbFile(plateId)))).toBe(false);
    expect(await prisma.plate.count({ where: { id: plateId } })).toBe(0);
  });
});
