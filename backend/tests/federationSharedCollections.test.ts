import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { mediaAddress } from "../src/federation/media";
import {
  collectionsSharedWith,
  personNamed,
  sendMedia,
  sendSharedFile,
  sharedCollectionObject,
} from "../src/federation/publish";
import { saveDescriptionImage } from "../src/services/descriptionImageService";
import { PLATE_PNG } from "./helpers/profileProject";
import { remoteCollection, remoteModel } from "../src/federation/remoteExplore";
import { activeRemoteModel } from "../src/federation/remoteFiles";
import { syncPeer } from "../src/federation/remoteIndex";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import {
  personByHandle,
  refreshShared,
  sharedCollectionFrom,
  sharedCollectionGoneFrom,
} from "../src/federation/sharedCollections";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

// Collections shared with partners' people, both ways: this instance telling a partner (what's queued, what it then
// serves), and this instance as the partner told, reading the collection from a stand-in for its owner's instance.
const { PARTNER, partner } = vi.hoisted(() => ({ PARTNER: "http://203.0.113.120", partner: { base: "" } }));
vi.mock("../src/federation/fetch", async (original) => ({
  ...(await original<typeof import("../src/federation/fetch")>()),
  federationFetch: (url: string, init?: RequestInit) => fetch(url.replace(PARTNER, partner.base), init),
}));

const app = createApp();
const ORIGIN = "http://192.0.2.80:8000";
const OTHER = "http://203.0.113.121";
const KEYS = ["federation", "public_url"];
const stamp = Date.now();

type Account = { token: string; id: string };
async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `fsc-${name.toLowerCase()}-${stamp}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status}`);
  return { token: res.body.token, id: res.body.user.id };
}
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
const actorOf = (origin: string) => new URL(`${origin}/api/ap/actors/instance`);
const queued = async (origin: string) =>
  (await prisma.federationDelivery.findMany({ where: { origin }, orderBy: { createdAt: "asc" } })).map(
    (row) => row.activity as { type: string; to: string[]; object: string | { id: string } },
  );
const objectId = (activity: { object: string | { id: string } }) =>
  typeof activity.object === "string" ? activity.object : activity.object.id;

/** A file `sendSharedFile` answered, or its status. */
async function served(fileId: string, peer: { id: string } | null): Promise<number> {
  let status = 200;
  const res = {
    status: (code: number) => ((status = code), res),
    json: () => res,
    attachment: () => res,
    setHeader: () => res,
    sendFile: (_file: string, done: (err?: Error) => void) => done(),
    headersSent: false,
  };
  const row = peer ? await prisma.peer.findUnique({ where: { id: peer.id } }) : null;
  await sendSharedFile(res as never, "plate", fileId, row);
  return status;
}

/** A picture `sendMedia` answered, or its status. */
async function mediaServed(kind: string, id: string, peer: { id: string }): Promise<number> {
  let status = 200;
  const res = {
    status: (code: number) => ((status = code), res),
    json: () => res,
    send: () => res,
    setHeader: () => res,
    sendFile: (_file: string, done: (err?: Error) => void) => done(),
    headersSent: false,
  };
  await sendMedia(res as never, kind, id, await prisma.peer.findUniqueOrThrow({ where: { id: peer.id } }));
  return status;
}

// The stand-in for the owner's instance: what it answers for its collections, people and models.
const docs = new Map<string, unknown>();
const people = new Map<string, unknown>();
// A collection's document answered only after this many ms; what /api/ap/shared lists; how often a person was asked.
const delays = new Map<string, number>();
const listedShared: string[] = [];
const directoryPeople: unknown[] = [];
let peopleAsked = 0;
let server: ReturnType<express.Express["listen"]>;

let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];
let alex: Account;
let bea: Account;
let carl: Account;
let partnerId: string;
let otherId: string;
let rutaId: string;
let collectionId: string;
let plateId: string;

beforeAll(async () => {
  const stand = express();
  stand.get("/api/ap/collections/:id", (req, res) => {
    setTimeout(() => {
      const doc = docs.get(req.params.id);
      if (doc) res.json(doc);
      else res.status(404).json({ error: "Not found" });
    }, delays.get(req.params.id) ?? 0);
  });
  stand.get("/api/ap/collections/:id/items", (req, res) => {
    // "partial": its second page is gone, so what's read of it is only part.
    if (req.params.id === "partial" && req.query.after) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      next: req.params.id === "partial" ? `${PARTNER}/api/ap/collections/partial/items?after=1` : undefined,
      type: "OrderedCollectionPage",
      orderedItems: [1, 2].map((n) => ({
        id: `${PARTNER}/api/ap/models/${req.params.id}-m${n}`,
        type: "thingport:Model",
        name: `Hook ${n}`,
        attributedTo: `${PARTNER}/api/ap/actors/ruta`,
        image: [],
        attachment: [],
      })),
    });
  });
  // It shares nothing openly unless a test lists someone: what it shared with people here is all there is.
  stand.get("/api/ap/directory", (_req, res) => {
    res.json({ type: "OrderedCollectionPage", orderedItems: directoryPeople });
  });
  // Rūta's models: one page, and the next one gone, so they're read only in part.
  stand.get("/api/ap/actors/ruta/models", (req, res) => {
    if (req.query.after) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      type: "OrderedCollectionPage",
      next: `${PARTNER}/api/ap/actors/ruta/models?after=1`,
      orderedItems: [
        {
          id: `${PARTNER}/api/ap/models/listed-1`,
          type: "thingport:Model",
          name: "Listed",
          attributedTo: `${PARTNER}/api/ap/actors/ruta`,
          image: [],
          attachment: [],
        },
      ],
    });
  });
  stand.get("/api/ap/shared", (_req, res) => {
    res.json({ type: "OrderedCollection", orderedItems: listedShared });
  });
  stand.get("/api/ap/media/:name", (_req, res) => {
    res.type("image/png").send(PLATE_PNG);
  });
  stand.get("/api/ap/people/:username", (req, res) => {
    peopleAsked++;
    const person = people.get(req.params.username);
    if (person) res.json(person);
    else res.status(404).json({ error: "Not found" });
  });
  server = stand.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  partner.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  alex = await register("Alex");
  bea = await register("Bea");
  carl = await register("Carl");
  await setSocialSettings({ enabled: true });
  await prisma.setting.upsert({
    where: { key: "public_url" },
    create: { key: "public_url", value: ORIGIN },
    update: { value: ORIGIN },
  });
  await updateFederationSettings({ enabled: true });
  resetRuntime();
  await prisma.peer.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  const peer = (origin: string, name: string) =>
    prisma.peer.create({
      data: {
        origin,
        name,
        status: "ACTIVE",
        actorUrl: actorOf(origin).href,
        inboxUrl: `${origin}/api/ap/inbox`,
        connectedAt: new Date(),
      },
    });
  partnerId = (await peer(PARTNER, "Makerspace")).id;
  otherId = (await peer(OTHER, "Print club")).id;
  invalidateAllowlist();
  rutaId = (
    await prisma.remotePerson.create({
      data: {
        peerId: partnerId,
        apId: `${PARTNER}/api/ap/actors/ruta`,
        username: "ruta",
        displayName: "Ruta",
        listed: true,
      },
    })
  ).id;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-fsc-"));
  fs.writeFileSync(path.join(dir, "tray.stl"), "solid tray endsolid");
  const upload = await request(app).post("/api/upload").set(auth(alex)).attach("files", path.join(dir, "tray.stl"));
  const printId = upload.body.prints[0].id as string;
  plateId = (await prisma.plate.findFirstOrThrow({ where: { printId } })).id;
  collectionId = (
    await request(app)
      .post("/api/collections")
      .set(auth(alex))
      .send({ name: `Tool wall ${stamp}` })
  ).body.id;
  await request(app).post(`/api/collection/${collectionId}/items/${printId}`).set(auth(alex));
});

afterAll(async () => {
  server?.close();
  await prisma.federationDelivery.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  await prisma.peer.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  clearFederationSettingsCache();
  resetRuntime();
  invalidateAllowlist();
});

describe("sharing with a partner's people", () => {
  const share = (body: Record<string, unknown>) =>
    request(app).patch(`/api/collection/${collectionId}/sharing`).set(auth(alex)).send(body);

  it("finds them to pick, with their instance", async () => {
    const found = await request(app).get("/api/social/people?q=Ruta").set(auth(alex));
    const ruta = found.body.people.find((person: { id: string }) => person.id === rutaId);
    expect(ruta?.remote).toMatchObject({ handle: "ruta@203.0.113.120", instance: { name: "Makerspace" } });
  });

  it("tells their instance, addressed to them, and lets it read the collection and its files", async () => {
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    const res = await share({ visibility: "shared", add_remote_person_ids: [rutaId] });
    expect(res.status).toBe(200);
    expect(res.body.people[0]).toMatchObject({ id: rutaId, remote: { instance: { name: "Makerspace" } } });

    const [update] = await queued(PARTNER);
    expect(update).toMatchObject({ type: "Update", to: [`${PARTNER}/api/ap/actors/ruta`] });
    expect(objectId(update)).toBe(`${ORIGIN}/api/ap/collections/${collectionId}`);
    expect(await queued(OTHER)).toEqual([]);

    const object = await sharedCollectionObject({ origin: ORIGIN }, collectionId, partnerId);
    expect(object).toMatchObject({
      name: `Tool wall ${stamp}`,
      to: [`${PARTNER}/api/ap/actors/ruta`],
      attributedTo: { id: `${ORIGIN}/api/ap/actors/${alex.id}`, name: "Alex" },
      "thingport:items": `${ORIGIN}/api/ap/collections/${collectionId}/items`,
    });
    // Nobody on the other partner: it isn't there to read.
    expect(await sharedCollectionObject({ origin: ORIGIN }, collectionId, otherId)).toBeNull();
    expect(await served(plateId, { id: partnerId })).toBe(200);
    expect(await served(plateId, { id: otherId })).toBe(404);
    expect(await served(plateId, null)).toBe(404);
  });

  it("says Delete once it's private, and Update again once it's shared", async () => {
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    await share({ visibility: "private" });
    await share({ visibility: "shared" });
    expect((await queued(PARTNER)).map((activity) => activity.type)).toEqual(["Delete", "Update"]);
    expect(await served(plateId, { id: partnerId })).toBe(200);
  });

  it("says Delete when they're taken off, and serves its files there no more", async () => {
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    const res = await share({ remove_remote_person_ids: [rutaId] });
    expect(res.body.people).toEqual([]);
    expect((await queued(PARTNER)).map((activity) => activity.type)).toEqual(["Delete"]);
    expect(await sharedCollectionObject({ origin: ORIGIN }, collectionId, partnerId)).toBeNull();
    expect(await served(plateId, { id: partnerId })).toBe(404);
  });

  it("is refused for someone on a paused partner, or while connected instances are off", async () => {
    await prisma.peer.update({ where: { id: partnerId }, data: { status: "PAUSED" } });
    try {
      expect((await share({ add_remote_person_ids: [rutaId] })).body.code).toBe("partner_unavailable");
    } finally {
      await prisma.peer.update({ where: { id: partnerId }, data: { status: "ACTIVE" } });
    }
    await updateFederationSettings({ enabled: false });
    try {
      expect((await share({ add_remote_person_ids: [rutaId] })).body.code).toBe("federation_off");
    } finally {
      await updateFederationSettings({ enabled: true });
      resetRuntime();
    }
  });

  it("says Delete when the collection is deleted", async () => {
    await share({ add_remote_person_ids: [rutaId] });
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    const doomed = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Doomed ${stamp}` })
    ).body.id as string;
    await request(app)
      .patch(`/api/collection/${doomed}/sharing`)
      .set(auth(alex))
      .send({ visibility: "shared", add_remote_person_ids: [rutaId] });
    await request(app).delete(`/api/collection/${doomed}`).set(auth(alex));
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => activity.type)).toEqual(["Update", "Delete"]);
    expect(objectId(sent[1])).toBe(`${ORIGIN}/api/ap/collections/${doomed}`);
  });

  it("finds someone on a partner by their exact handle, asking that partner only", async () => {
    people.set("dana", {
      id: `${PARTNER}/api/ap/actors/dana`,
      type: "Person",
      name: "Dana",
      preferredUsername: "dana",
    });
    const dana = await personByHandle("dana@203.0.113.120", alex.id);
    expect(dana).toMatchObject({ displayName: "Dana", username: "dana", listed: false, peerId: partnerId });
    expect(await personByHandle("dana@198.51.100.7", alex.id)).toBeNull();
    const found = await request(app).get("/api/social/people?q=dana@203.0.113.120").set(auth(alex));
    expect(found.body.people.map((person: { id: string }) => person.id)).toContain(dana!.id);
  });

  it("asks a partner for so many handles a minute, and no more", async () => {
    const before = peopleAsked;
    for (let n = 0; n < 15; n++) await personByHandle(`ghost${n}-${stamp}@203.0.113.120`, carl.id);
    expect(peopleAsked - before).toBe(10);
  });

  it("lists what it shares with a partner's people, and gives an avatar only where it's served", async () => {
    await request(app)
      .patch(`/api/collection/${collectionId}/sharing`)
      .set(auth(alex))
      .send({ visibility: "shared", add_remote_person_ids: [rutaId] });
    const partnerRow = await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } });
    const listed = (await collectionsSharedWith(partnerRow)) as { orderedItems: string[] };
    expect(listed.orderedItems).toContain(`${ORIGIN}/api/ap/collections/${collectionId}`);
    const other = (await collectionsSharedWith(await prisma.peer.findUniqueOrThrow({ where: { id: otherId } }))) as {
      orderedItems: string[];
    };
    expect(other.orderedItems).toEqual([]);

    const usernameOf = async (account: Account) =>
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id }, select: { username: true } })).username!;
    // Alex shares with someone there, so the partner may fetch his avatar; Carl shares nothing with anyone.
    expect(await personNamed(await usernameOf(alex), partnerRow)).toMatchObject({ icon: { type: "Image" } });
    expect(await personNamed(await usernameOf(carl), partnerRow)).toMatchObject({ icon: undefined });
  });

  it("hands the partner a shared model's description pictures too", async () => {
    const print = await prisma.print.findFirstOrThrow({ where: { plates: { some: { id: plateId } } } });
    const image = (await saveDescriptionImage(print.id, PLATE_PNG, null))!;
    expect(await mediaServed("description", image.id, { id: partnerId })).toBe(200);
    expect(await mediaServed("description", image.id, { id: otherId })).toBe(404);
  });
});

describe("a partner's person sharing a collection with people here", () => {
  const apId = (id: string) => `${PARTNER}/api/ap/collections/${id}`;
  const doc = (id: string, to: string[]) => ({
    id: apId(id),
    type: "thingport:Collection",
    name: "Hooks",
    attributedTo: { id: `${PARTNER}/api/ap/actors/ruta`, type: "Person", name: "Ruta", preferredUsername: "ruta" },
    to,
    "thingport:items": `${apId(id)}/items`,
  });
  const actor = (id: string) => `${ORIGIN}/api/ap/actors/${id}`;
  let keptId: string;
  let modelId: string;

  it("is kept for the people it names, with its models, and they're told", async () => {
    docs.set("c1", doc("c1", [actor(bea.id), `${PARTNER}/api/ap/actors/someone`]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c1"));
    const kept = await prisma.remoteCollection.findUniqueOrThrow({
      where: { apId: apId("c1") },
      include: { viewers: true },
    });
    keptId = kept.id;
    expect(kept).toMatchObject({ limited: true, name: "Hooks", peerId: partnerId });
    expect(kept.viewers.map((viewer) => viewer.userId)).toEqual([bea.id]);
    expect(kept.modelApIds).toHaveLength(2);
    const models = await prisma.remoteModel.findMany({ where: { apId: { in: kept.modelApIds } } });
    expect(models.every((model) => model.limited)).toBe(true);
    modelId = models[0].id;
    expect(
      await prisma.notification.count({
        where: { userId: bea.id, type: "share", internalPath: `/explore/elsewhere/collections/${keptId}` },
      }),
    ).toBe(1);
  });

  it("is Shared with you for them on Explore, and on no one's public rows", async () => {
    const theirs = await request(app).get("/api/explore").set(auth(bea));
    expect(theirs.body.elsewhere.shared_with_you.map((item: { id: string }) => item.id)).toEqual([keptId]);
    expect(theirs.body.elsewhere.recent_collections.map((item: { id: string }) => item.id)).not.toContain(keptId);
    const others = await request(app).get("/api/explore").set(auth(carl));
    expect(others.body.elsewhere.shared_with_you).toEqual([]);
    expect(others.body.elsewhere.recent_models.map((item: { id: string }) => item.id)).not.toContain(modelId);
  });

  it("opens, with its models and files, for them alone", async () => {
    expect(await remoteCollection(keptId, 30, 0, bea.id)).toMatchObject({ total: 2 });
    expect(await remoteCollection(keptId, 30, 0, carl.id)).toBeNull();
    expect(await remoteModel(modelId, bea.id)).not.toBeNull();
    expect(await remoteModel(modelId, carl.id)).toBeNull();
    await expect(activeRemoteModel(modelId, carl.id)).rejects.toThrow("Not found");
    expect((await request(app).get(`/api/explore/elsewhere/collection/${keptId}`).set(auth(carl))).status).toBe(404);
  });

  it("follows who it names, telling only those newly named", async () => {
    docs.set("c1", doc("c1", [actor(carl.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c1"));
    const viewers = await prisma.remoteCollectionViewer.findMany({ where: { collectionId: keptId } });
    expect(viewers.map((viewer) => viewer.userId)).toEqual([carl.id]);
    expect(await remoteCollection(keptId, 30, 0, bea.id)).toBeNull();
    expect(await prisma.notification.count({ where: { userId: carl.id, type: "share" } })).toBe(1);
  });

  it("goes, with the models kept only for it, once its owner's instance stops answering for it", async () => {
    docs.delete("c1");
    await refreshShared(partnerId);
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c1") } })).toBe(0);
    expect(await prisma.remoteModel.count({ where: { id: modelId } })).toBe(0);
  });

  it("goes on a Delete, and only from the partner it came from", async () => {
    docs.set("c2", doc("c2", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c2"));
    expect(await sharedCollectionGoneFrom(actorOf(OTHER), apId("c2"))).toBe(false);
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c2") } })).toBe(1);
    expect(await sharedCollectionGoneFrom(actorOf(PARTNER), apId("c2"))).toBe(true);
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c2") } })).toBe(0);
  });

  it("outlasts a read of what the partner shares openly, which lists none of it", async () => {
    docs.set("c4", doc("c4", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c4"));
    await syncPeer(partnerId);
    const kept = await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("c4") } });
    expect(kept.limited).toBe(true);
    expect(await prisma.remoteModel.count({ where: { apId: { in: kept.modelApIds }, limited: true } })).toBe(2);
    // Its owner shares nothing openly, and stays known for it.
    expect(await prisma.remotePerson.findUnique({ where: { id: kept.personId } })).toMatchObject({ listed: false });
    expect((await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } })).syncError).toBeNull();
  });

  it("leaves a model shared openly as it is when its owner's models were read only in part", async () => {
    // Shared openly there and kept from an earlier read, and in a collection shared with Bea too.
    const ruta = await prisma.remotePerson.findUniqueOrThrow({ where: { id: rutaId } });
    const unread = `${PARTNER}/api/ap/models/unread-${stamp}`;
    await prisma.remoteModel.create({
      data: {
        apId: unread,
        peerId: partnerId,
        personId: ruta.id,
        title: "Unread",
        limited: false,
        syncedAt: new Date(Date.now() - 60_000),
      },
    });
    const holder = await prisma.remoteCollection.create({
      data: {
        apId: `${PARTNER}/api/ap/collections/holder-${stamp}`,
        peerId: partnerId,
        personId: ruta.id,
        name: "Holder",
        modelApIds: [unread],
        limited: true,
        viewers: { create: { userId: bea.id } },
      },
    });
    directoryPeople.push({
      id: ruta.apId,
      type: "Person",
      name: "Ruta",
      preferredUsername: "ruta",
      "thingport:models": `${PARTNER}/api/ap/actors/ruta/models`,
    });
    try {
      await syncPeer(partnerId);
      // Not on the page read, but her models weren't all read: it may well still be shared openly.
      expect(await prisma.remoteModel.findUniqueOrThrow({ where: { apId: unread } })).toMatchObject({ limited: false });
    } finally {
      directoryPeople.length = 0;
      // Let go of by the read after, as its partner doesn't answer for it: gone already, as it should be.
      await prisma.remoteCollection.deleteMany({ where: { id: holder.id } });
    }
  });

  it("finds a collection shared with people here that it was never told of", async () => {
    docs.set("c5", doc("c5", [actor(bea.id)]));
    listedShared.push(apId("c5"));
    await refreshShared(partnerId);
    expect(await prisma.remoteCollection.findUnique({ where: { apId: apId("c5") } })).toMatchObject({ limited: true });
  });

  it("lets a Delete that came during a read have the last word", async () => {
    docs.set("c7", doc("c7", [actor(bea.id)]));
    delays.set("c7", 400);
    const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c7"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const gone = sharedCollectionGoneFrom(actorOf(PARTNER), apId("c7"));
    await Promise.all([reading, gone]);
    expect(await gone).toBe(true);
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c7") } })).toBe(0);
  });

  it("keeps the models it had beside those it read when only part could be read", async () => {
    docs.set("partial", doc("partial", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("partial"));
    const old = `${PARTNER}/api/ap/models/kept-from-before`;
    await prisma.remoteCollection.update({ where: { apId: apId("partial") }, data: { modelApIds: [old] } });
    await sharedCollectionFrom(actorOf(PARTNER), apId("partial"));
    const kept = await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("partial") } });
    expect(kept.modelApIds.toSorted()).toEqual(
      [old, `${PARTNER}/api/ap/models/partial-m1`, `${PARTNER}/api/ap/models/partial-m2`].toSorted(),
    );
  });

  it("keeps a model shared with some people here out of a collection shared openly", async () => {
    docs.set("c8", doc("c8", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c8"));
    const shared = await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("c8") } });
    const open = await prisma.remoteCollection.create({
      data: {
        peerId: partnerId,
        personId: shared.personId,
        apId: `${PARTNER}/api/ap/collections/open-${stamp}`,
        name: "Open",
        modelApIds: shared.modelApIds,
        limited: false,
      },
    });
    expect(await remoteCollection(open.id, 30, 0, carl.id)).toMatchObject({ total: 0, models: [] });
    expect((await remoteCollection(shared.id, 30, 0, bea.id))?.total).toBe(2);
  });

  it("shows a picture only of models shared with some people here to those people", async () => {
    docs.set("c9", doc("c9", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c9"));
    const shared = await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("c9") } });
    const url = `${PARTNER}/api/ap/media/pic-${stamp}`;
    await prisma.remoteModel.update({ where: { apId: shared.modelApIds[0] }, data: { images: [url] } });
    const address = `/api${mediaAddress(url)}`;
    expect((await request(app).get(address).set(auth(bea))).status).toBe(200);
    // Kept here now, and still nobody else's: not fetched again, and not handed to them from what's kept.
    expect((await request(app).get(address).set(auth(carl))).status).toBe(404);
  });

  it("isn't taken from a partner speaking for another's collection", async () => {
    docs.set("c3", doc("c3", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(OTHER), apId("c3"));
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c3") } })).toBe(0);
  });
});
