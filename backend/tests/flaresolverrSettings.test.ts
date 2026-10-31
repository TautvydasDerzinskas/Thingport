import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { fetchViaFlaresolverr, testFlaresolverr } from "../src/services/flaresolverr";
import { getFlaresolverrUrl, seedFlaresolverrUrl, setFlaresolverrUrl } from "../src/services/settingsService";

const policy = vi.hoisted(() => ({ requireHttps: true }));

vi.mock("../src/config", async (original) => ({
  ...(await original<typeof import("../src/config")>()),
  FLARESOLVERR_URL: "http://legacy-env.example:8191",
  get FLARESOLVERR_REQUIRE_HTTPS() {
    return policy.requireHttps;
  },
}));

const app = createApp();
const ENDPOINT = "https://fake-flaresolverr.test/v1";
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
  policy.requireHttps = true;
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
  it("keeps using an unseeded plain HTTP environment endpoint while HTTPS isn't required", async () => {
    policy.requireHttps = false;
    await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    const calls = fakeFlaresolverr(
      () => new Response(JSON.stringify({ status: "ok", solution: { response: "<html></html>" } })),
    );
    expect(await fetchViaFlaresolverr("https://api.thingiverse.com/things/123?access_token=secret")).not.toBeNull();
    expect(calls).toEqual(["http://legacy-env.example:8191/v1"]);
  });

  it("with HTTPS required, rejects an unseeded legacy environment endpoint before sending credentials", async () => {
    await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    const calls = fakeFlaresolverr(ready);
    expect(await getFlaresolverrUrl()).toBe("http://legacy-env.example:8191/v1");
    expect(await fetchViaFlaresolverr("https://makerworld.com/en/models/1", "token=secret")).toBeNull();
    expect(await fetchViaFlaresolverr("https://api.thingiverse.com/things/123?access_token=secret")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("seeds the DB from FLARESOLVERR_URL once, then ignores the env var", async () => {
    await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    await seedFlaresolverrUrl("https://fake-flaresolverr.test");
    expect(await getFlaresolverrUrl()).toBe(ENDPOINT);

    await setFlaresolverrUrl(null);
    await seedFlaresolverrUrl("https://other-flaresolverr.test/v1");
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
      .send({ url: "https://fake-flaresolverr.test/" });
    expect(saved.body).toMatchObject({ url: ENDPOINT });
    expect(calls).toEqual([ENDPOINT]);
  });

  it("accepts an unchanged normalized URL while the configured solver is unavailable", async () => {
    await setFlaresolverrUrl(ENDPOINT);
    const calls = fakeFlaresolverr(() => new Response("offline", { status: 502 }));
    for (const url of [ENDPOINT, "https://fake-flaresolverr.test/"]) {
      const saved = await request(app)
        .patch("/api/settings/flaresolverr")
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ url })
        .expect(200);
      expect(saved.body).toEqual({ url: ENDPOINT });
    }
    expect(calls).toEqual([]);
  });

  it.each(["http://remote.example:8191", "http://192.168.1.10:8191", "ftp://localhost:8191", "http://127.1:8191"])(
    "with HTTPS required, rejects unsafe settings and legacy configured endpoints without any request: %s",
    async (url) => {
      const calls = fakeFlaresolverr(ready);
      // Even an unchanged legacy DB value cannot bypass the endpoint policy.
      await prisma.setting.upsert({
        where: { key: "flaresolverr_url" },
        create: { key: "flaresolverr_url", value: url },
        update: { value: url },
      });
      for (const path of ["/api/settings/flaresolverr", "/api/settings/flaresolverr/test"]) {
        const response = path.endsWith("/test")
          ? await request(app)
              .post(path)
              .set({ Authorization: `Bearer ${adminToken}` })
              .send({ url })
          : await request(app)
              .patch(path)
              .set({ Authorization: `Bearer ${adminToken}` })
              .send({ url });
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).toContain("FLARESOLVERR_REQUIRE_HTTPS is on");
      }
      expect(await testFlaresolverr(url)).toMatchObject({
        ok: false,
        error: expect.stringContaining("FLARESOLVERR_REQUIRE_HTTPS is on"),
      });
      expect(await fetchViaFlaresolverr("https://makerworld.com/en/models/1", "token=secret")).toBeNull();
      expect(await fetchViaFlaresolverr("https://api.thingiverse.com/things/123?access_token=secret")).toBeNull();
      await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
      await seedFlaresolverrUrl(url);
      expect(await fetchViaFlaresolverr("https://www.myminifactory.com/api/v2/objects/123?key=secret")).toBeNull();
      expect(calls).toEqual([]);
    },
  );

  it.each([
    "http://flaresolverr:8191",
    "http://localhost:8191",
    "http://127.0.0.1:8191",
    "http://[::1]:8191",
    "https://solver.example/proxy",
  ])("tests and saves supported endpoint %s without following redirects", async (url) => {
    const calls = fakeFlaresolverr(ready);
    const saved = await request(app)
      .patch("/api/settings/flaresolverr")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ url })
      .expect(200);
    expect(saved.body).toEqual({ url: `${url}/v1` });
    expect(calls).toEqual([`${url}/v1`]);
    expect(global.fetch).toHaveBeenCalledWith(`${url}/v1`, expect.objectContaining({ redirect: "error" }));
  });

  it.each(["http://remote.example:8191", "http://192.168.1.10:8191"])(
    "tests and saves plain HTTP endpoint %s while HTTPS isn't required",
    async (url) => {
      policy.requireHttps = false;
      const calls = fakeFlaresolverr(ready);
      const saved = await request(app)
        .patch("/api/settings/flaresolverr")
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ url })
        .expect(200);
      expect(saved.body).toEqual({ url: `${url}/v1` });
      expect(calls).toEqual([`${url}/v1`]);
    },
  );

  it.each(["ftp://localhost:8191", "http://user:pass@remote.example:8191"])(
    "rejects %s even while HTTPS isn't required",
    async (url) => {
      policy.requireHttps = false;
      const calls = fakeFlaresolverr(ready);
      const response = await request(app)
        .patch("/api/settings/flaresolverr")
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ url });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain("without a login");
      expect(calls).toEqual([]);
    },
  );

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
