import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// config.ts reads STUDIO_ENABLED once, when it's first imported.
vi.hoisted(() => {
  process.env.STUDIO_ENABLED = "true";
});

import { createApp } from "../src/app";
import { DEFAULT_MCP_TOOL_NAMES, MCP_TOOLS } from "../src/mcp/tools";
import { STUDIO_COMMAND_LIST } from "../src/studio/commands.generated";

// Studio end to end: designs are their owner's, every change is a command kept as a revision, and every command is
// an MCP tool an assistant can run the same way.

const app = createApp();
const STUDIO_TOOLS = MCP_TOOLS.filter((tool) => tool.group === "studio").map((tool) => tool.name);

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function register(label: string): Promise<string> {
  const email = `studio-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Studio ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function command(session: string, id: string, name: string, args: Record<string, unknown> = {}) {
  return request(app).post(`/api/studio/designs/${id}/commands`).set(auth(session)).send({ command: name, args });
}

let nextRpc = 1;
async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set(auth(token))
    .send({ jsonrpc: "2.0", id: nextRpc++, method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  const result = res.body.result as { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
  const text = result.content[0]?.text ?? "";
  return {
    isError: Boolean(result.isError),
    text,
    data: result.isError ? null : JSON.parse(text),
    content: result.content,
  };
}

describe("Studio", () => {
  let alice: string;
  let bob: string;
  beforeAll(async () => {
    [alice, bob] = await Promise.all([register("alice"), register("bob")]);
  });

  it("says it's on, and keeps each user's designs to themselves", async () => {
    expect((await request(app).get("/api/studio/status").set(auth(alice))).body).toEqual({ enabled: true });
    const created = await request(app).post("/api/studio/designs").set(auth(alice)).send({ name: "Bracket" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Bracket", version: 0, can_undo: false, can_redo: false });
    expect(created.body.document).toEqual({ version: 1, features: [], next_id: 1 });

    const mine = await request(app).get("/api/studio/designs").set(auth(alice));
    expect(mine.body.map((design: { id: string }) => design.id)).toContain(created.body.id);
    expect((await request(app).get(`/api/studio/designs/${created.body.id}`).set(auth(bob))).status).toBe(404);
    expect((await command(bob, created.body.id, "add_box", { width: 1, depth: 1, height: 1 })).status).toBe(404);
    expect((await request(app).delete(`/api/studio/designs/${created.body.id}`).set(auth(bob))).status).toBe(404);
  });

  it("runs commands, refuses ones it can't carry out, and undoes and redoes them", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    expect(design.name).toBe("Untitled design");

    const added = await command(alice, design.id, "add_box", { width: 20, depth: 10, height: 5 });
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ created: ["box-1"], design: { version: 1, can_undo: true, can_redo: false } });

    const refused = await command(alice, design.id, "update_feature", { feature_id: "box-1", radius: 3 });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: "studio_command_refused", detail: expect.stringMatching(/no radius/) });
    expect((await command(alice, design.id, "no_such_command")).status).toBe(400);

    await command(alice, design.id, "add_cylinder", { radius: 3, height: 10 });
    const undone = await command(alice, design.id, "undo");
    expect(undone.body.summary).toMatch(/^Undid: Added cylinder-2/);
    expect(undone.body.design.document.features.map((f: { id: string }) => f.id)).toEqual(["box-1"]);
    expect(undone.body.design.can_redo).toBe(true);

    const redone = await command(alice, design.id, "redo");
    expect(redone.body.design.document.features).toHaveLength(2);
    await command(alice, design.id, "undo");
    // A new change after an undo leaves nothing to redo.
    const changed = await command(alice, design.id, "set_visibility", { feature_id: "box-1", visible: false });
    expect(changed.body.design.can_redo).toBe(false);
    expect((await command(alice, design.id, "redo")).body.detail).toMatch(/nothing to redo/);

    const renamed = await command(alice, design.id, "rename_design", { name: "Shelf clip" });
    expect(renamed.body.design.name).toBe("Shelf clip");
    const version = await request(app).get(`/api/studio/designs/${design.id}/version`).set(auth(alice));
    expect(version.body).toEqual({ version: renamed.body.design.version });
  });

  it("applies commands sent at once one after another, so none is lost", async () => {
    const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
    await Promise.all(Array.from({ length: 6 }, () => command(alice, design.id, "add_sphere", { radius: 2 })));
    const { body } = await request(app).get(`/api/studio/designs/${design.id}`).set(auth(alice));
    expect(body.document.features).toHaveLength(6);
    expect(body.version).toBe(6);
  });

  it("offers every command as an MCP tool, off until the user turns Studio on", async () => {
    for (const each of STUDIO_COMMAND_LIST) expect(STUDIO_TOOLS).toContain(`studio_${each.name}`);
    expect(DEFAULT_MCP_TOOL_NAMES.some((name) => name.startsWith("studio_"))).toBe(false);

    const res = await request(app)
      .post("/api/profile/api-token")
      .set(auth(alice))
      .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
    const token = res.body.token as string;

    const created = await callTool(token, "studio_create_design", { name: "From an assistant" });
    const id = created.data.design_id as string;
    expect(
      (await callTool(token, "studio_add_box", { design_id: id, width: 20, depth: 20, height: 10 })).data,
    ).toMatchObject({
      done: expect.stringContaining("box-1"),
      created: ["box-1"],
    });
    await callTool(token, "studio_add_cylinder", { design_id: id, radius: 5, height: 30, position: [0, 0, -5] });
    await callTool(token, "studio_boolean", {
      design_id: id,
      operation: "subtract",
      target_id: "box-1",
      tool_ids: ["cylinder-2"],
    });
    const refused = await callTool(token, "studio_delete_feature", { design_id: id, feature_id: "box-1" });
    expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/part of boolean-3/) });

    const read = await callTool(token, "studio_get_design", { design_id: id });
    expect(read.data).toMatchObject({ units: "mm", up: "+Z", top_level: ["boolean-3"], problems: [] });
    expect(read.data.bodies[0].size).toEqual([20, 20, 10]);
    expect(read.data.bodies[0].volume_mm3).toBeLessThan(4000);
    expect(read.data.recent_changes[0]).toMatchObject({ by: "mcp", summary: expect.stringContaining("boolean-3") });

    const view = await callTool(token, "studio_view_design", { design_id: id, views: ["iso", "top"], size: 128 });
    expect(view.isError).toBe(false);
    expect(view.content.filter((part) => part.type === "image")).toHaveLength(2);

    // The page sees what the assistant did.
    const page = await request(app).get(`/api/studio/designs/${id}`).set(auth(alice));
    expect(page.body.document.features.map((f: { id: string }) => f.id)).toEqual(["box-1", "cylinder-2", "boolean-3"]);
  });
});
