import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import sharp from "sharp";
import { setSocialSettings } from "../src/services/settingsService";
import { saveDescriptionImage } from "../src/services/descriptionImageService";

const app = createApp();

type Account = { token: string; id: string };

async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({
      displayName: name,
      email: `social-${name.toLowerCase()}-${Date.now()}@example.com`,
      password: "password123",
    });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, id: res.body.user.id };
}

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-social-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

let owner: Account;
let viewer: Account;
let admin: Account;
let collectionId: string;
let printId: string;

beforeAll(async () => {
  owner = await register("Owner");
  viewer = await register("Viewer");
  admin = await register("Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await setSocialSettings({ enabled: false });

  const upload = await request(app)
    .post("/api/upload")
    .set(auth(owner))
    .field("tags", "Shared")
    .attach("files", tmpFile("shared-part.stl", "solid shared-part endsolid"));
  printId = upload.body.prints[0].id;
  const created = await request(app)
    .post("/api/collections")
    .set(auth(owner))
    .send({ name: `Shared ${Date.now()}`, is_public: true });
  collectionId = created.body.id;
  await request(app).post(`/api/collection/${collectionId}/items/${printId}`).set(auth(owner));
});

afterAll(async () => {
  await setSocialSettings({ enabled: false });
});

describe("social features switched off", () => {
  it("offer no Explore, and keep a public collection to its owner", async () => {
    expect((await request(app).get("/api/social").set(auth(viewer))).body).toEqual({ enabled: false, explore: false });
    expect((await request(app).get("/api/explore").set(auth(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/collection/${collectionId}`).set(auth(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/print/${printId}`).set(auth(viewer))).status).toBe(404);
  });

  it("are an admin's to switch on", async () => {
    const refused = await request(app).patch("/api/social/settings").set(auth(viewer)).send({ enabled: true });
    expect(refused.status).toBe(403);
    const switched = await request(app).patch("/api/social/settings").set(auth(admin)).send({ enabled: true });
    expect(switched.status).toBe(200);
    expect(switched.body).toEqual({ enabled: true });
    expect((await request(app).get("/api/social").set(auth(viewer))).body).toEqual({ enabled: true, explore: true });
  });
});

describe("another user's public collection", () => {
  beforeAll(async () => {
    await setSocialSettings({ enabled: true });
  });

  it("starts private unless made public", async () => {
    const res = await request(app)
      .post("/api/collections")
      .set(auth(owner))
      .send({ name: `Private ${Date.now()}` });
    expect(res.body.is_public).toBe(false);
    expect((await request(app).get(`/api/collection/${res.body.id}`).set(auth(viewer))).status).toBe(404);
  });

  it("opens with whose it is, and lists its models as theirs", async () => {
    const collection = await request(app).get(`/api/collection/${collectionId}`).set(auth(viewer));
    expect(collection.status).toBe(200);
    expect(collection.body.owner).toMatchObject({ id: owner.id, display_name: "Owner" });
    expect(collection.body.owner.email).toBeUndefined();

    const list = await request(app).get("/api/prints").set(auth(viewer)).query({ collection_id: collectionId });
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([printId]);
    expect(list.body[0].owner.id).toBe(owner.id);
    // The server's own paths are the owner's business.
    expect(list.body[0].storage_path).toBeNull();
  });

  it("lets its models be opened, downloaded and pictured, but not changed", async () => {
    const model = await request(app).get(`/api/print/${printId}`).set(auth(viewer));
    expect(model.status).toBe(200);
    expect(model.body.owner.id).toBe(owner.id);
    expect(model.body.library_copy_id).toBeNull();

    const plate = model.body.plates[0];
    const file = await request(app).get(`/api${plate.url}`).set(auth(viewer));
    expect(file.status).toBe(200);
    const zip = await request(app)
      .post("/api/download/zip/summary")
      .set(auth(viewer))
      .send({ print_ids: [printId] });
    expect(zip.body.count).toBe(1);

    expect(
      (
        await request(app)
          .post(`/api/print/${printId}/tags`)
          .set(auth(viewer))
          .send({ tags: ["x"] })
      ).status,
    ).toBe(404);
    expect((await request(app).delete(`/api/print/${printId}`).set(auth(viewer))).status).toBe(404);
    expect((await request(app).post(`/api/print/${printId}/favorite`).set(auth(viewer))).status).toBe(404);
    expect(
      (await request(app).patch(`/api/collection/${collectionId}`).set(auth(viewer)).send({ name: "Taken" })).status,
    ).toBe(404);
    // Another user's views don't count as the owner's.
    expect((await prisma.print.findUnique({ where: { id: printId } }))?.viewCount).toBe(0);
  });

  it("shows on Explore, to everyone but its owner", async () => {
    const explore = await request(app).get("/api/explore").set(auth(viewer));
    expect(explore.status).toBe(200);
    const person = explore.body.people.find((p: { id: string }) => p.id === owner.id);
    expect(person).toMatchObject({ collection_count: 1, model_count: 1 });
    expect(explore.body.recent_models.map((p: { id: string }) => p.id)).toContain(printId);
    expect(explore.body.recent_collections.map((c: { id: string }) => c.id)).toContain(collectionId);

    const own = await request(app).get("/api/explore").set(auth(owner));
    expect(own.body.people.some((p: { id: string }) => p.id === owner.id)).toBe(false);

    const page = await request(app).get(`/api/explore/user/${owner.id}`).set(auth(viewer));
    expect(page.body.collections.map((c: { id: string }) => c.id)).toEqual([collectionId]);
    // Someone who shares nothing has no page to find.
    expect((await request(app).get(`/api/explore/user/${admin.id}`).set(auth(viewer))).status).toBe(404);
  });
});

describe("adding another user's model to a collection", () => {
  let mine: string;
  let copyId: string;

  beforeAll(async () => {
    await setSocialSettings({ enabled: true });
    mine = (
      await request(app)
        .post("/api/collections")
        .set(auth(viewer))
        .send({ name: `Mine ${Date.now()}` })
    ).body.id;
  });

  it("files a copy of it in the user's own library", async () => {
    const res = await request(app).post(`/api/collection/${mine}/items/${printId}`).set(auth(viewer));
    expect(res.status).toBe(200);
    copyId = res.body.print_id;
    expect(copyId).not.toBe(printId);

    const copy = await prisma.print.findUnique({ where: { id: copyId }, include: { plates: true } });
    expect(copy).toMatchObject({ userId: viewer.id, copiedFromId: printId, tags: ["Shared"] });
    expect(copy?.plates).toHaveLength(1);

    const memberships = await request(app).get(`/api/print/${printId}/collections`).set(auth(viewer));
    expect(memberships.body.find((c: { id: string }) => c.id === mine).in_collection).toBe(true);
    const model = await request(app).get(`/api/print/${printId}`).set(auth(viewer));
    expect(model.body.library_copy_id).toBe(copyId);
  });

  it("doesn't copy it twice", async () => {
    const res = await request(app).post(`/api/print/${printId}/copy`).set(auth(viewer));
    expect(res.body).toMatchObject({ copied: false, print: { id: copyId } });
    expect(await prisma.print.count({ where: { userId: viewer.id, copiedFromId: printId } })).toBe(1);
  });

  it("counts towards Most collected", async () => {
    const explore = await request(app).get("/api/explore").set(auth(admin));
    const entry = explore.body.most_collected.find((e: { model: { id: string } }) => e.model.id === printId);
    expect(entry?.copies).toBe(1);
  });

  it("keeps the copy when the original goes private, then is deleted", async () => {
    await request(app)
      .patch(`/api/collection/${collectionId}`)
      .set(auth(owner))
      .send({ name: "Gone private", is_public: false });
    expect((await request(app).get(`/api/print/${printId}`).set(auth(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/collection/${collectionId}`).set(auth(viewer))).status).toBe(404);

    await request(app).delete(`/api/print/${printId}`).set(auth(owner));
    const copy = await request(app).get(`/api/print/${copyId}`).set(auth(viewer));
    expect(copy.status).toBe(200);
    expect(copy.body.owner).toBeNull();
    const file = await request(app).get(`/api${copy.body.plates[0].url}`).set(auth(viewer));
    expect(file.status).toBe(200);
  });
});

describe("a copy", () => {
  it("brings the model's pictures, description images and files along, as its own", async () => {
    await setSocialSettings({ enabled: true });
    const upload = await request(app)
      .post("/api/upload")
      .set(auth(owner))
      .attach("files", tmpFile("pictured.stl", "solid pictured endsolid"));
    const sourceId = upload.body.prints[0].id;
    const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    await request(app)
      .post(`/api/print/${sourceId}/preview-images`)
      .set(auth(owner))
      .attach("files", picture, "photo.png");
    await request(app)
      .post(`/api/print/${sourceId}/files`)
      .set(auth(owner))
      .attach("file", Buffer.from("printing notes"), "notes.txt");
    const image = (await saveDescriptionImage(sourceId, picture, null))!;
    await prisma.print.update({
      where: { id: sourceId },
      data: { notes: `Look: ![step](/description-image/${image.id})` },
    });
    const shared = await request(app)
      .post("/api/collections")
      .set(auth(owner))
      .send({ name: `Pictured ${Date.now()}`, is_public: true });
    await request(app).post(`/api/collection/${shared.body.id}/items/${sourceId}`).set(auth(owner));

    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    expect(res.body.copied).toBe(true);
    const copy = await prisma.print.findUniqueOrThrow({
      where: { id: res.body.print.id },
      include: { previewImages: true, descriptionImages: true, files: true },
    });
    expect(copy.previewImages.filter((i) => !i.generated)).toHaveLength(1);
    expect(copy.files.map((f) => f.filename)).toEqual(["notes.txt"]);
    expect(copy.descriptionImages).toHaveLength(1);
    // Pointed at its own image, which the copier can read whatever becomes of the original.
    expect(copy.notes).toBe(`Look: ![step](/description-image/${copy.descriptionImages[0].id})`);
    const own = await request(app).get(`/api/description-image/${copy.descriptionImages[0].id}`).set(auth(viewer));
    expect(own.status).toBe(200);
    const gallery = await request(app).get(`/api/preview-image/${copy.previewImages[0].id}/file.jpg`).set(auth(viewer));
    expect(gallery.status).toBe(200);
  });
});
