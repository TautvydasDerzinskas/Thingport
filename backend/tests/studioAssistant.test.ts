import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";

// config.ts reads STUDIO_ENABLED once, when it's first imported.
vi.hoisted(() => {
  process.env.STUDIO_ENABLED = "true";
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { createAiConnection } from "../src/services/aiConnectionService";
import { setAiRetryDelayForTest } from "../src/services/aiProviderClient";
import { DEFAULT_STUDIO_ASSISTANT_PREFS, setStudioAssistantPrefs } from "../src/services/settingsService";
import { MAX_STEPS } from "../src/services/studioAssistant";

// Studio's assistant end to end: the admin's switch and the AIs it offers, then runs against fake AIs that answer
// with scripted tool calls, OpenAI-style and Claude's, changing a real design through the Studio commands.

const app = createApp();
const stamp = Date.now();
const KEY = "sk-ant-test-key";

type Seen = { body: Record<string, unknown> };
type Script = (body: Record<string, unknown>, index: number) => unknown | Promise<unknown>;

let server: http.Server | null = null;
const seen: Seen[] = [];
let script: Script = () => ({});

let admin: { token: string; userId: string };
let person: { token: string; userId: string };

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function register(label: string) {
  const email = `assistant-${label}-${stamp}@example.com`;
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Assistant ${label}`, email, password: "password123" });
  return { token: res.body.token as string, userId: res.body.user.id as string, email };
}

/** A fake AI: each request is answered by the script, with { status, body } for an HTTP error. */
async function startAi(): Promise<string> {
  seen.length = 0;
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
    seen.push({ body });
    const answer = (await script(body, seen.length - 1)) as { status?: number; body?: unknown; content?: unknown[] };
    if (res.destroyed) return;
    if (body.stream && !answer.status) return streamClaude(res, answer as ClaudeMessage);
    res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.status ? answer.body : answer));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  return `http://127.0.0.1:${address.port}`;
}

type ClaudeMessage = { content: Record<string, unknown>[]; stop_reason: string } & Record<string, unknown>;

/** A Claude answer as its API streams one: each block opened, filled and closed, then how it ended. */
function streamClaude(res: http.ServerResponse, message: ClaudeMessage) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const event = (type: string, data: Record<string, unknown>) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event("message_start", { message: { ...message, content: [], stop_reason: null } });
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      event("content_block_start", { index, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else if (block.type === "thinking") {
      event("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      event("content_block_delta", { index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "tool_search_tool_result") {
      // A server tool's result comes whole.
      event("content_block_start", { index, content_block: block });
    } else {
      event("content_block_start", { index, content_block: { ...block, input: {} } });
      event("content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    event("content_block_stop", { index });
  });
  event("message_delta", {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  event("message_stop", {});
  res.end();
}

/** An OpenAI-style answer: tool calls, or text. */
function openAi(calls: { name: string; args: Record<string, unknown> }[], text = "") {
  return {
    choices: [
      {
        message: {
          content: text || null,
          tool_calls: calls.map((call, index) => ({
            id: `call_${index}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        },
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ],
  };
}

/** A Claude answer, as its Messages API gives one. */
function claude(content: unknown[], stopReason: string) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

async function offer(kind: "openai" | "anthropic", baseUrl: string) {
  const connection = await createAiConnection({
    kind,
    baseUrl: kind === "openai" ? `${baseUrl}/v1` : baseUrl,
    apiKey: kind === "anthropic" ? KEY : null,
    model: kind === "anthropic" ? "claude-haiku-5-5" : "local",
    timeoutMs: 2000,
    concurrency: 1,
    reasoningEffort: null,
  });
  await setStudioAssistantPrefs({ enabled: true, aiConnectionIds: [connection.id] });
  return connection;
}

async function newDesign(token: string): Promise<string> {
  return (await request(app).post("/api/studio/designs").set(auth(token)).send({})).body.id as string;
}

/** Prompts the assistant and waits for the run to end. */
async function ask(token: string, designId: string, prompt: string, extra: Record<string, unknown> = {}) {
  const started = await request(app)
    .post(`/api/studio/designs/${designId}/assistant`)
    .set(auth(token))
    .send({ prompt, ...extra });
  expect(started.status).toBe(202);
  return finished(token, designId);
}

async function finished(token: string, designId: string) {
  for (let i = 0; i < 300; i++) {
    const thread = await request(app).get(`/api/studio/designs/${designId}/assistant`).set(auth(token));
    if (thread.body.run && thread.body.run.status !== "running") return thread.body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The run didn't end");
}

async function documentOf(token: string, designId: string) {
  return (await request(app).get(`/api/studio/designs/${designId}`).set(auth(token))).body.document as {
    features: { id: string; type: string }[];
  };
}

beforeAll(async () => {
  const registered = await register("admin");
  await prisma.user.update({ where: { id: registered.userId }, data: { role: "ADMIN" } });
  const login = await request(app).post("/api/login").send({ email: registered.email, password: "password123" });
  admin = { token: login.body.token, userId: registered.userId };
  person = await register("person");
  setAiRetryDelayForTest(async () => undefined);
});

afterEach(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  await prisma.aiConnection.deleteMany();
  await setStudioAssistantPrefs(DEFAULT_STUDIO_ASSISTANT_PREFS);
});

afterAll(async () => {
  setAiRetryDelayForTest();
  await prisma.user.deleteMany({ where: { id: { in: [admin.userId, person.userId] } } });
});

describe("Studio's assistant", () => {
  it("is off until an admin turns it on, and offers only the AIs the admin picked", async () => {
    const designId = await newDesign(person.token);
    expect((await request(app).get("/api/studio/ai-models").set(auth(person.token))).body).toEqual({
      enabled: false,
      models: [],
    });
    const off = await request(app)
      .post(`/api/studio/designs/${designId}/assistant`)
      .set(auth(person.token))
      .send({ prompt: "Make a box" });
    expect(off.status).toBe(403);

    const url = await startAi();
    const offered = await createAiConnection({
      baseUrl: `${url}/v1`,
      apiKey: null,
      model: "offered",
      timeoutMs: 2000,
      concurrency: 1,
      reasoningEffort: null,
    });
    const hidden = await createAiConnection({
      baseUrl: `${url}/v1`,
      apiKey: null,
      model: "hidden",
      timeoutMs: 2000,
      concurrency: 1,
      reasoningEffort: null,
    });
    expect(
      (await request(app).patch("/api/settings/studio-assistant").set(auth(person.token)).send({ enabled: true }))
        .status,
    ).toBe(403);
    const saved = await request(app)
      .patch("/api/settings/studio-assistant")
      .set(auth(admin.token))
      .send({ enabled: true, ai_connection_ids: [offered.id] });
    expect(saved.body).toEqual({
      enabled: true,
      ai_connection_ids: [offered.id],
      default_ai_connection_id: offered.id,
      compact_ai_connection_ids: [],
    });

    const listed = (await request(app).get("/api/studio/ai-models").set(auth(person.token))).body;
    expect(listed).toMatchObject({ enabled: true, models: [{ id: offered.id, model: "offered", is_default: true }] });
    const notOffered = await request(app)
      .post(`/api/studio/designs/${designId}/assistant`)
      .set(auth(person.token))
      .send({ prompt: "Make a box", ai_connection_id: hidden.id });
    expect(notOffered.status).toBe(400);

    // Deleting an offered AI takes it off the list, and its default with it.
    await request(app).delete(`/api/settings/ai-connections/${offered.id}`).set(auth(admin.token));
    expect((await request(app).get("/api/settings/studio-assistant").set(auth(admin.token))).body).toMatchObject({
      ai_connection_ids: [],
      default_ai_connection_id: null,
    });
  });

  it("makes a change through the commands with an OpenAI-style AI, and remembers it for the next prompt", async () => {
    await offer("openai", await startAi());
    const designId = await newDesign(person.token);
    script = (_body, index) =>
      index === 0
        ? openAi([{ name: "studio_add_box", args: { width: 20, depth: 20, height: 20 } }])
        : openAi([], "I made a 20 mm cube.");
    const thread = await ask(person.token, designId, "Make a 20 mm cube");
    expect(thread.run).toMatchObject({
      status: "done",
      steps: [{ tool: "studio_add_box", title: "Add a box", ok: true }],
    });
    expect(thread.run.steps[0].summary).toMatch(/box-1/);
    expect(thread.messages.map((message: { role: string; text: string }) => [message.role, message.text])).toEqual([
      ["user", "Make a 20 mm cube"],
      ["assistant", "I made a 20 mm cube."],
    ]);
    expect((await documentOf(person.token, designId)).features.map((feature) => feature.id)).toEqual(["box-1"]);
    const revision = await prisma.studioRevision.findFirst({ where: { designId, command: "add_box" } });
    expect(revision?.actor).toBe("assistant");

    // What it was asked with: the guide, the design as it was, and the tools without a design id.
    const first = seen[0].body as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string; parameters: { properties: object } } }[];
    };
    expect(first.messages[0]).toMatchObject({ role: "system", content: expect.stringContaining("Thingport Studio") });
    expect(first.messages.at(-1)!.content).toMatch(/The design now \(studio_get_design\)/);
    const addBox = first.tools.find((tool) => tool.function.name === "studio_add_box")!;
    expect(addBox.function.parameters.properties).toHaveProperty("width");
    expect(addBox.function.parameters.properties).not.toHaveProperty("design_id");
    expect(first.tools.map((tool) => tool.function.name)).not.toContain("studio_delete_design");
    // Tightened: no additionalProperties, and a vector's item said once rather than three times.
    expect(JSON.stringify(first.tools)).not.toContain("additionalProperties");
    expect(addBox.function.parameters.properties).toMatchObject({
      position: { type: "array", items: { type: "number" } },
    });
    // The tool's answer went back to it.
    const second = seen[1].body as { messages: { role: string; tool_call_id?: string; content: string }[] };
    expect(second.messages.find((message) => message.role === "tool")).toMatchObject({
      tool_call_id: "call_0",
      content: expect.stringContaining("box-1"),
    });

    // The next prompt brings the conversation along.
    script = () => openAi([], "It's 20 mm on each side.");
    await ask(person.token, designId, "How big is it?");
    const followUp = seen.at(-1)!.body as { messages: { role: string; content: string }[] };
    expect(followUp.messages.map((message) => message.content)).toEqual(
      expect.arrayContaining(["Make a 20 mm cube", expect.stringContaining("I made a 20 mm cube.")]),
    );
    expect(followUp.messages.find((message) => message.content?.startsWith("I made"))?.content).toMatch(/Steps taken/);

    // Cleared, the conversation is gone; the cube stays.
    expect(
      (await request(app).delete(`/api/studio/designs/${designId}/assistant`).set(auth(person.token))).status,
    ).toBe(204);
    expect((await request(app).get(`/api/studio/designs/${designId}/assistant`).set(auth(person.token))).body).toEqual({
      messages: [],
      run: null,
    });
    // Someone else's design isn't theirs to prompt about.
    expect(
      (
        await request(app)
          .post(`/api/studio/designs/${designId}/assistant`)
          .set(auth(admin.token))
          .send({ prompt: "Hi" })
      ).status,
    ).toBe(404);
  });

  it("works with Claude: finds its tools by search, caches the prompt, and hands its own blocks back as they came", async () => {
    await offer("anthropic", await startAi());
    const designId = await newDesign(person.token);
    script = (_body, index) =>
      index === 0
        ? claude(
            [
              { type: "thinking", thinking: "", signature: "sig-1" },
              {
                type: "server_tool_use",
                id: "srvtoolu_1",
                name: "tool_search_tool_bm25",
                input: { query: "add a sphere" },
              },
              {
                type: "tool_search_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                  type: "tool_search_tool_search_result",
                  tool_references: [{ type: "tool_reference", tool_name: "studio_add_sphere" }],
                },
              },
              { type: "tool_use", id: "toolu_1", name: "studio_add_sphere", input: { radius: 5 } },
            ],
            "tool_use",
          )
        : index === 1
          ? claude([{ type: "text", text: "Checking it." }], "pause_turn")
          : claude([{ type: "text", text: "I added a 10 mm ball." }], "end_turn");
    const thread = await ask(person.token, designId, "Add a ball", { selected: ["box-9"] });
    expect(thread.run).toMatchObject({ status: "done", steps: [{ tool: "studio_add_sphere", ok: true }] });
    expect((await documentOf(person.token, designId)).features.map((feature) => feature.type)).toEqual(["sphere"]);

    // Asked with tool search: the core tools loaded, the rest deferred; the instructions and the conversation cached.
    type ClaudeTool = { type?: string; name: string; defer_loading?: boolean; input_schema?: { type: string } };
    const first = seen[0].body as {
      system: { type: string; text: string; cache_control?: unknown }[];
      cache_control?: unknown;
      tools: ClaudeTool[];
      messages: { content: string }[];
    };
    expect(first.tools[0]).toEqual({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" });
    const byName = (name: string) => first.tools.find((tool) => tool.name === name)!;
    expect(byName("studio_add_box").defer_loading).toBeUndefined();
    expect(byName("studio_get_design").defer_loading).toBeUndefined();
    expect(byName("studio_add_sphere")).toMatchObject({ defer_loading: true, input_schema: { type: "object" } });
    expect(byName("studio_fillet").defer_loading).toBe(true);
    expect(first.system).toEqual([
      { type: "text", text: expect.stringContaining("Search for the rest"), cache_control: { type: "ephemeral" } },
    ]);
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.messages[0].content).toMatch(/Selected in the view: box-9/);

    // Its answer went back whole, search and thinking included; a result only for the tool Thingport ran.
    const second = seen[1].body as {
      messages: { role: string; content: { type: string; signature?: string; tool_use_id?: string }[] }[];
    };
    expect(second.messages[1].content.map((block) => block.type)).toEqual([
      "thinking",
      "server_tool_use",
      "tool_search_tool_result",
      "tool_use",
    ]);
    expect(second.messages[1].content[0]).toMatchObject({ signature: "sig-1" });
    expect(second.messages[2].content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" }),
    ]);
    // A paused turn is asked again as it is, with nothing added.
    const third = seen[2].body as { messages: { role: string }[] };
    expect(third.messages.at(-1)).toMatchObject({ role: "assistant" });
    expect(third.messages).toHaveLength(second.messages.length + 1);
  });

  it("sends Claude every tool when it can't search for them", async () => {
    await offer("anthropic", await startAi());
    const designId = await newDesign(person.token);
    script = (_body, index) =>
      index === 0
        ? {
            status: 400,
            body: {
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "tools.0: tool_search_tool_bm25_20251119 is not supported for this model",
              },
            },
          }
        : claude([{ type: "text", text: "Nothing to do." }], "end_turn");
    const thread = await ask(person.token, designId, "Hello");
    expect(thread.run.status).toBe("done");
    const retried = seen[1].body as { tools: { type?: string; defer_loading?: boolean }[] };
    expect(retried.tools.some((tool) => tool.type?.startsWith("tool_search"))).toBe(false);
    expect(retried.tools.some((tool) => tool.defer_loading)).toBe(false);
  });

  it("gives a small local model the compact tool set, with short instructions", async () => {
    const connection = await offer("openai", await startAi());
    await setStudioAssistantPrefs({ compactAiConnectionIds: [connection.id] });
    const designId = await newDesign(person.token);
    script = (_body, index) =>
      index === 0
        ? openAi([{ name: "studio_add_box", args: { width: 20, depth: 20, height: 20 } }])
        : openAi([], "Made a cube.");
    const thread = await ask(person.token, designId, "Make a cube");
    expect(thread.run).toMatchObject({ status: "done", steps: [{ tool: "studio_add_box", ok: true }] });
    const body = seen[0].body as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string; description: string; parameters: object } }[];
    };
    const names = body.tools.map((tool) => tool.function.name);
    expect(names).toContain("studio_add_box");
    expect(names).not.toContain("studio_fillet");
    expect(names.length).toBeLessThanOrEqual(14);
    // Its arguments named, not described: the tool's own line says what they are.
    expect(JSON.stringify(body.tools)).not.toMatch(/"properties":\{[^}]*"description"/);
    expect(body.messages[0].content).toMatch(/^You build and change 3D-printable parts/);
    // About a fifth of the full prompt's size.
    const size = JSON.stringify(body.tools).length + body.messages[0].content.length;
    expect(size).toBeLessThan(12_000);
  });

  it("guesses which new AIs see pictures from their model's name", async () => {
    const base = {
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: null,
      timeoutMs: 2000,
      concurrency: 1,
      reasoningEffort: null,
    };
    expect((await createAiConnection({ ...base, model: "gpt-4o-mini" })).vision).toBe(true);
    expect((await createAiConnection({ ...base, model: "qwen2.5vl:7b" })).vision).toBe(true);
    expect((await createAiConnection({ ...base, model: "qwen3:8b" })).vision).toBe(false);
    expect((await createAiConnection({ ...base, model: "qwen3:8b", vision: true })).vision).toBe(true);
  });

  it("sends a prompt's pictures to an AI that sees them, and only to one", async () => {
    const connection = await offer("openai", await startAi());
    const designId = await newDesign(person.token);
    const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#ffffff" } })
      .composite([
        {
          input: await sharp({ create: { width: 60, height: 40, channels: 4, background: "#000000" } })
            .png()
            .toBuffer(),
          left: 30,
          top: 20,
        },
      ])
      .png()
      .toBuffer();
    const picture = (
      await request(app)
        .post(`/api/studio/designs/${designId}/pictures`)
        .set(auth(person.token))
        .set("Content-Type", "image/png")
        .send(png)
    ).body as { id: string };
    // "local" says nothing of pictures, so it's taken not to see them.
    const refused = await request(app)
      .post(`/api/studio/designs/${designId}/assistant`)
      .set(auth(person.token))
      .send({ prompt: "Make this", pictures: [picture.id] });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("studio_assistant_no_vision");

    await prisma.aiConnection.update({ where: { id: connection.id }, data: { vision: true } });
    script = (_body, index) =>
      index === 0
        ? openAi([
            { name: "studio_trace_picture", args: { picture_id: picture.id, width: 30, height: 2, plane: "XY" } },
          ])
        : openAi([], "Traced the rectangle and made it 2 mm thick.");
    const thread = await ask(person.token, designId, "Make this a plaque", { pictures: [picture.id] });
    expect(thread.run).toMatchObject({ status: "done", steps: [{ tool: "studio_trace_picture", ok: true }] });
    const sent = (seen[0].body as { messages: { role: string; content: unknown }[] }).messages.at(-1)!;
    const parts = sent.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0].type).toBe("image_url");
    expect(parts[0].image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(parts.at(-1)!.text).toContain(picture.id);
    expect(thread.messages[0]).toMatchObject({ role: "user", pictures: [{ id: picture.id, width: 120, height: 80 }] });
    const doc = await documentOf(person.token, designId);
    expect(doc.features.map((feature) => feature.type)).toEqual(["sketch", "extrude"]);

    // The next prompt, with none of its own, still has the picture to look at.
    script = () => openAi([], "Done.");
    await ask(person.token, designId, "Make it look more like the picture");
    const history = (seen.at(-1)!.body as { messages: { role: string; content: unknown }[] }).messages;
    const earlier = history.find((message) => message.role === "user" && Array.isArray(message.content));
    expect(earlier).toBeDefined();
  });

  it("tells the AI what went wrong with a step, and lets it carry on", async () => {
    await offer("openai", await startAi());
    const designId = await newDesign(person.token);
    script = (_body, index) =>
      index === 0
        ? openAi([
            { name: "studio_add_box", args: { width: "wide" } },
            { name: "studio_make_coffee", args: {} },
          ])
        : openAi([], "That didn't work.");
    const thread = await ask(person.token, designId, "Make a box");
    expect(thread.run.steps.map((step: { ok: boolean }) => step.ok)).toEqual([false, false]);
    const results = (seen[1].body as { messages: { role: string; content: string }[] }).messages.filter(
      (message) => message.role === "tool",
    );
    expect(results.map((result) => result.content)).toEqual([
      expect.stringMatching(/Invalid arguments: width/),
      "There's no tool called studio_make_coffee.",
    ]);
  });

  it("stops when asked, takes one prompt at a time, and stops itself at the step limit", async () => {
    await offer("openai", await startAi());
    const designId = await newDesign(person.token);
    let release = () => {};
    script = () => new Promise((resolve) => (release = () => resolve(openAi([], "late"))));
    const started = await request(app)
      .post(`/api/studio/designs/${designId}/assistant`)
      .set(auth(person.token))
      .send({ prompt: "Take your time" });
    expect(started.status).toBe(202);
    const busy = await request(app)
      .post(`/api/studio/designs/${designId}/assistant`)
      .set(auth(person.token))
      .send({ prompt: "And another" });
    expect(busy.status).toBe(409);
    await request(app).post(`/api/studio/designs/${designId}/assistant/stop`).set(auth(person.token));
    const stopped = await finished(person.token, designId);
    release();
    expect(stopped.run.status).toBe("stopped");
    expect(stopped.messages.at(-1)).toMatchObject({ role: "assistant", outcome: "stopped" });

    // An AI that never stops calling tools.
    script = () => openAi([{ name: "studio_nothing_here", args: {} }]);
    const limited = await ask(person.token, designId, "Keep going");
    expect(limited.run.status).toBe("limit");
    expect(limited.run.steps).toHaveLength(MAX_STEPS);
  });

  it("says plainly when the AI can't use tools", async () => {
    await offer("openai", await startAi());
    const designId = await newDesign(person.token);
    script = () => ({ status: 400, body: { error: "registry.ollama.ai/library/tiny does not support tools" } });
    const thread = await ask(person.token, designId, "Make a box");
    expect(thread.run).toMatchObject({ status: "failed", error: expect.stringMatching(/can't use tools/) });
    expect(thread.messages.at(-1)).toMatchObject({
      outcome: "failed",
      error: expect.stringMatching(/can't use tools/),
    });
  });
});
