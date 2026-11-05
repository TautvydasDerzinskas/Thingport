import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resetClientTracking } from "../src/services/clientActivityService";

const policy = vi.hoisted(() => ({ requireHttps: false }));

vi.mock("../src/config", async (original) => ({
  ...(await original<typeof import("../src/config")>()),
  get FLARESOLVERR_REQUIRE_HTTPS() {
    return policy.requireHttps;
  },
}));

const app = createApp();
let admin: string;
let member: string;

async function register(role: "ADMIN" | "MEMBER") {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: role, email: `health-${role}-${Date.now()}@example.com`, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  return res.body.token as string;
}

beforeAll(async () => {
  admin = await register("ADMIN");
  member = await register("MEMBER");
});

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
type Report = {
  components: {
    component: string;
    result: { status: string; code: string; detail: string | null; checked_at: string; facts: object } | null;
  }[];
  full_checked_at: string | null;
};
const resultOf = (report: Report, component: string) =>
  report.components.find((c) => c.component === component)!.result;

afterEach(async () => {
  vi.restoreAllMocks();
  policy.requireHttps = false;
  await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
});

describe("system health", () => {
  it("reports Grab as not seen until it makes a request of its own", async () => {
    await prisma.setting.deleteMany({ where: { key: "client_seen_grab" } });
    await prisma.grabConnection.deleteMany();
    resetClientTracking();
    const test = async () =>
      resultOf(
        (await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "grab" })).body,
        "grab",
      )!;
    expect(await test()).toMatchObject({ status: "not_configured", code: "not_seen" });

    await request(app).get("/api/health").set("X-Thingport-Client", "grab");
    // Recorded without holding up the request.
    await vi.waitFor(async () => {
      expect(await test()).toMatchObject({ status: "ok", facts: { last_seen_at: expect.any(String) } });
    });
  });

  it("lists every component by importance, the database first and SMTP, which is optional, last", async () => {
    const res = await request(app).get("/api/admin/health").set(as(admin));
    expect(res.status).toBe(200);
    expect((res.body as Report).components.map((c) => c.component)).toEqual([
      "database",
      "storage",
      "memory",
      "internet",
      "flaresolverr",
      "thingiverse",
      "myminifactory",
      "grab",
      "ai",
      "smtp",
    ]);
  });

  it("tests one component when asked, leaving the others' last results as they were", async () => {
    const before = (await request(app).get("/api/admin/health").set(as(admin))).body as Report;
    const res = await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "database" });
    expect(res.status).toBe(200);
    const database = resultOf(res.body, "database")!;
    expect(database).toMatchObject({ status: "ok", code: "ok" });
    expect(database.facts).toMatchObject({ version: expect.stringMatching(/^PostgreSQL/) });
    expect(resultOf(res.body, "smtp")).toEqual(resultOf(before, "smtp"));
    expect(res.body.full_checked_at).toBe(before.full_checked_at);
  });

  it("tests everything in a full test, and says when it ran", async () => {
    const res = await request(app).post("/api/admin/health/test").set(as(admin)).send({});
    expect(res.status).toBe(200);
    const report = res.body as Report;
    expect(report.full_checked_at).not.toBeNull();
    for (const { component, result } of report.components)
      expect({ component, tested: Boolean(result) }).toEqual({ component, tested: true });
    expect(resultOf(report, "storage")!.status).toBe("ok");
    expect(resultOf(report, "memory")!.facts).toHaveProperty("available_bytes");
    // Kept: opening the page again shows the same results, without testing anything.
    const again = (await request(app).get("/api/admin/health").set(as(admin))).body as Report;
    expect(again).toEqual(report);
  });

  it("keeps every result when tests overlap, as from two admins at once", async () => {
    const before = (await request(app).get("/api/admin/health").set(as(admin))).body as Report;
    const started = new Date().toISOString();
    await Promise.all(
      ["database", "storage", "memory"].map((component) =>
        request(app).post("/api/admin/health/test").set(as(admin)).send({ component }),
      ),
    );
    const after = (await request(app).get("/api/admin/health").set(as(admin))).body as Report;
    for (const component of ["database", "storage", "memory"]) {
      expect({ component, fresh: resultOf(after, component)!.checked_at >= started }).toEqual({
        component,
        fresh: true,
      });
    }
    expect(after.full_checked_at).toBe(before.full_checked_at);
  });

  it("reports the server offline when nothing outside answers", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
    );
    const res = await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "internet" });
    expect(resultOf(res.body, "internet")).toMatchObject({
      status: "error",
      code: "offline",
      detail: "ENOTFOUND",
      facts: { host: expect.any(String) },
    });
  });

  it("reports the server online on any answer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const res = await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "internet" });
    expect(resultOf(res.body, "internet")).toMatchObject({ status: "ok", code: "ok" });
  });

  describe("FlareSolverr transport", () => {
    const solverReady = () =>
      vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => new Response(JSON.stringify({ status: "ok", version: "3.3.21" })));
    const testSolver = async (url: string) => {
      await prisma.setting.upsert({
        where: { key: "flaresolverr_url" },
        create: { key: "flaresolverr_url", value: url },
        update: { value: url },
      });
      const res = await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "flaresolverr" });
      return resultOf(res.body, "flaresolverr")!;
    };

    it("warns about a working plaintext remote solver", async () => {
      solverReady();
      expect(await testSolver("http://192.168.1.10:8191/v1")).toMatchObject({ status: "warning", code: "insecure" });
    });

    it.each(["http://flaresolverr:8191/v1", "https://solver.example/v1"])(
      "suggests requiring HTTPS once %s is secure",
      async (url) => {
        solverReady();
        expect(await testSolver(url)).toMatchObject({ status: "ok", code: "https_ready" });
      },
    );

    it("is plain green once HTTPS is required and met", async () => {
      policy.requireHttps = true;
      solverReady();
      expect(await testSolver("https://solver.example/v1")).toMatchObject({ status: "ok", code: "ok" });
    });

    it("reports a plaintext solver refused by FLARESOLVERR_REQUIRE_HTTPS without contacting it", async () => {
      policy.requireHttps = true;
      const sent = solverReady();
      expect(await testSolver("http://192.168.1.10:8191/v1")).toMatchObject({
        status: "error",
        code: "insecure_refused",
      });
      expect(sent).not.toHaveBeenCalled();
    });
  });

  it("is for admins only, and refuses a component it doesn't know", async () => {
    expect((await request(app).get("/api/admin/health").set(as(member))).status).toBe(403);
    expect((await request(app).post("/api/admin/health/test").set(as(member)).send({})).status).toBe(403);
    expect(
      (await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "toaster" })).status,
    ).toBe(400);
  });
});
