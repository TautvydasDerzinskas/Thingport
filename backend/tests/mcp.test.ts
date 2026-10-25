import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_MCP_TOOL_NAMES, MCP_TOOLS, mcpImportTiming } from "../src/mcp/tools";
import { setMcpAccess } from "../src/services/settingsService";

// /api/mcp end to end: who gets in, which tools each token sees, and that every tool only ever
// reads the token owner's own library.

const app = createApp();

// The write tools a new token gets without asking; every other default only reads.
const DEFAULT_ON_WRITES = ["save_widget", "upload_icon"];
const READ_TOOL_NAMES = MCP_TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name);

type Account = { session: string; userId: string; token: string };

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function register(label: string): Promise<{ session: string; userId: string }> {
  const email = `mcp-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `MCP ${label}`, email, password: "password123" });
  if (res.status !== 200) throw new Error(`register ${label}: ${res.status} ${JSON.stringify(res.body)}`);
  return { session: res.body.token, userId: res.body.user.id };
}

async function apiToken(session: string, body?: { mcp_tools: string[] }): Promise<string> {
  const res = await request(app)
    .post("/api/profile/api-token")
    .set(auth(session))
    .send(body ?? {});
  if (res.status !== 200) throw new Error(`api token: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.token;
}

async function upload(session: string, filename: string): Promise<string> {
  // supertest uses the basename as the upload filename, so each file gets its own directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-mcp-test-"));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, `solid ${filename}\nendsolid ${filename}\n`);
  const res = await request(app).post("/api/upload").set(auth(session)).attach("files", file);
  fs.rmSync(dir, { recursive: true, force: true });
  if (res.status !== 200) throw new Error(`upload: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.prints[0].id;
}

let nextId = 1;

function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const req = request(app)
    .post("/api/mcp")
    .set("Accept", "application/json, text/event-stream")
    .set("Content-Type", "application/json");
  if (token) req.set(auth(token));
  return req.send({ jsonrpc: "2.0", id: nextId++, method, params });
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result as { isError?: boolean; content: { type: string; text: string }[] };
  const text = result.content[0]?.text ?? "";
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
}

async function toolNames(token: string): Promise<string[]> {
  const res = await mcp(token, "tools/list");
  expect(res.status).toBe(200);
  return (res.body.result.tools as { name: string }[]).map((tool) => tool.name).toSorted();
}

let alice: Account;
let bob: Account;
let dragonId: string;
let benchyId: string;
let bobSecretId: string;
let collectionId: string;
let bobCollectionId: string;

beforeAll(async () => {
  const a = await register("alice");
  const b = await register("bob");
  alice = { ...a, token: await apiToken(a.session) };
  bob = { ...b, token: await apiToken(b.session) };

  dragonId = await upload(alice.session, "dragon.stl");
  benchyId = await upload(alice.session, "benchy.stl");
  await prisma.print.update({
    where: { id: dragonId },
    data: { title: "Articulated Dragon", tags: ["dragon", "flexi"], notes: "A flexible dragon that prints in place." },
  });
  await prisma.print.update({ where: { id: benchyId }, data: { title: "Speed Benchy", tags: ["calibration"] } });

  // Bob's model also says "dragon": search must still never return it to Alice.
  bobSecretId = await upload(bob.session, "secret.stl");
  await prisma.print.update({
    where: { id: bobSecretId },
    data: { title: "Bob's Secret Dragon", tags: ["dragon"] },
  });

  const created = await request(app).post("/api/collections").set(auth(alice.session)).send({ name: "MCP Dragons" });
  collectionId = created.body.id;
  await prisma.collectionItem.create({ data: { collectionId, printId: dragonId } });
  const bobs = await request(app).post("/api/collections").set(auth(bob.session)).send({ name: "Bob Private" });
  bobCollectionId = bobs.body.id;
});

describe("/api/mcp authentication", () => {
  it("asks for a token without one", async () => {
    const res = await mcp(null, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/Bearer/);
  });

  it("turns away a session token: MCP takes API tokens only", async () => {
    const res = await mcp(alice.session, "tools/list");
    expect(res.status).toBe(401);
  });

  it("turns away an unknown API token", async () => {
    const res = await mcp(`tp_${"x".repeat(43)}`, "tools/list");
    expect(res.status).toBe(401);
  });

  it("doesn't take the token from the address", async () => {
    const res = await request(app)
      .post(`/api/mcp?token=${alice.token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
  });

  it("answers initialize as Thingport", async () => {
    const res = await mcp(alice.token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe("thingport");
  });

  it("has no session to stream or end", async () => {
    expect((await request(app).get("/api/mcp").set(auth(alice.token))).status).toBe(405);
    expect((await request(app).delete("/api/mcp").set(auth(alice.token))).status).toBe(405);
  });

  it("stops working the moment the token is revoked", async () => {
    const user = await register("revoked");
    const token = await apiToken(user.session);
    expect((await mcp(token, "tools/list")).status).toBe(200);
    await request(app).delete("/api/profile/api-token").set(auth(user.session));
    expect((await mcp(token, "tools/list")).status).toBe(401);
  });

  it("leaves the REST API read-only for the same token", async () => {
    const res = await request(app).post("/api/collections").set(auth(alice.token)).send({ name: "Sneaky" });
    expect(res.status).toBe(403);
  });
});

describe("choosing a token's tools", () => {
  it("gives a new token every read-only tool, and the write tools that are on by default", async () => {
    expect(await toolNames(alice.token)).toEqual([...DEFAULT_MCP_TOOL_NAMES].toSorted());
    const res = await mcp(alice.token, "tools/list");
    for (const tool of res.body.result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(!DEFAULT_ON_WRITES.includes(tool.name));
    }
  });

  it("offers only the tools the token was given, and refuses a call to any other", async () => {
    const user = await register("picky");
    const token = await apiToken(user.session, { mcp_tools: ["search_models"] });
    expect(await toolNames(token)).toEqual(["search_models"]);

    const res = await mcp(token, "tools/call", { name: "library_stats", arguments: {} });
    // Unknown to this server: a protocol error or an error result, never the stats.
    const refused = res.body.error ?? (res.body.result?.isError ? res.body.result : null);
    expect(refused).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("model_count");
  });

  it("can turn every tool off", async () => {
    const user = await register("none");
    const token = await apiToken(user.session, { mcp_tools: [] });
    expect(await toolNames(token)).toEqual([]);
  });

  it("changes the tools without replacing the token", async () => {
    const user = await register("changes");
    const token = await apiToken(user.session);
    const res = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(user.session))
      .send({ mcp_tools: ["get_model", "list_tags", "get_model"] });
    expect(res.status).toBe(200);
    // Duplicates collapse.
    expect(res.body.mcp_tools).toEqual(["get_model", "list_tags"]);
    expect(await toolNames(token)).toEqual(["get_model", "list_tags"]);
    const log = await prisma.log.findFirst({
      where: { userId: user.userId, action: "api_token_mcp_tools_changed" },
    });
    expect(log).toBeTruthy();
  });

  it("refuses a tool name it doesn't know instead of dropping it", async () => {
    const res = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(alice.session))
      .send({ mcp_tools: ["search_models", "delete_everything"] });
    expect(res.status).toBe(400);
    expect(await toolNames(alice.token)).toEqual([...DEFAULT_MCP_TOOL_NAMES].toSorted());
  });

  it("can't be changed with the token itself", async () => {
    const res = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(alice.token))
      .send({ mcp_tools: DEFAULT_MCP_TOOL_NAMES });
    expect(res.status).toBe(403);
  });

  it("needs a token to set tools on", async () => {
    const user = await register("tokenless");
    const res = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(user.session))
      .send({ mcp_tools: ["search_models"] });
    expect(res.status).toBe(409);
  });

  it("forgets the tools when the token is revoked", async () => {
    const user = await register("forget");
    await apiToken(user.session);
    await request(app).delete("/api/profile/api-token").set(auth(user.session));
    const db = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(db.apiTokenMcpTools).toEqual([]);
  });

  it("only ever ships tools that say whether they write", () => {
    // A write tool must not slip into the default set unless it's marked defaultOn.
    for (const tool of MCP_TOOLS) expect(typeof tool.readOnly).toBe("boolean");
    const writes = DEFAULT_MCP_TOOL_NAMES.filter((name) => !MCP_TOOLS.find((t) => t.name === name)?.readOnly);
    expect(writes.toSorted()).toEqual([...DEFAULT_ON_WRITES].toSorted());
  });
});

describe("the tools", () => {
  it("search_models finds the user's model and never another user's", async () => {
    const { data } = await callTool(alice.token, "search_models", { query: "dragon" });
    const ids = data.models.map((m: { id: string }) => m.id);
    expect(ids).toContain(dragonId);
    expect(ids).not.toContain(bobSecretId);
    expect(data.collections.map((c: { id: string }) => c.id)).toContain(collectionId);
  });

  it("get_model reads everything without counting as a view", async () => {
    const before = await prisma.print.findUniqueOrThrow({ where: { id: dragonId } });
    const { data } = await callTool(alice.token, "get_model", { id: dragonId });
    expect(data.title).toBe("Articulated Dragon");
    expect(data.description).toBe("A flexible dragon that prints in place.");
    expect(data.tags.toSorted()).toEqual(["Dragon", "Flexi"].map((t) => t.toLowerCase()).toSorted());
    expect(data.files).toEqual([{ name: "dragon.stl", size_bytes: expect.any(Number) }]);
    expect(data.collections).toEqual([{ id: collectionId, name: "MCP Dragons" }]);
    // No file or image URLs: they need a session to open.
    expect(JSON.stringify(data)).not.toMatch(/\/api\/(plate|preview|print-file)/);

    const after = await prisma.print.findUniqueOrThrow({ where: { id: dragonId } });
    expect(after.viewCount).toBe(before.viewCount);
    expect(after.lastViewedAt).toEqual(before.lastViewedAt);
  });

  it("get_model says not found for another user's model", async () => {
    const result = await callTool(alice.token, "get_model", { id: bobSecretId });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
  });

  it("rejects arguments that don't fit the tool", async () => {
    const res = await mcp(alice.token, "tools/call", { name: "get_model", arguments: {} });
    const failed = res.body.error ?? (res.body.result?.isError ? res.body.result : null);
    expect(failed).toBeTruthy();
    const tooBig = await mcp(alice.token, "tools/call", { name: "list_models", arguments: { limit: 5000 } });
    expect(tooBig.body.error ?? (tooBig.body.result?.isError ? tooBig.body.result : null)).toBeTruthy();
  });

  it("list_models filters by tag and pages through results", async () => {
    const byTag = await callTool(alice.token, "list_models", { tags: ["FLEXI"] });
    expect(byTag.data.models.map((m: { id: string }) => m.id)).toEqual([dragonId]);

    const first = await callTool(alice.token, "list_models", { limit: 1 });
    expect(first.data.total).toBe(2);
    expect(first.data.models).toHaveLength(1);
    expect(first.data.next_offset).toBe(1);
    const second = await callTool(alice.token, "list_models", { limit: 1, offset: 1 });
    expect(second.data.next_offset).toBeNull();
    expect(second.data.models[0].id).not.toBe(first.data.models[0].id);
  });

  it("list_collections lists the user's collections and the built-in ones", async () => {
    const { data } = await callTool(alice.token, "list_collections");
    const ids = data.collections.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["favorites", "history", collectionId]));
    expect(ids).not.toContain(bobCollectionId);
    expect(data.collections.find((c: { id: string }) => c.id === collectionId).model_count).toBe(1);
  });

  it("get_collection lists its models, and won't open another user's", async () => {
    const { data } = await callTool(alice.token, "get_collection", { id: collectionId });
    expect(data.name).toBe("MCP Dragons");
    expect(data.models.map((m: { id: string }) => m.id)).toEqual([dragonId]);

    const other = await callTool(alice.token, "get_collection", { id: bobCollectionId });
    expect(other.isError).toBe(true);
  });

  it("list_tags lists only the user's tags, most used first, and narrows by query", async () => {
    const { data } = await callTool(alice.token, "list_tags");
    const byTag = new Map(
      data.tags.map((t: { tag: string; model_count: number }) => [t.tag.toLowerCase(), t.model_count]),
    );
    expect(byTag.get("dragon")).toBe(1);
    expect(byTag.get("calibration")).toBe(1);
    expect(data.total).toBe(3);

    const narrowed = await callTool(alice.token, "list_tags", { query: "DRAG", limit: 5 });
    expect(narrowed.data.tags.map((t: { tag: string }) => t.tag.toLowerCase())).toEqual(["dragon"]);
    // Bob's "dragon" model doesn't count towards Alice's tags.
    expect(narrowed.data.tags[0].model_count).toBe(1);

    const one = await callTool(alice.token, "list_tags", { limit: 1 });
    expect(one.data.tags).toHaveLength(1);
    expect(one.data.total).toBe(3);
  });

  it("list_categories and library_stats answer for the user", async () => {
    const categories = await callTool(alice.token, "list_categories");
    expect(Array.isArray(categories.data.categories)).toBe(true);
    const stats = await callTool(alice.token, "library_stats");
    expect(stats.data.model_count).toBe(2);
    expect(stats.data.collection_count).toBe(1);
  });

  it("list_model_files lists a model's files, and get_model_file returns one", async () => {
    const { data } = await callTool(alice.token, "list_model_files", { model_id: dragonId });
    expect(data.files).toEqual([
      expect.objectContaining({ name: "dragon.stl", kind: "plate", size_bytes: expect.any(Number) }),
    ]);
    // Reachable without a public address too.
    expect(data.files[0].api_path).toBe(`/api/print/${dragonId}/plate/${data.files[0].id}/file/dragon.stl`);
    const file = await callTool(alice.token, "get_model_file", { model_id: dragonId, file_id: data.files[0].id });
    expect(Buffer.from(file.data.base64, "base64").toString()).toBe("solid dragon.stl\nendsolid dragon.stl\n");
  });

  it("get_model_file won't read another user's model, nor a file of another model", async () => {
    const theirs = await callTool(alice.token, "list_model_files", { model_id: bobSecretId });
    expect(theirs.isError).toBe(true);
    const bobFiles = (await callTool(bob.token, "list_model_files", { model_id: bobSecretId })).data.files;
    const crossed = await callTool(alice.token, "get_model_file", { model_id: dragonId, file_id: bobFiles[0].id });
    expect(crossed.isError).toBe(true);
    expect(crossed.text).not.toContain("solid");
  });

  it("get_author says not found for an unknown author", async () => {
    const result = await callTool(alice.token, "get_author", { id: "no-such-author" });
    expect(result.isError).toBe(true);
  });
});

describe("the tools that write", () => {
  const WRITE_TOOLS = [
    "import_model",
    "upload_model",
    "edit_model",
    "edit_model_images",
    "add_model_files",
    "remove_model_file",
    "rename_model_file",
    "delete_model",
    "create_category",
    "create_collection",
    "add_to_collection",
    "remove_from_collection",
  ];
  // The ones that delete something for good, so an assistant's client can ask before calling them.
  const DESTRUCTIVE_TOOLS = ["edit_model_images", "remove_model_file", "delete_model"];
  // A public IP literal passes the SSRF check without a DNS lookup; fetch is mocked below.
  const FILE_URL = "https://93.184.215.14/files/mcp-imported-widget.stl";
  let writer: Account;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const user = await register("writer");
    writer = {
      ...user,
      token: await apiToken(user.session, { mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...WRITE_TOOLS] }),
    };
  });

  function mockFile(contents = "solid widget\nendsolid widget\n") {
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === FILE_URL) {
        return new Response(contents, { headers: { "content-type": "application/octet-stream" } });
      }
      throw new Error(`Unexpected fetch to ${String(input)}`);
    }) as typeof fetch;
  }

  it("are off for a new token, and marked as writing", async () => {
    const names = await toolNames(alice.token);
    for (const tool of WRITE_TOOLS) expect(names).not.toContain(tool);
    const listed = (await mcp(writer.token, "tools/list")).body.result.tools as {
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    }[];
    for (const tool of listed.filter((t) => WRITE_TOOLS.includes(t.name))) {
      expect(tool.annotations.readOnlyHint).toBe(false);
      expect(tool.annotations.destructiveHint).toBe(DESTRUCTIVE_TOOLS.includes(tool.name));
    }
  });

  it("refuses a write tool to a token that didn't turn it on", async () => {
    const before = await prisma.collection.count({ where: { userId: alice.userId } });
    const res = await mcp(alice.token, "tools/call", { name: "create_collection", arguments: { name: "Nope" } });
    expect(res.body.error ?? (res.body.result?.isError ? res.body.result : null)).toBeTruthy();
    expect(await prisma.collection.count({ where: { userId: alice.userId } })).toBe(before);
  });

  it("create_collection makes an empty collection, and refuses a name already taken", async () => {
    const created = await callTool(writer.token, "create_collection", { name: "From the assistant", tags: ["ai"] });
    expect(created.data.name).toBe("From the assistant");
    const row = await prisma.collection.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(row.userId).toBe(writer.userId);

    const again = await callTool(writer.token, "create_collection", { name: "from the ASSISTANT" });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already/i);
  });

  it("add_to_collection files the user's models and reports the rest", async () => {
    const own = await upload(writer.session, "own-model.stl");
    const { data: collection } = await callTool(writer.token, "create_collection", { name: "Filing test" });

    const first = await callTool(writer.token, "add_to_collection", {
      collection_id: collection.id,
      model_ids: [own, bobSecretId, "no-such-model"],
    });
    expect(first.data.added).toEqual([own]);
    // Another user's model reads as not found, never as added.
    expect(first.data.not_found.toSorted()).toEqual([bobSecretId, "no-such-model"].toSorted());
    expect(await prisma.collectionItem.count({ where: { printId: bobSecretId, collectionId: collection.id } })).toBe(0);

    const second = await callTool(writer.token, "add_to_collection", {
      collection_id: collection.id,
      model_ids: [own],
    });
    expect(second.data.added).toEqual([]);
    expect(second.data.already_in).toEqual([own]);
    // Logged once, for the one model actually added.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const logs = await prisma.log.findMany({
      where: { userId: writer.userId, action: "collection_item_added", targetId: collection.id },
    });
    expect(logs.map((log) => (log.details as { count: number }).count)).toEqual([1]);
  });

  it("add_to_collection won't touch another user's collection or a built-in one", async () => {
    const own = await upload(writer.session, "other-check.stl");
    const theirs = await callTool(writer.token, "add_to_collection", {
      collection_id: bobCollectionId,
      model_ids: [own],
    });
    expect(theirs.isError).toBe(true);
    expect(await prisma.collectionItem.count({ where: { collectionId: bobCollectionId } })).toBe(0);
    const builtIn = await callTool(writer.token, "add_to_collection", { collection_id: "favorites", model_ids: [own] });
    expect(builtIn.isError).toBe(true);
  });

  it("import_model imports a link into the library and the chosen collection, once", async () => {
    mockFile();
    try {
      const { data: collection } = await callTool(writer.token, "create_collection", { name: "Imported here" });
      const first = await callTool(writer.token, "import_model", {
        url: FILE_URL,
        title: "Widget from MCP",
        collection_id: collection.id,
      });
      expect(first.isError).toBe(false);
      expect(first.data.status).toBe("created");
      expect(first.data.model.title).toBe("Widget from MCP");
      expect(first.data.collection).toEqual({ id: collection.id, name: "Imported here" });
      const print = await prisma.print.findUniqueOrThrow({ where: { id: first.data.model.id } });
      expect(print.userId).toBe(writer.userId);
      expect(await prisma.collectionItem.count({ where: { collectionId: collection.id, printId: print.id } })).toBe(1);
      // The same trail as + Add > Import.
      expect(
        await prisma.log.count({ where: { userId: writer.userId, action: "model_imported", targetId: print.id } }),
      ).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("import_model refuses an internal address", async () => {
    const result = await callTool(writer.token, "import_model", { url: "http://127.0.0.1:8000/api/health" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/local addresses/i);
  });

  it("import_model checks the collection before importing anything", async () => {
    mockFile();
    try {
      const before = await prisma.print.count({ where: { userId: writer.userId } });
      const result = await callTool(writer.token, "import_model", { url: FILE_URL, collection_id: bobCollectionId });
      expect(result.isError).toBe(true);
      expect(await prisma.print.count({ where: { userId: writer.userId } })).toBe(before);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("hands a slow import over to get_import_status, which only its user can read", async () => {
    const slowUrl = "https://93.184.215.14/files/mcp-slow-widget.stl";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) !== slowUrl) throw new Error(`Unexpected fetch to ${String(input)}`);
      await gate;
      return new Response("solid slow\nendsolid slow\n", { headers: { "content-type": "application/octet-stream" } });
    }) as typeof fetch;
    const saved = { ...mcpImportTiming };
    mcpImportTiming.waitMs = 50;
    mcpImportTiming.pollMs = 10;
    try {
      const started = await callTool(writer.token, "import_model", { url: slowUrl });
      expect(started.data.status).toBe("running");
      const taskId = started.data.task_id as string;

      // Someone else's token can't follow it, even with the id.
      const peek = await callTool(alice.token, "get_import_status", { task_id: taskId });
      expect(peek.isError).toBe(true);

      release();
      let state = started.data;
      for (let i = 0; i < 100 && state.status === "running"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        state = (await callTool(writer.token, "get_import_status", { task_id: taskId })).data;
      }
      expect(state.status).toBe("created");
      expect(state.model.id).toBeTruthy();
    } finally {
      Object.assign(mcpImportTiming, saved);
      global.fetch = originalFetch;
    }
  });

  it("import_model refuses another user's category before importing anything", async () => {
    const bobCategory = await prisma.category.findFirstOrThrow({ where: { userId: bob.userId } });
    mockFile();
    try {
      const before = await prisma.print.count({ where: { userId: writer.userId } });
      const result = await callTool(writer.token, "import_model", { url: FILE_URL, category_id: bobCategory.id });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/category not found/i);
      expect(await prisma.print.count({ where: { userId: writer.userId } })).toBe(before);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("get_import_status won't read an import the web app started", async () => {
    const restUrl = "https://93.184.215.14/files/mcp-rest-widget.stl";
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input) !== restUrl) throw new Error(`Unexpected fetch to ${String(input)}`);
      return new Response("solid rest\nendsolid rest\n", { headers: { "content-type": "application/octet-stream" } });
    }) as typeof fetch;
    try {
      const started = await request(app).post("/api/import?async=1").set(auth(writer.session)).send({ url: restUrl });
      expect(started.status).toBe(202);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = await callTool(writer.token, "get_import_status", { task_id: started.body.task_id });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/import_model/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("upload_model makes one model from the files, with its pictures and collection", async () => {
    const { data: collection } = await callTool(writer.token, "create_collection", { name: "Uploaded here" });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } })
      .png()
      .toBuffer();
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    const result = await callTool(writer.token, "upload_model", {
      title: "Stringing test",
      description: "0.2 mm layers, PLA.",
      tags: ["calibration"],
      collection_id: collection.id,
      files: [
        { name: "stringing.stl", base64: b64("solid s\nendsolid s\n") },
        { name: "settings.txt", base64: b64("retraction 0.8 mm") },
      ],
      images: [png.toString("base64"), b64("not an image")],
    });
    expect(result.isError).toBe(false);
    expect(result.data.model.title).toBe("Stringing test");
    expect(result.data.images_added).toBe(1);
    expect(result.data.images_skipped).toBe(1);
    expect(result.data.collection).toEqual({ id: collection.id, name: "Uploaded here" });

    const print = await prisma.print.findUniqueOrThrow({
      where: { id: result.data.model.id },
      include: { plates: true, files: true },
    });
    expect(print.userId).toBe(writer.userId);
    expect(print.notes).toBe("0.2 mm layers, PLA.");
    expect(print.plates.map((p) => p.filename)).toEqual(["stringing.stl"]);
    expect(print.files.map((f) => [f.filename, f.role])).toEqual([["settings.txt", "SUPPORTING"]]);
    expect(await prisma.previewImage.count({ where: { printId: print.id } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.collectionItem.count({ where: { collectionId: collection.id, printId: print.id } })).toBe(1);
    // The same trail as + Add > Upload.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      await prisma.log.count({ where: { userId: writer.userId, action: "model_uploaded", targetId: print.id } }),
    ).toBe(1);

    // Both files read back with the file tools.
    const { data: listed } = await callTool(writer.token, "list_model_files", { model_id: print.id });
    expect(listed.files.map((f: { name: string; kind: string }) => [f.name, f.kind])).toEqual([
      ["stringing.stl", "plate"],
      ["settings.txt", "supporting"],
    ]);
  });

  it("upload_model checks the collection and category before storing anything", async () => {
    const before = await prisma.print.count({ where: { userId: writer.userId } });
    const files = [{ name: "x.stl", base64: Buffer.from("solid x\nendsolid x\n").toString("base64") }];
    const theirs = await callTool(writer.token, "upload_model", { files, collection_id: bobCollectionId });
    expect(theirs.isError).toBe(true);
    const bobCategory = await prisma.category.findFirstOrThrow({ where: { userId: bob.userId } });
    const category = await callTool(writer.token, "upload_model", { files, category_id: bobCategory.id });
    expect(category.isError).toBe(true);
    expect(category.text).toMatch(/category not found/i);
    expect(await prisma.print.count({ where: { userId: writer.userId } })).toBe(before);
  });

  it("upload_model refuses a file that isn't base64", async () => {
    const before = await prisma.print.count({ where: { userId: writer.userId } });
    for (const base64 of ["!!!", `${Buffer.from("solid x\nendsolid x\n").toString("base64")}!!!`]) {
      const result = await callTool(writer.token, "upload_model", { files: [{ name: "x.stl", base64 }] });
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/base64/);
    }
    expect(await prisma.print.count({ where: { userId: writer.userId } })).toBe(before);
  });

  const b64 = (text: string) => Buffer.from(text).toString("base64");
  const png = (background: string) =>
    sharp({ create: { width: 8, height: 8, channels: 3, background } })
      .png()
      .toBuffer()
      .then((buffer) => buffer.toString("base64"));

  it("edit_model changes only what it's given, and files the model in a new category", async () => {
    const id = await upload(writer.session, "bracket.stl");
    await prisma.print.update({ where: { id }, data: { tags: ["Old", "Keep"] } });
    const { data: category } = await callTool(writer.token, "create_category", { name: "MCP Brackets" });
    expect(category).toMatchObject({ name: "MCP Brackets", parent_id: null, kind: "folder" });

    const result = await callTool(writer.token, "edit_model", {
      model_id: id,
      title: "Shelf bracket",
      description: "Print on its side.",
      add_tags: ["brand-new-tag"],
      remove_tags: ["old"],
      category_id: category.id,
      favorite: true,
    });
    expect(result.isError).toBe(false);
    expect(result.data.changed).toEqual(["title", "description", "tags", "category", "favorite"]);
    const print = await prisma.print.findUniqueOrThrow({ where: { id } });
    expect(print).toMatchObject({ title: "Shelf bracket", notes: "Print on its side.", categoryId: category.id });
    expect(print.tags).toEqual(["Keep", "Brand-new-tag"]);
    expect(print.favoritedAt).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await prisma.log.count({ where: { userId: writer.userId, action: "model_edited", targetId: id } })).toBe(3);

    // Asked again, nothing changes.
    const again = await callTool(writer.token, "edit_model", {
      model_id: id,
      favorite: true,
      category_id: category.id,
    });
    expect(again.data.changed).toEqual([]);
    const cleared = await callTool(writer.token, "edit_model", { model_id: id, category_id: null, tags: [] });
    expect(cleared.data.changed).toEqual(["tags", "category"]);
    expect(await prisma.print.findUniqueOrThrow({ where: { id } })).toMatchObject({ categoryId: null, tags: [] });
  });

  it("edit_model checks the name and category before changing anything", async () => {
    const id = await upload(writer.session, "hinge.stl");
    await upload(writer.session, "taken.stl");
    const taken = await callTool(writer.token, "edit_model", { model_id: id, title: "taken", description: "x" });
    expect(taken.isError).toBe(true);
    expect(taken.text).toMatch(/already exists/);
    const bobCategory = await prisma.category.findFirstOrThrow({ where: { userId: bob.userId } });
    const theirs = await callTool(writer.token, "edit_model", {
      model_id: id,
      category_id: bobCategory.id,
      tags: ["x"],
    });
    expect(theirs.isError).toBe(true);
    expect(await prisma.print.findUniqueOrThrow({ where: { id } })).toMatchObject({ notes: null, tags: [] });

    expect((await callTool(writer.token, "edit_model", { model_id: id })).text).toMatch(/nothing to change/i);
    const bobs = await callTool(writer.token, "edit_model", { model_id: bobSecretId, title: "Mine now" });
    expect(bobs.isError).toBe(true);
    expect((await prisma.print.findUniqueOrThrow({ where: { id: bobSecretId } })).title).toBe("Bob's Secret Dragon");
  });

  it("edit_model_images adds, orders and removes a model's pictures", async () => {
    const id = await upload(writer.session, "vase.stl");
    const first = await callTool(writer.token, "edit_model_images", {
      model_id: id,
      add: [await png("#cc3333"), await png("#33cc33"), b64("not an image")],
    });
    expect(first.data).toMatchObject({ added: 2, skipped: 1, removed: 0 });
    const [red, green] = first.data.images.map((image: { id: string }) => image.id);
    expect(first.data.images.map((image: { cover: boolean }) => image.cover)).toEqual([true, false]);

    const { data: listed } = await callTool(writer.token, "list_model_images", { model_id: id });
    expect(listed.images.map((image: { id: string }) => image.id)).toEqual([red, green]);
    expect(listed.images[0].api_path).toBe(`/api/preview-image/${red}/file.jpg`);

    const reordered = await callTool(writer.token, "edit_model_images", { model_id: id, order: [green] });
    expect(reordered.data.images.map((image: { id: string }) => image.id)).toEqual([green, red]);

    const blueFirst = await callTool(writer.token, "edit_model_images", {
      model_id: id,
      add: [await png("#3333cc")],
      added_first: true,
      remove: [green],
    });
    const ids = blueFirst.data.images.map((image: { id: string }) => image.id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(red);
    expect(await prisma.previewImage.count({ where: { id: green } })).toBe(0);
  });

  it("edit_model_images checks every id before changing anything", async () => {
    const id = await upload(writer.session, "lamp.stl");
    const { data } = await callTool(writer.token, "edit_model_images", { model_id: id, add: [await png("#cccc33")] });
    const bobImage = await prisma.previewImage.create({ data: { printId: bobSecretId, position: 99 } });
    const result = await callTool(writer.token, "edit_model_images", {
      model_id: id,
      remove: [data.images[0].id, bobImage.id],
    });
    expect(result.isError).toBe(true);
    expect(await prisma.previewImage.count({ where: { id: { in: [data.images[0].id, bobImage.id] } } })).toBe(2);
    expect((await callTool(writer.token, "list_model_images", { model_id: bobSecretId })).isError).toBe(true);
  });

  it("add_model_files adds plates and supporting files, and remove_model_file takes them off", async () => {
    const id = await upload(writer.session, "gear.stl");
    const added = await callTool(writer.token, "add_model_files", {
      model_id: id,
      files: [
        { name: "gear-v2.stl", base64: b64("solid v2\nendsolid v2\n") },
        { name: "notes.txt", base64: b64("print at 0.12 mm") },
        { name: "spare.stl", base64: b64("solid s\nendsolid s\n"), kind: "supporting" },
      ],
    });
    expect(added.isError).toBe(false);
    expect(added.data).toMatchObject({ plates_added: 1, files_added: 2 });
    const kinds = (files: { name: string; kind: string }[]) => files.map((f) => [f.name, f.kind]);
    expect(kinds(added.data.files)).toEqual([
      ["gear.stl", "plate"],
      ["gear-v2.stl", "plate"],
      ["notes.txt", "supporting"],
      ["spare.stl", "supporting"],
    ]);

    const byName = (name: string) => added.data.files.find((f: { name: string }) => f.name === name).id;
    const notes = await callTool(writer.token, "remove_model_file", { model_id: id, file_id: byName("notes.txt") });
    expect(notes.data.removed).toMatchObject({ name: "notes.txt", kind: "supporting" });
    const plate = await callTool(writer.token, "remove_model_file", { model_id: id, file_id: byName("gear.stl") });
    expect(kinds(plate.data.files)).toEqual([
      ["gear-v2.stl", "plate"],
      ["spare.stl", "supporting"],
    ]);
    const last = await callTool(writer.token, "remove_model_file", { model_id: id, file_id: byName("gear-v2.stl") });
    expect(last.isError).toBe(true);
    expect(last.text).toMatch(/only plate/);
  });

  it("add_model_files and remove_model_file won't touch another user's model", async () => {
    const files = [{ name: "x.stl", base64: b64("solid x\nendsolid x\n") }];
    expect((await callTool(writer.token, "add_model_files", { model_id: bobSecretId, files })).isError).toBe(true);
    const bobFiles = (await callTool(bob.token, "list_model_files", { model_id: bobSecretId })).data.files;
    const removed = await callTool(writer.token, "remove_model_file", {
      model_id: bobSecretId,
      file_id: bobFiles[0].id,
    });
    expect(removed.isError).toBe(true);
    expect(await prisma.plate.count({ where: { printId: bobSecretId } })).toBe(1);
  });

  it("list_model_images shows the pictures themselves when asked", async () => {
    const id = await upload(writer.session, "statue.stl");
    await callTool(writer.token, "edit_model_images", {
      model_id: id,
      add: [await png("#cc33cc"), await png("#33cccc")],
    });
    const res = await mcp(writer.token, "tools/call", {
      name: "list_model_images",
      arguments: { model_id: id, include_pictures: true },
    });
    const content = res.body.result.content as { type: string; mimeType?: string; data?: string }[];
    expect(JSON.parse(content[0].text as unknown as string).pictures_shown).toBe(2);
    expect(content.slice(1).map((c) => [c.type, c.mimeType])).toEqual([
      ["image", "image/jpeg"],
      ["image", "image/jpeg"],
    ]);
    const meta = await sharp(Buffer.from(content[1].data!, "base64")).metadata();
    expect(meta.format).toBe("jpeg");

    // Without it, only the list.
    const plain = await mcp(writer.token, "tools/call", { name: "list_model_images", arguments: { model_id: id } });
    expect(plain.body.result.content).toHaveLength(1);
  });

  it("rename_model_file renames a plate, and only a plate", async () => {
    const id = await upload(writer.session, "arm.stl");
    const { data } = await callTool(writer.token, "add_model_files", {
      model_id: id,
      files: [
        { name: "arm-left.stl", base64: b64("solid l\nendsolid l\n") },
        { name: "readme.txt", base64: b64("hi") },
      ],
    });
    const byName = (name: string) => data.files.find((f: { name: string }) => f.name === name).id;
    const renamed = await callTool(writer.token, "rename_model_file", {
      model_id: id,
      file_id: byName("arm.stl"),
      name: "arm-right.stl",
    });
    expect(renamed.data).toEqual({ id: byName("arm.stl"), name: "arm-right.stl", previous_name: "arm.stl" });
    const clash = await callTool(writer.token, "rename_model_file", {
      model_id: id,
      file_id: byName("arm-left.stl"),
      name: "arm-right.stl",
    });
    expect(clash.data.name).toBe("arm-right (2).stl");
    const readme = await callTool(writer.token, "rename_model_file", {
      model_id: id,
      file_id: byName("readme.txt"),
      name: "x.txt",
    });
    expect(readme.text).toMatch(/only a plate/i);
  });

  it("delete_model deletes the user's own model, and only theirs", async () => {
    const id = await upload(writer.session, "doomed.stl");
    const result = await callTool(writer.token, "delete_model", { model_id: id });
    expect(result.data.deleted.id).toBe(id);
    expect(await prisma.print.count({ where: { id } })).toBe(0);
    expect(await prisma.plate.count({ where: { printId: id } })).toBe(0);
    expect((await callTool(writer.token, "delete_model", { model_id: id })).isError).toBe(true);
    expect((await callTool(writer.token, "delete_model", { model_id: bobSecretId })).isError).toBe(true);
    expect(await prisma.print.count({ where: { id: bobSecretId } })).toBe(1);
  });

  it("remove_from_collection takes models out, leaving them in the library", async () => {
    const id = await upload(writer.session, "shelved.stl");
    const other = await upload(writer.session, "unshelved.stl");
    const { data: collection } = await callTool(writer.token, "create_collection", { name: "To trim" });
    await callTool(writer.token, "add_to_collection", { collection_id: collection.id, model_ids: [id] });
    const result = await callTool(writer.token, "remove_from_collection", {
      collection_id: collection.id,
      model_ids: [id, other, bobSecretId],
    });
    expect(result.data.removed).toEqual([id]);
    expect(result.data.not_in_it).toEqual([other, bobSecretId]);
    expect(await prisma.collectionItem.count({ where: { collectionId: collection.id } })).toBe(0);
    expect(await prisma.print.count({ where: { id } })).toBe(1);

    const theirs = await callTool(writer.token, "remove_from_collection", {
      collection_id: bobCollectionId,
      model_ids: [id],
    });
    expect(theirs.isError).toBe(true);
    const builtIn = await callTool(writer.token, "remove_from_collection", {
      collection_id: "favorites",
      model_ids: [id],
    });
    expect(builtIn.isError).toBe(true);
  });

  it("get_import_status says when it doesn't know the import", async () => {
    const unknown = await callTool(writer.token, "get_import_status", { task_id: "no-such-task" });
    expect(unknown.isError).toBe(true);
  });
});

describe("the instance's MCP access", () => {
  const WRITE_TOOLS = ["import_model", "upload_model", "create_collection", "add_to_collection"];
  let writer: Account;

  beforeAll(async () => {
    const user = await register("access");
    writer = {
      ...user,
      token: await apiToken(user.session, { mcp_tools: [...DEFAULT_MCP_TOOL_NAMES, ...WRITE_TOOLS] }),
    };
  });

  // Instance-wide: put back the default whatever a test leaves behind.
  afterEach(() => setMcpAccess("write"));

  it("can be changed by an admin only", async () => {
    const res = await request(app).post("/api/settings/mcp").set(auth(writer.session)).send({ access: "off" });
    expect(res.status).toBe(403);
  });

  it("turned off, shuts the endpoint and the token's tool choice", async () => {
    await setMcpAccess("off");
    const res = await mcp(writer.token, "tools/list");
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/turned MCP off/i);

    const profile = await request(app).get("/api/profile/api-token").set(auth(writer.session));
    expect(profile.body.mcp_access).toBe("off");
    expect(profile.body.available_mcp_tools).toEqual([]);
    const put = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(writer.session))
      .send({ mcp_tools: DEFAULT_MCP_TOOL_NAMES });
    expect(put.status).toBe(403);
  });

  it("read only, hides the write tools without forgetting them", async () => {
    await setMcpAccess("read");
    expect(await toolNames(writer.token)).toEqual([...READ_TOOL_NAMES].toSorted());
    const call = await mcp(writer.token, "tools/call", { name: "create_collection", arguments: { name: "Nope" } });
    expect(call.body.error ?? (call.body.result?.isError ? call.body.result : null)).toBeTruthy();

    const profile = await request(app).get("/api/profile/api-token").set(auth(writer.session));
    expect(profile.body.available_mcp_tools.every((tool: { read_only: boolean }) => tool.read_only)).toBe(true);

    const refused = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(writer.session))
      .send({ mcp_tools: ["import_model"] });
    expect(refused.status).toBe(403);

    // Unticking a read tool keeps the hidden write ticks, so they come back with read and change.
    const kept = await request(app)
      .put("/api/profile/api-token/mcp-tools")
      .set(auth(writer.session))
      .send({ mcp_tools: READ_TOOL_NAMES.filter((name) => name !== "library_stats") });
    expect(kept.status).toBe(200);
    expect(kept.body.mcp_tools).toEqual(expect.arrayContaining(WRITE_TOOLS));

    await setMcpAccess("write");
    const names = await toolNames(writer.token);
    for (const tool of WRITE_TOOLS) expect(names).toContain(tool);
    expect(names).not.toContain("library_stats");
  });
});
