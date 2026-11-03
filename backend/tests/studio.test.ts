import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// config.ts reads STUDIO_ENABLED once, when it's first imported.
vi.hoisted(() => {
  process.env.STUDIO_ENABLED = "true";
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_MCP_TOOL_NAMES, MCP_TOOLS } from "../src/mcp/tools";
import { STUDIO_COMMAND_LIST } from "../src/studio/commands.generated";
import { decodeMesh } from "../src/studio/meshAsset.generated";
import { studioAssetDir } from "../src/services/studioService";

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
    // One after the other: on a new instance the first account is its admin, and a second at the same time is turned away.
    alice = await register("alice");
    bob = await register("bob");
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

  it("lets an assistant read the guide, name edges from inspect_body, and round, drill and split with them", async () => {
    const res = await request(app)
      .post("/api/profile/api-token")
      .set(auth(alice))
      .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
    const token = res.body.token as string;
    expect((await callTool(token, "studio_guide")).data.guide).toMatch(/Naming faces and edges/);

    const id = (await callTool(token, "studio_create_design", {})).data.design_id as string;
    await callTool(token, "studio_add_box", { design_id: id, width: 40, depth: 30, height: 12 });
    const box = (await callTool(token, "studio_inspect_body", { design_id: id, feature_id: "box-1" })).data;
    expect(box.faces).toHaveLength(6);
    expect(box.edges).toHaveLength(12);
    const vertical = box.edges.filter((edge: { a: number[]; b: number[] }) => edge.a[2] !== edge.b[2]);
    const rounded = await callTool(token, "studio_fillet", {
      design_id: id,
      feature_id: "box-1",
      edges: vertical.map(({ a, b }: { a: number[]; b: number[] }) => ({ a, b })),
      radius: 4,
    });
    expect(rounded.data).toMatchObject({ created: ["fillet-2"], problems: [] });

    const drilled = await callTool(token, "studio_hole", {
      design_id: id,
      feature_id: "fillet-2",
      point: [0, 0, 12],
      normal: [0, 0, 1],
      diameter: 5,
      counterbore: { diameter: 10, depth: 4 },
    });
    expect(drilled.data).toMatchObject({ created: ["hole-3"], problems: [] });
    const read = await callTool(token, "studio_get_design", { design_id: id });
    const volume = read.data.bodies[0].volume_mm3 as number;
    const corners = 4 * (16 - 4 * Math.PI) * 12;
    const hole = Math.PI * 6.25 * 12 + Math.PI * (25 - 6.25) * 4;
    expect(Math.abs(volume - (40 * 30 * 12 - corners - hole)) / volume).toBeLessThan(0.01);

    // Too big a radius isn't refused outright: the reply says what's wrong, and undo takes it back.
    const tooBig = await callTool(token, "studio_update_feature", {
      design_id: id,
      feature_id: "fillet-2",
      radius: 20,
    });
    expect(tooBig.data.problems[0].message).toMatch(/too big/);
    await callTool(token, "studio_undo", { design_id: id });

    const split = await callTool(token, "studio_split", {
      design_id: id,
      feature_id: "hole-3",
      plane: { point: [0, 0, 6], normal: [0, 0, 1] },
    });
    expect(split.data).toMatchObject({ created: ["split-4", "split-5"], problems: [] });
  });

  describe("importing library models", () => {
    /** An ASCII STL of a w x d x h box from the origin, Z up; `open` leaves its top off. */
    function boxStl(w: number, d: number, h: number, open = false): string {
      const v = (x: number, y: number, z: number) => `vertex ${x * w} ${y * d} ${z * h}`;
      const quads: [number, number, number][][] = [
        [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [1, 0, 0],
        ],
        [
          [0, 0, 1],
          [1, 0, 1],
          [1, 1, 1],
          [0, 1, 1],
        ],
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 0, 1],
          [0, 0, 1],
        ],
        [
          [0, 1, 0],
          [0, 1, 1],
          [1, 1, 1],
          [1, 1, 0],
        ],
        [
          [0, 0, 0],
          [0, 0, 1],
          [0, 1, 1],
          [0, 1, 0],
        ],
        [
          [1, 0, 0],
          [1, 1, 0],
          [1, 1, 1],
          [1, 0, 1],
        ],
      ].filter((_, i) => !(open && i === 1)) as [number, number, number][][];
      const facets = quads.flatMap(([a, b, c, e]) =>
        [
          [a, b, c],
          [a, c, e],
        ].map((tri) => `facet normal 0 0 0\nouter loop\n${tri.map((p) => v(...p)).join("\n")}\nendloop\nendfacet`),
      );
      return `solid box\n${facets.join("\n")}\nendsolid box\n`;
    }

    async function upload(session: string, filename: string, text: string) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-studio-"));
      const file = path.join(dir, filename);
      fs.writeFileSync(file, text);
      const res = await request(app).post("/api/upload").set(auth(session)).attach("files", file);
      fs.rmSync(dir, { recursive: true, force: true });
      if (res.status !== 200) throw new Error(`upload: ${res.status} ${JSON.stringify(res.body)}`);
      return { modelId: res.body.prints[0].id as string, fileId: res.body.prints[0].plates[0].id as string };
    }

    it("brings a closed STL in as a solid, centred on the bed, that booleans can cut", async () => {
      const box = await upload(alice, "studio-box.stl", boxStl(10, 20, 30));
      const library = await request(app).get("/api/studio/library").set(auth(alice));
      const listed = library.body.models.find((model: { id: string }) => model.id === box.modelId);
      expect(listed.files).toEqual([expect.objectContaining({ id: box.fileId, name: "studio-box.stl" })]);

      const { body: design } = await request(app).post("/api/studio/designs").set(auth(alice)).send({});
      const imported = await command(alice, design.id, "import_model", { model_id: box.modelId });
      expect(imported.status).toBe(200);
      expect(imported.body.created).toEqual(["mesh-1"]);
      const mesh = imported.body.design.document.features[0];
      expect(mesh).toMatchObject({
        type: "mesh",
        solid: true,
        size: [10, 20, 30],
        source: { model_id: box.modelId, file_id: box.fileId, file_name: "studio-box.stl" },
      });

      const asset = await request(app)
        .get(`/api/studio/designs/${design.id}/assets/${mesh.asset_id}`)
        .set(auth(alice))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(asset.status).toBe(200);
      const zs = decodeMesh(new Uint8Array(asset.body as Buffer)).positions.filter((_, i) => i % 3 === 2);
      expect([Math.min(...zs), Math.max(...zs)]).toEqual([0, 30]);
      expect(
        (await request(app).get(`/api/studio/designs/${design.id}/assets/${mesh.asset_id}`).set(auth(bob))).status,
      ).toBe(404);

      await command(alice, design.id, "add_cylinder", { radius: 3, height: 50, position: [0, 0, -10] });
      const cut = await command(alice, design.id, "boolean", {
        operation: "subtract",
        target_id: "mesh-1",
        tool_ids: ["cylinder-2"],
      });
      expect(cut.status).toBe(200);
      // Someone else's model isn't one to import.
      expect((await command(bob, design.id, "import_model", { model_id: box.modelId })).status).toBe(404);

      const owner = (await prisma.studioDesign.findUniqueOrThrow({ where: { id: design.id } })).userId;
      expect(fs.existsSync(studioAssetDir(owner, design.id))).toBe(true);
      await request(app).delete(`/api/studio/designs/${design.id}`).set(auth(alice));
      expect(fs.existsSync(studioAssetDir(owner, design.id))).toBe(false);
    });

    it("lets an assistant import an open mesh, which shows and measures but won't combine", async () => {
      const open = await upload(alice, "studio-tray.stl", boxStl(40, 40, 10, true));
      const res = await request(app)
        .post("/api/profile/api-token")
        .set(auth(alice))
        .send({ mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...STUDIO_TOOLS] });
      const token = res.body.token as string;
      const id = (await callTool(token, "studio_create_design", {})).data.design_id as string;
      const imported = await callTool(token, "studio_import_model", {
        design_id: id,
        model_id: open.modelId,
        position: [0, 0, 5],
      });
      expect(imported.data.done).toMatch(/not a closed solid/);
      await callTool(token, "studio_add_box", { design_id: id, width: 5, depth: 5, height: 5 });
      const refused = await callTool(token, "studio_boolean", {
        design_id: id,
        operation: "union",
        target_id: "mesh-1",
        tool_ids: ["box-2"],
      });
      expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/isn't a closed solid/) });
      const read = await callTool(token, "studio_get_design", { design_id: id });
      const body = read.data.bodies.find((each: { id: string }) => each.id === "mesh-1");
      expect(body).toMatchObject({ size: [40, 40, 10], volume_mm3: null });
      expect(body.bounds.min[2]).toBe(5);
      const view = await callTool(token, "studio_view_design", { design_id: id, size: 128 });
      expect(view.content.some((part) => part.type === "image")).toBe(true);
    });
  });
});
