import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { MEDIA_DIR, mediaAddress, pruneMedia } from "../src/federation/media";
import { FederationFetchError } from "../src/federation/fetch";
import {
  collectionsOf,
  DIRECTORY_PAGE,
  directory,
  fitPerson,
  modelsPage,
  PERSON_MAX_BYTES,
  person as personDoc,
} from "../src/federation/publish";
import { readModels } from "../src/federation/remoteIndex";
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
      "f3di:concreteType": "User",
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
    expect(models.headers["x-total-count"]).toBe("1");
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
    // `count` pages of one model each; past them, what `after` says.
    const partner =
      (count: number, after: (page: number) => unknown = () => Promise.reject(gone())) =>
      async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page >= count) return after(page);
        return {
          orderedItems: [{ id: `${PARTNER}/api/ap/models/p${page}`, name: `P${page}`, attributedTo: "x" }],
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
    expect(await read(partner(45, () => ({ orderedItems: [], next: at(999) })))).toEqual({ count: 40, all: false });
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
    const body = (await collectionsOf(owner.id)) as { orderedItems: { id: string }[] };
    const ids = body.orderedItems.map((item) => item.id.split("/").pop());
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer));
  });
});
