import { execFileSync } from "node:child_process";
import nodeCrypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueueActivity, tick } from "../src/federation/delivery";
import { canonicalHeaders, keyIdOf } from "../src/federation/edge";
import { getInstanceKeys } from "../src/federation/keys";
import { MAX_NEW_INCOMING_PER_HOUR, onAcceptReceived, onDisconnectReceived } from "../src/federation/peers";
import { onlyComparedKeys, publishedKeys } from "../src/federation/pinning";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { probeProof } from "../src/federation/reachability";
import { getRuntime, resetRuntime } from "../src/federation/runtime";
import {
  clearFederationSettingsCache,
  getFederationSettings,
  updateFederationSettings,
} from "../src/federation/settings";
import { getSocialSettings, setPublicUrl, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const ORIGIN = "http://192.0.2.50:8000";

type Account = { token: string; id: string };

const follow = (from: string) =>
  JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Follow",
    id: `${from}/api/ap/follows/1`,
    actor: `${from}/api/ap/actors/instance`,
    object: `${ORIGIN}/api/ap/actors/instance`,
    name: "Stranger",
    content: "<p>Hello &amp; welcome</p>",
  });
const signed = (from: string) => `keyId="${from}/api/ap/actors/instance#main-key",algorithm="rsa-sha256",signature="x"`;
const inbox = (from: string, body: string) =>
  request(app)
    .post("/api/ap/inbox")
    .set("Content-Type", "application/activity+json")
    .set("Signature", signed(from))
    .send(body);

async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `fed-${name.toLowerCase()}-${Date.now()}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, id: res.body.user.id };
}
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

// What this file changes in the shared rows, put back afterwards.
let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];
const KEYS = ["federation", "public_url"];

let admin: Account;
let member: Account;

beforeAll(async () => {
  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  admin = await register("FedAdmin");
  member = await register("FedMember");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await prisma.user.update({ where: { id: member.id }, data: { role: "MEMBER" } });
});

afterAll(async () => {
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  await prisma.peerRequest.deleteMany({ where: { origin: { startsWith: "http://198.51.100." } } });
  await prisma.peer.deleteMany({ where: { origin: { startsWith: "http://203.0.113." } } });
  clearFederationSettingsCache();
  invalidateAllowlist();
  resetRuntime();
});

describe("connected instances, off", () => {
  beforeAll(async () => {
    await updateFederationSettings({ enabled: false, reachability: null });
  });

  it("answers nothing under /api/ap", async () => {
    expect((await request(app).get("/api/ap/instance")).status).toBe(404);
    expect((await request(app).get("/api/ap/actors/instance")).status).toBe(404);
    expect((await request(app).post("/api/ap/inbox").send("{}")).status).toBe(404);
  });

  it("answers the probe with this instance's secret, without signing in", async () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    const res = await request(app).get(`/api/federation/probe/${nonce}`);
    expect(res.status).toBe(200);
    expect(res.body.proof).toBe(probeProof(nonce));
    expect((await request(app).get("/api/federation/probe/nope")).status).toBe(400);
  });

  it("keeps its settings to admins", async () => {
    expect((await request(app).get("/api/federation/settings")).status).toBe(401);
    expect((await request(app).get("/api/federation/settings").set(auth(member))).status).toBe(403);
    const res = await request(app).get("/api/federation/settings").set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("won't turn on without social features", async () => {
    await setSocialSettings({ enabled: false });
    const res = await request(app).patch("/api/federation/settings").set(auth(admin)).send({ enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("social_off");
  });

  it("turns on with nothing answering at its Public URL, to connect through links", async () => {
    await setSocialSettings({ enabled: true });
    // A port on this network nothing listens on, as a home instance's address is to itself behind some routers.
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    await setPublicUrl(`http://127.0.0.1:${port}`);
    process.env.FEDERATION_ALLOW_LOOPBACK = "1";
    try {
      const res = await request(app).patch("/api/federation/settings").set(auth(admin)).send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: true, reachability: { kind: "unreachable", reason: "refused" } });
    } finally {
      delete process.env.FEDERATION_ALLOW_LOOPBACK;
      await request(app).patch("/api/federation/settings").set(auth(admin)).send({ enabled: false });
      await updateFederationSettings({ reachability: null });
    }
  });

  it("won't turn on without a Public URL, or with one on this machine or in a reserved range", async () => {
    await setSocialSettings({ enabled: true });
    await setPublicUrl(null);
    const unset = await request(app).patch("/api/federation/settings").set(auth(admin)).send({ enabled: true });
    expect(unset.status).toBe(409);
    expect(unset.body.code).toBe("no_public_url");
    // Link-local isn't this machine, but no instance connects there either.
    for (const url of ["http://127.0.0.1:8000", "http://169.254.1.2:8000"]) {
      await setPublicUrl(url);
      const here = await request(app).patch("/api/federation/settings").set(auth(admin)).send({ enabled: true });
      expect(here.status).toBe(422);
      expect(here.body.code).toBe("reserved_address");
    }
    expect((await getFederationSettings()).enabled).toBe(false);
    await updateFederationSettings({ reachability: null });
  });

  it("doesn't even load Fedify", () => {
    // Not by building the app, nor by answering what comes to /api/ap while it's off.
    const script = [
      'const server = require("./src/app").createApp().listen(0, async () => {',
      "  const base = `http://127.0.0.1:${server.address().port}/api/ap`;",
      '  const answers = [(await fetch(`${base}/instance`)).status, (await fetch(`${base}/inbox`, { method: "POST", body: "{}" })).status];',
      '  require("./src/routes/federation");',
      '  const loaded = Object.keys(require.cache).some((file) => file.includes("@fedify"));',
      '  process.stdout.write(`${answers.join(",")} ${loaded}`);',
      "  process.exit(0);",
      "});",
    ].join("\n");
    const out = execFileSync(path.resolve("node_modules/.bin/tsx"), ["-e", script], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect(out.trim().endsWith("404,404 false")).toBe(true);
  });

  it("tells an instance we asked to come back later, rather than that nothing's here", async () => {
    const asked = "http://203.0.113.20";
    const peer = await prisma.peer.create({
      data: { origin: asked, status: "OUTGOING", initiatedBy: "us", actorUrl: `${asked}/api/ap/actors/instance` },
    });
    await prisma.peer.update({ where: { id: peer.id }, data: { followId: `${ORIGIN}/api/ap/follows/${peer.id}` } });
    // Its answer to our request isn't lost while this is off, and its check of our request waits too.
    const answer = await inbox(asked, "{}");
    expect(answer.status).toBe(503);
    expect(answer.headers["retry-after"]).toBe("3600");
    expect((await request(app).get(`/api/ap/follows/${peer.id}`)).status).toBe(503);
    expect((await request(app).get("/api/ap/follows/someone-else")).status).toBe(404);
    expect((await inbox("http://203.0.113.29", "{}")).status).toBe(404);
  });

  it("takes no request to reach someone elsewhere", async () => {
    const res = await request(app)
      .post("/api/me/connection-requests")
      .set(auth(member))
      .send({ handle: "bob@198.51.100.20" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("federation_off");
    expect((await request(app).get("/api/social").set(auth(member))).body).toMatchObject({
      federation: false,
      instance_host: null,
    });
  });
});

describe("connected instances, on", () => {
  beforeAll(async () => {
    await setSocialSettings({ enabled: true });
    await prisma.setting.upsert({
      where: { key: "public_url" },
      create: { key: "public_url", value: ORIGIN },
      update: { value: ORIGIN },
    });
    await updateFederationSettings({ enabled: true });
    resetRuntime();
  });

  it("publishes its instance and its actor to anyone", async () => {
    const about = await request(app).get("/api/ap/instance");
    expect(about.status).toBe(200);
    expect(about.body).toMatchObject({ software: "thingport", actor: `${ORIGIN}/api/ap/actors/instance` });
    expect(about.body.fingerprint).toMatch(/^([0-9A-F]{4} ){5}[0-9A-F]{4}$/);

    const actor = await request(app).get("/api/ap/actors/instance").set("Accept", "application/activity+json");
    expect(actor.status).toBe(200);
    const body = JSON.parse(actor.text);
    expect(body.type).toBe("Application");
    expect(body.publicKey.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(body.manuallyApprovesFollowers).toBe(true);
    // Read as a partner reads it: the keys it publishes are exactly the ones its fingerprint is of.
    const keys = await getInstanceKeys();
    const compared = [
      await crypto.subtle.exportKey("jwk", keys.rsa.publicKey),
      await crypto.subtle.exportKey("jwk", keys.ed25519.publicKey),
    ];
    const runtime = await getRuntime();
    const published = await runtime.keysIn(body);
    expect(published).toHaveLength(3);
    expect(onlyComparedKeys(published, compared)).toBe(true);
    expect(onlyComparedKeys(published, compared.slice(0, 1))).toBe(false);
    const other = nodeCrypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const otherJwk = nodeCrypto.createPublicKey(other.publicKey).export({ format: "jwk" });
    expect(onlyComparedKeys(published, [otherJwk, compared[1]])).toBe(false);
    expect(await runtime.keysIn({ "@context": "https://www.w3.org/ns/activitystreams", type: "Note" })).toEqual([]);
    // A key renamed through the document's own context: missed by name, still read the way Fedify reads it.
    const actorId = `${ORIGIN}/api/ap/actors/instance`;
    const renamed = {
      "@context": [
        "https://www.w3.org/ns/activitystreams",
        "https://w3id.org/security/v1",
        { pem: "sec:publicKeyPem" },
      ],
      id: actorId,
      type: "Application",
      inbox: `${ORIGIN}/api/ap/inbox`,
      publicKey: { id: `${actorId}#main-key`, owner: actorId, pem: other.publicKey },
    };
    expect(publishedKeys(renamed)).toEqual([]);
    expect(onlyComparedKeys(await runtime.keysIn(renamed), compared)).toBe(false);
    // Anyone else at an actor's address is a person here, for partners only; whether they exist isn't told.
    expect((await request(app).get("/api/ap/actors/someone").set("Accept", "application/activity+json")).status).toBe(
      401,
    );
  });

  it("turns away what isn't signed", async () => {
    const res = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .send(follow("x"));
    expect(res.status).toBe(401);
  });

  it("keeps a stranger's request to connect for an admin, unread", async () => {
    const stranger = "http://198.51.100.7";
    const res = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .set("Signature", signed(stranger))
      .send(follow(stranger));
    expect(res.status).toBe(202);
    const stored = await prisma.peerRequest.findFirst({ where: { origin: stranger, status: "PENDING" } });
    expect(stored).toMatchObject({ kind: "INCOMING", requesterName: "Stranger", note: "Hello & welcome" });
    expect(stored?.activity).toBe(follow(stranger));
    // Kept with the Host the Public URL gives, which is what a sender signs.
    expect((stored!.headers as Record<string, string>).host).toBe("192.0.2.50:8000");
    const notified = await prisma.notification.findFirst({
      where: { userId: admin.id, type: "federation", internalPath: `/admin-social?request=${stored!.id}` },
    });
    expect(notified?.title).toBe("Stranger wants to connect");

    const listed = await request(app).get("/api/federation/instances").set(auth(admin));
    expect(listed.body.incoming.some((item: { origin: string }) => item.origin === stranger)).toBe(true);
  });

  it("takes nothing else from a stranger", async () => {
    const stranger = "http://198.51.100.8";
    const create = JSON.stringify({
      type: "Create",
      actor: `${stranger}/api/ap/actors/instance`,
      object: { type: "Note" },
    });
    const res = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .set("Signature", signed(stranger))
      .send(create);
    expect(res.status).toBe(401);
    // Signed by one origin, on behalf of another.
    const mismatched = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .set("Signature", signed(stranger))
      .send(follow("http://198.51.100.9"));
    expect(mismatched.status).toBe(401);
    expect(await prisma.peerRequest.count({ where: { origin: { in: [stranger, "http://198.51.100.9"] } } })).toBe(0);
  });

  it("refuses a key on an address no instance could be at", async () => {
    for (const from of ["http://127.0.0.1:9", "http://169.254.169.254"]) {
      const res = await request(app)
        .post("/api/ap/inbox")
        .set("Content-Type", "application/activity+json")
        .set("Signature", signed(from))
        .send(follow(from));
      expect(res.status).toBe(401);
    }
  });

  it("gives everyone a username, which they can change", async () => {
    const me = await request(app).get("/api/me").set(auth(member));
    expect(me.body.user.username).toMatch(/^fedmember(-\d+)?$/);
    const adminName = (await request(app).get("/api/me").set(auth(admin))).body.user.username as string;
    const available = (username: string) =>
      request(app).get("/api/me/username-available").query({ username }).set(auth(member));
    expect((await available(adminName)).body).toMatchObject({ available: false, reason: "taken" });
    expect((await available(me.body.user.username)).body).toMatchObject({ available: true });
    expect((await available("Not one")).body).toMatchObject({ available: false, reason: "invalid" });

    const taken = await request(app).patch("/api/me/username").set(auth(member)).send({ username: adminName });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("username_taken");
    const invalid = await request(app).patch("/api/me/username").set(auth(member)).send({ username: "-no" });
    expect(invalid.body.code).toBe("invalid_username");
    const wanted = `m.${Date.now()}`;
    const changed = await request(app)
      .patch("/api/me/username")
      .set(auth(member))
      .send({ username: `@${wanted}` });
    expect(changed.status).toBe(200);
    expect(changed.body.user.username).toBe(wanted);
    expect((await request(app).get("/api/social").set(auth(member))).body).toMatchObject({
      federation: true,
      instance_host: "192.0.2.50:8000",
    });
  });

  it("keeps someone's request to reach a person elsewhere for the admins, and lets them withdraw it", async () => {
    const ask = (handle: string, note?: string) =>
      request(app).post("/api/me/connection-requests").set(auth(member)).send({ handle, note });
    const res = await ask("Bob@198.51.100.20", "  For the   bins ");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ handle: "bob@198.51.100.20", note: "For the bins", status: "waiting_admin" });
    const id = res.body.id as string;

    const notified = await prisma.notification.findFirst({
      where: { userId: admin.id, type: "federation", internalPath: `/admin-social?request=${id}` },
    });
    expect(notified?.title).toBe("FedMember asks to reach bob@198.51.100.20");
    const listed = await request(app).get("/api/federation/instances").set(auth(admin));
    expect(listed.body.local).toContainEqual(
      expect.objectContaining({
        id,
        origin: "http://198.51.100.20",
        http: true,
        userName: "FedMember",
        targetHandle: "bob@198.51.100.20",
      }),
    );
    // Not another instance's, so nothing in it to check against a key.
    expect(listed.body.incoming.some((item: { id: string }) => item.id === id)).toBe(false);

    expect((await ask("bob@198.51.100.20")).body.code).toBe("exists");
    expect((await ask("carl@192.0.2.50:8000")).body.code).toBe("same_instance");
    expect((await ask("nobody")).body.code).toBe("invalid_handle");

    const mine = await request(app).get("/api/me/connection-requests").set(auth(member));
    expect(mine.body.map((item: { id: string }) => item.id)).toContain(id);
    // Someone else's can't be withdrawn by anyone but them.
    expect((await request(app).delete(`/api/me/connection-requests/${id}`).set(auth(admin))).status).toBe(404);
    expect((await request(app).delete(`/api/me/connection-requests/${id}`).set(auth(member))).status).toBe(204);
    const after = await request(app).get("/api/me/connection-requests").set(auth(member));
    expect(after.body.map((item: { id: string }) => item.id)).not.toContain(id);
  });

  it("lets someone have ten requests waiting, and only so many a day", async () => {
    const ask = (handle: string) => request(app).post("/api/me/connection-requests").set(auth(admin)).send({ handle });
    const made: string[] = [];
    for (let n = 0; n < 10; n++) {
      const res = await ask(`p${n}@198.51.100.4${n}`);
      expect(res.status).toBe(201);
      made.push(res.body.id);
    }
    const eleventh = await ask("p10@198.51.100.50");
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe("request_limit");
    // Withdrawing makes room, but not endlessly: each one still told every admin.
    for (const id of made) await request(app).delete(`/api/me/connection-requests/${id}`).set(auth(admin));
    const more: string[] = [];
    for (let n = 0; n < 10; n++) {
      const res = await ask(`q${n}@198.51.100.6${n}`);
      expect(res.status).toBe(201);
      more.push(res.body.id);
    }
    await request(app).delete(`/api/me/connection-requests/${more[0]}`).set(auth(admin));
    const daily = await ask("q@198.51.100.70");
    expect(daily.status).toBe(429);
    expect(daily.body.code).toBe("daily_limit");
    // Every one still waiting is listed, however many were answered or withdrawn after.
    const mine = await request(app).get("/api/me/connection-requests").set(auth(admin));
    expect(mine.body.filter((item: { status: string }) => item.status === "waiting_admin")).toHaveLength(9);
  });

  it("won't decline a request withdrawn meanwhile", async () => {
    const res = await request(app)
      .post("/api/me/connection-requests")
      .set(auth(member))
      .send({ handle: "gone@198.51.100.22" });
    await request(app).delete(`/api/me/connection-requests/${res.body.id}`).set(auth(member));
    expect((await request(app).post(`/api/federation/requests/${res.body.id}/decline`).set(auth(admin))).status).toBe(
      404,
    );
  });

  it("tells someone their admin declined, without a word to the other instance", async () => {
    const res = await request(app)
      .post("/api/me/connection-requests")
      .set(auth(member))
      .send({ handle: "dana@198.51.100.21" });
    const id = res.body.id as string;
    expect((await request(app).post(`/api/federation/requests/${id}/decline`).set(auth(admin))).status).toBe(204);
    const told = await prisma.notification.findFirst({
      where: { userId: member.id, type: "federation", title: "Your admin won't connect with 198.51.100.21" },
    });
    expect(told?.body).toBe("You asked to reach dana@198.51.100.21.");
    const mine = await request(app).get("/api/me/connection-requests").set(auth(member));
    expect(mine.body.find((item: { id: string }) => item.id === id)?.status).toBe("declined");
    expect(await prisma.federationDelivery.count({ where: { peer: { origin: "http://198.51.100.21" } } })).toBe(0);
  });

  it("says when an instance is already connected, asked or blocked", async () => {
    const ask = (handle: string) => request(app).post("/api/me/connection-requests").set(auth(member)).send({ handle });
    const peers = await Promise.all(
      (["ACTIVE", "OUTGOING", "BLOCKED"] as const).map((status, n) =>
        prisma.peer.create({ data: { origin: `https://203.0.113.${30 + n}`, status } }),
      ),
    );
    try {
      // Whichever scheme the admin connected with.
      expect((await ask("a@203.0.113.30")).body.code).toBe("already_connected");
      expect((await ask("a@203.0.113.31")).body.code).toBe("already_asked");
      expect((await ask("a@203.0.113.32")).body.code).toBe("not_available");
    } finally {
      await prisma.peer.deleteMany({ where: { id: { in: peers.map((peer) => peer.id) } } });
      invalidateAllowlist();
    }
  });

  it("turns away a body that isn't an activity", async () => {
    for (const body of ["null", "[]", "3"]) expect((await inbox("http://198.51.100.11", body)).status).toBe(401);
  });

  it("keeps another request under the same address beside the first, not over it", async () => {
    const from = "http://198.51.100.10";
    expect((await inbox(from, follow(from))).status).toBe(202);
    // Anyone can send one under that address: it mustn't replace the one the instance really sent.
    expect((await inbox(from, follow(from).replace("Hello &amp; welcome", "Forged"))).status).toBe(202);
    const rows = await prisma.peerRequest.findMany({
      where: { origin: from, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => row.note)).toEqual(["Hello & welcome", "Forged"]);
    expect(
      await prisma.notification.count({
        where: { userId: admin.id, internalPath: { in: rows.map((row) => `/admin-social?request=${row.id}`) } },
      }),
    ).toBe(1);
    const listed = await request(app).get("/api/federation/instances").set(auth(admin));
    expect(listed.body.incoming.filter((item: { origin: string }) => item.origin === from)).toHaveLength(1);
    // A few per address; past that it's told to try again later, which its delivery does.
    expect((await inbox(from, follow(from))).status).toBe(202);
    expect((await inbox(from, follow(from))).status).toBe(429);
  });

  it("takes no more than a few new instances' requests an hour", async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.peerRequest.count({ where: { kind: "INCOMING", createdAt: { gte: hourAgo } } });
    // Invented addresses, as one sender could make up: the hour's worth, then one more.
    const invented = Array.from(
      { length: Math.max(0, MAX_NEW_INCOMING_PER_HOUR - recent) },
      (_, n) => `http://198.51.100.${120 + n}`,
    );
    await prisma.peerRequest.createMany({
      data: invented.map((origin) => ({ kind: "INCOMING", origin, url: `${ORIGIN}/api/ap/inbox`, activity: "{}" })),
    });
    try {
      expect((await inbox("http://198.51.100.150", follow("http://198.51.100.150"))).status).toBe(429);
      // An hour on, there's room again; and an instance already asking can still send another.
      await prisma.peerRequest.updateMany({
        where: { kind: "INCOMING", createdAt: { gte: hourAgo } },
        data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      });
      expect((await inbox("http://198.51.100.150", follow("http://198.51.100.150"))).status).toBe(202);
    } finally {
      await prisma.peerRequest.deleteMany({
        where: { origin: { in: [...invented, "http://198.51.100.150"] } },
      });
    }
  });

  it("shows our own request to connect while it stands, and nothing else", async () => {
    const asked = "http://203.0.113.21";
    const peer = await prisma.peer.create({
      data: { origin: asked, status: "OUTGOING", initiatedBy: "us", actorUrl: `${asked}/api/ap/actors/instance` },
    });
    const followId = `${ORIGIN}/api/ap/follows/${peer.id}`;
    await prisma.peer.update({ where: { id: peer.id }, data: { followId } });
    const res = await request(app).get(`/api/ap/follows/${peer.id}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: followId,
      type: "Follow",
      actor: `${ORIGIN}/api/ap/actors/instance`,
      object: `${asked}/api/ap/actors/instance`,
    });
    // Theirs, not ours: nothing to show.
    await prisma.peer.update({ where: { id: peer.id }, data: { initiatedBy: "them" } });
    expect((await request(app).get(`/api/ap/follows/${peer.id}`)).status).toBe(404);
  });

  it("takes pairing news only from the instance actor connected with, about the Follow it's about", async () => {
    const origin = "http://203.0.113.23";
    const actor = new URL(`${origin}/api/ap/actors/instance`);
    const peer = await prisma.peer.create({
      data: {
        origin,
        status: "OUTGOING",
        initiatedBy: "us",
        actorUrl: actor.href,
        followId: `${ORIGIN}/api/ap/follows/ours`,
      },
    });
    const status = async () => (await prisma.peer.findUnique({ where: { id: peer.id } }))?.status ?? "gone";
    await onAcceptReceived(new URL(`${origin}/api/ap/actors/someone`), `${ORIGIN}/api/ap/follows/ours`);
    await onAcceptReceived(actor, null);
    await onAcceptReceived(actor, `${ORIGIN}/api/ap/follows/another`);
    expect(await status()).toBe("OUTGOING");
    await onAcceptReceived(actor, `${ORIGIN}/api/ap/follows/ours`);
    expect(await status()).toBe("ACTIVE");
    // An Undo naming no Follow we know, and not of theirs: nothing ends.
    await onDisconnectReceived(actor, null, false);
    await onDisconnectReceived(actor, `${origin}/api/ap/follows/elsewhere`, false);
    expect(await status()).toBe("ACTIVE");
    // Their Follow of us undone, whatever its id (both admins may have asked at once).
    await onDisconnectReceived(actor, `${origin}/api/ap/follows/theirs`, true);
    expect(await status()).toBe("gone");
  });

  it("sends nothing more to an instance blocked after something was queued for it", async () => {
    const peer = await prisma.peer.create({ data: { origin: "http://203.0.113.22", status: "BLOCKED" } });
    await enqueueActivity({
      origin: peer.origin,
      inboxUrl: `${peer.origin}/api/ap/inbox`,
      peerId: peer.id,
      activity: { type: "Follow" },
    });
    await tick();
    expect(await prisma.federationDelivery.count({ where: { peerId: peer.id } })).toBe(0);
  });

  it("keeps what a partner turned away while its connected instances are off, and drops what it refused", async () => {
    let answer = 404;
    const partner = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => res.writeHead(answer).end());
    });
    await new Promise<void>((resolve) => partner.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(partner.address() as AddressInfo).port}`;
    process.env.FEDERATION_ALLOW_LOOPBACK = "1";
    const peer = await prisma.peer.create({ data: { origin, status: "ACTIVE" } });
    invalidateAllowlist();
    try {
      await enqueueActivity({
        origin,
        inboxUrl: `${origin}/api/ap/inbox`,
        peerId: peer.id,
        activity: { type: "Create" },
      });
      // The clock each run reads: just after it was queued, so only what would be due now anyway is sent with it.
      const at = Date.now() + 1000;
      const runAt = async () => {
        await tick(() => new Date(at));
        return prisma.federationDelivery.findFirst({ where: { peerId: peer.id } });
      };
      // Off over there, which answers 404: kept, and tried again 30 seconds on.
      expect(await runAt()).toMatchObject({ attempts: 1, lastError: "HTTP 404", nextAttemptAt: new Date(at + 30_000) });
      // Its key didn't load there this time (401): kept, and tried again two minutes on.
      answer = 401;
      await prisma.federationDelivery.updateMany({ where: { peerId: peer.id }, data: { nextAttemptAt: new Date(at) } });
      expect(await runAt()).toMatchObject({
        attempts: 2,
        lastError: "HTTP 401",
        nextAttemptAt: new Date(at + 120_000),
      });
      // Refused as it is: not worth sending again.
      answer = 400;
      await prisma.federationDelivery.updateMany({ where: { peerId: peer.id }, data: { nextAttemptAt: new Date(at) } });
      expect(await runAt()).toBeNull();
    } finally {
      delete process.env.FEDERATION_ALLOW_LOOPBACK;
      await prisma.federationDelivery.deleteMany({ where: { peerId: peer.id } });
      await prisma.peer.delete({ where: { id: peer.id } });
      invalidateAllowlist();
      await new Promise((resolve) => partner.close(resolve));
    }
  });

  it("sends a chat's activities to a partner in the order they were queued", async () => {
    const peer = await prisma.peer.create({ data: { origin: "http://203.0.113.24", status: "ACTIVE" } });
    const row = { origin: peer.origin, inboxUrl: `${peer.origin}/api/ap/inbox`, peerId: peer.id, actor: "instance" };
    const later = new Date(Date.now() + 60 * 60 * 1000);
    // Tried, failed, and waiting to be tried again: what came after it in that room waits for it.
    const update = await prisma.federationDelivery.create({
      data: { ...row, activity: { type: "Update" }, orderKey: "room", attempts: 1, nextAttemptAt: later },
    });
    const message = await prisma.federationDelivery.create({
      data: {
        ...row,
        activity: { type: "Create" },
        orderKey: "room",
        createdAt: new Date(update.createdAt.getTime() + 1),
      },
    });
    await tick();
    const waiting = await prisma.federationDelivery.findUniqueOrThrow({ where: { id: message.id } });
    expect(waiting).toMatchObject({ attempts: 0, nextAttemptAt: later });
    await prisma.peer.delete({ where: { id: peer.id } });
    await prisma.federationDelivery.deleteMany({ where: { id: { in: [update.id, message.id] } } });
  });

  it("asks for an address to look up, with social features on", async () => {
    expect((await request(app).get("/api/federation/lookup").set(auth(admin))).status).toBe(400);
    await setSocialSettings({ enabled: false });
    try {
      const res = await request(app).get("/api/federation/lookup?address=things.example").set(auth(admin));
      expect(res.body.code).toBe("social_off");
    } finally {
      await setSocialSettings({ enabled: true });
    }
  });

  it("changes only the settings it's given, whatever it read before", async () => {
    await getFederationSettings();
    // Turned off elsewhere after this process last read it.
    await prisma.setting.update({
      where: { key: "federation" },
      data: { value: { enabled: false, reachability: null } },
    });
    const after = await updateFederationSettings({
      reachability: { kind: "local", url: ORIGIN, addresses: [], checkedAt: new Date().toISOString() },
    });
    expect(after).toMatchObject({ enabled: false, reachability: { kind: "local" } });
    await updateFederationSettings({ enabled: true });
  });

  it("drops a blocked instance's request without a word", async () => {
    const blocked = "http://203.0.113.9";
    await prisma.peer.create({ data: { origin: blocked, status: "BLOCKED" } });
    invalidateAllowlist();
    const res = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .set("Signature", signed(blocked))
      .send(follow(blocked));
    expect(res.status).toBe(202);
    expect(await prisma.peerRequest.count({ where: { origin: blocked } })).toBe(0);
  });
});

describe("the inbox's helpers", () => {
  it("reads the key id from either kind of signature", () => {
    expect(keyIdOf({ signature: 'keyId="https://a.example/actor#main-key",signature="x"' })).toBe(
      "https://a.example/actor#main-key",
    );
    expect(keyIdOf({ "signature-input": 'sig1=("@method");keyid="https://b.example/actor#k";alg="rsa"' })).toBe(
      "https://b.example/actor#k",
    );
    expect(keyIdOf({})).toBeNull();
  });

  it("sets Host from the Public URL, as a proxy may drop the port", () => {
    expect(canonicalHeaders({ host: "192.0.2.50", accept: "x" }, ORIGIN)).toEqual({
      host: "192.0.2.50:8000",
      accept: "x",
    });
  });
});
