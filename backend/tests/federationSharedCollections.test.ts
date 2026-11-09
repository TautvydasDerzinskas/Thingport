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
  sharedCollectionItems,
  sharedCollectionObject,
} from "../src/federation/publish";
import { saveDescriptionImage } from "../src/services/descriptionImageService";
import { PLATE_PNG } from "./helpers/profileProject";
import { blockedBy, sessionOf } from "./helpers/locks";
import { remoteCollection, remoteModel } from "../src/federation/remoteExplore";
import { activeRemoteModel } from "../src/federation/remoteFiles";
import { askedAt, forgetPeerContent, holdRemoteModels, syncPeer } from "../src/federation/remoteIndex";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import {
  personByHandle,
  refreshShared,
  sharedCollectionFrom,
  sharedCollectionGoneFrom,
} from "../src/federation/sharedCollections";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";
import { deleteUser } from "../src/services/userAdminService";

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
// Answers held until a test lets them go (`hold`), by a collection's id (`<id>/items` for its models), "directory",
// "ruta-models" or "ruta-collections"; what /api/ap/shared
// lists, on its first page and its second, or that it fails; Rūta's public collections; how often a person was asked,
// and which collections were.
const gates = new Map<string, { reached: () => void; open: Promise<void> }>();
const askedFor: string[] = [];
const listedShared: string[] = [];
const listedSharedNext: string[] = [];
const sharedList = { fails: false };
const directoryPeople: unknown[] = [];
const openCollections: unknown[] = [];
// Whether its directory fails; models Rūta shares openly besides "listed-1".
const directory = { fails: false };
const openModels: unknown[] = [];
// Collections holding only their first model now.
const shrunk = new Set<string>();
let peopleAsked = 0;

/** Holds the stand-in's answer for `key`: `reached` once it's asked for it, `open()` to send it. */
function hold(key: string): { reached: Promise<void>; open: () => void } {
  let reached!: () => void;
  let open!: () => void;
  const asked = new Promise<void>((resolve) => (reached = resolve));
  gates.set(key, { reached, open: new Promise<void>((resolve) => (open = resolve)) });
  return {
    reached: asked,
    open: () => {
      gates.delete(key);
      open();
    },
  };
}
/** Sends `answer` once `key`'s gate, if any, is open. */
function afterGate(key: string, answer: () => void): void {
  const gate = gates.get(key);
  if (!gate) return answer();
  gate.reached();
  void gate.open.then(answer);
}
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
let printId: string;
let plateId: string;

beforeAll(async () => {
  const stand = express();
  stand.get("/api/ap/collections/:id", (req, res) => {
    askedFor.push(req.params.id);
    // "broken": its instance fails to answer for it.
    if (req.params.id === "broken") {
      res.status(500).json({ error: "Broken" });
      return;
    }
    afterGate(req.params.id, () => {
      const doc = docs.get(req.params.id);
      if (doc) res.json(doc);
      else res.status(404).json({ error: "Not found" });
    });
  });
  stand.get("/api/ap/collections/:id/items", (req, res) => {
    // "partial": its second page is gone, so what's read of it is only part.
    if (req.params.id === "partial" && req.query.after) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    afterGate(`${req.params.id}/items`, () =>
      res.json({
        next: req.params.id === "partial" ? `${PARTNER}/api/ap/collections/partial/items?after=1` : undefined,
        type: "OrderedCollectionPage",
        // "c26b" holds c26a's models, as said of them later.
        orderedItems: (shrunk.has(req.params.id) ? [1] : [1, 2]).map((n) => ({
          id: `${PARTNER}/api/ap/models/${req.params.id === "c26b" ? "c26a" : req.params.id}-m${n}`,
          type: "thingport:Model",
          name: req.params.id === "c26b" ? `Later hook ${n}` : `Hook ${n}`,
          // What's said of c17's only to those it's shared with.
          source: req.params.id === "c17" ? { content: "Only shared" } : undefined,
          attributedTo: `${PARTNER}/api/ap/actors/ruta`,
          image: [],
          attachment: [],
        })),
      }),
    );
  });
  // It shares nothing openly unless a test lists someone: what it shared with people here is all there is.
  stand.get("/api/ap/directory", (_req, res) => {
    if (directory.fails) {
      res.status(500).json({ error: "Broken" });
      return;
    }
    afterGate("directory", () => res.json({ type: "OrderedCollectionPage", orderedItems: directoryPeople }));
  });
  // Rūta's models: one page, and the next one gone, so they're read only in part.
  stand.get("/api/ap/actors/ruta/models", (req, res) => {
    if (req.query.after) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    afterGate("ruta-models", () =>
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
          ...openModels,
        ],
      }),
    );
  });
  stand.get("/api/ap/shared", (req, res) => {
    if (sharedList.fails) {
      res.status(500).json({ error: "Broken" });
      return;
    }
    res.json({
      type: "OrderedCollectionPage",
      orderedItems: req.query.after ? listedSharedNext : listedShared,
      next: !req.query.after && listedSharedNext.length ? `${PARTNER}/api/ap/shared?after=1` : undefined,
    });
  });
  stand.get("/api/ap/actors/ruta/collections", (_req, res) => {
    afterGate("ruta-collections", () => res.json({ type: "OrderedCollectionPage", orderedItems: openCollections }));
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
  printId = upload.body.prints[0].id as string;
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
    // What it answers at that address: the model filed in it, whole.
    const partnerRow = await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } });
    const items = (await sharedCollectionItems(collectionId, partnerRow, null)) as { orderedItems: { id: string }[] };
    expect(items.orderedItems.map((item) => item.id)).toEqual([`${ORIGIN}/api/ap/models/${printId}`]);
    // Nobody on the other partner: it isn't there to read.
    expect(await sharedCollectionObject({ origin: ORIGIN }, collectionId, otherId)).toBeNull();
    const otherRow = await prisma.peer.findUniqueOrThrow({ where: { id: otherId } });
    expect(await sharedCollectionItems(collectionId, otherRow, null)).toBeNull();
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
    // Two of its people on it: told once all the same.
    const tomas = await prisma.remotePerson.create({
      data: { peerId: partnerId, apId: `${PARTNER}/api/ap/actors/tomas`, username: "tomas", displayName: "Tomas" },
    });
    await request(app)
      .patch(`/api/collection/${doomed}/sharing`)
      .set(auth(alex))
      .send({ visibility: "shared", add_remote_person_ids: [rutaId, tomas.id] });
    await request(app).delete(`/api/collection/${doomed}`).set(auth(alex));
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => activity.type)).toEqual(["Update", "Delete"]);
    expect(objectId(sent[1])).toBe(`${ORIGIN}/api/ap/collections/${doomed}`);
  });

  it("says Delete of what someone shared once their account is deleted", async () => {
    const erin = await register("Erin");
    const theirs = (
      await request(app)
        .post("/api/collections")
        .set(auth(erin))
        .send({ name: `Erin's ${stamp}` })
    ).body.id as string;
    await request(app)
      .patch(`/api/collection/${theirs}/sharing`)
      .set(auth(erin))
      .send({ visibility: "shared", add_remote_person_ids: [rutaId] });
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    await deleteUser(alex.id, erin.id);
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => [activity.type, objectId(activity)])).toEqual([
      ["Delete", `${ORIGIN}/api/ap/collections/${theirs}`],
    ]);
  });

  it("says Delete of what was being shared as its owner's account was deleted", async () => {
    const fay = await register("Fay");
    const theirs = (
      await request(app)
        .post("/api/collections")
        .set(auth(fay))
        .send({ name: `Fay's ${stamp}` })
    ).body.id as string;
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    // A change to who sees it, under way as the account goes: it holds the collection's row until it's kept.
    await deleteDuring(fay, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${theirs} FOR UPDATE`;
      await tx.collectionShare.create({ data: { collectionId: theirs, remotePersonId: rutaId } });
    });
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => [activity.type, objectId(activity)])).toEqual([
      ["Delete", `${ORIGIN}/api/ap/collections/${theirs}`],
    ]);
  });

  it("says Delete of what was made and shared as its owner's account was deleted", async () => {
    const gil = await register("Gil");
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    // Made and shared as the account goes: not there yet to be held.
    let made = "";
    await deleteDuring(gil, async (tx) => {
      const name = `Gil's ${stamp}`;
      made = (
        await tx.collection.create({
          data: { userId: gil.id, name, nameNormalized: name.toLowerCase() },
          select: { id: true },
        })
      ).id;
      await tx.collectionShare.create({ data: { collectionId: made, remotePersonId: rutaId } });
    });
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => [activity.type, objectId(activity)])).toEqual([
      ["Delete", `${ORIGIN}/api/ap/collections/${made}`],
    ]);
  });

  it("says Delete of a collection deleted as someone elsewhere was being added to it", async () => {
    const doomed = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Doomed ${stamp}` })
    ).body.id as string;
    await prisma.federationDelivery.deleteMany({ where: { origin: PARTNER } });
    // A change to who sees it, under way as it's deleted: it holds the collection's row until it's kept.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const held = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${doomed} FOR UPDATE`;
          await tx.collectionShare.create({ data: { collectionId: doomed, remotePersonId: rutaId } });
          changed();
          await released;
        },
        { timeout: 20_000 },
      )
      .then(
        () => null,
        (err: Error) => err,
      );
    let deleting: Promise<number> | undefined;
    try {
      await Promise.race([changing, held]);
      deleting = request(app)
        .delete(`/api/collection/${doomed}`)
        .set(auth(alex))
        .then((res) => res.status);
      await blockedBy(holder);
    } finally {
      release();
      await held;
      await deleting;
    }
    expect(await held).toBeNull();
    expect(await deleting).toBe(200);
    const sent = await queued(PARTNER);
    expect(sent.map((activity) => [activity.type, objectId(activity)])).toEqual([
      ["Delete", `${ORIGIN}/api/ap/collections/${doomed}`],
    ]);
  });

  /** Deletes `account` while `change` is under way in a transaction, let go once the deletion waits on it, so it's the
   *  race being tested whatever the machine's pace. */
  async function deleteDuring(
    account: Account,
    change: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const held = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await change(tx);
          changed();
          await released;
        },
        { timeout: 20_000 },
      )
      .then(
        () => null,
        (err: Error) => err,
      );
    let deleting: Promise<Error | null> | undefined;
    try {
      await Promise.race([changing, held]);
      deleting = deleteUser(alex.id, account.id).then(
        () => null,
        (err: Error) => err,
      );
      await blockedBy(holder);
    } finally {
      release();
      await held;
      await deleting;
    }
    expect(await held).toBeNull();
    expect(await deleting).toBeNull();
  }

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

  it("finds someone on a partner at an IPv6 address, however it's written", async () => {
    const at = await prisma.peer.create({
      data: {
        origin: "http://[fd00::1]:8000",
        name: "Garage",
        status: "ACTIVE",
        actorUrl: "http://[fd00::1]:8000/api/ap/actors/instance",
        connectedAt: new Date(),
      },
    });
    try {
      const ivy = await prisma.remotePerson.create({
        data: { peerId: at.id, apId: "http://[fd00::1]:8000/api/ap/actors/ivy", username: "ivy", displayName: "Ivy" },
      });
      expect((await personByHandle("ivy@[fd00::1]:8000", alex.id))?.id).toBe(ivy.id);
      expect((await personByHandle("@ivy@[FD00:0::1]:8000", alex.id))?.id).toBe(ivy.id);
      expect(await personByHandle("ivy@[fd00::2]:8000", alex.id)).toBeNull();
    } finally {
      await prisma.peer.delete({ where: { id: at.id } });
    }
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
    const listed = (await collectionsSharedWith(partnerRow)) as { orderedItems: string[]; next?: string };
    expect(listed.orderedItems).toContain(`${ORIGIN}/api/ap/collections/${collectionId}`);
    expect(listed.next).toBeUndefined();
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

  it("lists what it shares with a partner's people a page at a time", async () => {
    await prisma.collection.createMany({
      data: Array.from({ length: 501 }, (_, n) => ({
        userId: carl.id,
        name: `Bin ${n} ${stamp}`,
        nameNormalized: `bin ${n} ${stamp}`,
        visibility: "SHARED" as const,
      })),
    });
    const many = await prisma.collection.findMany({ where: { userId: carl.id }, select: { id: true } });
    try {
      await prisma.collectionShare.createMany({
        data: many.map((collection) => ({ collectionId: collection.id, remotePersonId: rutaId })),
      });
      const partnerRow = await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } });
      const first = (await collectionsSharedWith(partnerRow)) as { orderedItems: string[]; next?: string };
      expect(first.orderedItems).toHaveLength(500);
      const after = new URL(first.next!).searchParams.get("after");
      const second = (await collectionsSharedWith(partnerRow, after)) as { orderedItems: string[]; next?: string };
      expect(second.next).toBeUndefined();
      const all = [...first.orderedItems, ...second.orderedItems];
      expect(new Set(all).size).toBe(all.length);
      for (const collection of [...many, { id: collectionId }]) {
        expect(all).toContain(`${ORIGIN}/api/ap/collections/${collection.id}`);
      }
    } finally {
      await prisma.collection.deleteMany({ where: { id: { in: many.map((collection) => collection.id) } } });
    }
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

  it("is in Shared with you a page at a time past the first, however many partners' people shared", async () => {
    docs.set("c34", doc("c34", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c34"));
    const total = await prisma.remoteCollectionViewer.count({
      where: { userId: bea.id, collection: { limited: true } },
    });
    expect(total).toBeGreaterThan(1);
    const overview = await request(app).get("/api/explore").set(auth(bea));
    expect(overview.body.elsewhere.shared_with_you_total).toBe(total);
    const pages = await Promise.all(
      [0, 1].map((offset) => request(app).get(`/api/explore/elsewhere/shared?limit=1&offset=${offset}`).set(auth(bea))),
    );
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(page.body).toHaveLength(1);
      expect(page.headers["x-total-count"]).toBe(String(total));
      expect(Date.parse(page.body[0].shared_at)).toBeGreaterThan(0);
    }
    // The latest shared first, as Explore's first page has them.
    expect(pages.map((page) => page.body[0].id)).toEqual(
      overview.body.elsewhere.shared_with_you.slice(0, 2).map((item: { id: string }) => item.id),
    );
    // One partner's only, by its id; nobody else's.
    const theirs = await request(app).get(`/api/explore/elsewhere/shared?scope=${otherId}`).set(auth(bea));
    expect(theirs.body).toEqual([]);
    expect((await request(app).get("/api/explore/elsewhere/shared").set(auth(carl))).body).toEqual([]);
  });

  it("reaches what partners' people shared past Explore's first 48", async () => {
    const many = Array.from({ length: 49 }, (_, n) => apId(`many-${n}`));
    const rows = await prisma.remoteCollection.createManyAndReturn({
      data: many.map((url) => ({ apId: url, peerId: partnerId, personId: rutaId, name: "Many", limited: true })),
    });
    try {
      await prisma.remoteCollectionViewer.createMany({
        data: rows.map((row) => ({ collectionId: row.id, userId: bea.id })),
      });
      const overview = await request(app).get("/api/explore").set(auth(bea));
      const total = overview.body.elsewhere.shared_with_you_total as number;
      expect(total).toBeGreaterThan(48);
      expect(overview.body.elsewhere.shared_with_you).toHaveLength(48);
      const rest = await request(app).get("/api/explore/elsewhere/shared?limit=24&offset=48").set(auth(bea));
      expect(rest.headers["x-total-count"]).toBe(String(total));
      expect(rest.body).toHaveLength(Math.min(24, total - 48));
      const first = new Set(overview.body.elsewhere.shared_with_you.map((item: { id: string }) => item.id));
      for (const item of rest.body) {
        expect(first.has(item.id)).toBe(false);
        expect(Date.parse(item.shared_at)).toBeGreaterThan(0);
      }
    } finally {
      await prisma.remoteCollection.deleteMany({ where: { apId: { in: many } } });
    }
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
    const held = hold("c7");
    const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c7"));
    // The read has asked for it: the Delete comes while it's out.
    await held.reached;
    let found!: () => void;
    const peerFound = new Promise<void>((resolve) => (found = resolve));
    const findFirst = prisma.peer.findFirst.bind(prisma.peer);
    const looked = vi.spyOn(prisma.peer, "findFirst").mockImplementation((async (...args: [never]) => {
      const peer = await findFirst(...args);
      found();
      return peer;
    }) as never);
    const gone = sharedCollectionGoneFrom(actorOf(PARTNER), apId("c7"));
    try {
      // The Delete has found its partner, and so is waiting its turn, before the read is let go.
      await peerFound;
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      looked.mockRestore();
      held.open();
    }
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
    const theirs = await request(app).get(address).set(auth(bea));
    expect(theirs.status).toBe(200);
    // Not kept by the browser either, where someone else may sign in next.
    expect(theirs.headers["cache-control"]).toBe("private, no-store");
    // Kept here now, and still nobody else's: not fetched again, and not handed to them from what's kept.
    expect((await request(app).get(address).set(auth(carl))).status).toBe(404);
    // Once it's no longer shared with anyone here, it's nobody's, though it's still kept on disk for now.
    await sharedCollectionGoneFrom(actorOf(PARTNER), apId("c9"));
    expect((await request(app).get(address).set(auth(bea))).status).toBe(404);
  });

  it("isn't taken from a partner speaking for another's collection", async () => {
    docs.set("c3", doc("c3", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(OTHER), apId("c3"));
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c3") } })).toBe(0);
  });

  it("keeps the models it had when it says nowhere of its own to read them", async () => {
    docs.set("c10", doc("c10", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c10"));
    const before = (await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("c10") } })).modelApIds;
    expect(before).toHaveLength(2);
    for (const items of [undefined, "http://198.51.100.9/api/ap/collections/c10/items"]) {
      docs.set("c10", { ...doc("c10", [actor(bea.id)]), "thingport:items": items });
      await sharedCollectionFrom(actorOf(PARTNER), apId("c10"));
      const kept = await prisma.remoteCollection.findUniqueOrThrow({ where: { apId: apId("c10") } });
      expect(kept.modelApIds.toSorted()).toEqual(before.toSorted());
      expect(await prisma.remoteModel.count({ where: { apId: { in: before } } })).toBe(2);
    }
  });

  it("follows the list of what's shared a page at a time, and says when it can't be read", async () => {
    docs.set("c11", doc("c11", [actor(bea.id)]));
    listedSharedNext.push(apId("c11"));
    try {
      await refreshShared(partnerId);
      expect(await prisma.remoteCollection.findUnique({ where: { apId: apId("c11") } })).toMatchObject({
        limited: true,
      });
      // Broken now: said, and what's kept is read all the same.
      sharedList.fails = true;
      docs.set("c11", { ...doc("c11", [actor(bea.id)]), name: "Hooks, renamed" });
      await refreshShared(partnerId);
      expect((await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } })).syncError).toMatch(
        /Couldn't list what its people shared/,
      );
      expect(await prisma.remoteCollection.findUnique({ where: { apId: apId("c11") } })).toMatchObject({
        name: "Hooks, renamed",
      });
    } finally {
      sharedList.fails = false;
      listedSharedNext.length = 0;
      await prisma.peer.update({ where: { id: partnerId }, data: { syncError: null } });
    }
  });

  it("isn't made public again by a read of what's shared openly that began before it was read", async () => {
    const ruta = await prisma.remotePerson.findUniqueOrThrow({ where: { id: rutaId } });
    directoryPeople.push({
      id: ruta.apId,
      type: "Person",
      name: "Ruta",
      preferredUsername: "ruta",
      "thingport:collections": `${PARTNER}/api/ap/actors/ruta/collections`,
    });
    // Public there as the index is read; shared with Bea alone by the time that read is written.
    openCollections.push({
      id: apId("c12"),
      type: "thingport:Collection",
      name: "Hooks",
      attributedTo: ruta.apId,
      "thingport:models": { first: { orderedItems: [] } },
    });
    const held = hold("ruta-collections");
    try {
      const syncing = syncPeer(partnerId);
      await held.reached;
      docs.set("c12", doc("c12", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c12"));
      held.open();
      await syncing;
      const kept = await prisma.remoteCollection.findUniqueOrThrow({
        where: { apId: apId("c12") },
        include: { viewers: true },
      });
      expect(kept.limited).toBe(true);
      expect(kept.viewers.map((viewer) => viewer.userId)).toEqual([bea.id]);
      expect(await remoteCollection(kept.id, 30, 0, carl.id)).toBeNull();
      // Its models, not shared openly there, are still Bea's alone.
      const models = await prisma.remoteModel.findMany({ where: { apId: { in: kept.modelApIds } } });
      expect(models).toHaveLength(2);
      for (const model of models) {
        expect(model.limited).toBe(true);
        expect(await remoteModel(model.id, carl.id)).toBeNull();
      }
    } finally {
      held.open();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
  });

  /** Rūta in the directory, with `apId`'s collection public among hers. */
  async function listedOpenly(id: string): Promise<void> {
    const ruta = await prisma.remotePerson.findUniqueOrThrow({ where: { id: rutaId } });
    directoryPeople.push({
      id: ruta.apId,
      type: "Person",
      name: "Ruta",
      preferredUsername: "ruta",
      "thingport:collections": `${PARTNER}/api/ap/actors/ruta/collections`,
    });
    openCollections.push({
      id: apId(id),
      type: "thingport:Collection",
      name: "Hooks",
      attributedTo: ruta.apId,
      "thingport:models": { first: { orderedItems: [] } },
    });
  }

  it("is public again by a read of the index that asked after it was read as shared", async () => {
    // The index's read is under way when it's read as shared; made public there, it's asked for after.
    const held = hold("directory");
    try {
      await listedOpenly("c14");
      const syncing = syncPeer(partnerId);
      await held.reached;
      docs.set("c14", doc("c14", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c14"));
      docs.delete("c14");
      held.open();
      await syncing;
      const kept = await prisma.remoteCollection.findUniqueOrThrow({
        where: { apId: apId("c14") },
        include: { viewers: true },
      });
      expect(kept).toMatchObject({ limited: false, viewers: [] });
      expect(await remoteCollection(kept.id, 30, 0, carl.id)).not.toBeNull();
    } finally {
      held.open();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
  });

  it("stays public when a read of it as shared, asked for before the index's, finishes after", async () => {
    docs.set("c15", doc("c15", [actor(bea.id)]));
    const held = hold("c15");
    const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c15"));
    try {
      await held.reached;
      await listedOpenly("c15");
      await syncPeer(partnerId);
    } finally {
      held.open();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
    await reading;
    const kept = await prisma.remoteCollection.findUniqueOrThrow({
      where: { apId: apId("c15") },
      include: { viewers: true },
    });
    expect(kept).toMatchObject({ limited: false, viewers: [] });
  });

  it("takes nothing while social features are off here, and tells nobody", async () => {
    docs.set("c16", doc("c16", [actor(bea.id)]));
    listedShared.push(apId("c16"));
    const told = await prisma.notification.count({ where: { userId: bea.id, type: "share" } });
    await setSocialSettings({ enabled: false });
    try {
      await refreshShared(partnerId);
      expect(await prisma.remoteCollection.count({ where: { apId: apId("c16") } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: bea.id, type: "share" } })).toBe(told);
    } finally {
      await setSocialSettings({ enabled: true });
      listedShared.splice(listedShared.indexOf(apId("c16")), 1);
    }
  });

  it("asks for nothing that waited its turn while social features were turned off", async () => {
    docs.set("c21", doc("c21", [actor(bea.id)]));
    const failed = (err: Error) => err;
    const held = hold("c21");
    const first = sharedCollectionFrom(actorOf(PARTNER), apId("c21")).then(() => null, failed);
    try {
      await held.reached;
      askedFor.length = 0;
      let checked!: () => void;
      const socialChecked = new Promise<void>((resolve) => (checked = resolve));
      const findUnique = prisma.setting.findUnique.bind(prisma.setting);
      const looked = vi.spyOn(prisma.setting, "findUnique").mockImplementation((async (...args: [never]) => {
        const row = await findUnique(...args);
        checked();
        return row;
      }) as never);
      const second = sharedCollectionFrom(actorOf(PARTNER), apId("c21")).then(() => null, failed);
      try {
        // Told of it again while they're on, so it waits its turn behind the read under way.
        await socialChecked;
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        looked.mockRestore();
      }
      await setSocialSettings({ enabled: false });
      held.open();
      expect((await first)?.message).toBe("Social features are off here for now");
      expect((await second)?.message).toBe("Social features are off here for now");
      expect(askedFor).toEqual([]);
      expect(await prisma.remoteCollection.count({ where: { apId: apId("c21") } })).toBe(0);
    } finally {
      held.open();
      await setSocialSettings({ enabled: true });
    }
  });

  it("waits for social features being turned off as it's kept, then keeps nothing and tells nobody", async () => {
    docs.set("c22", doc("c22", [actor(bea.id)]));
    const told = () => prisma.notification.count({ where: { userId: bea.id, type: "share" } });
    const before = await told();
    // An admin turning them off, under way as it's read: their row's held until that's done.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const turningOff = prisma.$transaction(
      async (tx) => {
        holder = await sessionOf(tx);
        await tx.$executeRaw`UPDATE "Setting" SET value = value || '{"enabled": false}'::jsonb WHERE key = 'social'`;
        changed();
        await released;
      },
      { timeout: 20_000 },
    );
    try {
      await changing;
      const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c22")).then(
        () => null,
        (err: Error) => err,
      );
      // Let go only once the read waits on the setting, so it's the race being tested whatever the machine's pace.
      await blockedBy(holder);
      release();
      await turningOff;
      expect((await reading)?.message).toBe("Social features are off here for now");
      expect(await prisma.remoteCollection.count({ where: { apId: apId("c22") } })).toBe(0);
      expect(await told()).toBe(before);
    } finally {
      release();
      await turningOff.catch(() => {});
      await setSocialSettings({ enabled: true });
    }
  });

  it("stops reading, and keeps nothing, once social features are turned off during a refresh", async () => {
    const ids = [apId("c19"), apId("c20")];
    docs.set("c19", doc("c19", [actor(bea.id)]));
    docs.set("c20", doc("c20", [actor(bea.id)]));
    listedShared.push(...ids);
    const told = () => prisma.notification.count({ where: { userId: bea.id, type: "share" } });
    const before = await told();
    const held = hold("c19");
    try {
      askedFor.length = 0;
      const refreshing = refreshShared(partnerId);
      await held.reached;
      await setSocialSettings({ enabled: false });
      held.open();
      await refreshing;
      expect(await prisma.remoteCollection.count({ where: { apId: { in: ids } } })).toBe(0);
      expect(askedFor).not.toContain("c20");
      expect(await told()).toBe(before);
      // Read as new once they're on again: Bea's told then.
      await setSocialSettings({ enabled: true });
      await refreshShared(partnerId);
      expect(await prisma.remoteCollection.count({ where: { apId: { in: ids } } })).toBe(2);
      expect(await told()).toBe(before + 2);
    } finally {
      held.open();
      await setSocialSettings({ enabled: true });
      listedShared.splice(0, listedShared.length, ...listedShared.filter((url) => !ids.includes(url)));
    }
  });

  it("keeps a model shared openly there as its index read it, until the index finds it isn't", async () => {
    // Read openly before; made private there and changed since, and in a collection shared with Bea.
    const open = await prisma.remoteModel.create({
      data: {
        apId: `${PARTNER}/api/ap/models/c17-m1`,
        peerId: partnerId,
        personId: rutaId,
        title: "Open title",
        description: "Open description",
        limited: false,
        syncedAt: new Date(Date.now() - 60_000),
      },
    });
    docs.set("c17", doc("c17", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c17"));
    const openly = { title: "Open title", description: "Open description" };
    expect(await prisma.remoteModel.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({
      ...openly,
      limited: false,
    });
    // Carl, whom it isn't shared with, sees what's open there and no more.
    expect(await remoteModel(open.id, carl.id)).toMatchObject(openly);
    // The next read of the index doesn't list it: shared only, and read again as such after.
    await syncPeer(partnerId);
    expect(await prisma.remoteModel.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({
      title: "Hook 1",
      description: "Only shared",
      limited: true,
    });
    expect(await remoteModel(open.id, carl.id)).toBeNull();
  });

  it("leaves a model as a read of another collection holding it, asked for later, wrote it", async () => {
    // Shared with Bea in another collection too, and read so after this one was asked for.
    const later = await prisma.remoteModel.create({
      data: {
        apId: `${PARTNER}/api/ap/models/c24-m1`,
        peerId: partnerId,
        personId: rutaId,
        title: "Read later",
        limited: true,
        syncedAt: new Date(Date.now() + 60_000),
      },
    });
    docs.set("c24", doc("c24", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c24"));
    expect(await prisma.remoteModel.findUniqueOrThrow({ where: { id: later.id } })).toMatchObject({
      title: "Read later",
    });
    // Its other model is this read's.
    expect(
      await prisma.remoteModel.findUniqueOrThrow({ where: { apId: `${PARTNER}/api/ap/models/c24-m2` } }),
    ).toMatchObject({ title: "Hook 2" });
  });

  it("leaves a model as a read of another collection holding it wrote it, asked for in the same millisecond but later", async () => {
    docs.set("c26a", doc("c26a", [actor(bea.id)]));
    docs.set("c26b", doc("c26b", [actor(bea.id)]));
    // Its models' page, which is what they're timed by.
    const held = hold("c26a/items");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date());
    try {
      // Asked for first, answered last.
      const first = sharedCollectionFrom(actorOf(PARTNER), apId("c26a"));
      await held.reached;
      await sharedCollectionFrom(actorOf(PARTNER), apId("c26b"));
      held.open();
      await first;
    } finally {
      vi.useRealTimers();
      held.open();
    }
    expect(
      await prisma.remoteModel.findUniqueOrThrow({ where: { apId: `${PARTNER}/api/ap/models/c26a-m1` } }),
    ).toMatchObject({ title: "Later hook 1" });
  });

  it("is public again by a read of the index after a run of reads as shared got ahead of the clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date());
    try {
      // Read as shared twice in the same millisecond: the second is given the next one.
      docs.set("c27", doc("c27", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c27"));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c27"));
      // Then public there, and read by the index while the clock still says the same.
      docs.delete("c27");
      await listedOpenly("c27");
      await syncPeer(partnerId);
    } finally {
      vi.useRealTimers();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
    expect(
      await prisma.remoteCollection.findUnique({ where: { apId: apId("c27") }, include: { viewers: true } }),
    ).toMatchObject({ limited: false, viewers: [] });
  });

  it("keeps a public collection the index read again in the same millisecond", async () => {
    const at = new Date();
    const open = await prisma.remoteCollection.create({
      data: {
        apId: apId("c23"),
        peerId: partnerId,
        personId: rutaId,
        name: "Old hooks",
        limited: false,
        fetchedAt: at,
        syncedAt: new Date(at.getTime() - 60_000),
      },
    });
    await listedOpenly("c23");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at);
    try {
      await syncPeer(partnerId);
    } finally {
      vi.useRealTimers();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
    // Written as read, not only kept.
    expect(await prisma.remoteCollection.findUnique({ where: { id: open.id } })).toMatchObject({
      limited: false,
      name: "Hooks",
    });
  });

  it("stays shared when the index asked for it first in the same millisecond, and finished after", async () => {
    await listedOpenly("c18");
    const held = hold("ruta-collections");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date());
    try {
      // The index asks while it's public there; it's shared with Bea alone, and read so, before that's answered.
      const syncing = syncPeer(partnerId);
      await held.reached;
      docs.set("c18", doc("c18", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c18"));
      held.open();
      await syncing;
    } finally {
      vi.useRealTimers();
      held.open();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
    const kept = await prisma.remoteCollection.findUniqueOrThrow({
      where: { apId: apId("c18") },
      include: { viewers: true },
    });
    expect(kept.limited).toBe(true);
    expect(kept.viewers.map((viewer) => viewer.userId)).toEqual([bea.id]);
  });

  it("reads what's shared with people here again when what's shared openly can't be read", async () => {
    docs.set("c28", doc("c28", [actor(bea.id)]));
    listedShared.push(apId("c28"));
    directory.fails = true;
    try {
      await syncPeer(partnerId);
      expect(await prisma.remoteCollection.findUnique({ where: { apId: apId("c28") } })).toMatchObject({
        limited: true,
      });
      // What its admin is shown is why the index couldn't be read.
      const { syncError } = await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } });
      expect(syncError).toBeTruthy();
      expect(syncError).not.toMatch(/shared with people here/);
    } finally {
      directory.fails = false;
      listedShared.splice(listedShared.indexOf(apId("c28")), 1);
      await prisma.peer.update({ where: { id: partnerId }, data: { syncError: null } });
    }
  });

  it("shows the partner's admin a collection shared with people here that couldn't be read, and reads the rest", async () => {
    const ids = [apId("broken"), apId("c29")];
    docs.set("c29", doc("c29", [actor(bea.id)]));
    listedShared.push(...ids);
    try {
      await refreshShared(partnerId);
      expect((await prisma.peer.findUniqueOrThrow({ where: { id: partnerId } })).syncError).toMatch(
        /^Couldn't read a collection its people shared with people here/,
      );
      expect(await prisma.remoteCollection.findUnique({ where: { apId: apId("c29") } })).toMatchObject({
        limited: true,
      });
    } finally {
      listedShared.splice(0, listedShared.length, ...listedShared.filter((url) => !ids.includes(url)));
      await prisma.peer.update({ where: { id: partnerId }, data: { syncError: null } });
    }
  });

  it("keeps a model shared only, read so after the index asked for it, though the index lists it", async () => {
    const ruta = await prisma.remotePerson.findUniqueOrThrow({ where: { id: rutaId } });
    const model = `${PARTNER}/api/ap/models/c30-m1`;
    directoryPeople.push({
      id: ruta.apId,
      type: "Person",
      name: "Ruta",
      preferredUsername: "ruta",
      "thingport:models": `${PARTNER}/api/ap/actors/ruta/models`,
    });
    // Open there as the index asks for her models; then open no longer, and in a collection shared with Bea, read so
    // before that's stored.
    openModels.push({
      id: model,
      type: "thingport:Model",
      name: "Hook 1",
      attributedTo: ruta.apId,
      image: [],
      attachment: [],
    });
    const held = hold("ruta-models");
    try {
      const syncing = syncPeer(partnerId);
      await held.reached;
      docs.set("c30", doc("c30", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c30"));
      held.open();
      await syncing;
    } finally {
      held.open();
      directoryPeople.length = 0;
      openModels.length = 0;
    }
    const kept = await prisma.remoteModel.findUniqueOrThrow({ where: { apId: model } });
    expect(kept.limited).toBe(true);
    expect(await remoteModel(kept.id, carl.id)).toBeNull();
  });

  it("keeps a model that a collection being kept meanwhile holds, when another lets go of it", async () => {
    docs.set("c31", doc("c31", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c31"));
    const model = `${PARTNER}/api/ap/models/c31-m1`;
    // A read of another collection holding it, being kept as c31 goes.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const held = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await holdRemoteModels(tx, partnerId);
          await tx.remoteCollection.create({
            data: {
              apId: apId("c32"),
              peerId: partnerId,
              personId: rutaId,
              name: "Hooks",
              limited: true,
              modelApIds: [model],
            },
          });
          changed();
          await released;
        },
        { timeout: 20_000 },
      )
      .then(
        () => null,
        (err: Error) => err,
      );
    let going: Promise<boolean> | undefined;
    try {
      await Promise.race([changing, held]);
      going = sharedCollectionGoneFrom(actorOf(PARTNER), apId("c31"));
      await blockedBy(holder);
    } finally {
      release();
      await held;
      await going?.catch(() => false);
    }
    expect(await held).toBeNull();
    expect(await going).toBe(true);
    expect(await prisma.remoteModel.count({ where: { apId: model } })).toBe(1);
    await prisma.remoteCollection.deleteMany({ where: { apId: apId("c32") } });
  });

  it("isn't brought back as public by a read of the index asked for before it was let go of", async () => {
    await listedOpenly("c33");
    const held = hold("ruta-collections");
    try {
      // The index asks while it's public there; it's then shared with Bea alone, and then with nobody here.
      const syncing = syncPeer(partnerId);
      await held.reached;
      docs.set("c33", doc("c33", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c33"));
      expect(await sharedCollectionGoneFrom(actorOf(PARTNER), apId("c33"))).toBe(true);
      docs.delete("c33");
      held.open();
      await syncing;
    } finally {
      held.open();
      directoryPeople.length = 0;
      openCollections.length = 0;
    }
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c33") } })).toBe(0);
  });

  /** Rūta in the directory with her models, `model` among them, shared openly there as the index asks. */
  async function sharesOpenly(model: string): Promise<void> {
    const ruta = await prisma.remotePerson.findUniqueOrThrow({ where: { id: rutaId } });
    directoryPeople.push({
      id: ruta.apId,
      type: "Person",
      name: "Ruta",
      preferredUsername: "ruta",
      "thingport:models": `${PARTNER}/api/ap/actors/ruta/models`,
    });
    openModels.push({
      id: model,
      type: "thingport:Model",
      name: "Hook 1",
      attributedTo: ruta.apId,
      image: [],
      attachment: [],
    });
  }

  it("keeps a model shared only whose page was asked for after the index's, though its collection was asked for before", async () => {
    const model = `${PARTNER}/api/ap/models/c36-m1`;
    await sharesOpenly(model);
    docs.set("c36", doc("c36", [actor(bea.id)]));
    const asked = hold("c36");
    const models = hold("ruta-models");
    try {
      // Its collection asked for first; then the index asks for her models; then its models' page is asked for.
      const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c36"));
      await asked.reached;
      const syncing = syncPeer(partnerId);
      await models.reached;
      asked.open();
      await reading;
      models.open();
      await syncing;
    } finally {
      asked.open();
      models.open();
      directoryPeople.length = 0;
      openModels.length = 0;
    }
    const kept = await prisma.remoteModel.findUniqueOrThrow({ where: { apId: model } });
    expect(kept.limited).toBe(true);
    expect(await remoteModel(kept.id, carl.id)).toBeNull();
  });

  it("isn't brought back as public by a read of the index asked for before the collection holding it went", async () => {
    const model = `${PARTNER}/api/ap/models/c37-m1`;
    await sharesOpenly(model);
    const models = hold("ruta-models");
    try {
      // The index asks for her models; the model's then read as shared, and its collection let go of, before that's
      // stored.
      const syncing = syncPeer(partnerId);
      await models.reached;
      docs.set("c37", doc("c37", [actor(bea.id)]));
      await sharedCollectionFrom(actorOf(PARTNER), apId("c37"));
      expect(await sharedCollectionGoneFrom(actorOf(PARTNER), apId("c37"))).toBe(true);
      expect(await prisma.remoteModel.count({ where: { apId: model } })).toBe(0);
      models.open();
      await syncing;
    } finally {
      models.open();
      directoryPeople.length = 0;
      openModels.length = 0;
    }
    expect(await prisma.remoteModel.count({ where: { apId: model } })).toBe(0);
  });

  it("isn't let go of, nor noted gone, on another partner's Delete of it", async () => {
    docs.set("c38", doc("c38", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c38"));
    expect(await sharedCollectionGoneFrom(actorOf(OTHER), apId("c38"))).toBe(false);
    expect(await prisma.remoteGone.count({ where: { apId: apId("c38") } })).toBe(0);
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c38") } })).toBe(1);
  });

  it("isn't brought back as public by a read of the index asked for after its last read as shared, but before it went", async () => {
    const model = `${PARTNER}/api/ap/models/c40-m1`;
    await sharesOpenly(model);
    docs.set("c40", doc("c40", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c40"));
    const models = hold("ruta-models");
    try {
      // Read as shared; then the index asks for her models; then its collection's let go of, before that's stored.
      const syncing = syncPeer(partnerId);
      await models.reached;
      expect(await sharedCollectionGoneFrom(actorOf(PARTNER), apId("c40"))).toBe(true);
      models.open();
      await syncing;
    } finally {
      models.open();
      directoryPeople.length = 0;
      openModels.length = 0;
    }
    expect(await prisma.remoteModel.count({ where: { apId: model } })).toBe(0);
  });

  it("lets go of one whose only person here is deleted as it's read, with its models", async () => {
    const eve = await register("Eve");
    docs.set("c39", doc("c39", [actor(eve.id)]));
    const held = hold("c39/items");
    try {
      // Eve's found as it's read; her account's deleted before what it holds is written.
      const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c39"));
      await held.reached;
      await prisma.user.delete({ where: { id: eve.id } });
      held.open();
      await reading;
    } finally {
      held.open();
    }
    expect(await prisma.remoteCollection.count({ where: { apId: apId("c39") } })).toBe(0);
    expect(await prisma.remoteModel.count({ where: { apId: { startsWith: `${PARTNER}/api/ap/models/c39-` } } })).toBe(
      0,
    );
  });

  it("prunes a model its collection no longer holds, and keeps the one it still does", async () => {
    docs.set("c42", doc("c42", [actor(bea.id)]));
    await sharedCollectionFrom(actorOf(PARTNER), apId("c42"));
    const [first, second] = [1, 2].map((n) => `${PARTNER}/api/ap/models/c42-m${n}`);
    expect(await prisma.remoteModel.count({ where: { apId: { in: [first, second] } } })).toBe(2);
    shrunk.add("c42");
    try {
      await sharedCollectionFrom(actorOf(PARTNER), apId("c42"));
    } finally {
      shrunk.delete("c42");
    }
    expect(await prisma.remoteModel.count({ where: { apId: first } })).toBe(1);
    expect(await prisma.remoteModel.count({ where: { apId: second } })).toBe(0);
    expect(await prisma.remoteGone.count({ where: { apId: second } })).toBe(1);
  });

  it("doesn't make public a model noted gone since the index asked, though a read as shared kept it again", async () => {
    const model = `${PARTNER}/api/ap/models/c41-m1`;
    await sharesOpenly(model);
    // Still shared with Bea when it's read again after the index.
    docs.set("c41", doc("c41", [actor(bea.id)]));
    const models = hold("ruta-models");
    try {
      // The index asks for her models; the model's pruned, then kept again by a read as shared, as of a page asked
      // for before the index's, before that's stored.
      const syncing = syncPeer(partnerId);
      await models.reached;
      const asked = new Date(Date.now() - 60_000);
      // By the clock reads are timed by, which may run a little ahead of the wall's.
      await prisma.remoteGone.create({ data: { apId: model, peerId: partnerId, at: askedAt() } });
      await prisma.remoteModel.create({
        data: { apId: model, peerId: partnerId, personId: rutaId, title: "Kept again", limited: true, syncedAt: asked },
      });
      await prisma.remoteCollection.create({
        data: {
          apId: apId("c41"),
          peerId: partnerId,
          personId: rutaId,
          name: "Hooks",
          limited: true,
          modelApIds: [model],
          fetchedAt: asked,
          viewers: { create: { userId: bea.id } },
        },
      });
      models.open();
      await syncing;
    } finally {
      models.open();
      directoryPeople.length = 0;
      openModels.length = 0;
    }
    const kept = await prisma.remoteModel.findUniqueOrThrow({ where: { apId: model } });
    expect(kept.limited).toBe(true);
    expect(await remoteModel(kept.id, carl.id)).toBeNull();
    await prisma.remoteCollection.deleteMany({ where: { apId: apId("c41") } });
    await prisma.remoteModel.deleteMany({ where: { apId: model } });
  });

  it("clears what was noted gone of a partner blocked during a long write of its kept collections", async () => {
    await prisma.remoteGone.create({ data: { apId: apId("noted-early"), peerId: partnerId, at: new Date() } });
    // A write holding the partner's lock for longer than a transaction's usual five seconds, noting something gone as
    // it ends: after the cleanup began waiting, so that goes too.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const holds = new Promise<void>((resolve) => (holding = resolve));
    let holder = 0;
    const held = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await holdRemoteModels(tx, partnerId);
          holding();
          await released;
          await tx.remoteGone.create({ data: { apId: apId("noted-late"), peerId: partnerId, at: new Date() } });
        },
        { timeout: 20_000 },
      )
      .then(
        () => null,
        (err: Error) => err,
      );
    await holds;
    const forgetting = forgetPeerContent(partnerId).then(
      () => null,
      (err: Error) => err,
    );
    try {
      await blockedBy(holder);
      await new Promise((resolve) => setTimeout(resolve, 5_500));
    } finally {
      release();
      await held;
    }
    expect(await held).toBeNull();
    expect(await forgetting).toBeNull();
    expect(await prisma.remoteGone.count({ where: { peerId: partnerId } })).toBe(0);
  }, 20_000);

  // Last: it forgets everything of the partner's.
  it("keeps nothing of a read that a block of its partner finished during, its owner neither", async () => {
    const zoe = `${PARTNER}/api/ap/actors/zoe`;
    docs.set("c13", {
      ...doc("c13", [actor(bea.id)]),
      attributedTo: { id: zoe, type: "Person", name: "Zoe", preferredUsername: "zoe" },
    });
    const held = hold("c13");
    const reading = sharedCollectionFrom(actorOf(PARTNER), apId("c13")).then(
      () => null,
      (err: Error) => err,
    );
    // Something of the partner's noted gone, which goes too.
    await prisma.remoteGone.create({ data: { apId: apId("noted"), peerId: partnerId, at: new Date() } });
    try {
      await held.reached;
      await prisma.peer.update({ where: { id: partnerId }, data: { status: "BLOCKED" } });
      await forgetPeerContent(partnerId);
      held.open();
      expect((await reading)?.message).toBe("No longer connected");
      expect(await prisma.remotePerson.count({ where: { apId: zoe } })).toBe(0);
      expect(await prisma.remoteCollection.count({ where: { apId: apId("c13") } })).toBe(0);
      expect(await prisma.remoteGone.count({ where: { peerId: partnerId } })).toBe(0);
    } finally {
      held.open();
      await prisma.peer.update({ where: { id: partnerId }, data: { status: "ACTIVE" } });
    }
  });
});
