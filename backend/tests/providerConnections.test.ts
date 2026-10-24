import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { MANIFESTS, PROVIDER_IDS } from "../src/providers/_generated";
import { setThingiverseAccessToken } from "../src/providers/thingiverse/token";

const app = createApp();

async function register(name: string, role: "MEMBER" | "ADMIN") {
  const email = `provider-connections-${name}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  return { Authorization: `Bearer ${res.body.token}` };
}

describe("provider connections", () => {
  let user: Record<string, string>;
  let admin: Record<string, string>;

  beforeAll(async () => {
    user = await register("user", "MEMBER");
    admin = await register("admin", "ADMIN");
  });

  afterAll(async () => {
    await setThingiverseAccessToken(null);
  });

  it("lists every provider with a state for each credential its manifest names", async () => {
    const res = await request(app).get("/api/providers").set(user);
    expect(res.status).toBe(200);
    expect(res.body.providers.map((p: { id: string }) => p.id)).toEqual([...PROVIDER_IDS]);
    for (const provider of res.body.providers) {
      expect(provider.enabled).toBe(true);
      expect(Object.keys(provider.slots).toSorted()).toEqual(
        MANIFESTS[provider.id as keyof typeof MANIFESTS].auth.map((a) => a.slot).toSorted(),
      );
    }
    const cults3d = res.body.providers.find((p: { id: string }) => p.id === "cults3d");
    expect(cults3d.slots).toEqual({
      default: { status: "disconnected", account: null },
      browser: { status: "disconnected", account: null },
    });
  });

  it("saves a user's credential, and answers the legacy endpoint as it did", async () => {
    const saved = await request(app)
      .patch("/api/providers/cults3d/connection")
      .set(user)
      .send({ nick: "@maker", api_key: "key" });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ configured: true, nick: "maker" });

    const status = await request(app).get("/api/providers/cults3d/connection").set(user);
    expect(status.body).toEqual({ status: "connected", account: "maker" });
    const legacy = await request(app).get("/api/settings/cults3d").set(user);
    expect(legacy.body).toEqual({
      configured: true,
      expired: false,
      nick: "maker",
      session_configured: false,
      session_expired: false,
    });

    const browser = await request(app)
      .patch("/api/providers/cults3d/connection/browser")
      .set(user)
      .send({ session: "nothing like a sign-in" });
    expect(browser.status).toBe(422);

    const forgotten = await request(app).patch("/api/settings/cults3d").set(user).send({ nick: null, api_key: null });
    expect(forgotten.body).toEqual({ configured: false, nick: null });
    expect((await request(app).get("/api/providers/cults3d/connection").set(user)).body.status).toBe("disconnected");
  });

  it("leaves an instance's credential to an admin, on both endpoints", async () => {
    expect((await request(app).patch("/api/providers/thingiverse/connection").set(user).send({})).status).toBe(403);
    expect((await request(app).post("/api/settings/thingiverse").set(user).send({})).status).toBe(403);

    const cleared = await request(app)
      .patch("/api/providers/thingiverse/connection")
      .set(admin)
      .send({ access_token: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual({ configured: false });

    await setThingiverseAccessToken("instance-token");
    expect((await request(app).get("/api/settings/thingiverse").set(user)).body).toEqual({ configured: true });
    expect((await request(app).get("/api/providers/thingiverse/connection").set(user)).body).toEqual({
      status: "connected",
      account: null,
    });
  });

  it("knows no connection a provider hasn't got", async () => {
    expect((await request(app).get("/api/providers/nowhere/connection").set(user)).status).toBe(404);
    expect((await request(app).get("/api/providers/printables/connection").set(user)).status).toBe(404);
    expect((await request(app).patch("/api/providers/nexprint/connection/browser").set(user).send({})).status).toBe(
      404,
    );
  });
});
