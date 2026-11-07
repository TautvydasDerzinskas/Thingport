import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { mediaAddress } from "../src/federation/media";
import { collectionsOf, directory, modelsPage, sendSharedFile } from "../src/federation/publish";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const ORIGIN = "http://192.0.2.60:8000";
const PARTNER = "http://203.0.113.70";

type Account = { token: string; id: string };
async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `fx-${name.toLowerCase()}-${Date.now()}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status}`);
  return { token: res.body.token, id: res.body.user.id };
}
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-fx-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];
const KEYS = ["federation", "public_url"];
let owner: Account;
let viewer: Account;
let sharedPrint: string;
let privatePrint: string;
let collectionId: string;
let peerId: string;
let personId: string;
let modelId: string;
let filesModelId: string;
let remoteCollectionId: string;

beforeAll(async () => {
  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  owner = await register("Sharer");
  viewer = await register("Looker");
  await setSocialSettings({ enabled: true });
  await prisma.setting.upsert({
    where: { key: "public_url" },
    create: { key: "public_url", value: ORIGIN },
    update: { value: ORIGIN },
  });
  await updateFederationSettings({ enabled: true });
  resetRuntime();

  const upload = async (name: string) =>
    (
      await request(app)
        .post("/api/upload")
        .set(auth(owner))
        .attach("files", tmpFile(`${name}.stl`, `solid ${name} endsolid`))
    ).body.prints[0].id as string;
  sharedPrint = await upload("shared-bin");
  privatePrint = await upload("private-bin");
  await prisma.print.update({ where: { id: sharedPrint }, data: { title: "Shared bin", notes: "A **bin**." } });
  const created = await request(app)
    .post("/api/collections")
    .set(auth(owner))
    .send({ name: `Bins ${Date.now()}`, is_public: true });
  collectionId = created.body.id;
  await request(app).post(`/api/collection/${collectionId}/items/${sharedPrint}`).set(auth(owner));

  // A partner, and what its directory said, as a sync leaves it.
  const peer = await prisma.peer.create({
    data: {
      origin: PARTNER,
      name: "Makerspace",
      status: "ACTIVE",
      actorUrl: `${PARTNER}/api/ap/actors/instance`,
      connectedAt: new Date(),
      syncedAt: new Date(),
    },
  });
  peerId = peer.id;
  invalidateAllowlist();
  const person = await prisma.remotePerson.create({
    data: {
      peerId,
      apId: `${PARTNER}/api/ap/actors/ruta`,
      username: "ruta",
      displayName: "Rūta",
      bio: "Gridfinity everything.",
      links: ["https://example.org/ruta"],
      avatarUrl: `${PARTNER}/api/ap/media/avatar/ruta?v=1`,
      coverPreset: "pixel",
      modelCount: 1,
      collectionCount: 1,
      sharedAt: new Date(Date.now() + 60_000),
    },
  });
  personId = person.id;
  const model = await prisma.remoteModel.create({
    data: {
      peerId,
      personId,
      apId: `${PARTNER}/api/ap/models/m1`,
      title: "Gridfinity bin 2x3",
      description: "Prints without supports.",
      images: [`${PARTNER}/api/ap/media/image/i1?v=1`],
      files: [{ name: "bin.3mf", size: 1800, mediaType: "model/3mf" }],
      sharedAt: new Date(Date.now() + 60_000),
    },
  });
  modelId = model.id;
  filesModelId = (
    await prisma.remoteModel.create({
      data: {
        peerId,
        personId,
        apId: `${PARTNER}/api/ap/models/m2`,
        title: "Bin with files",
        images: [],
        sharedAt: new Date(Date.now() - 60_000),
        files: [
          { name: "bin.3mf", size: 1800, mediaType: "model/3mf", url: `${PARTNER}/api/ap/files/plate/p1/bin.3mf` },
          { name: "notes.pdf", size: 20, mediaType: "application/pdf" },
          { name: "elsewhere.stl", size: 30, url: "http://198.51.100.9/api/ap/files/plate/p2/elsewhere.stl" },
        ],
      },
    })
  ).id;
  const collection = await prisma.remoteCollection.create({
    data: {
      peerId,
      personId,
      apId: `${PARTNER}/api/ap/collections/c1`,
      name: "Tool wall",
      modelApIds: [`${PARTNER}/api/ap/models/m1`, `${PARTNER}/api/ap/models/gone`],
      updatedAt: new Date(),
    },
  });
  remoteCollectionId = collection.id;
});

afterAll(async () => {
  await prisma.peer.deleteMany({ where: { origin: PARTNER } });
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  clearFederationSettingsCache();
  invalidateAllowlist();
  resetRuntime();
});

describe("what partners are shown", () => {
  it("lists people who share, with what they share counted", async () => {
    const body = (await directory()) as { type: string; orderedItems: Record<string, unknown>[] };
    expect(body.type).toBe("OrderedCollection");
    const person = body.orderedItems.find((item) => item.id === `${ORIGIN}/api/ap/actors/${owner.id}`);
    expect(person).toMatchObject({
      type: "Person",
      "f3di:concreteType": "User",
      name: "Sharer",
      "thingport:modelCount": 1,
      "thingport:collectionCount": 1,
      "thingport:models": `${ORIGIN}/api/ap/actors/${owner.id}/models`,
    });
    // Someone who shares nothing isn't listed.
    expect(body.orderedItems.some((item) => item.id === `${ORIGIN}/api/ap/actors/${viewer.id}`)).toBe(false);
  });

  it("gives only the shared models, shaped like Manyfold's", async () => {
    const page = (await modelsPage(owner.id, 0)) as { orderedItems: Record<string, unknown>[] };
    expect(page.orderedItems.map((item) => item.id)).toEqual([`${ORIGIN}/api/ap/models/${sharedPrint}`]);
    expect(page.orderedItems[0]).toMatchObject({
      type: "Service",
      "f3di:concreteType": "3DModel",
      name: "Shared bin",
      source: { content: "A **bin**.", mediaType: "text/markdown" },
      attributedTo: `${ORIGIN}/api/ap/actors/${owner.id}`,
      attachment: [expect.objectContaining({ type: "Document", name: "shared-bin.stl" })],
    });
    expect(JSON.stringify(page)).not.toContain(privatePrint);
    expect(await modelsPage(viewer.id, 0)).toBeNull();
  });

  it("gives public collections with the models in them", async () => {
    const body = (await collectionsOf(owner.id)) as { orderedItems: Record<string, unknown>[] };
    expect(body.orderedItems).toEqual([
      expect.objectContaining({
        id: `${ORIGIN}/api/ap/collections/${collectionId}`,
        type: "Group",
        "f3di:concreteType": "Collection",
        "thingport:models": [`${ORIGIN}/api/ap/models/${sharedPrint}`],
      }),
    ]);
  });

  it("gives each file an address only partners get it at", async () => {
    const page = (await modelsPage(owner.id, 0)) as { orderedItems: { attachment: { url: string }[] }[] };
    const [file] = page.orderedItems[0].attachment;
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId: sharedPrint } });
    expect(file.url).toBe(`${ORIGIN}/api/ap/files/plate/${plate.id}/shared-bin.stl`);
    expect((await request(app).get(new URL(file.url).pathname)).status).toBe(401);

    // What a partner's signed request reaches: the file, while its model is shared, and nothing else.
    const files = express().get(
      "/files/:kind/:id",
      (req, res) => void sendSharedFile(res, req.params.kind, req.params.id),
    );
    const sent = await request(files).get(`/files/plate/${plate.id}`).responseType("blob");
    expect(sent.status).toBe(200);
    expect(sent.headers["content-disposition"]).toBe('attachment; filename="shared-bin.stl"');
    expect(sent.body.toString()).toBe("solid shared-bin endsolid");
    const hidden = await prisma.plate.findFirstOrThrow({ where: { printId: privatePrint } });
    expect((await request(files).get(`/files/plate/${hidden.id}`)).status).toBe(404);
    expect((await request(files).get(`/files/print/${plate.id}`)).status).toBe(404);
  });

  it("answers only a partner's signed request", async () => {
    for (const route of [
      "/api/ap/directory",
      `/api/ap/actors/${owner.id}/models`,
      `/api/ap/media/avatar/${owner.id}`,
    ]) {
      expect((await request(app).get(route)).status).toBe(401);
      const forged = await request(app)
        .get(route)
        .set("Signature", `keyId="${PARTNER}/api/ap/actors/instance#main-key",algorithm="rsa-sha256",signature="x"`);
      expect(forged.status).toBe(401);
    }
  });
});

describe("Explore with partners", () => {
  it("shows partners' people, models and collections beside this instance's", async () => {
    const res = await request(app).get("/api/explore").set(auth(viewer));
    expect(res.status).toBe(200);
    expect(res.body.instances).toEqual([{ id: peerId, name: "Makerspace", origin: PARTNER, http: true }]);
    expect(res.body.people.some((person: { id: string }) => person.id === owner.id)).toBe(true);
    expect(res.body.shared_at.people[owner.id]).toEqual(expect.any(String));
    const { people, recent_models, recent_collections } = res.body.elsewhere;
    expect(people).toEqual([
      expect.objectContaining({
        id: personId,
        display_name: "Rūta",
        handle: "ruta@203.0.113.70",
        instance: expect.objectContaining({ id: peerId }),
        avatar_url: mediaAddress(`${PARTNER}/api/ap/media/avatar/ruta?v=1`),
      }),
    ]);
    expect(recent_models[0]).toMatchObject({ id: modelId, title: "Gridfinity bin 2x3", file_count: 1 });
    // What the index doesn't have of a collection isn't counted.
    expect(recent_collections[0]).toMatchObject({ id: remoteCollectionId, item_count: 1 });
  });

  it("narrows to this instance, or to one partner", async () => {
    const here = await request(app).get("/api/explore?scope=here").set(auth(viewer));
    expect(here.body.elsewhere.people).toEqual([]);
    expect(here.body.people.length).toBeGreaterThan(0);
    const there = await request(app).get(`/api/explore?scope=${peerId}`).set(auth(viewer));
    expect(there.body.people).toEqual([]);
    expect(there.body.elsewhere.people).toHaveLength(1);
  });

  it("opens a partner's person, model and collection", async () => {
    const person = await request(app).get(`/api/explore/elsewhere/person/${personId}`).set(auth(viewer));
    expect(person.body.person).toMatchObject({
      display_name: "Rūta",
      bio: "Gridfinity everything.",
      links: ["https://example.org/ruta"],
      cover_preset: "pixel",
    });
    expect(person.body.collections).toHaveLength(1);
    const models = await request(app).get(`/api/explore/elsewhere/person/${personId}/models`).set(auth(viewer));
    expect(models.headers["x-total-count"]).toBe("2");
    expect(models.body[0].id).toBe(modelId);
    const model = await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(viewer));
    expect(model.body).toMatchObject({
      description: "Prints without supports.",
      files: [{ name: "bin.3mf", size: 1800, media_type: "model/3mf" }],
      owner_handle: "ruta@203.0.113.70",
      collections: [{ id: remoteCollectionId, name: "Tool wall" }],
    });
    const collection = await request(app)
      .get(`/api/explore/elsewhere/collection/${remoteCollectionId}`)
      .set(auth(viewer));
    expect(collection.body.models.map((item: { id: string }) => item.id)).toEqual([modelId]);
  });

  it("hands out a partner's files through this instance, and only those the partner gave", async () => {
    const remoteFiles = await request(app).get(`/api/explore/elsewhere/model/${filesModelId}`).set(auth(viewer));
    expect(remoteFiles.body.files).toEqual([
      {
        name: "bin.3mf",
        size: 1800,
        media_type: "model/3mf",
        url: `/explore/elsewhere/model/${filesModelId}/files/0/bin.3mf`,
      },
      { name: "notes.pdf", size: 20, media_type: "application/pdf", url: null },
      // Somewhere other than the partner's own origin: never fetched.
      { name: "elsewhere.stl", size: 30, media_type: null, url: null },
    ]);
    for (const index of ["1", "2", "9", "x"]) {
      const res = await request(app)
        .get(`/api/explore/elsewhere/model/${filesModelId}/files/${index}/f`)
        .set(auth(viewer));
      expect(res.status).toBe(404);
    }
    // Nothing to copy where no file can be had.
    const copy = await request(app).post(`/api/explore/elsewhere/model/${modelId}/copy`).set(auth(viewer));
    expect(copy.status).toBe(409);
    expect(copy.body.code).toBe("no_files");
    expect((await request(app).get(`/api/explore/elsewhere/model/${modelId}/copy`).set(auth(viewer))).body).toEqual({
      state: "idle",
      files: [],
      copy_id: null,
      error: null,
    });
  });

  it("says where a copy came from, and offers it rather than another", async () => {
    const mine = (
      await request(app).post("/api/upload").set(auth(viewer)).attach("files", tmpFile("bin.3mf", "not really a 3mf"))
    ).body.prints[0].id as string;
    await prisma.print.update({
      where: { id: mine },
      data: {
        remoteSource: {
          apId: `${PARTNER}/api/ap/models/m1`,
          origin: PARTNER,
          instance: "Makerspace then",
          ownerName: "Rūta then",
          ownerHandle: "ruta@203.0.113.70",
        },
      },
    });
    const copy = await request(app).get(`/api/print/${mine}`).set(auth(viewer));
    expect(copy.body.copied_from_remote).toEqual({
      instance: { name: "Makerspace", origin: PARTNER, http: true },
      owner_id: personId,
      owner_name: "Rūta",
      owner_handle: "ruta@203.0.113.70",
      owner_avatar_url: mediaAddress(`${PARTNER}/api/ap/media/avatar/ruta?v=1`),
      original_id: modelId,
    });
    const original = await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(viewer));
    expect(original.body.library_copy_id).toBe(mine);
    const again = await request(app).post(`/api/explore/elsewhere/model/${modelId}/copy`).set(auth(viewer));
    expect(again.body).toMatchObject({ state: "done", copy_id: mine });
    // Someone else has no copy of it.
    const theirs = await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(owner));
    expect(theirs.body.library_copy_id).toBeNull();

    // The partner paused: what was kept, and no original to go to.
    await prisma.peer.update({ where: { id: peerId }, data: { status: "PAUSED" } });
    try {
      const kept = await request(app).get(`/api/print/${mine}`).set(auth(viewer));
      expect(kept.body.copied_from_remote).toEqual({
        instance: { name: "Makerspace then", origin: PARTNER, http: true },
        owner_id: null,
        owner_name: "Rūta then",
        owner_handle: "ruta@203.0.113.70",
        owner_avatar_url: null,
        original_id: null,
      });
    } finally {
      await prisma.peer.update({ where: { id: peerId }, data: { status: "ACTIVE" } });
    }
    // An ordinary model says nothing of the kind.
    expect((await request(app).get(`/api/print/${sharedPrint}`).set(auth(owner))).body.copied_from_remote).toBeNull();
  });

  it("fetches no picture it didn't hand out the address of", async () => {
    const address = mediaAddress(`${PARTNER}/api/ap/media/avatar/ruta?v=1`)!;
    const tampered = address.replace(/\.[^.]+$/, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect((await request(app).get(`/api${tampered}`).set(auth(viewer))).status).toBe(404);
    // Signed for an address no partner is at.
    expect(
      (
        await request(app)
          .get(`/api${mediaAddress("http://198.51.100.99/x.png")}`)
          .set(auth(viewer))
      ).status,
    ).toBe(404);
  });

  it("hides a paused partner, and everything elsewhere while connected instances are off", async () => {
    await prisma.peer.update({ where: { id: peerId }, data: { status: "PAUSED" } });
    try {
      const res = await request(app).get("/api/explore").set(auth(viewer));
      expect(res.body.elsewhere.people).toEqual([]);
      expect(res.body.instances).toEqual([]);
      expect((await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(viewer))).status).toBe(404);
    } finally {
      await prisma.peer.update({ where: { id: peerId }, data: { status: "ACTIVE" } });
    }
    await updateFederationSettings({ enabled: false });
    try {
      const res = await request(app).get("/api/explore").set(auth(viewer));
      expect(res.body.elsewhere.people).toEqual([]);
      expect((await request(app).get(`/api/explore/elsewhere/person/${personId}`).set(auth(viewer))).status).toBe(404);
    } finally {
      await updateFederationSettings({ enabled: true });
    }
  });
});
