import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { canonicalHeaders, keyIdOf } from "../src/federation/edge";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { probeProof } from "../src/federation/reachability";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const ORIGIN = "http://192.0.2.50:8000";

type Account = { token: string; id: string };

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
    const script = [
      'require("./src/app").createApp();',
      'require("./src/routes/federation");',
      'const loaded = Object.keys(require.cache).some((file) => file.includes("@fedify"));',
      "process.stdout.write(String(loaded));",
      "process.exit(0);",
    ].join("\n");
    const out = execFileSync(path.resolve("node_modules/.bin/tsx"), ["-e", script], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect(out.trim().endsWith("false")).toBe(true);
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
    expect((await request(app).get("/api/ap/actors/someone").set("Accept", "application/activity+json")).status).toBe(
      404,
    );
  });

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
  const signed = (from: string) =>
    `keyId="${from}/api/ap/actors/instance#main-key",algorithm="rsa-sha256",signature="x"`;

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
