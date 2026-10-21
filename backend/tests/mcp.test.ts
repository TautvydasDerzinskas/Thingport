import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_MCP_TOOL_NAMES, MCP_TOOLS, mcpImportTiming } from "../src/mcp/tools";
import { setMcpAccess } from "../src/services/settingsService";

// /api/mcp end to end: who gets in, which tools each token sees, and that every tool only ever
// reads the token owner's own library.

const app = createApp();

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
  it("gives a new token every read-only tool, all marked read-only", async () => {
    expect(await toolNames(alice.token)).toEqual([...DEFAULT_MCP_TOOL_NAMES].toSorted());
    const res = await mcp(alice.token, "tools/list");
    for (const tool of res.body.result.tools) expect(tool.annotations.readOnlyHint).toBe(true);
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
    // A write tool must not slip into the default set.
    for (const tool of MCP_TOOLS) expect(typeof tool.readOnly).toBe("boolean");
    expect(DEFAULT_MCP_TOOL_NAMES.every((name) => MCP_TOOLS.find((t) => t.name === name)?.readOnly)).toBe(true);
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

  it("get_author says not found for an unknown author", async () => {
    const result = await callTool(alice.token, "get_author", { id: "no-such-author" });
    expect(result.isError).toBe(true);
  });
});

describe("the tools that write", () => {
  const WRITE_TOOLS = ["import_model", "create_collection", "add_to_collection"];
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
      expect(tool.annotations.destructiveHint).toBe(false);
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

  it("get_import_status says when it doesn't know the import", async () => {
    const unknown = await callTool(writer.token, "get_import_status", { task_id: "no-such-task" });
    expect(unknown.isError).toBe(true);
  });
});

describe("the instance's MCP access", () => {
  const WRITE_TOOLS = ["import_model", "create_collection", "add_to_collection"];
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
    expect(await toolNames(writer.token)).toEqual([...DEFAULT_MCP_TOOL_NAMES].toSorted());
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
      .send({ mcp_tools: DEFAULT_MCP_TOOL_NAMES.filter((name) => name !== "library_stats") });
    expect(kept.status).toBe(200);
    expect(kept.body.mcp_tools).toEqual(expect.arrayContaining(WRITE_TOOLS));

    await setMcpAccess("write");
    const names = await toolNames(writer.token);
    for (const tool of WRITE_TOOLS) expect(names).toContain(tool);
    expect(names).not.toContain("library_stats");
  });
});
