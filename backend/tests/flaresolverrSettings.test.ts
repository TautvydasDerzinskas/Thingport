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

describe("FlareSolverr settings contract", () => {
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  it("returns only the global URL", async () => {
    await setFlaresolverrUrl(ENDPOINT);
    const result = await request(app).get("/api/settings/flaresolverr").set(auth()).expect(200);
    expect(result.body).toEqual({ url: ENDPOINT });
  });

  it("rejects removed provider preferences and missing URLs", async () => {
    for (const body of [{ providers: { thingiverse: false } }, { url: null, providers: {} }, {}]) {
      await request(app).patch("/api/settings/flaresolverr").set(auth()).send(body).expect(400);
    }
    expect(await prisma.setting.count({ where: { key: { startsWith: "flaresolverr_provider_" } } })).toBe(0);
    await request(app).patch("/api/settings/flaresolverr").send({ url: null }).expect(401);
  });
});
