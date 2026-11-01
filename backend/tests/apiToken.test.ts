import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { API_TOKEN_SCOPE_IDS, scopeForPath } from "../src/services/apiTokenScopes";

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
    const { available_mcp_tools, available_rest_scopes, mcp_access, ...token } = res.body;
    expect(token).toEqual({
      configured: false,
      hint: null,
      created_at: null,
      last_used_at: null,
      mcp_tools: [],
      rest_scopes: [],
    });
    expect(available_rest_scopes.map((scope: { id: string }) => scope.id)).toContain("search");
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

  it("reads every REST scope when new, and only the allowed ones once narrowed", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    expect(body.rest_scopes).toEqual(API_TOKEN_SCOPE_IDS);

    const narrowed = await request(app)
      .put("/api/profile/api-token/rest-scopes")
      .set(auth(session))
      .send({ rest_scopes: ["search"] });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.rest_scopes).toEqual(["search"]);

    expect((await request(app).get("/api/search").query({ q: "x" }).set(auth(body.token))).status).toBe(200);
    const summary = await request(app).get("/api/dashboard/summary").set(auth(body.token));
    expect(summary.status).toBe(403);
    expect(summary.body.scope).toBe("dashboard");
    // A path no scope lists needs "everything else".
    expect((await request(app).get("/api/notifications").set(auth(body.token))).status).toBe(403);
    // The token's session-signed-in owner is unaffected.
    expect((await request(app).get("/api/dashboard/summary").set(auth(session))).status).toBe(200);
  });

  it("reads the import queue under the imports scope", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const scoped = (rest_scopes: string[]) =>
      request(app).put("/api/profile/api-token/rest-scopes").set(auth(session)).send({ rest_scopes });

    await scoped(["imports"]);
    const allowed = await request(app).get("/api/import/queue").set(auth(body.token));
    expect(allowed.status).toBe(200);
    expect(allowed.body.jobs).toEqual([]);

    await scoped(["search"]);
    const denied = await request(app).get("/api/import/queue").set(auth(body.token));
    expect(denied.status).toBe(403);
    expect(denied.body.scope).toBe("imports");
  });

  it("refuses an unknown REST scope, and a change made with the token itself", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(session));
    const unknown = await request(app)
      .put("/api/profile/api-token/rest-scopes")
      .set(auth(session))
      .send({ rest_scopes: ["everything"] });
    expect(unknown.status).toBe(400);
    const viaToken = await request(app)
      .put("/api/profile/api-token/rest-scopes")
      .set(auth(body.token))
      .send({ rest_scopes: API_TOKEN_SCOPE_IDS });
    expect(viaToken.status).toBe(403);
  });
});

describe("scopeForPath", () => {
  it("maps the paths integrations read to their scopes", () => {
    expect(scopeForPath("/search")).toBe("search");
    expect(scopeForPath("/prints")).toBe("models");
    expect(scopeForPath("/print/abc")).toBe("models");
    expect(scopeForPath("/print/abc/collections")).toBe("collections");
    expect(scopeForPath("/dashboard/featured")).toBe("dashboard");
    expect(scopeForPath("/activity")).toBe("activity");
    expect(scopeForPath("/plate/p1/thumb.jpg")).toBe("images");
    expect(scopeForPath("/preview-image/i1/file.jpg")).toBe("images");
    expect(scopeForPath("/print/m1/plate/p1/file/Benchy%20v2.stl")).toBe("files");
    expect(scopeForPath("/plate/p1/preview.glb")).toBe("files");
    expect(scopeForPath("/tags/summary")).toBe("tags");
    expect(scopeForPath("/tags/benchy/mosaic.webp")).toBe("images");
    expect(scopeForPath("/import/queue")).toBe("imports");
    expect(scopeForPath("/import/jobs/j1/items")).toBe("imports");
  });

  it("puts anything unlisted under other", () => {
    expect(scopeForPath("/settings/theme")).toBe("other");
    expect(scopeForPath("/profile/api-token")).toBe("other");
    expect(scopeForPath("/searchx")).toBe("other");
    expect(scopeForPath("/plate/p1/thumbxjpg")).toBe("other");
  });
});
