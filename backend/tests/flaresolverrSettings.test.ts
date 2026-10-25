import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { getFlaresolverrUrl, seedFlaresolverrUrl, setFlaresolverrUrl } from "../src/services/settingsService";

const app = createApp();
const ENDPOINT = "http://fake-flaresolverr.test/v1";
let adminToken: string;

beforeAll(async () => {
  const email = `flaresolverr-admin-${Date.now()}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "FlareSolverr Admin", email, password: "password123" });
  await prisma.user.update({ where: { id: registered.body.user.id }, data: { role: "ADMIN" } });
  adminToken = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
});

const originalFetch = global.fetch;

afterEach(async () => {
  global.fetch = originalFetch;
  await prisma.setting.deleteMany({ where: { key: { startsWith: "flaresolverr_" } } });
});

function fakeFlaresolverr(answer: () => Response) {
  const calls: string[] = [];
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    calls.push(String(input));
    return answer();
  }) as unknown as typeof fetch;
  return calls;
}

const ready = () => new Response(JSON.stringify({ status: "ok", sessions: [], version: "3.3.21" }), { status: 200 });

describe("FlareSolverr URL setting", () => {
  it("seeds the DB from FLARESOLVERR_URL once, then ignores the env var", async () => {
    await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    await seedFlaresolverrUrl("http://fake-flaresolverr.test");
    expect(await getFlaresolverrUrl()).toBe(ENDPOINT);

    await setFlaresolverrUrl(null);
    await seedFlaresolverrUrl("http://other-flaresolverr.test/v1");
    expect(await getFlaresolverrUrl()).toBeNull();
  });

  it("tests a URL before saving it and refuses one that doesn't answer", async () => {
    const calls = fakeFlaresolverr(() => new Response("nope", { status: 502 }));
    const refused = await request(app)
      .patch("/api/settings/flaresolverr")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url: ENDPOINT });
    expect(refused.status).toBe(422);
    expect(calls).toEqual([ENDPOINT]);
    expect(await prisma.setting.findUnique({ where: { key: "flaresolverr_url" } })).toBeNull();

    fakeFlaresolverr(ready);
    const saved = await request(app)
      .patch("/api/settings/flaresolverr")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url: ENDPOINT });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ url: ENDPOINT });

    const tested = await request(app)
      .post("/api/settings/flaresolverr/test")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url: ENDPOINT });
    expect(tested.body).toMatchObject({ ok: true, version: "3.3.21" });
  });

  it("accepts the base URL and adds /v1 itself", async () => {
    const calls = fakeFlaresolverr(ready);
    const saved = await request(app)
      .patch("/api/settings/flaresolverr")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url: "http://fake-flaresolverr.test/" });
    expect(saved.body).toMatchObject({ url: ENDPOINT });
    expect(calls).toEqual([ENDPOINT]);
  });

  it("clears the URL without testing it", async () => {
    const calls = fakeFlaresolverr(ready);
    const cleared = await request(app)
      .patch("/api/settings/flaresolverr")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url: "" });
    expect(cleared.body).toMatchObject({ url: null });
    expect(calls).toEqual([]);
  });
});

describe("FlareSolverr provider preferences", () => {
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  it("defaults supported providers on and persists explicit false across URL-only saves", async () => {
    const initial = await request(app).get("/api/settings/flaresolverr").set(auth());
    expect(initial.body.providers).toMatchObject({
      makerworld: true,
      thingiverse: true,
      myminifactory: true,
      printables: true,
      thangs: true,
    });
    expect(initial.body.providers).not.toHaveProperty("snapmaker");
    const changed = await request(app)
      .patch("/api/settings/flaresolverr")
      .set(auth())
      .send({ providers: { thingiverse: false } });
    expect(changed.status).toBe(200);
    expect(changed.body.providers.thingiverse).toBe(false);
    await request(app).patch("/api/settings/flaresolverr").set(auth()).send({ url: null }).expect(200);
    const reload = await request(app).get("/api/settings/flaresolverr").set(auth());
    expect(reload.body.providers.thingiverse).toBe(false);
    expect(reload.body.providers.myminifactory).toBe(true);
  });

  it("can disable a provider while the saved solver is unavailable, including an unchanged URL", async () => {
    await setFlaresolverrUrl(ENDPOINT);
    const calls = fakeFlaresolverr(() => new Response("offline", { status: 502 }));
    await request(app)
      .patch("/api/settings/flaresolverr")
      .set(auth())
      .send({ url: ENDPOINT, providers: { makerworld: false } })
      .expect(200);
    expect(calls).toEqual([]);
  });

  it("rejects unknown providers, non-booleans and unauthorized updates", async () => {
    for (const providers of [{ unknown: true }, { snapmaker: false }, { thingiverse: "false" }]) {
      const response = await request(app).patch("/api/settings/flaresolverr").set(auth()).send({ providers });
      expect(response.status).toBe(400);
    }
    await request(app)
      .patch("/api/settings/flaresolverr")
      .send({ providers: { thingiverse: false } })
      .expect(401);
  });
});
