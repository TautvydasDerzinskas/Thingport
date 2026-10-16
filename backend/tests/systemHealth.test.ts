import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

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
    result: { status: string; code: string; checked_at: string; facts: object } | null;
  }[];
  full_checked_at: string | null;
};
const resultOf = (report: Report, component: string) =>
  report.components.find((c) => c.component === component)!.result;

describe("system health", () => {
  it("lists every component by importance, the database first and SMTP, which is optional, last", async () => {
    const res = await request(app).get("/api/admin/health").set(as(admin));
    expect(res.status).toBe(200);
    expect((res.body as Report).components.map((c) => c.component)).toEqual([
      "database",
      "storage",
      "memory",
      "flaresolverr",
      "thingiverse",
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

  it("is for admins only, and refuses a component it doesn't know", async () => {
    expect((await request(app).get("/api/admin/health").set(as(member))).status).toBe(403);
    expect((await request(app).post("/api/admin/health/test").set(as(member)).send({})).status).toBe(403);
    expect(
      (await request(app).post("/api/admin/health/test").set(as(admin)).send({ component: "toaster" })).status,
    ).toBe(400);
  });
});
