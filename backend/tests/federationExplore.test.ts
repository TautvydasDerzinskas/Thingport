import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createApp } from "../src/app";
import { IMPORT_MAX_BYTES } from "../src/config";
import { prisma } from "../src/db";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { MEDIA_DIR, mediaAddress, pruneMedia } from "../src/federation/media";
import { FederationFetchError } from "../src/federation/fetch";
import {
  COLLECTION_FIRST_IDS,
  COLLECTION_MAX_BYTES,
  COLLECTIONS_PAGE,
  collectionModelsPage,
  collectionsPage,
  DIRECTORY_PAGE,
  directory,
  fitCollection,
  fitPerson,
  modelsPage,
  PAGE_BYTES,
  parseModelsCursor,
  PERSON_MAX_BYTES,
  person as personDoc,
  sendSharedFile,
} from "../src/federation/publish";
import { imagesAsLinks } from "../src/federation/remoteCopy";
import { fileKey } from "../src/federation/remoteFiles";
import { readCollections, readModels } from "../src/federation/remoteIndex";
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
let emptyCollectionId: string;

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
  emptyCollectionId = (
    await prisma.remoteCollection.create({
      data: {
        peerId,
        personId,
        apId: `${PARTNER}/api/ap/collections/c2`,
        name: "Not started",
        modelApIds: [],
        updatedAt: new Date(Date.now() - 60_000),
      },
    })
  ).id;
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
    const body = (await directory()) as { type: string; next?: string; orderedItems: Record<string, unknown>[] };
    expect(body.type).toBe("OrderedCollectionPage");
    // A page at a time, each small enough for a partner's fetch; the newest sharer is on the first.
    expect(body.orderedItems.length).toBeLessThanOrEqual(DIRECTORY_PAGE);
    expect([undefined, `${ORIGIN}/api/ap/directory?page=1`]).toContain(body.next);
    expect(((await directory(100_000)) as { orderedItems: unknown[] }).orderedItems).toEqual([]);
    const person = body.orderedItems.find((item) => item.id === `${ORIGIN}/api/ap/actors/${owner.id}`);
    expect(person).toMatchObject({
      type: "Person",
      name: "Sharer",
      "thingport:modelCount": 1,
      "thingport:collectionCount": 1,
      "thingport:models": `${ORIGIN}/api/ap/actors/${owner.id}/models`,
    });
    // Someone who shares nothing isn't listed.
    expect(body.orderedItems.some((item) => item.id === `${ORIGIN}/api/ap/actors/${viewer.id}`)).toBe(false);
  });

  it("gives a person who shares at their id, and no one else", async () => {
    expect(await personDoc(owner.id)).toMatchObject({
      id: `${ORIGIN}/api/ap/actors/${owner.id}`,
      type: "Person",
      name: "Sharer",
    });
    expect(await personDoc(viewer.id)).toBeNull();
    expect((await request(app).get(`/api/ap/actors/${owner.id}`)).status).toBe(401);
    // The instance actor is anyone's to read, as checking a signature needs its key.
    expect((await request(app).get("/api/ap/actors/instance").set("Accept", "application/activity+json")).status).toBe(
      200,
    );
    // A drawn avatar is versioned by what's drawn.
    const icon = ((await personDoc(owner.id)) as { icon?: { url: string } }).icon?.url;
    expect(icon ?? "").not.toMatch(/\?v=svg$/);
  });

  it("gives only the shared models", async () => {
    const page = (await modelsPage(owner.id)) as { orderedItems: Record<string, unknown>[] };
    expect(page.orderedItems.map((item) => item.id)).toEqual([`${ORIGIN}/api/ap/models/${sharedPrint}`]);
    expect(page.orderedItems[0]).toMatchObject({
      type: "thingport:Model",
      name: "Shared bin",
      source: { content: "A **bin**.", mediaType: "text/markdown" },
      attributedTo: `${ORIGIN}/api/ap/actors/${owner.id}`,
      attachment: [expect.objectContaining({ type: "Document", name: "shared-bin.stl" })],
    });
    expect(JSON.stringify(page)).not.toContain(privatePrint);
    expect(await modelsPage(viewer.id)).toBeNull();
  });

  it("gives public collections with the models in them", async () => {
    const body = (await collectionsPage(owner.id)) as { orderedItems: Record<string, unknown>[] };
    expect(body.orderedItems).toEqual([
      expect.objectContaining({
        id: `${ORIGIN}/api/ap/collections/${collectionId}`,
        type: "thingport:Collection",
        "thingport:models": expect.objectContaining({
          totalItems: 1,
          first: expect.objectContaining({ orderedItems: [`${ORIGIN}/api/ap/models/${sharedPrint}`] }),
        }),
      }),
    ]);
  });

  it("gives each file an address only partners get it at", async () => {
    const page = (await modelsPage(owner.id)) as { orderedItems: { attachment: { url: string }[] }[] };
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
    // An empty one too, as this instance's own are.
    expect(recent_collections.map((item: { id: string }) => item.id)).toContain(emptyCollectionId);
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
    expect(person.body.collections).toHaveLength(2);
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
    expect(collection.body.total).toBe(1);
    const beyond = await request(app)
      .get(`/api/explore/elsewhere/collection/${remoteCollectionId}?limit=1&offset=1`)
      .set(auth(viewer));
    expect(beyond.body).toMatchObject({ models: [], total: 1 });
  });

  it("pages a person's collections on their page, here and on a partner", async () => {
    // Here: the first page comes with their page, the rest from its own route.
    const shelver = await register("Shelver");
    await prisma.collection.createMany({
      data: Array.from({ length: 26 }, (_, n) => ({
        userId: shelver.id,
        name: `C${n}`,
        nameNormalized: `c${n}`,
        visibility: "PUBLIC",
      })),
    });
    const page = await request(app).get(`/api/explore/user/${shelver.id}`).set(auth(viewer));
    expect(page.status).toBe(200);
    expect(page.body.collections).toHaveLength(24);
    expect(page.body.collections_total).toBe(26);
    const rest = await request(app).get(`/api/explore/user/${shelver.id}/collections?offset=24`).set(auth(viewer));
    expect(rest.status).toBe(200);
    expect(rest.body).toHaveLength(2);
    expect(rest.headers["x-total-count"]).toBe("26");
    expect(rest.headers["x-has-more"]).toBe("false");
    expect(new Set([...page.body.collections, ...rest.body].map((c: { id: string }) => c.id)).size).toBe(26);
    // Someone who shares none has none to page.
    expect((await request(app).get(`/api/explore/user/${viewer.id}/collections`).set(auth(owner))).status).toBe(404);

    // On a partner: as many as this instance has of theirs.
    const many = `${PARTNER}/api/ap/collections/many-`;
    await prisma.remoteCollection.createMany({
      data: Array.from({ length: 25 }, (_, n) => ({
        peerId,
        personId,
        apId: `${many}${n}`,
        name: `Many ${n}`,
        modelApIds: [],
        updatedAt: new Date(Date.now() - 3_600_000 - n * 1000),
      })),
    });
    try {
      const there = await request(app).get(`/api/explore/elsewhere/person/${personId}`).set(auth(viewer));
      expect(there.body.collections).toHaveLength(24);
      expect(there.body.collections_total).toBe(27);
      const more = await request(app)
        .get(`/api/explore/elsewhere/person/${personId}/collections?offset=24&limit=30`)
        .set(auth(viewer));
      expect(more.status).toBe(200);
      expect(more.body).toHaveLength(3);
      expect(more.headers["x-has-more"]).toBe("false");
      expect(
        (await request(app).get(`/api/explore/elsewhere/person/nobody/collections`).set(auth(viewer))).status,
      ).toBe(404);
    } finally {
      await prisma.remoteCollection.deleteMany({ where: { apId: { startsWith: many } } });
    }
  });

  it("hands out a partner's files through this instance, and only those the partner gave", async () => {
    const remoteFiles = await request(app).get(`/api/explore/elsewhere/model/${filesModelId}`).set(auth(viewer));
    expect(remoteFiles.body.files).toEqual([
      {
        name: "bin.3mf",
        folder: null,
        size: 1800,
        media_type: "model/3mf",
        // By a key from its address at the partner, so a reordered list never serves another file.
        url: `/explore/elsewhere/model/${filesModelId}/files/${fileKey(`${PARTNER}/api/ap/files/plate/p1/bin.3mf`)}/bin.3mf`,
      },
      { name: "notes.pdf", folder: null, size: 20, media_type: "application/pdf", url: null },
      // Somewhere other than the partner's own origin: never fetched.
      { name: "elsewhere.stl", folder: null, size: 30, media_type: null, url: null },
    ]);
    // A key for no file it shares, or for one that isn't on its origin, is never fetched.
    for (const key of ["0", "x", fileKey("http://198.51.100.9/api/ap/files/plate/p2/elsewhere.stl")]) {
      const res = await request(app)
        .get(`/api/explore/elsewhere/model/${filesModelId}/files/${key}/f`)
        .set(auth(viewer));
      expect(res.status).toBe(404);
    }
    // A copy is all of it or nothing: one with files that can't be had isn't copied without them.
    const partly = await request(app).post(`/api/explore/elsewhere/model/${filesModelId}/copy`).set(auth(viewer));
    expect(partly.status).toBe(409);
    expect(partly.body.code).toBe("files_missing");
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

  it("won't copy a model whose files together are more than one import", async () => {
    const half = Math.floor(IMPORT_MAX_BYTES / 2) + 1;
    const big = await prisma.remoteModel.create({
      data: {
        peerId,
        personId,
        apId: `${PARTNER}/api/ap/models/big`,
        title: "Two halves",
        images: [],
        sharedAt: new Date(Date.now() - 120_000),
        files: ["a", "b"].map((name) => ({
          name: `${name}.stl`,
          size: half,
          url: `${PARTNER}/api/ap/files/plate/big/${name}.stl`,
        })),
      },
    });
    try {
      // Each would be taken on its own; both, held on disk until the copy is made, aren't.
      const copy = await request(app).post(`/api/explore/elsewhere/model/${big.id}/copy`).set(auth(viewer));
      expect(copy.status).toBe(413);
      expect(copy.body.code).toBe("copy_too_big");
    } finally {
      await prisma.remoteModel.delete({ where: { id: big.id } });
    }
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
    // Someone else has no copy of it, until they copy this one: theirs says where it came from too, and stands for it.
    const theirs = await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(owner));
    expect(theirs.body.library_copy_id).toBeNull();
    const shelf = await request(app).post("/api/collections").set(auth(viewer)).send({ name: "Mine", is_public: true });
    await request(app).post(`/api/collection/${shelf.body.id}/items/${mine}`).set(auth(viewer));
    const copied = await request(app).post(`/api/print/${mine}/copy`).set(auth(owner));
    expect(copied.status).toBe(200);
    const ownersCopy = await request(app).get(`/api/print/${copied.body.print.id}`).set(auth(owner));
    expect(ownersCopy.body.copied_from_remote).toMatchObject({ original_id: modelId, owner_name: "Rūta" });
    expect(
      (await request(app).get(`/api/explore/elsewhere/model/${modelId}`).set(auth(owner))).body.library_copy_id,
    ).toBe(copied.body.print.id);

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
    // Connected instances off: the same, with no links to pages that aren't there.
    await updateFederationSettings({ enabled: false });
    try {
      const off = await request(app).get(`/api/print/${mine}`).set(auth(viewer));
      expect(off.body.copied_from_remote).toMatchObject({ owner_id: null, original_id: null, owner_name: "Rūta then" });
    } finally {
      await updateFederationSettings({ enabled: true });
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

describe("keeping it current", () => {
  it("leaves only the pictures a partner still names", async () => {
    const dir = path.join(MEDIA_DIR, peerId);
    fs.mkdirSync(dir, { recursive: true });
    const name = (url: string) => crypto.createHash("sha256").update(url).digest("hex");
    const named = name(`${PARTNER}/api/ap/media/avatar/ruta?v=1`);
    const old = name(`${PARTNER}/api/ap/media/avatar/ruta?v=0`);
    const fresh = name(`${PARTNER}/api/ap/media/image/new?v=1`);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const file of [named, `${named}.type`, old, `${old}.type`, fresh]) {
      fs.writeFileSync(path.join(dir, file), "x");
      if (file !== fresh) fs.utimesSync(path.join(dir, file), hourAgo, hourAgo);
    }
    await pruneMedia(peerId);
    // The one still named stays, an older version goes, and one just written is left a while.
    expect(fs.readdirSync(dir).toSorted()).toEqual([named, `${named}.type`, fresh].toSorted());
    // Past the most kept of a partner's, the oldest fetched goes first, named or not.
    await pruneMedia(peerId, 1);
    expect(fs.readdirSync(dir)).toEqual([fresh]);
  });

  it("reads a person's models page by page, and knows when it hasn't read them all", async () => {
    const own = (url: string | undefined): url is string => Boolean(url?.startsWith(`${PARTNER}/`));
    const at = (page: number) => `${PARTNER}/api/ap/actors/ruta/models?page=${page}`;
    const gone = () => new FederationFetchError("Not found", "status", 404);
    // `count` pages of `size` models each; past them, what `after` says.
    const partner =
      (count: number, after: (page: number) => unknown = () => Promise.reject(gone()), size = 1) =>
      async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page >= count) return after(page);
        return {
          orderedItems: Array.from({ length: size }, (_, n) => ({
            id: `${PARTNER}/api/ap/models/p${page}-${n}`,
            name: `P${page}`,
            attributedTo: "x",
          })),
          next: page + 1 < count ? at(page + 1) : undefined,
        };
      };
    const read = async (pages: (url: string) => Promise<unknown>) => {
      const { models, all } = await readModels(pages, at(0), own);
      return { count: models.length, all };
    };
    expect(await read(partner(3))).toEqual({ count: 3, all: true });
    // None of their own: only collections.
    expect(await read(partner(0))).toEqual({ count: 0, all: true });
    // More than are read, a page gone after the first, or the next one somewhere else: the rest isn't known.
    expect(await read(partner(250))).toEqual({ count: 200, all: false });
    // At most 2,000 of them, however they're paged.
    expect(await read(partner(45, undefined, 50))).toEqual({ count: 2000, all: false });
    expect(await read(partner(40, undefined, 50))).toEqual({ count: 2000, all: true });
    // A last page that crosses the cap: cut there, and the rest not known.
    expect(await read(partner(67, undefined, 30))).toEqual({ count: 2000, all: false });
    const vanishing = async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      if (page === 1) throw gone();
      return { orderedItems: [], next: at(page + 1) };
    };
    expect(await read(vanishing)).toEqual({ count: 0, all: false });
    const elsewhere = async () => ({ orderedItems: [], next: "http://198.51.100.9/models?page=1" });
    expect(await read(elsewhere)).toEqual({ count: 0, all: false });
    // A page without its items is broken, not empty.
    await expect(read(async () => ({ next: at(1) }))).rejects.toThrow(/orderedItems/);
  });

  it("keeps a published person within what a partner's fetch takes, however their text escapes", async () => {
    expect(DIRECTORY_PAGE * PERSON_MAX_BYTES + 16 * 1024).toBeLessThan(1024 * 1024);
    const big = await register("Big");
    // Control characters are six bytes each in JSON.
    const escaping = (length: number) => "\u0001".repeat(length);
    await prisma.user.update({
      where: { id: big.id },
      data: {
        displayName: escaping(5000),
        bio: escaping(1000),
        profileLinks: Array.from({ length: 5 }, (_, n) => `https://example.org/${n}/${'"'.repeat(480)}`),
      },
    });
    const shelf = await request(app).post("/api/collections").set(auth(big)).send({ name: "Big", is_public: true });
    expect(shelf.status).toBe(200);
    const doc = (await personDoc(big.id)) as Record<string, unknown>;
    const { "@context": _context, ...person } = doc;
    expect(Buffer.byteLength(JSON.stringify(person))).toBeLessThanOrEqual(PERSON_MAX_BYTES);
    expect(String(person.name)).toHaveLength(120);
    // Cut, not dropped: what fits of the bio stays.
    expect((person.source as { content: string }).content.length).toBeGreaterThan(0);
    expect(fitPerson({ name: "Small" })).toEqual({ name: "Small" });
  });

  it("publishes the collections changed last, filing something counting as a change", async () => {
    const make = async (name: string) =>
      (await request(app).post("/api/collections").set(auth(owner)).send({ name, is_public: true })).body.id as string;
    const older = await make(`Older ${Date.now()}`);
    const newer = await make(`Newer ${Date.now()}`);
    await prisma.collection.update({ where: { id: older }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    await request(app).post(`/api/collection/${older}/items/${sharedPrint}`).set(auth(owner));
    const body = (await collectionsPage(owner.id)) as { orderedItems: { id: string }[] };
    const ids = body.orderedItems.map((item) => item.id.split("/").pop());
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
  });

  it("keeps every page of models within what a partner's fetch takes, and pages through them all", async () => {
    const big = await register("Wordy");
    // Each description as long as a partner keeps, and six bytes a character in JSON: a few fill a page.
    const notes = "\u0001".repeat(25_000);
    await prisma.print.createMany({
      data: Array.from({ length: 12 }, (_, n) => ({
        userId: big.id,
        name: `wordy-${n}`,
        nameNormalized: `wordy-${n}`,
        notes,
        createdAt: new Date(Date.now() - n * 1000),
      })),
    });
    const prints = await prisma.print.findMany({ where: { userId: big.id }, select: { id: true } });
    const shelf = await request(app).post("/api/collections").set(auth(big)).send({ name: "All", is_public: true });
    await prisma.collectionItem.createMany({
      data: prints.map((print) => ({ collectionId: shelf.body.id, printId: print.id })),
    });

    const seen: string[] = [];
    let page = (await modelsPage(big.id)) as {
      next?: string;
      orderedItems: { id: string; source: { content: string } }[];
    };
    const sizes: number[] = [];
    for (;;) {
      sizes.push(Buffer.byteLength(JSON.stringify(page)));
      expect(page.orderedItems[0].source.content).toHaveLength(20_000);
      seen.push(...page.orderedItems.map((item) => item.id));
      if (!page.next) break;
      const after = parseModelsCursor(new URL(page.next).searchParams.get("after")!);
      page = (await modelsPage(big.id, after)) as typeof page;
    }
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PAGE_BYTES);
    expect(seen.toSorted()).toEqual(prints.map((print) => `${ORIGIN}/api/ap/models/${print.id}`).toSorted());
    expect(parseModelsCursor("1.x/y")).toBeNull();
  });

  it("pages a person's collections, and the models in a big one", async () => {
    const collector = await register("Collector");
    const make = (name: string) =>
      prisma.collection.create({
        data: { userId: collector.id, name, nameNormalized: name.toLowerCase(), visibility: "PUBLIC" },
        select: { id: true },
      });
    const shelves = [];
    for (let n = 0; n <= COLLECTIONS_PAGE; n++) shelves.push(await make(`Shelf ${n}`));
    await prisma.print.createMany({
      data: Array.from({ length: COLLECTION_FIRST_IDS + 5 }, (_, n) => ({
        userId: collector.id,
        name: `part-${n}`,
        nameNormalized: `part-${n}`,
      })),
    });
    const parts = await prisma.print.findMany({ where: { userId: collector.id }, select: { id: true } });
    await prisma.collectionItem.createMany({
      data: parts.map((part) => ({ collectionId: shelves[0].id, printId: part.id })),
    });

    type Listed = {
      id: string;
      "thingport:models": { totalItems: number; first: { orderedItems: string[]; next?: string } };
    };
    const first = (await collectionsPage(collector.id)) as {
      totalItems: number;
      next?: string;
      orderedItems: Listed[];
    };
    expect(first.totalItems).toBe(COLLECTIONS_PAGE + 1);
    expect(first.orderedItems).toHaveLength(COLLECTIONS_PAGE);
    expect(first.next).toBe(`${ORIGIN}/api/ap/actors/${collector.id}/collections?page=1`);
    const second = (await collectionsPage(collector.id, 1)) as { next?: string; orderedItems: Listed[] };
    expect(second.orderedItems).toHaveLength(1);
    expect(second.next).toBeUndefined();

    // Filled last, so listed first: its first models with it, the rest on a page of their own.
    const full = first.orderedItems[0];
    expect(full.id).toBe(`${ORIGIN}/api/ap/collections/${shelves[0].id}`);
    expect(full["thingport:models"].totalItems).toBe(COLLECTION_FIRST_IDS + 5);
    expect(full["thingport:models"].first.orderedItems).toHaveLength(COLLECTION_FIRST_IDS);
    expect(full["thingport:models"].first.next).toBe(`${full.id}/models?offset=${COLLECTION_FIRST_IDS}`);
    const rest = (await collectionModelsPage(shelves[0].id, COLLECTION_FIRST_IDS)) as {
      next?: string;
      orderedItems: string[];
    };
    expect(rest.orderedItems).toHaveLength(5);
    expect(rest.next).toBeUndefined();
    expect(new Set([...full["thingport:models"].first.orderedItems, ...rest.orderedItems]).size).toBe(parts.length);
    // A private one's aren't given.
    await prisma.collection.update({ where: { id: shelves[0].id }, data: { visibility: "PRIVATE" } });
    expect(await collectionModelsPage(shelves[0].id, 0)).toBeNull();
  });

  it("keeps every published collection within its share of a page, however long its ids and text", () => {
    const make = (description: string | null, ids: string[]) => ({
      name: "Shelf",
      source: description ? { content: description } : undefined,
      models: ids.map((id) => `https://${"a".repeat(240)}.example/api/ap/models/${id}`),
    });
    const ids = Array.from({ length: COLLECTION_FIRST_IDS }, (_, n) => `m${n}`);
    const fitted = fitCollection(make, "\u0001".repeat(5000), ids);
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(COLLECTION_MAX_BYTES);
    expect(fitted.models.length).toBeGreaterThan(0);
    expect(COLLECTIONS_PAGE * COLLECTION_MAX_BYTES + 16 * 1024).toBeLessThanOrEqual(PAGE_BYTES);
    // One that fits is left as it is.
    expect(fitCollection(make, "Bins", ["m1"])).toEqual(make("Bins", ["m1"]));
  });

  it("reads a person's collections page by page, each with all its models", async () => {
    const own = (url: string | undefined): url is string => Boolean(url?.startsWith(`${PARTNER}/`));
    const gone = () => new FederationFetchError("Not found", "status", 404);
    const listing = `${PARTNER}/api/ap/actors/ruta/collections`;
    const shelf = (n: number, next?: string) => ({
      id: `${PARTNER}/api/ap/collections/s${n}`,
      name: `Shelf ${n}`,
      attributedTo: `${PARTNER}/api/ap/actors/ruta`,
      "thingport:models": { totalItems: 3, first: { orderedItems: [`${PARTNER}/api/ap/models/a${n}`], next } },
    });
    const pages: Record<string, unknown> = {
      [listing]: {
        orderedItems: [shelf(0, `${PARTNER}/api/ap/collections/s0/models?offset=1`)],
        next: `${listing}?page=1`,
      },
      [`${listing}?page=1`]: { orderedItems: [shelf(1)] },
      [`${PARTNER}/api/ap/collections/s0/models?offset=1`]: {
        orderedItems: [`${PARTNER}/api/ap/models/b0`, "http://198.51.100.9/api/ap/models/elsewhere"],
        next: `${PARTNER}/api/ap/collections/s0/models?offset=3`,
      },
      [`${PARTNER}/api/ap/collections/s0/models?offset=3`]: { orderedItems: [`${PARTNER}/api/ap/models/c0`] },
    };
    const partner =
      (missing: string[] = []) =>
      async (url: string) => {
        if (missing.includes(url) || !(url in pages)) throw gone();
        return pages[url];
      };
    const all = await readCollections(partner(), listing, own);
    expect(all.all).toBe(true);
    expect(
      all.collections.map((c) => [c.id.split("/").pop(), c.modelIds.map((id) => id.split("/").pop()), c.allIds]),
    ).toEqual([
      ["s0", ["a0", "b0", "c0"], true],
      ["s1", ["a1"], true],
    ]);
    // A later page gone: what's read is kept, and the rest isn't known.
    const partly = await readCollections(partner([`${listing}?page=1`]), listing, own);
    expect(partly).toMatchObject({ all: false, collections: [expect.objectContaining({ allIds: true })] });
    // One of a collection's pages gone: its models as they were stay.
    const ids = await readCollections(partner([`${PARTNER}/api/ap/collections/s0/models?offset=3`]), listing, own);
    expect(ids.collections[0]).toMatchObject({ allIds: false });
    // More on a page than are read: the rest kept from before stay.
    const crowded = await readCollections(
      async () => ({ orderedItems: Array.from({ length: 201 }, (_, n) => shelf(100 + n)) }),
      listing,
      own,
    );
    expect(crowded).toMatchObject({ all: false });
    expect(crowded.collections).toHaveLength(200);
    // From an instance from before pages, all its models in a list; with none said, they aren't known.
    const older = await readCollections(
      async () => ({
        orderedItems: [
          { ...shelf(7), "thingport:models": [`${PARTNER}/api/ap/models/x`, `${PARTNER}/api/ap/models/y`] },
          { id: `${PARTNER}/api/ap/collections/bare`, name: "Bare", attributedTo: `${PARTNER}/api/ap/actors/ruta` },
        ],
      }),
      listing,
      own,
    );
    expect(older.collections.map((c) => [c.modelIds.length, c.allIds])).toEqual([
      [2, true],
      [0, false],
    ]);
    // The first page gone fails the read, as with the rest of what they share.
    await expect(readCollections(partner([listing]), listing, own)).rejects.toThrow("Not found");
  });

  it("copies a partner's description with its images made links, so a viewer's browser fetches none", () => {
    expect(imagesAsLinks("Look: ![a bin](https://cdn.example.org/bin.png) and ![][ref] but not \\![this](x)")).toBe(
      "Look: [a bin](https://cdn.example.org/bin.png) and [][ref] but not \\![this](x)",
    );
    expect(imagesAsLinks(null)).toBeNull();
  });
});
