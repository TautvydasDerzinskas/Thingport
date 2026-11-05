import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Set rather than deleted: a dev .env may turn it on, and dotenv never overrides a variable already set.
vi.hoisted(() => {
  process.env.STUDIO_ENABLED = "false";
});

import { createApp } from "../src/app";
import { mcpToolsFor } from "../src/mcp/tools";

// Off, which it is unless STUDIO_ENABLED is "true", Studio isn't there: no routes, no MCP tools.

const app = createApp();

describe("Studio, switched off", () => {
  it("says so, and has nothing else to offer", async () => {
    const email = `studio-off-${Date.now()}@example.com`;
    const { body } = await request(app)
      .post("/api/register")
      .send({ displayName: "Off", email, password: "password123" });
    const session = { Authorization: `Bearer ${body.token}` };
    expect((await request(app).get("/api/studio/status").set(session)).body).toEqual({ enabled: false });
    expect((await request(app).get("/api/studio/designs").set(session)).status).toBe(404);
    expect((await request(app).post("/api/studio/designs").set(session).send({})).status).toBe(404);
    expect((await request(app).get("/api/studio/ai-models").set(session)).status).toBe(404);
    expect(mcpToolsFor("write").some((tool) => tool.group === "studio")).toBe(false);
  });
});
