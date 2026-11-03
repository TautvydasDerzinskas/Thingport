import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import {
  DEFAULT_AI_CATEGORIZATION_PREFS,
  DEFAULT_AI_DESCRIPTION_PREFS,
  setAiCategorizationPrefs,
  setAiDescriptionPrefs,
} from "../src/services/settingsService";
import { createAiConnection } from "../src/services/aiConnectionService";
import { setAiRetryDelayForTest } from "../src/services/aiProviderClient";
import { categorizePrint } from "../src/services/aiCategorizationService";
import { improvePrintDescription } from "../src/services/aiDescriptionService";
import { claudeContent, claudeSchema } from "../src/services/aiAnthropicClient";

// Claude as an AI: Anthropic's own Messages and Models APIs, faked here as they answer, behind the same features an
// OpenAI-style AI serves.

const app = createApp();
const stamp = Date.now();
const KEY = "sk-ant-test-key";

type Reply =
  | { text: string; stop_reason?: string; stop_details?: unknown }
  | { status: number; message: string; headers?: Record<string, string> };
type Seen = { path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> };

let claude: http.Server | null = null;
let openai: http.Server | null = null;
const seen: Seen[] = [];
let openaiRequests = 0;
let reply: (body: Record<string, unknown>, index: number) => Reply = () => ({ text: "{}" });
const MODEL_PAGES = [
  { data: [{ id: "claude-sonnet-5-5", type: "model" }], has_more: true, first_id: "a", last_id: "claude-sonnet-5-5" },
  { data: [{ id: "claude-haiku-5-5", type: "model" }], has_more: false, first_id: "b", last_id: "claude-haiku-5-5" },
];

let adminToken: string;
let adminId: string;

function auth(token = adminToken) {
  return { Authorization: `Bearer ${token}` };
}

/** The question's text, whatever blocks are around it. */
function promptOf(body: Record<string, unknown>): string {
  const content = (body.messages as { content: string | { type: string; text?: string }[] }[])[0].content;
  return typeof content === "string" ? content : content.flatMap((part) => (part.text ? [part.text] : [])).join("\n");
}

/** A categorization answer picking the candidate listed under this name. */
function picking(body: Record<string, unknown>, name: string): string {
  const category = promptOf(body)
    .split("\n")
    .find((line) => line.startsWith(name));
  return JSON.stringify({ reason: `It is a ${name.toLowerCase()} piece`, category: category ?? null, confidence: 0.9 });
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  return `http://127.0.0.1:${address.port}`;
}

/** Anthropic's API as it answers: messages in one piece or as server-sent events, models a page at a time. */
async function startClaude(): Promise<string> {
  seen.length = 0;
  claude = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const url = new URL(req.url ?? "/", "http://claude");
    seen.push({ path: url.pathname, headers: req.headers, body });
    if (req.headers["x-api-key"] !== KEY && req.headers.authorization !== `Bearer ${KEY}`)
      return send(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    if (url.pathname === "/v1/models") {
      const after = url.searchParams.get("after_id");
      return send(res, 200, MODEL_PAGES[after ? MODEL_PAGES.findIndex((page) => page.last_id === after) + 1 : 0]);
    }
    if (url.pathname !== "/v1/messages")
      return send(res, 404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
    const answer = reply(body, seen.filter((each) => each.path === "/v1/messages").length - 1);
    if ("status" in answer)
      return send(
        res,
        answer.status,
        { type: "error", error: { type: "api_error", message: answer.message } },
        answer.headers,
      );
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: answer.text }],
      stop_reason: answer.stop_reason ?? "end_turn",
      stop_sequence: null,
      stop_details: answer.stop_details ?? null,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    if (!body.stream) return send(res, 200, message);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const event = (type: string, data: Record<string, unknown>) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event("message_start", { message: { ...message, content: [], stop_reason: null } });
    event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    const third = Math.max(1, Math.ceil(answer.text.length / 3));
    for (let start = 0; start < answer.text.length; start += third)
      event("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: answer.text.slice(start, start + third) },
      });
    event("content_block_stop", { index: 0 });
    event("message_delta", {
      delta: { stop_reason: message.stop_reason, stop_sequence: null, stop_details: message.stop_details },
      usage: { output_tokens: 20 },
    });
    event("message_stop", {});
    res.end();
  });
  return listen(claude);
}

/** An OpenAI-style AI that always picks the "Gadget" category. */
async function startOpenAi(): Promise<string> {
  openaiRequests = 0;
  openai = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    openaiRequests++;
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    send(res, 200, { choices: [{ message: { content: picking(body, "Gadget") }, finish_reason: "stop" }] });
  });
  return `${await listen(openai)}/v1`;
}

async function stop(server: http.Server | null) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function claudeConnection(baseUrl: string, patch: { model?: string; reasoningEffort?: "low" | "medium" } = {}) {
  return createAiConnection({
    kind: "anthropic",
    baseUrl,
    apiKey: KEY,
    model: patch.model ?? "claude-haiku-5-5",
    timeoutMs: 2000,
    concurrency: 1,
    reasoningEffort: patch.reasoningEffort ?? null,
  });
}

/** A model with a description, in a library with Gadget and Calibration categories. */
async function modelWithCategories() {
  for (const name of ["Gadget", "Calibration"])
    await prisma.category.create({
      data: { userId: adminId, name: `${name} ${stamp}-${Math.random()}`, kind: "category" },
    });
  const name = `Claude cube ${stamp}-${Math.random()}`;
  return prisma.print.create({
    data: {
      userId: adminId,
      name,
      nameNormalized: name.toLowerCase(),
      notes: "A calibration cube. Follow me on Patreon for more!",
    },
  });
}

beforeAll(async () => {
  const email = `ai-claude-${stamp}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "AI Claude", email, password: "password123" });
  adminId = registered.body.user.id;
  await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
  adminToken = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
  setAiRetryDelayForTest(async () => undefined);
});

afterEach(async () => {
  await stop(claude);
  await stop(openai);
  claude = null;
  openai = null;
  await prisma.aiConnection.deleteMany();
  await setAiCategorizationPrefs(DEFAULT_AI_CATEGORIZATION_PREFS);
  await setAiDescriptionPrefs(DEFAULT_AI_DESCRIPTION_PREFS);
});

afterAll(async () => {
  setAiRetryDelayForTest();
  await prisma.print.deleteMany({ where: { userId: adminId } });
  await prisma.category.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
});

describe("Claude as an AI", () => {
  it("is saved once it answers, without /v1 on its URL, and lists the models its key may use", async () => {
    const url = await startClaude();
    reply = (body) => ({ text: picking(body, "Calibration") });
    const keyless = await request(app)
      .post("/api/settings/ai-connections")
      .set(auth())
      .send({ kind: "anthropic", base_url: url, model: "claude-haiku-5-5" });
    expect(keyless.status).toBe(422);
    expect(keyless.body.detail).toMatch(/needs an API key/);

    const created = await request(app)
      .post("/api/settings/ai-connections")
      .set(auth())
      .send({
        kind: "anthropic",
        base_url: `${url}/v1/`,
        model: "claude-haiku-5-5",
        api_key: KEY,
        reasoning_effort: "low",
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: "anthropic", base_url: url, has_api_key: true, is_default: true });

    // The test question, as Claude's own API takes it.
    const asked = seen.find((each) => each.path === "/v1/messages")!;
    expect(asked.headers["anthropic-version"]).toBeTruthy();
    expect(asked.body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1024 + 4096,
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(asked.body.temperature).toBeUndefined();
    // Not Anthropic's own host, so no server-side fallback is asked for.
    expect(asked.body.fallbacks).toBeUndefined();
    const schema = JSON.stringify((asked.body.output_config as { format: { schema: unknown } }).format.schema);
    expect(schema).not.toMatch(/maxLength|minimum|maximum/);

    const listed = await request(app)
      .post("/api/settings/ai-connections/models")
      .set(auth())
      .send({ id: created.body.id });
    expect(listed.body).toEqual({ ok: true, models: ["claude-haiku-5-5", "claude-sonnet-5-5"] });
    const wrongKey = await request(app)
      .post("/api/settings/ai-connections/models")
      .set(auth())
      .send({ kind: "anthropic", base_url: url, api_key: "sk-ant-wrong" });
    expect(wrongKey.body).toEqual({ ok: false, error: "Claude rejected the API key (HTTP 401)" });
  });

  it("categorizes with Claude, and rewrites a description with it while categorization uses another AI", async () => {
    const url = await startClaude();
    const print = await modelWithCategories();
    const connection = await claudeConnection(url, { reasoningEffort: "medium" });
    reply = (body) => ({ text: picking(body, "Calibration") });
    await setAiCategorizationPrefs({ ...DEFAULT_AI_CATEGORIZATION_PREFS, enabled: true, onImport: false });
    expect(await categorizePrint(adminId, print.id)).toBe("suggested");
    const suggested = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    const calibration = await prisma.category.findUniqueOrThrow({
      where: { id: (suggested.aiSuggestion as { categoryId: string }).categoryId },
    });
    expect(calibration.name).toMatch(/^Calibration/);

    // Categorization moves to an OpenAI-style AI; descriptions stay on Claude, which streams the long answer.
    const other = await createAiConnection({
      baseUrl: await startOpenAi(),
      apiKey: null,
      model: "local",
      timeoutMs: 2000,
      concurrency: 1,
      reasoningEffort: null,
    });
    await setAiCategorizationPrefs({ aiConnectionId: other.id });
    await setAiDescriptionPrefs({
      ...DEFAULT_AI_DESCRIPTION_PREFS,
      enabled: true,
      onImport: false,
      aiConnectionId: connection.id,
    });
    reply = () => ({ text: JSON.stringify({ changed: true, description: "A calibration cube." }) });
    const before = seen.length;
    expect(await improvePrintDescription(adminId, print.id, { force: true })).toBe("suggested");
    expect(await categorizePrint(adminId, print.id, { force: true })).toBe("suggested");
    expect(openaiRequests).toBe(1);
    const rewrites = seen.slice(before).filter((each) => each.path === "/v1/messages");
    expect(rewrites).toHaveLength(1);
    expect(rewrites[0].body).toMatchObject({ stream: true, output_config: { effort: "medium" } });
    const rewritten = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect((rewritten.aiDescriptionSuggestion as { notes?: string }).notes).toBe("A calibration cube.");
    const gadget = await prisma.category.findUniqueOrThrow({
      where: { id: (rewritten.aiSuggestion as { categoryId: string }).categoryId },
    });
    expect(gadget.name).toMatch(/^Gadget/);
  });

  it("retries what a retry can fix, and asks an older model again without what it doesn't take", async () => {
    const url = await startClaude();
    const print = await modelWithCategories();
    await claudeConnection(url, { model: "claude-haiku-4-5", reasoningEffort: "medium" });
    await setAiCategorizationPrefs({ ...DEFAULT_AI_CATEGORIZATION_PREFS, enabled: true, onImport: false });
    const replies: Reply[] = [
      { status: 400, message: "output_config.effort: This model does not support the effort parameter." },
      { status: 400, message: "output_config.format: structured outputs are not supported on this model." },
      { status: 529, message: "Overloaded" },
      { status: 429, message: "Rate limited", headers: { "retry-after": "2" } },
    ];
    reply = (body, index) => replies[index] ?? { text: `Here it is: ${picking(body, "Calibration")}` };
    expect(await categorizePrint(adminId, print.id)).toBe("suggested");
    const bodies = seen.filter((each) => each.path === "/v1/messages").map((each) => each.body);
    expect(bodies).toHaveLength(5);
    expect(bodies[0].output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(bodies[1].output_config).toEqual({ format: expect.objectContaining({ type: "json_schema" }) });
    // Without structured outputs the schema is in the question, and the answer is found in the prose around it.
    expect(bodies[4].output_config).toBeUndefined();
    expect(promptOf(bodies[4])).toMatch(/Answer with only a JSON object that follows this JSON schema/);
  });

  it("says why it couldn't answer: a refusal, a cut-off answer, a key it rejects", async () => {
    const url = await startClaude();
    const print = await modelWithCategories();
    await claudeConnection(url);
    await setAiCategorizationPrefs({ ...DEFAULT_AI_CATEGORIZATION_PREFS, enabled: true, onImport: false });
    reply = () => ({
      text: "",
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: null },
    });
    await expect(categorizePrint(adminId, print.id)).rejects.toThrow("Claude declined to answer (cyber)");
    reply = () => ({ text: '{"reason": "It is', stop_reason: "max_tokens" });
    await expect(categorizePrint(adminId, print.id)).rejects.toThrow(/cut the answer off/);
    const asked = seen.length;
    reply = () => ({ status: 401, message: "invalid x-api-key" });
    await expect(categorizePrint(adminId, print.id)).rejects.toThrow("Claude rejected the API key (HTTP 401)");
    // Neither a refusal nor a rejected key is asked again.
    expect(seen.length - asked).toBe(1);
  });

  it("sends the preview image first, and leaves out the schema keywords Claude doesn't take", () => {
    expect(
      claudeContent([
        { type: "text", text: "What is it?" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ]),
    ).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "text", text: "What is it?" },
    ]);
    expect(
      claudeSchema({
        type: "object",
        additionalProperties: false,
        properties: {
          maximum: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", maxLength: 300, enum: ["a", "b"] },
        },
        required: ["maximum", "reason"],
      }),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { maximum: { type: "number" }, reason: { type: "string", enum: ["a", "b"] } },
      required: ["maximum", "reason"],
    });
  });
});
