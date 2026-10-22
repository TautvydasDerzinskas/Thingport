import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import JSZip from "jszip";
import { createApp } from "../src/app";
import { IMPORT_MAX_BYTES } from "../src/config";
import { createPrint } from "../src/services/printCreation";
import { prisma } from "../src/db";
import {
  NOT_IMPORTED_DIR,
  consumeFolder,
  setConsumeSettings,
  startConsumeWatcher,
} from "../src/services/consumeService";

const app = createApp();
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
let userId: string;
let token: string;
let dir: string;

function put(rel: string, contents: string | Buffer) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

const png = () =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 0, b: 0 } } })
    .png()
    .toBuffer();

async function printsNamed(name: string) {
  return prisma.print.findMany({
    where: { userId, name },
    include: { plates: true, previewImages: true, files: true, category: true },
  });
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Consumer", email: `consume-${Date.now()}@example.com`, password: "password123" });
  userId = res.body.user.id;
  token = res.body.token;
  await setConsumeSettings({ userId });
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ["consume_mode", "consume_user_id"] } } });
});

describe("consume folder", () => {
  it("imports each file as a model by default, recreating folders, and empties the folder", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "separate" });
    put("Loose.stl", STL);
    put("Shelf/Gadgets/Clip.stl", STL);
    put("Shelf/notes.txt", "not a model");

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 2, files: 2, failed: ["Shelf/notes.txt"] });

    const [clip] = await printsNamed("Clip");
    expect(clip.category?.name).toBe("Gadgets");
    expect(clip.category?.kind).toBe("folder");
    expect((await printsNamed("Loose"))[0].categoryId).toBeNull();

    expect(fs.readdirSync(dir)).toEqual([NOT_IMPORTED_DIR]);
    expect(fs.existsSync(path.join(dir, NOT_IMPORTED_DIR, "Shelf/notes.txt"))).toBe(true);

    const notes = await request(app)
      .get("/api/notifications")
      .set({ Authorization: `Bearer ${token}` });
    expect(JSON.stringify(notes.body)).toContain("Imported 2 models from the consume folder");
  });

  it("makes a folder of model files one model, with its images as previews", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "folder" });
    put("Robots/Walker/leg.stl", STL);
    put("Robots/Walker/body.stl", STL);
    put("Robots/Walker/photo.png", await png());
    put("Robots/Walker/readme.pdf", "pdf");

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 1, files: 4, failed: [] });
    const [walker] = await printsNamed("Walker");
    expect(walker.plates.map((p) => p.filename).toSorted()).toEqual(["body.stl", "leg.stl"]);
    expect(walker.previewImages).toHaveLength(1);
    expect(walker.files.map((f) => f.filename)).toEqual(["readme.pdf"]);
    expect(walker.category?.name).toBe("Robots");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("unpacks a zip as a folder named after it", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "folder" });
    const zip = new JSZip();
    zip.file("a.stl", STL);
    zip.file("b.stl", STL);
    put("Zipped Model.zip", await zip.generateAsync({ type: "nodebuffer" }));

    expect(await consumeFolder(dir)).toMatchObject({ models: 1, failed: [] });
    expect((await printsNamed("Zipped Model"))[0].plates).toHaveLength(2);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("unpacks a zip whose paths start with ./, as macOS tar -a writes them", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "separate" });
    const zip = new JSZip();
    zip.file("./Dotted/hull.stl", STL);
    zip.file("./Dotted/Parts/mast.stl", STL);
    put("dotted.zip", await zip.generateAsync({ type: "nodebuffer" }));

    expect(await consumeFolder(dir)).toMatchObject({ models: 2, files: 2, failed: [] });
    expect((await printsNamed("hull"))[0].category?.name).toBe("Dotted");
    expect((await printsNamed("mast"))[0].category?.name).toBe("Parts");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("picks up files dropped into a watched folder once they stop changing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "separate" });
    startConsumeWatcher(dir);
    put("Dropped.stl", STL);
    for (let i = 0; i < 40 && fs.existsSync(path.join(dir, "Dropped.stl")); i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(fs.existsSync(path.join(dir, "Dropped.stl"))).toBe(false);
    expect(await printsNamed("Dropped")).toHaveLength(1);
  }, 20000);

  it("sets aside a folder whose model couldn't be created, leaving no half-made model", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "folder" });
    put("Broken/a.stl", STL);
    put("Broken/b.stl", STL);
    fs.chmodSync(path.join(dir, "Broken/b.stl"), 0o000);

    const summary = await consumeFolder(dir);
    expect(summary).toMatchObject({ models: 0, failed: ["Broken/a.stl", "Broken/b.stl"] });
    expect(await printsNamed("Broken")).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir, NOT_IMPORTED_DIR, "Broken")).toSorted()).toEqual(["a.stl", "b.stl"]);
  });

  it("sets aside files over the import size limit", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "consume-"));
    await setConsumeSettings({ mode: "separate" });
    put("Huge.stl", "");
    // Sparse, so it takes no real disk space.
    fs.truncateSync(path.join(dir, "Huge.stl"), IMPORT_MAX_BYTES + 1);

    expect(await consumeFolder(dir)).toMatchObject({ models: 0, failed: ["Huge.stl"] });
    expect(await printsNamed("Huge")).toHaveLength(0);
  });
});

describe("createPrint", () => {
  it("removes a half-created print when a later plate fails", async () => {
    const src = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "plates-")), "first.stl");
    fs.writeFileSync(src, STL);
    await expect(
      createPrint(userId, { title: "Half made" }, "Half made", [
        { filename: "first.stl", copyFromPath: src },
        { filename: "second.stl", copyFromPath: `${src}.missing` },
      ]),
    ).rejects.toThrow(/ENOENT/);
    expect(await printsNamed("Half made")).toHaveLength(0);
    expect(await prisma.plate.count({ where: { print: { userId, name: "Half made" } } })).toBe(0);
    expect(fs.existsSync(src)).toBe(true);
  });
});

describe("consume settings routes", () => {
  let adminToken: string;

  beforeAll(async () => {
    const email = `consume-admin-${Date.now()}@example.com`;
    const res = await request(app).post("/api/register").send({ displayName: "Admin", email, password: "password123" });
    await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
    // Tokens carry the role from when they were issued.
    adminToken = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
  });

  it("is admin-only", async () => {
    const res = await request(app)
      .get("/api/settings/consume")
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(403);
  });

  it("reports and saves the mode and owner", async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };
    const res = await request(app).patch("/api/settings/consume").set(admin).send({ mode: "folder", user_id: userId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "folder", user_id: userId, not_imported_dir: NOT_IMPORTED_DIR });
    expect(typeof res.body.available).toBe("boolean");
    expect((await request(app).get("/api/settings/consume").set(admin)).body.mode).toBe("folder");
  });

  it("rejects an unknown mode or user", async () => {
    const admin = { Authorization: `Bearer ${adminToken}` };
    expect((await request(app).patch("/api/settings/consume").set(admin).send({ mode: "zip" })).status).toBe(400);
    expect((await request(app).patch("/api/settings/consume").set(admin).send({ user_id: "nope" })).status).toBe(400);
  });
});
