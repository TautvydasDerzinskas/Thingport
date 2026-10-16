import fs from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
const originalFetch = global.fetch;
let token: string;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Versions", email: `versions-${Date.now()}@example.com`, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
  token = res.body.token;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("the update checker", () => {
  it("says which version of the backend is running, the one its releases bump in package.json", async () => {
    // GitHub's answer, for the published images' commits.
    global.fetch = vi.fn<() => Promise<Response>>(async () =>
      Response.json({ workflow_runs: [{ head_sha: "abc123" }] }),
    ) as unknown as typeof fetch;
    const res = await request(app)
      .get("/api/settings/version-check")
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const { version } = JSON.parse(fs.readFileSync("package.json", "utf8")) as { version: string };
    expect(res.body).toMatchObject({ backend_version: version, latest_backend_sha: "abc123" });
  });
});
