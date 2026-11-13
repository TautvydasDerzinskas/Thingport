import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import { createApp } from "../src/app";
import { ADAPTED_3MFS, MODEL_PREVIEWS, STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { attachImportedPreviewImages } from "../src/services/importService";
import { currentStorageCleanup, startStorageCleanup } from "../src/services/storageCleanup";
import { takeInventory } from "../src/services/storageInventory";
import { getPhotosPerModel, setPhotosPerModel } from "../src/services/settingsService";

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
    const told = await prisma.notification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    expect((told?.message as { key?: string } | null)?.key).toBe("storageFreed");

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
});
