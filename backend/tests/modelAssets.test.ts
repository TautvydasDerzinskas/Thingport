import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { BUNDLES, DESCRIPTION_IMAGES, MODEL_PREVIEWS, PREVIEWS, STORAGE, THUMBS } from "../src/config";
import { prisma } from "../src/db";
import {
  getStorageTemplate,
  reorganizeManagedPrints,
  setStorageTemplate,
  storageOutOfPlace,
} from "../src/services/printService";
import { currentStorageMove, resumeStorageMove } from "../src/services/storageMoveService";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
// The template is one instance-wide row, so it's put back afterwards.
let previousTemplate: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const stored = (...parts: string[]) => path.join(STORAGE, ...parts);
const png = (r: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g: 0, b: 0 } } })
    .png()
    .toBuffer();

async function upload(filename: string, contents: string): Promise<string> {
  const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(contents), filename);
  expect(res.status).toBe(200);
  return res.body.prints[0].id;
}

async function attachFile(printId: string, filename: string, contents: string) {
  const res = await request(app)
    .post(`/api/print/${printId}/files`)
    .set(auth())
    .attach("file", Buffer.from(contents), filename);
  expect(res.status).toBe(200);
}

async function browse(folder: string) {
  const res = await request(app).get("/api/admin/storage/browse").query({ path: folder }).set(auth());
  expect(res.status).toBe(200);
  return res.body as {
    folders: { name: string; pictures: boolean }[];
    files: { name: string; kind: string; print_id: string }[];
  };
}

beforeAll(async () => {
  previousTemplate = await getStorageTemplate();
  await setStorageTemplate("{category-or-folder}/{model}/{filename}");
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Assets", email: `model-assets-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
});

afterAll(async () => {
  await setStorageTemplate(previousTemplate);
});

describe("a model's pictures and supporting files", () => {
  let printId: string;
  const modelFolder = () => path.join(`u-${userId}`, "Unassigned", `beside-${stamp}`);

  it("are kept beside its model files, the pictures in an Images folder", async () => {
    printId = await upload(`beside-${stamp}.stl`, "solid beside endsolid");
    // Chosen with the model, before it has any picture, so only a model from before has none.
    expect((await prisma.print.findUniqueOrThrow({ where: { id: printId } })).assetsPath).toBe(
      path.join(modelFolder(), "Images"),
    );
    const added = await request(app)
      .post(`/api/print/${printId}/preview-images`)
      .set(auth())
      .attach("files", await png(200), "photo.png");
    expect(added.status).toBe(200);
    await attachFile(printId, "notes.txt", "first");
    await attachFile(printId, "notes.txt", "second");

    const print = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      include: { plates: true, previewImages: true, files: { orderBy: { id: "asc" } } },
    });
    expect(print.assetsPath).toBe(path.join(modelFolder(), "Images"));
    expect(fs.existsSync(stored(print.assetsPath!, `${print.previewImages[0].id}.jpg`))).toBe(true);
    // The first image became the plate's thumbnail.
    expect(fs.existsSync(stored(print.assetsPath!, "Thumbnails", `${print.plates[0].id}.jpg`))).toBe(true);
    // A second file of the same name is numbered rather than replacing the first.
    expect(print.files.map((file) => file.storagePath)).toEqual([
      path.join(modelFolder(), "notes.txt"),
      path.join(modelFolder(), "notes (2).txt"),
    ]);
    expect(fs.readFileSync(stored(modelFolder(), "notes.txt"), "utf8")).toBe("first");

    const image = await request(app).get(`/api/preview-image/${print.previewImages[0].id}/file.jpg`).set(auth());
    expect(image.status).toBe(200);
  });

  it("show in the storage browser", async () => {
    const model = await browse(modelFolder().split(path.sep).join("/"));
    expect(model.folders).toEqual([expect.objectContaining({ name: "Images", pictures: true })]);
    expect(model.files.map((file) => [file.name, file.kind])).toEqual([
      [`beside-${stamp}.stl`, "plate"],
      ["notes (2).txt", "file"],
      ["notes.txt", "file"],
    ]);

    const pictures = await browse(`${modelFolder().split(path.sep).join("/")}/Images`);
    expect(pictures.folders.map((folder) => folder.name)).toContain("Thumbnails");
    expect(pictures.files).toEqual([expect.objectContaining({ kind: "image", print_id: printId })]);
  });

  it("move with the model when the storage structure changes", async () => {
    const template = "{category-or-folder}/{model}/{id}/{filename}";
    expect((await storageOutOfPlace(template)).files).toBeGreaterThanOrEqual(4);
    await reorganizeManagedPrints(template, userId);
    const moved = path.join(modelFolder(), printId);
    const print = await prisma.print.findUniqueOrThrow({ where: { id: printId }, include: { previewImages: true } });
    expect(print.assetsPath).toBe(path.join(moved, "Images"));
    expect(fs.existsSync(stored(moved, "Images", `${print.previewImages[0].id}.jpg`))).toBe(true);
    expect(fs.readFileSync(stored(moved, "notes.txt"), "utf8")).toBe("first");
    expect(fs.existsSync(stored(modelFolder(), "Images"))).toBe(false);

    await reorganizeManagedPrints("{category-or-folder}/{model}/{filename}", userId);
    expect(fs.existsSync(stored(moved))).toBe(false);
  });

  it("go with the model when it's deleted", async () => {
    const res = await request(app).delete(`/api/print/${printId}`).set(auth());
    expect(res.status).toBe(200);
    expect(fs.existsSync(stored(modelFolder()))).toBe(false);
  });
});

describe("another model's files inside a model's pictures folder", () => {
  it("stay put when the model moves or is deleted", async () => {
    // A category named like "<model>/Images" puts another model's files there.
    const printId = await upload(`host-${stamp}.stl`, "solid host endsolid");
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: printId } })).assetsPath!;
    const added = await request(app)
      .post(`/api/print/${printId}/preview-images`)
      .set(auth())
      .attach("files", await png(90), "photo.png");
    expect(added.status).toBe(200);
    const foreign = ["Guest/guest.stl", "guest.jpg"];
    for (const file of foreign) {
      fs.mkdirSync(path.dirname(stored(home, file)), { recursive: true });
      fs.writeFileSync(stored(home, file), "guest");
    }

    await reorganizeManagedPrints("{category-or-folder}/{model}/{id}/{filename}", userId);
    const moved = (await prisma.print.findUniqueOrThrow({ where: { id: printId } })).assetsPath!;
    expect(moved).not.toBe(home);
    expect(fs.readdirSync(stored(moved))).not.toContain("guest.jpg");
    for (const file of foreign) expect(fs.readFileSync(stored(home, file), "utf8")).toBe("guest");

    await reorganizeManagedPrints("{category-or-folder}/{model}/{filename}", userId);
    expect(await request(app).delete(`/api/print/${printId}`).set(auth())).toHaveProperty("status", 200);
    for (const file of foreign) expect(fs.readFileSync(stored(home, file), "utf8")).toBe("guest");
    fs.rmSync(stored(path.dirname(home)), { recursive: true, force: true });
  });

  it("are listed as that model's in the storage browser", async () => {
    const hostId = await upload(`nest-host-${stamp}.stl`, "solid nest endsolid");
    const guestId = await upload(`nest-guest-${stamp}.stl`, "solid nest endsolid");
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: hostId } })).assetsPath!;
    const guestHome = path.join(home, "Guest", "Images");
    await prisma.print.update({ where: { id: guestId }, data: { assetsPath: guestHome } });
    fs.mkdirSync(stored(guestHome), { recursive: true });
    fs.writeFileSync(stored(guestHome, "guest.jpg"), "guest");

    const listing = await browse(guestHome.split(path.sep).join("/"));
    expect(listing.files).toEqual([expect.objectContaining({ name: "guest.jpg", print_id: guestId })]);

    for (const id of [guestId, hostId]) await request(app).delete(`/api/print/${id}`).set(auth());
    fs.rmSync(stored(path.dirname(home)), { recursive: true, force: true });
  });
});

describe("a model saved before pictures moved in beside its files", () => {
  it("keeps its pictures and supporting files where they were until the move brings them over", async () => {
    const name = `legacy-${stamp}`;
    const print = await prisma.print.create({ data: { userId, name, nameNormalized: name } });
    const platePath = path.join(`u-${userId}`, "Unassigned", name, "part.lbrn");
    fs.mkdirSync(stored(path.dirname(platePath)), { recursive: true });
    fs.writeFileSync(stored(platePath), "laser");
    const plate = await prisma.plate.create({
      data: { printId: print.id, position: 0, filename: "part.lbrn", mime: "text/plain", storagePath: platePath },
    });
    const image = await prisma.previewImage.create({ data: { printId: print.id, position: 0 } });
    const description = await prisma.descriptionImage.create({
      data: { printId: print.id, mime: "image/png", size: 10 },
    });
    const file = await prisma.printFile.create({
      data: {
        printId: print.id,
        role: "SUPPORTING",
        filename: "guide.txt",
        mime: "text/plain",
        storagePath: "pending",
      },
    });
    const bundled = path.join("bundles", print.id, file.id, "guide.txt");
    await prisma.printFile.update({ where: { id: file.id }, data: { storagePath: bundled, size: 5 } });

    const legacy = {
      image: path.join(PREVIEWS, `${image.id}.jpg`),
      description: path.join(DESCRIPTION_IMAGES, description.id),
      thumb: path.join(THUMBS, `${plate.id}.jpg`),
      bundle: path.join(BUNDLES, print.id, file.id, "guide.txt"),
    };
    for (const target of Object.values(legacy)) fs.mkdirSync(path.dirname(target), { recursive: true });
    await sharp(await png(200))
      .jpeg()
      .toFile(legacy.image);
    await sharp(await png(100))
      .jpeg()
      .toFile(legacy.thumb);
    fs.writeFileSync(legacy.description, await png(50));
    fs.writeFileSync(legacy.bundle, "guide");

    const served = async () =>
      Promise.all(
        [
          `/api/preview-image/${image.id}/file.jpg`,
          `/api/description-image/${description.id}`,
          `/api/plate/${plate.id}/thumb.jpg`,
          `/api/print/${print.id}/files/${file.id}`,
        ].map(async (url) => (await request(app).get(url).set(auth())).status),
      );
    expect(await served()).toEqual([200, 200, 200, 200]);

    await reorganizeManagedPrints(undefined, userId);
    const home = path.join(`u-${userId}`, "Unassigned", name, "Images");
    expect((await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).assetsPath).toBe(home);
    expect(fs.existsSync(stored(home, `${image.id}.jpg`))).toBe(true);
    expect(fs.existsSync(stored(home, "Description", `${description.id}.png`))).toBe(true);
    expect(fs.existsSync(stored(home, "Thumbnails", `${plate.id}.jpg`))).toBe(true);
    expect((await prisma.printFile.findUniqueOrThrow({ where: { id: file.id } })).storagePath).toBe(
      path.join(`u-${userId}`, "Unassigned", name, "guide.txt"),
    );
    for (const target of Object.values(legacy)) expect(fs.existsSync(target)).toBe(false);
    expect(await served()).toEqual([200, 200, 200, 200]);

    await request(app).delete(`/api/print/${print.id}`).set(auth());
  });
});

describe("the first start after upgrading", () => {
  it("brings older models' pictures over on its own", async () => {
    const name = `upgrade-${stamp}`;
    const print = await prisma.print.create({ data: { userId, name, nameNormalized: name } });
    const image = await prisma.previewImage.create({ data: { printId: print.id, position: 0 } });
    fs.mkdirSync(PREVIEWS, { recursive: true });
    await sharp(await png(200))
      .jpeg()
      .toFile(path.join(PREVIEWS, `${image.id}.jpg`));

    // A render of a plate deleted long ago belongs to no model; the move clears it, so it can't start another.
    const orphan = path.join(MODEL_PREVIEWS, `gone-${stamp}.render.v2.png`);
    fs.writeFileSync(orphan, "old");

    await resumeStorageMove();
    expect(currentStorageMove()?.running).toBe(true);
    for (let i = 0; i < 300 && currentStorageMove()?.running; i++) await new Promise((r) => setTimeout(r, 200));
    const home = (await prisma.print.findUniqueOrThrow({ where: { id: print.id } })).assetsPath;
    expect(home).toBe(path.join(`u-${userId}`, "Unassigned", name, "Images"));
    expect(fs.existsSync(stored(home!, `${image.id}.jpg`))).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(PREVIEWS)).toBe(false);
    // Nothing is left to bring over, so the next start doesn't move anything.
    await resumeStorageMove();
    expect(currentStorageMove()?.running).toBe(false);
    // Nobody asked for it, so nobody's told.
    expect(await prisma.notification.count({ where: { userId, title: "Model files moved" } })).toBe(0);

    await request(app).delete(`/api/print/${print.id}`).set(auth());
  }, 90_000);
});
