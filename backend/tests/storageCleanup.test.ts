import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { createApp } from "../src/app";
import { ADAPTED_3MFS, MODEL_PREVIEWS, STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { attachImportedPreviewImages } from "../src/services/importService";
import { assetTarget, plateGlbFile } from "../src/services/modelAssets";
import { generateModelPreviewGlb } from "../src/services/modelPreviewCache";
import { reorderPreviewImages } from "../src/services/previewImageService";
import { currentStorageCleanup, startStorageCleanup } from "../src/services/storageCleanup";
import { currentStorageMove } from "../src/services/storageMoveService";
import { takeInventory } from "../src/services/storageInventory";
import { getPhotosPerModel, setPhotosPerModel } from "../src/services/settingsService";
import { withStorageLock } from "../src/utils/storageLock";
import { writeZip } from "../src/utils/zipWriter";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
let memberToken: string;

const auth = (bearer = token) => ({ Authorization: `Bearer ${bearer}` });
const STL =
  "solid part\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid part\n";
const png = (red: number) =>
  sharp({ create: { width: 16, height: 16, channels: 3, background: { r: red, g: 10, b: 10 } } })
    .png()
    .toBuffer();

async function uploadStl(): Promise<{ printId: string; plateId: string; home: string }> {
  const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(STL), "part.stl");
  expect(res.status).toBe(200);
  const printId = res.body.prints[0].id as string;
  const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
  const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
  return { printId, plateId: plate.id, home: print.assetsPath! };
}

/** A real, unpacked GLB of a few thousand triangles, as three's exporter writes them. */
async function plainGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions: number[] = [];
  for (let i = 0; i < 3000; i++) positions.push(i % 50, Math.floor(i / 50), Math.sin(i) * 3);
  const accessor = doc
    .createAccessor()
    .setType(Accessor.Type.VEC3)
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", accessor);
  doc.createScene().addChild(doc.createNode("preview").setMesh(doc.createMesh().addPrimitive(primitive)));
  return new NodeIO().writeBinary(doc);
}

function write(file: string, contents: string | Uint8Array): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

async function waitForCleanup(): Promise<void> {
  for (let i = 0; i < 300 && currentStorageCleanup()?.running; i++) await new Promise((r) => setTimeout(r, 100));
  expect(currentStorageCleanup()?.running).toBe(false);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The run's notification, once it's written: the run says it's over just before. One from before `since` isn't it. */
async function freedNotice(since: Date) {
  for (let i = 0; i < 50; i++) {
    const told = await prisma.notification.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
    });
    if ((told?.message as { key?: string } | null)?.key === "storageFreed") return told;
    await sleep(100);
  }
  return null;
}

/** A model with `count` photos of its own, in their order, and where they're kept. */
async function withPhotos(count: number) {
  const { printId, plateId, home } = await uploadStl();
  for (let i = 0; i < count; i++) {
    const added = await request(app)
      .post(`/api/print/${printId}/preview-images`)
      .set(auth())
      .attach("files", await png(200 - i * 40), "photo.png");
    expect(added.status).toBe(200);
  }
  const photos = (await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } })).filter(
    (image) => !image.generated,
  );
  expect(photos).toHaveLength(count);
  const fileOf = (id: string) => path.join(STORAGE, home, `${id}.jpg`);
  return { printId, plateId, home, photos, fileOf };
}

/** fs.rm refuses `stuck`, as a file held open or on a read-only disk would; the rest go as usual. */
function refuseToRemove(stuck: string) {
  const rm = fsPromises.rm;
  return vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
    if (String(target) === stuck) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    return rm(target, options);
  });
}

async function runCleanup(keys: Parameters<typeof startStorageCleanup>[1], keep: 1 | 2 | 3 | null) {
  expect(startStorageCleanup(null, keys, keep)).not.toBeNull();
  await waitForCleanup();
  return currentStorageCleanup()!;
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Cleanup", email: `cleanup-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  const member = await request(app)
    .post("/api/register")
    .send({ displayName: "Member", email: `cleanup-member-${stamp}@example.com`, password: "password123" });
  memberToken = member.body.token;
  await prisma.user.update({ where: { id: member.body.user.id }, data: { role: "MEMBER" } });
  return () => setPhotosPerModel(null);
});

describe("Photos kept per model", () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await setPhotosPerModel(null);
  });

  it("is all of them unless an admin picks fewer, and only admins may", async () => {
    expect((await request(app).get("/api/settings/photos-per-model").set(auth())).body).toEqual({ keep: null });
    const saved = await request(app).post("/api/settings/photos-per-model").set(auth()).send({ keep: 3 });
    expect(saved.body).toEqual({ keep: 3 });
    expect(await getPhotosPerModel()).toBe(3);
    expect((await request(app).post("/api/settings/photos-per-model").set(auth()).send({ keep: 4 })).status).toBe(400);
    expect(
      (await request(app).post("/api/settings/photos-per-model").set(auth(memberToken)).send({ keep: 1 })).status,
    ).toBe(403);
  });

  it("limits what an import keeps, a photo that couldn't be fetched not counting", async () => {
    await setPhotosPerModel(1);
    const { printId, plateId } = await uploadStl();
    const images: Record<string, Buffer> = {
      "https://8.8.8.8/b.png": await png(120),
      "https://8.8.8.8/c.png": await png(60),
    };
    const asked: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      const body = images[String(input)];
      return body
        ? new Response(body, { headers: { "content-type": "image/png" } })
        : new Response("gone", { status: 404 });
    }) as typeof fetch;
    const stored = await attachImportedPreviewImages(
      printId,
      plateId,
      "https://8.8.8.8/a.png",
      [
        { url: "https://8.8.8.8/b.png", filename: "b.png" },
        { url: "https://8.8.8.8/c.png", filename: "c.png" },
      ],
      0,
    );
    expect(stored).toBe(1);
    // The cover was gone, so the next one took its place, and nothing past it was fetched.
    expect(asked).toEqual(["https://8.8.8.8/a.png", "https://8.8.8.8/b.png"]);
    expect(await prisma.previewImage.count({ where: { printId, generated: false } })).toBe(1);
  });
});

describe("Free up space", () => {
  it("measures each kind, and frees what was ticked", async () => {
    const { printId, plateId, home } = await uploadStl();
    for (const red of [200, 150, 100]) {
      const added = await request(app)
        .post(`/api/print/${printId}/preview-images`)
        .set(auth())
        .attach("files", await png(red), "photo.png");
      expect(added.status).toBe(200);
    }
    const photos = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    const own = photos.filter((image) => !image.generated);
    expect(own).toHaveLength(3);

    const folder = (...parts: string[]) => path.join(STORAGE, home, ...parts);
    const glb = await plainGlb();
    const files = {
      current: write(folder("3D previews", `${plateId}.v5.glb`), glb),
      olderPreview: write(folder("3D previews", `${plateId}.v4.glb`), "older"),
      olderRender: write(folder("Renders", `${plateId}.render.v3.png`), "older"),
      currentRender: write(folder("Renders", `${plateId}.render.v4.png`), "current"),
      copy: write(folder("Slicer copies", `${plateId}.bambu.v4.3mf`), "copy"),
      sharedCopy: write(path.join(ADAPTED_3MFS, `${plateId}.bambu.v3.3mf`), "older copy"),
      // A plate long gone left its preview behind.
      orphan: write(path.join(MODEL_PREVIEWS, `gone-${stamp}.v5.glb`), "orphan"),
    };

    const inventory = await takeInventory();
    for (const file of [files.olderPreview, files.olderRender, files.orphan])
      expect(inventory.oldFiles).toContain(file);
    expect(inventory.oldFiles).not.toContain(files.current);
    expect(inventory.slicerFiles).toEqual(expect.arrayContaining([files.copy, files.sharedCopy]));
    expect(inventory.compressSaving).toBeGreaterThan(0);
    const beyondFirst = own.slice(1).reduce((sum, image) => sum + fs.statSync(folder(`${image.id}.jpg`)).size, 0);
    expect(inventory.photosBeyond[1]).toBeGreaterThanOrEqual(beyondFirst);

    const usage = await request(app).get("/api/admin/storage").set(auth());
    expect(usage.body.breakdown.old).toBeGreaterThan(0);
    expect(usage.body.freeable.photos["1"]).toBeGreaterThanOrEqual(beyondFirst);

    const since = new Date(Date.now() - 1000);
    const started = await request(app)
      .post("/api/admin/storage/cleanup")
      .set(auth())
      .send({ tasks: ["old", "compress", "slicer", "photos"], keep_photos: 1 });
    expect(started.status).toBe(200);
    expect(started.body.cleanup.tasks.map((task: { key: string }) => task.key)).toEqual([
      "old",
      "compress",
      "slicer",
      "photos",
    ]);
    await waitForCleanup();
    const run = (await request(app).get("/api/admin/storage/cleanup").set(auth())).body.cleanup;
    expect(run.tasks.every((task: { status: string }) => task.status === "done")).toBe(true);

    for (const file of [files.olderPreview, files.olderRender, files.orphan, files.copy, files.sharedCopy]) {
      expect(fs.existsSync(file)).toBe(false);
    }
    expect(fs.existsSync(files.currentRender)).toBe(true);
    // Still there, packed smaller.
    expect(fs.statSync(files.current).size).toBeLessThan(glb.byteLength);
    const kept = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    expect(kept.map((image) => image.id)).toEqual([own[0].id]);
    for (const image of own.slice(1)) expect(fs.existsSync(folder(`${image.id}.jpg`))).toBe(false);
    // Imports keep as many from now on.
    expect(await getPhotosPerModel()).toBe(1);
    expect(await freedNotice(since)).not.toBeNull();

    // A plate's previews and copies are its own, and go with the model.
    const listing = await request(app)
      .get("/api/admin/storage/browse")
      .query({ path: `${home.split(path.sep).join("/")}/3D previews` })
      .set(auth());
    expect(listing.body.files.map((file: { kind: string }) => file.kind)).toEqual(["preview"]);
    await request(app).delete(`/api/print/${printId}`).set(auth());
    expect(fs.existsSync(files.current)).toBe(false);
    expect(fs.existsSync(folder())).toBe(false);
  }, 60_000);

  it("asks how many photos to keep, runs one at a time, and is for admins", async () => {
    const missing = await request(app)
      .post("/api/admin/storage/cleanup")
      .set(auth())
      .send({ tasks: ["photos"] });
    expect(missing.status).toBe(400);
    const member = await request(app)
      .post("/api/admin/storage/cleanup")
      .set(auth(memberToken))
      .send({ tasks: ["old"] });
    expect(member.status).toBe(403);

    // It looks over storage before anything else, so the first is still running when the second asks.
    expect(startStorageCleanup(null, ["old"], null)).not.toBeNull();
    expect(startStorageCleanup(null, ["slicer"], null)).toBeNull();
    await waitForCleanup();
  });

  it("goes first when it starts while a storage structure is being saved: the move waits for it", async () => {
    const template = (await request(app).get("/api/settings/storage").set(auth())).body.template as string;
    // The save held where the structure is written, so the clean-up can start meanwhile.
    let save!: () => void;
    const saveGate = new Promise<void>((resolve) => (save = resolve));
    let saving = false;
    const realUpsert = prisma.setting.upsert.bind(prisma.setting);
    const upsert = vi.spyOn(prisma.setting, "upsert").mockImplementation(((args: any) => {
      if (args.where?.key !== "storage_path_template" || saving) return realUpsert(args);
      saving = true;
      return saveGate.then(() => realUpsert(args));
    }) as any);
    // The clean-up held at its first read, the models' folders; the move's first step is listing every model.
    let free!: () => void;
    const freeGate = new Promise<void>((resolve) => (free = resolve));
    let listed = false;
    const realFindMany = prisma.print.findMany.bind(prisma.print);
    const findMany = vi.spyOn(prisma.print, "findMany").mockImplementation(((args: any) => {
      if (args?.where?.assetsPath) return freeGate.then(() => realFindMany(args));
      if (args?.include?.plates && args?.orderBy?.id === "asc") listed = true;
      return realFindMany(args);
    }) as any);
    const until = async (done: () => boolean) => {
      while (!done()) await sleep(10);
    };
    try {
      const saved = request(app)
        .post("/api/settings/storage")
        .set(auth())
        .send({ template })
        .then((res) => res);
      await until(() => saving);
      const started = await request(app)
        .post("/api/admin/storage/cleanup")
        .set(auth())
        .send({ tasks: ["old"] });
      expect(started.status).toBe(200);
      save();
      expect((await saved).status).toBe(200);
      const move = currentStorageMove()!;
      try {
        expect(move.running).toBe(true);
        await sleep(300);
        expect(listed).toBe(false);
      } finally {
        free();
        await waitForCleanup();
        await until(() => !move.running);
      }
      expect(listed).toBe(true);
    } finally {
      upsert.mockRestore();
      findMany.mockRestore();
    }
  });

  it("counts an older version it couldn't remove as failed, and leaves it", async () => {
    const { plateId, home } = await uploadStl();
    const older = write(path.join(STORAGE, home, "3D previews", `${plateId}.v4.glb`), "older");
    const spy = refuseToRemove(older);
    try {
      const run = await runCleanup(["old"], null);
      expect(run.tasks[0]).toMatchObject({ key: "old", status: "done", failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(older)).toBe(true);
    fs.rmSync(older);
  });

  it("keeps a photo whose file it couldn't remove, row and all, for another run", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    const removable = fs.statSync(fileOf(photos[1].id)).size;
    const spy = refuseToRemove(fileOf(photos[2].id));
    let run: Awaited<ReturnType<typeof runCleanup>>;
    try {
      run = await runCleanup(["photos"], 1);
    } finally {
      spy.mockRestore();
    }
    const task = run.tasks.find((each) => each.key === "photos")!;
    expect(task).toMatchObject({ status: "done", failed: 1 });
    // Freed is what went, the stuck photo not counted; other models' photos may have gone too.
    expect(task.freed).toBeGreaterThanOrEqual(removable);
    expect(fs.existsSync(fileOf(photos[1].id))).toBe(false);
    expect(fs.existsSync(fileOf(photos[2].id))).toBe(true);
    const left = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    expect(left.map((image) => image.id)).toEqual([photos[0].id, photos[2].id]);
  });

  it("looks at each model's photos again before removing any, so one moved to the front meanwhile stays", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    const findMany = prisma.previewImage.findMany.bind(prisma.previewImage);
    let moved = false;
    const spy = vi.spyOn(prisma.previewImage, "findMany").mockImplementation((async (args: never) => {
      const rows = await findMany(args);
      // Right after the clean-up has read every model's photos: the last one is made the cover.
      if (!moved && currentStorageCleanup()?.tasks.find((task) => task.key === "photos")?.status === "running") {
        moved = true;
        await reorderPreviewImages(printId, [photos[2].id, photos[0].id, photos[1].id]);
      }
      return rows;
    }) as never);
    try {
      await runCleanup(["photos"], 1);
    } finally {
      spy.mockRestore();
    }
    expect(moved).toBe(true);
    const left = await prisma.previewImage.findMany({ where: { printId } });
    expect(left.map((image) => image.id)).toEqual([photos[2].id]);
    expect(fs.existsSync(fileOf(photos[2].id))).toBe(true);
    for (const photo of photos.slice(0, 2)) expect(fs.existsSync(fileOf(photo.id))).toBe(false);
  });

  it("keeps the cover a reorder still under way makes of the last photo", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    const order = [photos[2].id, photos[0].id, photos[1].id];
    let commit!: () => void;
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));
    // The reorder's two phases, held open with its rows locked until the clean-up waits for them.
    const reorder = prisma.$transaction(async (tx) => {
      for (const [phase, base] of [
        [0, -1],
        [1, 0],
      ] as const) {
        for (const [idx, id] of order.entries()) {
          await tx.previewImage.update({ where: { id }, data: { position: phase === 0 ? base - idx : idx } });
        }
      }
      locked();
      await new Promise<void>((resolve) => (commit = resolve));
    });
    await holding;
    expect(startStorageCleanup(null, ["photos"], 1)).not.toBeNull();
    let waiting = false;
    for (let i = 0; i < 200 && !waiting; i++) {
      const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS "count" FROM pg_locks WHERE NOT granted`;
      waiting = count > 0n;
      if (!waiting) await sleep(25);
    }
    commit();
    await reorder;
    await waitForCleanup();
    expect(waiting).toBe(true);
    const left = await prisma.previewImage.findMany({ where: { printId } });
    expect(left.map((image) => image.id)).toEqual([photos[2].id]);
    expect(fs.existsSync(fileOf(photos[2].id))).toBe(true);
  });

  it("removes a photo's file only once its row is gone, so no reorder can make it the cover", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    const files = new Map(photos.map((photo) => [fileOf(photo.id), photo.id]));
    const stillThere: string[] = [];
    const rm = fsPromises.rm;
    const spy = vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
      const id = files.get(String(target));
      // Read from outside the clean-up, as a reorder would: the row must already be gone for good.
      if (id && (await prisma.previewImage.findUnique({ where: { id } }))) stillThere.push(id);
      return rm(target, options);
    });
    try {
      await runCleanup(["photos"], 1);
    } finally {
      spy.mockRestore();
    }
    expect(stillThere).toEqual([]);
    for (const photo of photos.slice(1)) expect(fs.existsSync(fileOf(photo.id))).toBe(false);
    const left = await prisma.previewImage.findMany({ where: { printId } });
    expect(left.map((image) => image.id)).toEqual([photos[0].id]);
  });

  it("keeps a model's photo rows when it can't find the model's folder", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    const findUnique = prisma.print.findUnique.bind(prisma.print);
    // The look-up of the model's folder fails, as a dropped connection would.
    const spy = vi
      .spyOn(prisma.print, "findUnique")
      .mockImplementation(((args: { where: { id?: string } }) =>
        args.where.id === printId ? Promise.reject(new Error("connection lost")) : findUnique(args as never)) as never);
    let run: Awaited<ReturnType<typeof runCleanup>>;
    try {
      run = await runCleanup(["photos"], 1);
    } finally {
      spy.mockRestore();
    }
    expect(run.tasks.find((each) => each.key === "photos")!.status).toBe("failed");
    for (const photo of photos) expect(fs.existsSync(fileOf(photo.id))).toBe(true);
    const left = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    expect(left.map((image) => image.id)).toEqual(photos.map((photo) => photo.id));
  });

  it("removes no file of a model whose rows it can't delete", async () => {
    const { printId, photos, fileOf } = await withPhotos(3);
    // The database refuses the deletion of this model's rows, as a dropped connection would.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION cleanup_test_refuse() RETURNS trigger AS $$ BEGIN
      IF OLD."printId" = '${printId}' THEN RAISE EXCEPTION 'connection lost'; END IF; RETURN OLD; END $$
      LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER cleanup_test_refuse BEFORE DELETE ON "PreviewImage"
      FOR EACH ROW EXECUTE FUNCTION cleanup_test_refuse()`);
    let run: Awaited<ReturnType<typeof runCleanup>>;
    try {
      run = await runCleanup(["photos"], 1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER cleanup_test_refuse ON "PreviewImage"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION cleanup_test_refuse()`);
    }
    expect(run.tasks.find((each) => each.key === "photos")!.status).toBe("failed");
    for (const photo of photos) expect(fs.existsSync(fileOf(photo.id))).toBe(true);
    const left = await prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } });
    expect(left.map((image) => image.id)).toEqual(photos.map((photo) => photo.id));
  });
});

describe("A new 3D preview", () => {
  /** A 3MF of one triangle, drawn in a moment. */
  async function oneTriangle(): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-cleanup-3mf-"));
    const model = write(
      path.join(dir, "3dmodel.model"),
      `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0" /><vertex x="10" y="0" z="0" /><vertex x="0" y="10" z="0" /></vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh></object></resources>
 <build><item objectid="1" /></build>
</model>`,
    );
    const file = path.join(dir, "tiny.3mf");
    await writeZip(file, [{ arcname: "3D/3dmodel.model", filePath: model }]);
    return file;
  }

  it("goes into the model's folder as it is once drawn, though the model moved while it was drawn", async () => {
    const { printId, plateId, home } = await uploadStl();
    const fixture = await oneTriangle();
    const before = assetTarget(home, plateGlbFile(plateId));
    const packed = () =>
      fs.readdirSync(MODEL_PREVIEWS).some((name) => name.startsWith(`${plateId}.`) && name.endsWith(".packed.tmp"));
    // Held as a move of the model's files holds it.
    let release!: () => void;
    const held = withStorageLock(() => new Promise<void>((resolve) => (release = resolve)));
    const drawing = generateModelPreviewGlb(plateId, fixture);
    const moved = `${home}-moved`;
    try {
      // Drawn and packed, and waiting to be put in place (or put in the folder already, were it not waiting).
      for (let i = 0; i < 150 && !fs.existsSync(before) && !packed(); i++) await sleep(100);
      await sleep(300);
      await prisma.print.update({ where: { id: printId }, data: { assetsPath: moved } });
    } finally {
      release();
      await held;
      await drawing.catch(() => undefined);
    }
    await drawing;
    expect(fs.existsSync(assetTarget(moved, plateGlbFile(plateId)))).toBe(true);
    expect(fs.existsSync(before)).toBe(false);
    await request(app).delete(`/api/print/${printId}`).set(auth());
  });
});
