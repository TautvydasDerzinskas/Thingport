import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
let session: string;
let userId: string;

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  const email = `api-token-test-${Date.now()}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "API Token Test", email, password: "password123" });
  if (registered.status !== 200) {
    throw new Error(`Failed to register during test setup: ${registered.status} ${JSON.stringify(registered.body)}`);
  }
  // No SMTP in tests, so registration signs in immediately.
  session = registered.body.token;
  userId = registered.body.user.id;
});

describe("API token", () => {
  it("reports no token for a new account", async () => {
    const res = await request(app).get("/api/profile/api-token").set(auth(session));
    expect(res.status).toBe(200);
    const { available_mcp_tools, mcp_access, ...token } = res.body;
    expect(token).toEqual({ configured: false, hint: null, created_at: null, last_used_at: null, mcp_tools: [] });
    expect(mcp_access).toBe("write");
    // What the profile page offers to tick, token or not.
    expect(available_mcp_tools.map((tool: { name: string }) => tool.name)).toContain("search_models");
  });

  it("generates a token that is shown once and stored only as a hash", async () => {
    const res = await request(app).post("/api/profile/api-token").set(auth(session));
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^tp_[A-Za-z0-9_-]{43}$/);
    expect(res.body.hint).toBe(res.body.token.slice(-4));

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.apiTokenHash).not.toContain(res.body.token);

    const info = await request(app).get("/api/profile/api-token").set(auth(session));
    expect(info.body.configured).toBe(true);
    expect(info.body.token).toBeUndefined();
  });

  it("reads as its owner and records when it was last used", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const res = await request(app).get("/api/dashboard/summary").set(auth(body.token));
    expect(res.status).toBe(200);

    // The last-used write is fire-and-forget, so give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const info = await request(app).get("/api/profile/api-token").set(auth(session));
    expect(info.body.last_used_at).not.toBeNull();
  });

  it("can't write, mint a session or replace itself", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const refresh = await request(app).post("/api/refresh").set(auth(body.token));
    expect(refresh.status).toBe(403);
    const regenerate = await request(app).post("/api/profile/api-token").set(auth(body.token));
    expect(regenerate.status).toBe(403);
    const revoke = await request(app).delete("/api/profile/api-token").set(auth(body.token));
    expect(revoke.status).toBe(403);
  });

  it("is only accepted in the Authorization header, not ?token=", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const res = await request(app).get("/api/profile/api-token").query({ token: body.token });
    expect(res.status).toBe(401);
  });

  it("stops working once regenerated", async () => {
    const first = await request(app).post("/api/profile/api-token").set(auth(session));
    const second = await request(app).post("/api/profile/api-token").set(auth(session));
    expect(second.body.token).not.toBe(first.body.token);

    expect((await request(app).get("/api/profile/api-token").set(auth(first.body.token))).status).toBe(401);
    expect((await request(app).get("/api/profile/api-token").set(auth(second.body.token))).status).toBe(200);
  });

  it("stops working once revoked", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const revoked = await request(app).delete("/api/profile/api-token").set(auth(session));
    expect(revoked.status).toBe(200);
    expect(revoked.body.configured).toBe(false);

    expect((await request(app).get("/api/profile/api-token").set(auth(body.token))).status).toBe(401);
  });

  it("rejects a made-up token", async () => {
    const res = await request(app).get("/api/profile/api-token").set(auth("tp_not-a-real-token"));
    expect(res.status).toBe(401);
  });

  it("can't reach admin routes, even for an admin", async () => {
    await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    try {
      const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
      const res = await request(app).get("/api/admin/users").set(auth(body.token));
      expect(res.status).toBe(403);
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { role: "MEMBER" } });
    }
  });
});
