import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import sharp from "sharp";
import { setSocialSettings } from "../src/services/settingsService";
import { descriptionImagePath, saveDescriptionImage } from "../src/services/descriptionImageService";
import { STORAGE } from "../src/config";

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
    expect((await request(app).get("/api/social").set(auth(viewer))).body).toEqual({
      enabled: false,
      explore: false,
      chats: false,
      federation: false,
      instance_host: null,
    });
    expect((await request(app).get("/api/explore").set(auth(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/collection/${collectionId}`).set(auth(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/print/${printId}`).set(auth(viewer))).status).toBe(404);
  });

  it("are an admin's to switch on", async () => {
    const refused = await request(app).patch("/api/social/settings").set(auth(viewer)).send({ enabled: true });
    expect(refused.status).toBe(403);
    const switched = await request(app).patch("/api/social/settings").set(auth(admin)).send({ enabled: true });
    expect(switched.status).toBe(200);
    expect(switched.body).toEqual({ enabled: true, chats: false });
    expect((await request(app).get("/api/social").set(auth(viewer))).body).toEqual({
      enabled: true,
      explore: true,
      chats: false,
      federation: false,
      instance_host: null,
    });
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
    expect(collection.body.cover_items.map((p: { id: string }) => p.id)).toEqual([printId]);
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
    // Copied by three, more than anything else here: first, whatever earlier runs left in the database.
    const popularId = await sharedModel(owner, `popular-${Date.now()}`);
    const fan = await register("Fan");
    for (const who of [viewer, admin, fan]) await request(app).post(`/api/print/${popularId}/copy`).set(auth(who));
    const explore = await request(app).get("/api/explore").set(auth(fan));
    expect(explore.body.most_collected[0]).toMatchObject({ model: { id: popularId }, copies: 3 });
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

/** A model of `account`'s in a public collection of theirs: what another user can copy. */
async function sharedModel(account: Account, name: string): Promise<string> {
  const upload = await request(app)
    .post("/api/upload")
    .set(auth(account))
    .attach("files", tmpFile(`${name}.stl`, `solid ${name} endsolid`));
  const id = upload.body.prints[0].id;
  await shareModel(account, id);
  return id;
}

async function shareModel(account: Account, modelId: string): Promise<void> {
  const collection = await request(app)
    .post("/api/collections")
    .set(auth(account))
    .send({ name: `Shared ${modelId} ${Date.now()}`, is_public: true });
  await request(app).post(`/api/collection/${collection.body.id}/items/${modelId}`).set(auth(account));
}

describe("copying, more closely", () => {
  beforeAll(async () => {
    await setSocialSettings({ enabled: true });
  });

  it("makes one copy of two asked for at once", async () => {
    // The original, and the admin's copy of it under another name: the same model, but two copies of it wouldn't share
    // a name or a place in storage, so nothing but the copies taking turns stops both being made.
    const originalId = await sharedModel(owner, `twice-${Date.now()}`);
    const renamedId = (await request(app).post(`/api/print/${originalId}/copy`).set(auth(admin))).body.print.id;
    const renamed = `renamed-${Date.now()}`;
    await prisma.print.update({
      where: { id: renamedId },
      data: { title: renamed, name: renamed, nameNormalized: renamed },
    });
    await shareModel(admin, renamedId);

    // New models can't be written while this holds the table, so both requests would pass the check for an existing
    // copy and wait at writing theirs, until it's let go.
    let both!: Promise<request.Response[]>;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Print" IN SHARE MODE`;
      both = Promise.all([
        request(app).post(`/api/print/${originalId}/copy`).set(auth(viewer)),
        request(app).post(`/api/print/${renamedId}/copy`).set(auth(viewer)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    const [first, second] = await both;
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.print.id).toBe(second.body.print.id);
    // Whole, for whichever came second too: not the first's row while its files were still being copied.
    expect([first.body.print.plates.length, second.body.print.plates.length]).toEqual([1, 1]);
    const copies = await prisma.print.count({
      where: { userId: viewer.id, copiedFromId: { in: [originalId, renamedId] } },
    });
    expect(copies).toBe(1);
  });

  it("refuses a model with a file missing, rather than copy part of it", async () => {
    const upload = await request(app)
      .post("/api/upload")
      .set(auth(owner))
      .field("mode", "multiplate")
      .attach("files", tmpFile("kept.stl", "solid kept endsolid"))
      .attach("files", tmpFile("lost.stl", "solid lost endsolid"));
    const sourceId = upload.body.prints[0].id;
    await shareModel(owner, sourceId);
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId: sourceId, filename: "lost.stl" } });
    fs.rmSync(path.join(STORAGE, plate.storagePath));
    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("copy_files_missing");
    expect(await prisma.print.count({ where: { userId: viewer.id, copiedFromId: sourceId } })).toBe(0);
  });

  it("copies a model whose LICENSE.txt is missing, and writes the copy's own", async () => {
    const sourceId = await sharedModel(owner, `licensed-${Date.now()}`);
    await request(app).post(`/api/print/${sourceId}/meta`).set(auth(owner)).send({ license: "CC-BY-4.0" });
    const license = await prisma.printFile.findFirstOrThrow({ where: { printId: sourceId, role: "LICENSE" } });
    fs.rmSync(path.join(STORAGE, license.storagePath));
    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    expect(res.status).toBe(200);
    const copy = await prisma.printFile.findFirstOrThrow({ where: { printId: res.body.print.id, role: "LICENSE" } });
    expect(fs.readFileSync(path.join(STORAGE, copy.storagePath), "utf8")).toContain("Attribution 4.0");
  });

  it("refuses a model left with no files", async () => {
    const sourceId = await sharedModel(owner, `emptied-${Date.now()}`);
    await prisma.plate.deleteMany({ where: { printId: sourceId } });
    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("copy_no_plates");
  });

  it("keeps each file's role: a prepared print, and a supporting file named like one", async () => {
    const sourceId = await sharedModel(owner, `prepared-${Date.now()}`);
    const source = await prisma.print.findUniqueOrThrow({ where: { id: sourceId }, include: { plates: true } });
    const folder = path.dirname(source.plates[0].storagePath);
    const file = async (filename: string, role: "PREPARED" | "SUPPORTING") => {
      const storagePath = path.join(folder, filename);
      fs.writeFileSync(path.join(STORAGE, storagePath), filename);
      return prisma.printFile.create({
        data: { printId: sourceId, role, filename, mime: "application/octet-stream", storagePath },
      });
    };
    const prepared = await file("plate.gcode.3mf", "PREPARED");
    await file("other.gcode.3mf", "SUPPORTING");
    await prisma.print.update({ where: { id: sourceId }, data: { preparedFileId: prepared.id } });

    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    const copy = await prisma.print.findUniqueOrThrow({ where: { id: res.body.print.id }, include: { files: true } });
    const roleOf = (filename: string) => copy.files.find((f) => f.filename === filename)?.role;
    expect(roleOf("plate.gcode.3mf")).toBe("PREPARED");
    expect(roleOf("other.gcode.3mf")).toBe("SUPPORTING");
    expect(copy.preparedFileId).toBe(copy.files.find((f) => f.filename === "plate.gcode.3mf")?.id);
  });

  it("points a description image it couldn't copy back where it came from, or leaves it out", async () => {
    const sourceId = await sharedModel(owner, `described-${Date.now()}`);
    const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 200 } } })
      .png()
      .toBuffer();
    const fromWeb = (await saveDescriptionImage(sourceId, picture, "https://example.com/step.png"))!;
    const ownPicture = (await saveDescriptionImage(sourceId, picture, null))!;
    const { assetsPath } = await prisma.print.findUniqueOrThrow({ where: { id: sourceId } });
    for (const image of [fromWeb, ownPicture]) fs.rmSync(descriptionImagePath(image, assetsPath));
    await prisma.print.update({
      where: { id: sourceId },
      data: {
        notes:
          `One ![a](/description-image/${fromWeb.id}) two ![b](/description-image/${ownPicture.id}) end ` +
          "[elsewhere](https://example.test/description-image/abc) " +
          "[viewer](https://example.test/view?image=/description-image/abc)",
      },
    });

    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(viewer));
    const copy = await prisma.print.findUniqueOrThrow({ where: { id: res.body.print.id } });
    // Another site's link that only looks like one of ours is left alone.
    expect(copy.notes).toBe(
      "One ![a](https://example.com/step.png) two  end [elsewhere](https://example.test/description-image/abc) " +
        "[viewer](https://example.test/view?image=/description-image/abc)",
    );
  });

  it("knows a copy of a copy is the model the user copied already", async () => {
    const third = await register("Third");
    const originalId = await sharedModel(owner, `lineage-${Date.now()}`);
    const mine = (await request(app).post(`/api/print/${originalId}/copy`).set(auth(viewer))).body.print.id;
    // The admin copies the original and shares it; the third user copies that copy and shares theirs.
    const adminsCopy = (await request(app).post(`/api/print/${originalId}/copy`).set(auth(admin))).body.print.id;
    await shareModel(admin, adminsCopy);
    const thirdsCopy = (await request(app).post(`/api/print/${adminsCopy}/copy`).set(auth(third))).body.print.id;
    await shareModel(third, thirdsCopy);

    const res = await request(app).post(`/api/print/${thirdsCopy}/copy`).set(auth(viewer));
    expect(res.body).toMatchObject({ copied: false, print: { id: mine } });
    expect((await request(app).get(`/api/print/${thirdsCopy}`).set(auth(viewer))).body.library_copy_id).toBe(mine);
  });

  it("still knows the model after its original is deleted", async () => {
    const originalId = await sharedModel(owner, `orphaned-${Date.now()}`);
    const mine = (await request(app).post(`/api/print/${originalId}/copy`).set(auth(viewer))).body.print.id;
    const adminsCopy = (await request(app).post(`/api/print/${originalId}/copy`).set(auth(admin))).body.print.id;
    await shareModel(admin, adminsCopy);
    expect((await request(app).delete(`/api/print/${originalId}`).set(auth(owner))).status).toBe(200);

    const res = await request(app).post(`/api/print/${adminsCopy}/copy`).set(auth(viewer));
    expect(res.body).toMatchObject({ copied: false, print: { id: mine } });
  });

  it("copies nothing into a tool's collection, which takes no models", async () => {
    const sharedId = await sharedModel(owner, `tooled-${Date.now()}`);
    const tool = await prisma.tool.create({
      data: {
        source: "own",
        scope: viewer.id,
        slug: `social-${Date.now()}`,
        userId: viewer.id,
        manifest: {},
        script: "",
        sha: "x",
      },
    });
    const toolCollection = await prisma.collection.create({
      data: { userId: viewer.id, name: `Tool ${Date.now()}`, nameNormalized: `tool ${Date.now()}`, toolId: tool.id },
    });

    const res = await request(app)
      .post(`/api/collection/${toolCollection.id}/items`)
      .set(auth(viewer))
      .send({ print_ids: [sharedId] });
    expect(res.status).toBe(403);
    expect(await prisma.print.count({ where: { userId: viewer.id, copiedFromId: sharedId } })).toBe(0);
  });

  it("covers each collection with its own first four models", async () => {
    const sharer = await register("Sharer");
    const covers: string[][] = [];
    for (const shelf of ["first", "second"]) {
      const collection = await request(app)
        .post("/api/collections")
        .set(auth(sharer))
        .send({ name: `${shelf} ${Date.now()}`, is_public: true });
      const ids: string[] = [];
      for (let n = 0; n < 5; n++) {
        const upload = await request(app)
          .post("/api/upload")
          .set(auth(sharer))
          .attach("files", tmpFile(`${shelf}-${n}.stl`, `solid ${shelf}${n} endsolid`));
        ids.push(upload.body.prints[0].id);
        await request(app).post(`/api/collection/${collection.body.id}/items/${ids[n]}`).set(auth(sharer));
      }
      covers.push(ids.slice(0, 4));
    }
    const page = await request(app).get(`/api/explore/user/${sharer.id}`).set(auth(viewer));
    const byName = (prefix: string) =>
      page.body.collections
        .find((c: { name: string }) => c.name.startsWith(prefix))
        .cover_items.map((p: { id: string }) => p.id);
    expect([byName("first"), byName("second")]).toEqual(covers);
  });

  it("says which models a bulk add couldn't file", async () => {
    const sharedId = await sharedModel(owner, `bulk-${Date.now()}`);
    const hidden = await request(app)
      .post("/api/upload")
      .set(auth(owner))
      .attach("files", tmpFile("hidden.stl", "solid hidden endsolid"));
    const hiddenId = hidden.body.prints[0].id;
    const target = await request(app)
      .post("/api/collections")
      .set(auth(viewer))
      .send({ name: `Bulk ${Date.now()}` });

    const res = await request(app)
      .post(`/api/collection/${target.body.id}/items`)
      .set(auth(viewer))
      .send({ print_ids: [sharedId, hiddenId] });
    expect(res.body).toEqual({ ok: true, not_found: [hiddenId] });
    expect((await request(app).get(`/api/collection/${target.body.id}`).set(auth(viewer))).body.item_count).toBe(1);
  });
});

describe("a copy's category", () => {
  beforeAll(async () => {
    await setSocialSettings({ enabled: true });
  });

  /** `account`'s starter category of these names, from the top. */
  async function starter(account: Account, ...names: string[]): Promise<string> {
    let parentId: string | null = null;
    for (const name of names) {
      const found: { id: string } = await prisma.category.findFirstOrThrow({
        where: { userId: account.id, kind: "category", parentId, name },
        select: { id: true },
      });
      parentId = found.id;
    }
    return parentId!;
  }

  async function sortedModel(categoryId: string): Promise<string> {
    const id = await sharedModel(owner, `sorted-${Date.now()}`);
    await prisma.print.update({ where: { id }, data: { categoryId, categorySource: "MANUAL" } });
    return id;
  }

  async function copyOf(account: Account, sourceId: string) {
    const res = await request(app).post(`/api/print/${sourceId}/copy`).set(auth(account));
    expect(res.body.copied).toBe(true);
    return prisma.print.findUniqueOrThrow({ where: { id: res.body.print.id } });
  }

  it("is the copier's own starter category with the same names", async () => {
    const copy = await copyOf(viewer, await sortedModel(await starter(owner, "3D Printer", "Test Models")));
    expect(copy).toMatchObject({
      categoryId: await starter(viewer, "3D Printer", "Test Models"),
      categorySource: "RULE",
    });
  });

  it("is found by the sites' categories when the copier renamed theirs", async () => {
    const sorter = await register("Sorter");
    const theirs = await starter(sorter, "3D Printer", "Test Models");
    await prisma.category.update({ where: { id: theirs }, data: { name: "Calibration" } });
    const copy = await copyOf(sorter, await sortedModel(await starter(owner, "3D Printer", "Test Models")));
    expect(copy.categoryId).toBe(theirs);
  });

  it("is found however deep it is", async () => {
    const deep = async (account: Account) => {
      let parentId = await starter(account, "3D Printer", "Test Models");
      for (let depth = 1; depth <= 25; depth++) {
        const data = { userId: account.id, name: `Depth ${depth}`, kind: "category", parentId };
        parentId = (await prisma.category.create({ data })).id;
      }
      return parentId;
    };
    const mine = await deep(viewer);
    expect((await copyOf(viewer, await sortedModel(await deep(owner)))).categoryId).toBe(mine);
  });

  it("is never one of the owner's own folders, however it's named", async () => {
    const folder = await prisma.category.create({ data: { userId: owner.id, name: "Test Models", kind: "folder" } });
    expect((await copyOf(viewer, await sortedModel(folder.id))).categoryId).toBeNull();
  });

  it("comes with its source, and what the source had nothing for", async () => {
    const sourceId = await sharedModel(owner, `sourced-${Date.now()}`);
    await prisma.print.update({
      where: { id: sourceId },
      data: { sourceProvider: "printables", sourceExternalId: `copied-${Date.now()}`, unfillableGaps: ["author"] },
    });
    const copy = await copyOf(viewer, sourceId);
    expect(copy).toMatchObject({ sourceProvider: "printables", unfillableGaps: ["author"] });
    const page = await request(app).get(`/api/print/${copy.id}`).set(auth(viewer));
    expect(page.body.source_url).toMatch(/^https:\/\/www\.printables\.com\//);
    expect(page.body.source_gaps).toContain("creator");
    expect(page.body.source_gaps).not.toContain("author");
  });
});
