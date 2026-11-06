import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueueActivity, tick } from "../src/federation/delivery";
import { canonicalHeaders, keyIdOf } from "../src/federation/edge";
import { getInstanceKeys } from "../src/federation/keys";
import { onAcceptReceived, onDisconnectReceived } from "../src/federation/peers";
import { onlyComparedKeys } from "../src/federation/pinning";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { probeProof } from "../src/federation/reachability";
import { resetRuntime } from "../src/federation/runtime";
import {
  clearFederationSettingsCache,
  getFederationSettings,
  updateFederationSettings,
} from "../src/federation/settings";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

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
    expect(onlyComparedKeys(body, compared)).toBe(true);
    expect(onlyComparedKeys(body, compared.slice(0, 1))).toBe(false);
    const other = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    expect(onlyComparedKeys(body, [await crypto.subtle.exportKey("jwk", other.publicKey), compared[1]])).toBe(false);
    expect(onlyComparedKeys({ type: "Note" }, compared)).toBe(true);
    expect((await request(app).get("/api/ap/actors/someone").set("Accept", "application/activity+json")).status).toBe(
      404,
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
