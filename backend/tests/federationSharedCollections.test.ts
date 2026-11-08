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
import { sendSharedFile, sharedCollectionObject } from "../src/federation/publish";
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

// The stand-in for the owner's instance: what it answers for its collections, people and models.
const docs = new Map<string, unknown>();
const people = new Map<string, unknown>();
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
    const doc = docs.get(req.params.id);
    if (doc) res.json(doc);
    else res.status(404).json({ error: "Not found" });
  });
  stand.get("/api/ap/collections/:id/items", (req, res) => {
    res.json({
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
  // It shares nothing openly: what it shared with people here is all there is.
  stand.get("/api/ap/directory", (_req, res) => {
    res.json({ type: "OrderedCollectionPage", orderedItems: [] });
  });
  stand.get("/api/ap/people/:username", (req, res) => {
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
    const dana = await personByHandle("dana@203.0.113.120");
    expect(dana).toMatchObject({ displayName: "Dana", username: "dana", listed: false, peerId: partnerId });
    expect(await personByHandle("dana@198.51.100.7")).toBeNull();
    const found = await request(app).get("/api/social/people?q=dana@203.0.113.120").set(auth(alex));
    expect(found.body.people.map((person: { id: string }) => person.id)).toContain(dana!.id);
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

  it("isn't taken from a partner speaking for another's collection", async () => {
    docs.set("c3", doc("c3", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(OTHER), apId("c3"));
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c3") } })).toBe(0);
  });
});
