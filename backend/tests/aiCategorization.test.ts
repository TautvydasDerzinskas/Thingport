import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_AI_CATEGORIZATION_SETTINGS, setAiCategorizationSettings } from "../src/services/settingsService";
import { aiCategoryPaths, setAiCategorizationRetryDelayForTest } from "../src/services/aiCategorizationService";

const app = createApp();
const stamp = Date.now();
const STL = "solid test\nendsolid test";
let token: string;
let userId: string;
let userNumber = 0;
let printNumber = 0;
let categoryNumber = 0;
const createdPrints: string[] = [];
const createdCategories: string[] = [];
const createdUsers: string[] = [];
let provider: http.Server | null = null;
let providerRequests = 0;
let providerInFlight = 0;
let providerMaxInFlight = 0;

type ProviderAnswer = { category_id: string | null; confidence: number; reason: string };
type ProviderReply =
  | ProviderAnswer
  | {
      status: number;
      headers?: Record<string, string>;
      content?: ProviderAnswer | string;
      finishReason?: string;
      usage?: Record<string, unknown>;
      never?: boolean;
    };
type ProviderHandler = (body: Record<string, unknown>) => ProviderReply | Promise<ProviderReply>;

type User = { id: string; token: string };

function auth(value = token) {
  return { Authorization: `Bearer ${value}` };
}

function isAnswer(reply: ProviderReply): reply is ProviderAnswer {
  return "category_id" in reply;
}

function promptText(body: Record<string, unknown>): string {
  return (body.messages as { content: { text: string }[] }[])[0].content[0].text;
}

// Handlers answer with real category ids for readability; the provider answers with a candidate's path, so
// translate an id into the path the prompt lists. An id the prompt doesn't list becomes a path that isn't there.
async function candidatePath(body: Record<string, unknown>, categoryId: string): Promise<string> {
  const row = await prisma.category.findUnique({ where: { id: categoryId } });
  const path = row ? (await aiCategoryPaths(row.userId)).get(categoryId) : undefined;
  const listed = path !== undefined && promptText(body).split("\n").includes(path);
  return listed ? path : "Not a candidate";
}

async function toProviderJson(body: Record<string, unknown>, answer: ProviderAnswer) {
  const { category_id: categoryId, ...rest } = answer;
  return { category: categoryId === null ? null : await candidatePath(body, categoryId), ...rest };
}

async function toProviderText(body: Record<string, unknown>, text: string): Promise<string> {
  let out = text.replace(/"category_id":null/g, '"category":null');
  for (const [match, categoryId] of text.matchAll(/"category_id":"([^"]+)"/g)) {
    out = out.replace(match, `"category":${JSON.stringify(await candidatePath(body, categoryId))}`);
  }
  return out;
}

async function startProvider(handler: ProviderHandler) {
  providerRequests = 0;
  providerInFlight = 0;
  providerMaxInFlight = 0;
  await new Promise<void>((resolve) => {
    provider = http.createServer(async (req, res) => {
      providerRequests++;
      providerInFlight++;
      providerMaxInFlight = Math.max(providerMaxInFlight, providerInFlight);
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        const reply = await handler(body);
        if (!isAnswer(reply) && reply.never) return;
        const status = isAnswer(reply) ? 200 : reply.status;
        const headers = isAnswer(reply) ? {} : reply.headers || {};
        const content = isAnswer(reply)
          ? reply
          : (reply.content ?? { category_id: null, confidence: 1, reason: "none" });
        res.writeHead(status, { "content-type": "application/json", ...headers });
        const text =
          typeof content === "string"
            ? await toProviderText(body, content)
            : JSON.stringify(await toProviderJson(body, content));
        const finishReason = isAnswer(reply) ? "stop" : (reply.finishReason ?? "stop");
        const usage = isAnswer(reply) ? undefined : reply.usage;
        res.end(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: finishReason }], usage }));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "provider failed" }));
      } finally {
        providerInFlight--;
      }
    });
    provider.listen(0, "127.0.0.1", resolve);
  });
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Provider did not bind a TCP port");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function stopProvider() {
  if (!provider) return;
  provider.closeAllConnections?.();
  await new Promise<void>((resolve) => provider!.close(() => resolve()));
  provider = null;
}

// What the models manager sends; by default only uncategorized models, as before folders and manual ones could be picked.
function runScope(include: Partial<Record<"uncategorized" | "folders" | "ai" | "rule" | "manual", boolean>> = {}) {
  const scope = { uncategorized: true, folders: false, ai: false, rule: false, manual: false, ...include };
  return Object.fromEntries(Object.entries(scope).map(([key, value]) => [`include_${key}`, value]));
}

async function enable(baseUrl: string, patch: Partial<typeof DEFAULT_AI_CATEGORIZATION_SETTINGS> = {}) {
  await setAiCategorizationSettings({
    mode: "suggest",
    baseUrl,
    apiKey: null,
    model: "local",
    threshold: 0.8,
    onImport: false,
    concurrency: 1,
    sendImage: false,
    timeoutMs: 1000,
    ...patch,
  });
}

async function categoryFor(ownerId: string, name: string, kind = "category") {
  // Unique, so a test's answer maps to exactly one candidate path in the prompt.
  const row = await prisma.category.create({ data: { userId: ownerId, name: `${name} ${categoryNumber++}`, kind } });
  createdCategories.push(row.id);
  return row;
}

async function category(name: string, kind = "category") {
  return categoryFor(userId, name, kind);
}

async function printFor(
  ownerId: string,
  categoryId: string | null = null,
  categorySource: "MANUAL" | "RULE" | "AI" | "LEGACY" | null = null,
  patch: { name?: string; title?: string; notes?: string } = {},
) {
  const name = patch.name ?? `Model ${printNumber++}`;
  const row = await prisma.print.create({
    data: {
      userId: ownerId,
      name,
      nameNormalized: name.toLowerCase(),
      title: patch.title ?? null,
      notes: patch.notes ?? null,
      categoryId,
      categorySource,
    },
  });
  createdPrints.push(row.id);
  return row;
}

async function print(
  categoryId: string | null = null,
  categorySource: "MANUAL" | "RULE" | "AI" | "LEGACY" | null = null,
  patch: { name?: string; title?: string; notes?: string } = {},
) {
  return printFor(userId, categoryId, categorySource, patch);
}

async function newUser(): Promise<User> {
  const email = `ai-categorization-${stamp}-${userNumber++}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: `AI categorization ${userNumber}`, email, password: "password123" });
  createdUsers.push(registered.body.user.id);
  return { id: registered.body.user.id, token: registered.body.token };
}

async function waitForRun(value: string) {
  for (let i = 0; i < 100; i++) {
    const response = await request(app).get("/api/ai-categorization/run").set(auth(value));
    if (!response.body.run?.running) return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("AI categorization run did not finish");
}

async function waitFor(check: () => boolean | Promise<boolean>, message: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

beforeAll(async () => {
  const email = `ai-categorization-${stamp}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "AI categorization", email, password: "password123" });
  token = registered.body.token;
  userId = registered.body.user.id;
  await prisma.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
  token = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
});

afterEach(async () => {
  setAiCategorizationRetryDelayForTest();
  await stopProvider();
  await setAiCategorizationSettings(DEFAULT_AI_CATEGORIZATION_SETTINGS);
});

afterAll(async () => {
  await prisma.print.deleteMany({ where: { id: { in: createdPrints } } });
  await prisma.category.deleteMany({ where: { id: { in: createdCategories } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, ...createdUsers] } } });
});

describe("AI categorization", () => {
  it("keeps API keys write-only and exposes legacy category provenance", async () => {
    const baseUrl = await startProvider(() => ({ category_id: null, confidence: 1, reason: "none" }));
    const patched = await request(app)
      .patch("/api/settings/ai-categorization")
      .set(auth())
      .send({ mode: "auto", base_url: baseUrl, model: "local-model", api_key: "private-key" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ mode: "auto", has_api_key: true });
    expect(JSON.stringify(patched.body)).not.toContain("private-key");
    const read = await request(app).get("/api/settings/ai-categorization").set(auth());
    expect(read.body).toMatchObject({ has_api_key: true, base_url: baseUrl, model: "local-model" });
    expect(JSON.stringify(read.body)).not.toContain("private-key");

    const legacyCategory = await category("Legacy");
    const legacy = await print(legacyCategory.id, "LEGACY");
    const detail = await request(app).get(`/api/print/${legacy.id}`).set(auth());
    expect(detail.body.category_source).toBe("legacy");
  });

  it("saves a connection only after it answers, and tests unsaved values", async () => {
    await setAiCategorizationSettings(DEFAULT_AI_CATEGORIZATION_SETTINGS);
    const deadUrl = await startProvider(() => ({ category_id: null, confidence: 1, reason: "none" }));
    await stopProvider();
    const tested = await request(app)
      .post("/api/settings/ai-categorization/test")
      .set(auth())
      .send({ base_url: deadUrl, model: "local-model", timeout_ms: 1000 });
    expect(tested.body).toMatchObject({ ok: false, error: expect.stringContaining("Could not reach the AI provider") });
    const refused = await request(app)
      .patch("/api/settings/ai-categorization")
      .set(auth())
      .send({ base_url: deadUrl, model: "local-model", timeout_ms: 1000 });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe("ai_connection_failed");
    const unchanged = await request(app).get("/api/settings/ai-categorization").set(auth());
    expect(unchanged.body.base_url).toBeNull();

    // A test makes one attempt rather than retrying a failing provider.
    const failingUrl = await startProvider(() => ({ status: 500 }));
    const failing = await request(app)
      .post("/api/settings/ai-categorization/test")
      .set(auth())
      .send({ base_url: failingUrl, model: "local-model" });
    expect(failing.body).toMatchObject({ ok: false, error: "AI provider returned HTTP 500" });
    expect(providerRequests).toBe(1);
    await stopProvider();

    const liveUrl = await startProvider(() => ({ category_id: null, confidence: 1, reason: "none" }));
    const draft = await request(app)
      .post("/api/settings/ai-categorization/test")
      .set(auth())
      .send({ base_url: liveUrl, model: "local-model" });
    expect(draft.body).toMatchObject({ ok: true, model: "local-model" });
    // A bare origin gets /v1 added, as Ollama and most local servers need.
    const saved = await request(app)
      .patch("/api/settings/ai-categorization")
      .set(auth())
      .send({ base_url: liveUrl.replace(/\/v1$/, "/"), model: "local-model" });
    expect(saved.status).toBe(200);
    expect(saved.body.base_url).toBe(liveUrl);

    await stopProvider();
    const cleared = await request(app)
      .patch("/api/settings/ai-categorization")
      .set(auth())
      .send({ base_url: null, model: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ base_url: null, model: null });
  });

  it("waits before retrying 429 responses both without and with Retry-After", async () => {
    const target = await category("Retry target");
    const withoutHeader = await startProvider(() =>
      providerRequests === 1 ? { status: 429 } : { category_id: target.id, confidence: 1, reason: "retry worked" },
    );
    await enable(withoutHeader, { mode: "auto" });
    const first = await print();
    const started = Date.now();
    const retried = await request(app).post(`/api/print/${first.id}/recategorize`).set(auth()).send({});
    expect(retried.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(providerRequests).toBe(2);

    await stopProvider();
    const withHeader = await startProvider(() =>
      providerRequests === 1
        ? { status: 429, headers: { "retry-after": "1" } }
        : { category_id: target.id, confidence: 1, reason: "retry worked" },
    );
    await enable(withHeader, { mode: "auto" });
    const second = await print();
    const withRetryAfterStarted = Date.now();
    const retryAfter = await request(app).post(`/api/print/${second.id}/recategorize`).set(auth()).send({});
    expect(retryAfter.status).toBe(200);
    expect(Date.now() - withRetryAfterStarted).toBeGreaterThanOrEqual(900);
    expect(providerRequests).toBe(2);
  });

  it("maps timeouts and repeated 500s to ai_failed, but does not retry a 400", async () => {
    setAiCategorizationRetryDelayForTest(async () => undefined);
    const target = await category("Failure target");
    const timeoutUrl = await startProvider(() => ({ status: 200, never: true }));
    await enable(timeoutUrl, { timeoutMs: 20 });
    const timedOut = await print();
    const timeout = await request(app).post(`/api/print/${timedOut.id}/recategorize`).set(auth()).send({});
    expect(timeout.status).toBe(502);
    expect(timeout.body.code).toBe("ai_failed");
    expect(timeout.body.error).toBe("AI provider failed: The AI provider did not answer within 0 s");
    expect(providerRequests).toBe(3);

    await stopProvider();
    const serverErrorUrl = await startProvider(() => ({ status: 500 }));
    await enable(serverErrorUrl);
    const serverError = await print();
    const failed = await request(app).post(`/api/print/${serverError.id}/recategorize`).set(auth()).send({});
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe("ai_failed");
    expect(providerRequests).toBe(3);

    await stopProvider();
    const badRequestUrl = await startProvider(() => ({ status: 400 }));
    await enable(badRequestUrl);
    const badRequest = await print();
    const notRetried = await request(app).post(`/api/print/${badRequest.id}/recategorize`).set(auth()).send({});
    expect(notRetried.status).toBe(502);
    expect(notRetried.body.code).toBe("ai_failed");
    expect(notRetried.body.error).toBe("AI provider failed: AI provider returned HTTP 400");
    expect(providerRequests).toBe(1);
    expect(target.id).toBeTruthy();
  });

  it("accepts fenced answers, truncates reasons, and rejects invalid classifications", async () => {
    const target = await category("Output target");
    const longReason = "r".repeat(301);
    const replies: ProviderReply[] = [
      { category_id: null, confidence: 1, reason: "none" },
      {
        status: 200,
        content: `\`\`\`json\n${JSON.stringify({ category_id: target.id, confidence: 50, reason: longReason })}\n\`\`\``,
      },
      { status: 200, content: '{"category_id":null,"confidence":NaN,"reason":"bad"}' },
      { category_id: target.id, confidence: 1.1, reason: "bad" },
      { category_id: "not-a-candidate", confidence: 1, reason: "bad" },
    ];
    let schema: Record<string, unknown> | null = null;
    let prompt = "";
    const baseUrl = await startProvider((body) => {
      schema = body.response_format as Record<string, unknown>;
      prompt = promptText(body);
      return replies.shift()!;
    });
    await enable(baseUrl, { mode: "suggest" });

    const noMatch = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(noMatch.body.outcome).toBe("no_match");

    const fenced = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(fenced.status).toBe(200);
    expect(fenced.body).toMatchObject({ outcome: "suggested", print: { ai_suggestion: { category_id: target.id } } });
    expect(fenced.body.print.ai_suggestion.reason).toHaveLength(300);
    // Answered as a whole percentage, which some providers do despite the 0-1 range.
    expect(fenced.body.print.ai_suggestion.confidence).toBe(0.5);
    expect(JSON.stringify(schema)).toContain('"maxLength":300');
    // Candidates are answered by path: a near-identical id or a number from a long list is easy to get wrong.
    expect(JSON.stringify(schema)).not.toContain(target.id);
    expect(JSON.stringify(schema)).toContain(JSON.stringify(target.name));
    // The shared part goes first, so a provider can reuse the prefix; the model's own details come last.
    expect(prompt.indexOf("Candidates:")).toBeLessThan(prompt.indexOf("Title:"));
    // The reason is generated before the answer.
    const properties = (schema as unknown as { json_schema: { schema: { properties: object } } }).json_schema.schema
      .properties;
    expect(Object.keys(properties)[0]).toBe("reason");

    for (let i = 0; i < 3; i++) {
      const invalid = await request(app)
        .post(`/api/print/${(await print()).id}/recategorize`)
        .set(auth())
        .send({});
      expect(invalid.status).toBe(502);
      expect(invalid.body.code).toBe("ai_failed");
    }
  });

  it("matches a path answered with different case or spacing, but nothing else", async () => {
    const target = await category("Path match target");
    const replies: ProviderReply[] = [
      {
        status: 200,
        content: `{"category":${JSON.stringify(`  ${target.name.toUpperCase()} `)},"confidence":0.9,"reason":"x"}`,
      },
      { status: 200, content: `{"category":${JSON.stringify(`${target.name} extra`)},"confidence":0.9,"reason":"x"}` },
    ];
    const baseUrl = await startProvider(() => replies.shift()!);
    await enable(baseUrl);

    const loose = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(loose.body).toMatchObject({ outcome: "suggested", print: { ai_suggestion: { category_id: target.id } } });
    const other = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(other.status).toBe(502);
    expect(other.body.error).toBe("AI provider failed: AI provider returned a category outside the candidate list");
  });

  it("explains an answer cut off by the token limit instead of a JSON parse position", async () => {
    const target = await category("Cut off target");
    // A reason filled to its 300-character limit, cut before the closing brace: what a small max_tokens produced.
    const cut = `{"reason":"${"r".repeat(300)}","category_id":"${target.id}"`;
    const replies: ProviderReply[] = [
      {
        status: 200,
        content: cut,
        finishReason: "length",
        usage: { completion_tokens: 1024, completion_tokens_details: { reasoning_tokens: 900 } },
      },
      { status: 200, content: cut },
      { status: 200, content: '{"category_id":null,"confidence":1,"reason":"fine"}', finishReason: "length" },
    ];
    let maxTokens: unknown;
    const baseUrl = await startProvider((body) => {
      maxTokens = body.max_tokens;
      return replies.shift()!;
    });
    await enable(baseUrl);
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => void warnings.push(String(line)));

    const cutPrint = await print();
    const limited = await request(app).post(`/api/print/${cutPrint.id}/recategorize`).set(auth()).send({});
    vi.restoreAllMocks();
    expect(limited.status).toBe(502);
    expect(limited.body.error).toBe("AI provider failed: AI provider cut the answer off at its token limit");
    // The log says why, for which model, and how the token budget went: the run status only keeps the last error.
    const answerLine = warnings.find((line) => line.includes("provider answer unusable"));
    expect(answerLine).toContain(`print=${cutPrint.id}`);
    expect(answerLine).toContain("finish_reason=length");
    expect(answerLine).toContain("completion_tokens=1024");
    expect(answerLine).toContain("reasoning_tokens=900");
    expect(answerLine).toContain("answer_chars=");
    expect(answerLine).toContain(`answer_end=`);
    const failureLine = warnings.find((line) => line.includes("model categorization failed"));
    expect(failureLine).toContain(`print=${cutPrint.id}`);
    expect(failureLine).toContain("source=request");
    // Leaves room for a full-length reason and the JSON around it.
    expect(maxTokens).toBeGreaterThanOrEqual(1024);

    // A provider that doesn't report finish_reason still gets a readable error.
    const unreported = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(unreported.status).toBe(502);
    expect(unreported.body.error).toBe("AI provider failed: AI provider returned an answer that is not valid JSON");
    expect(unreported.body.error).not.toContain("position");

    // A complete answer that still reports the limit is used: a cut-off object never parses.
    const completeAtLimit = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(completeAtLimit.status).toBe(200);
    expect(completeAtLimit.body.outcome).toBe("no_match");
    expect(providerRequests).toBe(3);
  });

  it("reads an answer wrapped in markdown or prose by a provider that ignores response_format", async () => {
    const target = await category("Wrapped target");
    const answer = `{"reason":"fits","category_id":"${target.id}","confidence":0.9}`;
    const replies: ProviderReply[] = [
      // What Xiaomi MiMo sent back: the object in bold.
      { status: 200, content: `**${answer}**` },
      { status: 200, content: `Here is my answer:\n${answer}\nHope this helps.` },
      // Braces in prose around something that still isn't JSON: a clear failure, not a crash.
      { status: 200, content: "I think {it is a tool} but {not sure}" },
    ];
    const baseUrl = await startProvider(() => replies.shift()!);
    await enable(baseUrl);

    for (const wrapped of ["bold", "prose"]) {
      const response = await request(app)
        .post(`/api/print/${(await print()).id}/recategorize`)
        .set(auth())
        .send({});
      // The label rides along so a failure says which wrapping broke.
      expect({ wrapped, status: response.status }).toEqual({ wrapped, status: 200 });
      expect({ wrapped, ...response.body }).toMatchObject({
        wrapped,
        outcome: "suggested",
        print: { ai_suggestion: { category_id: target.id } },
      });
    }

    const notJson = await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(notJson.status).toBe(502);
    expect(notJson.body.error).toBe("AI provider failed: AI provider returned an answer that is not valid JSON");
  });

  it("logs a run's start, each failed model and the totals", async () => {
    const runner = await newUser();
    await categoryFor(runner.id, "Run log target");
    const failing = await printFor(runner.id);
    const fine = await printFor(runner.id);
    const baseUrl = await startProvider(async (body) =>
      promptText(body).includes(failing.name)
        ? { status: 200, content: "not json" }
        : { category_id: null, confidence: 1, reason: "none" },
    );
    await enable(baseUrl);
    const lines: string[] = [];
    for (const stream of ["log", "warn", "error"] as const) {
      vi.spyOn(console, stream).mockImplementation((line: unknown) => void lines.push(String(line)));
    }
    try {
      const started = await request(app).post("/api/ai-categorization/run").set(auth(runner.token)).send(runScope());
      expect(started.status).toBe(202);
      await waitForRun(runner.token);
      await waitFor(() => lines.some((line) => line.includes("run finished")), "run finish was not logged");
    } finally {
      vi.restoreAllMocks();
    }
    expect(lines.find((line) => line.includes("run started"))).toContain(`user=${runner.id}`);
    expect(lines.find((line) => line.includes("run selected models"))).toContain("total=2");
    const failedLine = lines.find((line) => line.includes("model categorization failed"));
    expect(failedLine).toContain(`print=${failing.id}`);
    expect(failedLine).toContain("source=run");
    expect(failedLine).toContain("not valid JSON");
    expect(lines.find((line) => line.includes(`print=${fine.id}`) && line.includes("model categorized"))).toContain(
      "outcome=no_match",
    );
    const finished = lines.find((line) => line.includes("run finished"))!;
    expect(finished).toMatch(/WARN .*run finished with failures/);
    expect(finished).toContain("total=2");
    expect(finished).toContain("failed=1");
    expect(finished).toContain("no_match=1");
    // The owner may have left the page: the totals also arrive as a notification.
    await waitFor(
      async () => (await prisma.notification.count({ where: { userId: runner.id, type: "ai" } })) === 1,
      "run finish was not notified",
    );
    expect(await prisma.notification.findFirst({ where: { userId: runner.id, type: "ai" } })).toMatchObject({
      title: "AI categorization finished 2 models",
      // Nothing was suggested or kept, so those aren't mentioned.
      body:
        "1 model has no fitting category. 1 model couldn't be categorized. " +
        "Last error: AI provider returned an answer that is not valid JSON",
    });
  });

  it("categorizes one model in the background, folders included, and notifies the outcome", async () => {
    const owner = await newUser();
    const target = await categoryFor(owner.id, "Background target");
    const folder = await categoryFor(owner.id, "Background folder", "folder");
    const inFolder = await printFor(owner.id, folder.id, "MANUAL", { name: "Folder model" });
    const manual = await printFor(owner.id, target.id, "MANUAL", { name: "Hand-picked model" });
    const unreadable = await printFor(owner.id, null, null, { name: "Unreadable answer model" });
    const baseUrl = await startProvider(async (body) =>
      promptText(body).includes(unreadable.name)
        ? { status: 200, content: "not json" }
        : { category_id: target.id, confidence: 0.6, reason: "fits the target" },
    );
    await enable(baseUrl);
    const recategorize = (id: string) =>
      request(app).post(`/api/print/${id}/recategorize`).set(auth(owner.token)).send({ background: true });
    const notifications = () =>
      prisma.notification.findMany({ where: { userId: owner.id, type: "ai" }, orderBy: { createdAt: "asc" } });

    // A manual category is still confirmed before anything is queued.
    const refused = await recategorize(manual.id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("manual_category");

    expect((await recategorize(inFolder.id)).status).toBe(202);
    await waitFor(async () => (await notifications()).length === 1, "the suggestion was not notified");
    expect((await notifications())[0]).toMatchObject({
      title: `AI suggests ${target.name} for "Folder model"`,
      body: "fits the target",
      internalPath: `/models/${inFolder.id}`,
    });
    // Accepting takes the model out of its folder.
    const accepted = await request(app).post(`/api/print/${inFolder.id}/ai-suggestion/accept`).set(auth(owner.token));
    expect(accepted.body.print).toMatchObject({ category_id: target.id, category_kind: "category" });

    expect((await recategorize(unreadable.id)).status).toBe(202);
    await waitFor(async () => (await notifications()).length === 2, "the failure was not notified");
    expect((await notifications())[1]).toMatchObject({
      title: 'Couldn\'t categorize "Unreadable answer model"',
      body: "AI provider returned an answer that is not valid JSON",
    });
  });

  it("asks a reasoning model not to think only when thinking is turned off", async () => {
    const bodies: Record<string, unknown>[] = [];
    const baseUrl = await startProvider((body) => {
      bodies.push(body);
      return { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(baseUrl);
    const recategorize = async () =>
      (
        await request(app)
          .post(`/api/print/${(await print()).id}/recategorize`)
          .set(auth())
          .send({})
      ).status;

    expect(await recategorize()).toBe(200);
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");

    const off = await request(app).patch("/api/settings/ai-categorization").set(auth()).send({ thinking: false });
    expect(off.status).toBe(200);
    expect(off.body.thinking).toBe(false);
    expect(await recategorize()).toBe(200);
    expect(bodies[1].reasoning_effort).toBe("none");
  });

  it("asks again without reasoning_effort when a strict provider rejects it, and remembers that", async () => {
    const bodies: Record<string, unknown>[] = [];
    // What OpenAI answers for a model that doesn't reason.
    const baseUrl = await startProvider((body) => {
      bodies.push(body);
      return "reasoning_effort" in body
        ? { status: 400, content: "Unsupported parameter: 'reasoning_effort' is not supported with this model." }
        : { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(baseUrl, { thinking: false });
    const recategorize = async () =>
      (
        await request(app)
          .post(`/api/print/${(await print()).id}/recategorize`)
          .set(auth())
          .send({})
      ).status;

    expect(await recategorize()).toBe(200);
    expect(bodies.map((body) => "reasoning_effort" in body)).toEqual([true, false]);
    expect(await recategorize()).toBe(200);
    expect(bodies.map((body) => "reasoning_effort" in body)).toEqual([true, false, false]);
  });

  it("treats a 400 that isn't about reasoning as a failed request, not a rejected reasoning_effort", async () => {
    const bodies: Record<string, unknown>[] = [];
    const baseUrl = await startProvider((body) => {
      bodies.push(body);
      return { status: 400, content: "The model `missing` does not exist" };
    });
    await enable(baseUrl, { thinking: false });
    for (let i = 0; i < 2; i++) {
      const failed = await request(app)
        .post(`/api/print/${(await print()).id}/recategorize`)
        .set(auth())
        .send({});
      expect(failed.status).toBe(502);
    }
    // Neither asked again without it, nor stopped sending it.
    expect(bodies.map((body) => "reasoning_effort" in body)).toEqual([true, true]);
  });

  it("numbers categories that share a path, so each answer means one of them", async () => {
    const owner = await newUser();
    const [, second] = await Promise.all(
      [0, 1].map((position) =>
        prisma.category.create({ data: { userId: owner.id, name: "Twin", kind: "category", position } }),
      ),
    );
    const model = await printFor(owner.id);
    let prompt = "";
    const baseUrl = await startProvider((body) => {
      prompt = promptText(body);
      return { status: 200, content: '{"reason":"the second twin","category":"Twin (2)","confidence":0.9}' };
    });
    await enable(baseUrl);

    const response = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth(owner.token)).send({});
    expect(response.body).toMatchObject({ outcome: "suggested", print: { ai_suggestion: { category_id: second.id } } });
    expect(prompt.split("\n")).toEqual(expect.arrayContaining(["Twin", "Twin (2)"]));
  });

  it("tells the provider a model's current category", async () => {
    const current = await category("Current hint");
    const prompts: string[] = [];
    const baseUrl = await startProvider((body) => {
      prompts.push(promptText(body));
      return { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(baseUrl);
    await request(app)
      .post(`/api/print/${(await print(current.id, "LEGACY")).id}/recategorize`)
      .set(auth())
      .send({});
    await request(app)
      .post(`/api/print/${(await print()).id}/recategorize`)
      .set(auth())
      .send({});
    expect(prompts[0]).toContain(`Current category: ${current.name}`);
    expect(prompts[1]).not.toContain("Current category:");
  });

  it("preserves hyphens in plain-text prompt descriptions", async () => {
    const target = await category("Hyphen target");
    let prompt = "";
    const baseUrl = await startProvider((body) => {
      const messages = body.messages as { content: { text: string }[] }[];
      prompt = messages[0].content[0].text;
      return { category_id: target.id, confidence: 1, reason: "fits" };
    });
    await enable(baseUrl, { mode: "auto" });
    const model = await print(null, null, { notes: "- heading\n3-in-1 tool" });
    const result = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth()).send({});
    expect(result.status).toBe(200);
    expect(prompt).toContain("3-in-1 tool");
  });

  it("never changes MANUAL categories unless explicitly forced and clears a pending suggestion manually", async () => {
    const target = await category("Target");
    const manual = await category("Manual");
    const baseUrl = await startProvider(() => ({ category_id: target.id, confidence: 0.99, reason: "matches" }));
    await enable(baseUrl, { mode: "auto" });
    const model = await print(manual.id, "MANUAL");
    const denied = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth()).send({});
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("manual_category");
    const forced = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth()).send({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body).toMatchObject({ outcome: "applied", print: { category_id: target.id, category_source: "ai" } });

    await enable(baseUrl, { mode: "suggest" });
    const suggested = await print();
    await request(app).post(`/api/print/${suggested.id}/recategorize`).set(auth()).send({});
    const cleared = await request(app)
      .post(`/api/print/${suggested.id}/category`)
      .set(auth())
      .send({ category_id: manual.id });
    expect(cleared.status).toBe(200);
    expect(cleared.body.print.ai_suggestion).toBeNull();
  });

  it("suggests below threshold, supports bulk actions, and handles deleted suggestion categories", async () => {
    const first = await category("First");
    const second = await category("Second");
    const staleCategory = await category("Stale");
    const received: unknown[] = [];
    const baseUrl = await startProvider((body) => {
      received.push(body);
      const categoryId = received.length === 1 ? first.id : received.length === 4 ? staleCategory.id : second.id;
      return { category_id: categoryId, confidence: 0.3, reason: "review" };
    });
    await enable(baseUrl, { mode: "auto" });
    const model = await print();
    const suggested = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth()).send({});
    expect(suggested.body).toMatchObject({ outcome: "suggested", print: { ai_suggestion: { category_id: first.id } } });
    const bulk = await request(app)
      .post("/api/ai-categorization/suggestions/bulk")
      .set(auth())
      .send({ action: "reject", print_ids: [model.id] });
    expect(bulk.body).toMatchObject({ accepted: 0, rejected: 1, failed: 0 });
    const repeated = await request(app).post(`/api/print/${model.id}/recategorize`).set(auth()).send({});
    expect(repeated.body).toMatchObject({ outcome: "suggested", print: { ai_suggestion: { category_id: second.id } } });
    expect(promptText(received[1] as Record<string, unknown>)).not.toContain(first.name);

    const accepted = await print();
    await request(app).post(`/api/print/${accepted.id}/recategorize`).set(auth()).send({});
    const acceptedBulk = await request(app)
      .post("/api/ai-categorization/suggestions/bulk")
      .set(auth())
      .send({ action: "accept", print_ids: [accepted.id] });
    expect(acceptedBulk.body).toMatchObject({ accepted: 1, rejected: 0, failed: 0 });

    const stale = await print();
    await request(app).post(`/api/print/${stale.id}/recategorize`).set(auth()).send({});
    await prisma.category.delete({ where: { id: staleCategory.id } });
    const staleAccept = await request(app).post(`/api/print/${stale.id}/ai-suggestion/accept`).set(auth()).send({});
    expect(staleAccept.status).toBe(409);
    expect(staleAccept.body.code).toBe("stale");
  });

  it("discards an in-flight answer when a user categorizes manually", async () => {
    const target = await category("AI target");
    const manual = await category("Manual winner");
    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const baseUrl = await startProvider(async () => {
      arrived();
      await held;
      return { category_id: target.id, confidence: 1, reason: "late" };
    });
    await enable(baseUrl, { mode: "auto", timeoutMs: 5000 });
    const model = await print();
    const pending = request(app)
      .post(`/api/print/${model.id}/recategorize`)
      .set(auth())
      .send({})
      .then((response) => response);
    await providerStarted;
    const chosen = await request(app)
      .post(`/api/print/${model.id}/category`)
      .set(auth())
      .send({ category_id: manual.id });
    expect(chosen.status).toBe(200);
    release();
    const completed = await pending;
    expect(completed.body.outcome).toBe("unchanged");
    expect(completed.body.print).toMatchObject({ category_id: manual.id, category_source: "manual" });
  });

  it("does not block imports when a provider is down and skips prints created with a category", async () => {
    setAiCategorizationRetryDelayForTest(async () => undefined);
    const assigned = await category("Assigned on upload");
    const downUrl = await startProvider(() => ({ status: 500 }));
    await enable(downUrl, { onImport: true });
    const manualUpload = await request(app)
      .post("/api/upload")
      .set(auth())
      .field("category_id", assigned.id)
      .attach("files", Buffer.from(STL), "manual.stl");
    expect(manualUpload.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(providerRequests).toBe(0);

    const uncategorizedUpload = await request(app)
      .post("/api/upload")
      .set(auth())
      .attach("files", Buffer.from(STL), "uncategorized.stl");
    expect(uncategorizedUpload.status).toBe(200);
    await waitFor(() => providerRequests === 3, "import hook did not retry its failed provider call");
  });

  it("isolates candidate categories and suggestion lists by user", async () => {
    const owner = await newUser();
    const other = await newUser();
    const ownCategory = await categoryFor(owner.id, "Owned category");
    const ownFolder = await categoryFor(owner.id, "Owned folder", "folder");
    const otherCategory = await categoryFor(other.id, "Other category");
    const bodies: Record<string, unknown>[] = [];
    const baseUrl = await startProvider((body) => {
      bodies.push(body);
      return {
        category_id: promptText(body).includes(ownCategory.name) ? ownCategory.id : otherCategory.id,
        confidence: 0.2,
        reason: "review",
      };
    });
    await enable(baseUrl);
    const ownPrint = await printFor(owner.id);
    const otherPrint = await printFor(other.id);
    await request(app).post(`/api/print/${ownPrint.id}/recategorize`).set(auth(owner.token)).send({});
    await request(app).post(`/api/print/${otherPrint.id}/recategorize`).set(auth(other.token)).send({});
    expect(promptText(bodies[0])).toContain(ownCategory.name);
    expect(promptText(bodies[0])).not.toContain(ownFolder.name);
    expect(promptText(bodies[0])).not.toContain(otherCategory.name);

    const suggestions = await request(app).get("/api/ai-categorization/suggestions").set(auth(owner.token));
    expect(suggestions.body.total).toBe(1);
    expect(suggestions.body.items.map((item: { id: string }) => item.id)).toEqual([ownPrint.id]);
  });

  it("honors run scope, rejects duplicate starts, and cancels", async () => {
    const runner = await newUser();
    const target = await categoryFor(runner.id, "Run target");
    const folder = await categoryFor(runner.id, "Run folder", "folder");
    await printFor(runner.id);
    await printFor(runner.id, target.id, "AI");
    await printFor(runner.id, target.id, "RULE");
    await printFor(runner.id, target.id, "LEGACY");
    await printFor(runner.id, target.id, "MANUAL");
    await printFor(runner.id, folder.id, "AI");
    const baseUrl = await startProvider(() => ({ category_id: null, confidence: 1, reason: "none" }));
    await enable(baseUrl);

    const counts = await request(app).get("/api/ai-categorization/run").set(auth(runner.token));
    expect(counts.body.counts).toMatchObject({ uncategorized: 1, ai: 1, rule: 1, legacy: 1, manual: 1, folder: 1 });
    const onlyUncategorized = await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send(runScope());
    expect(onlyUncategorized.status).toBe(202);
    const firstRun = await waitForRun(runner.token);
    expect(firstRun.body.run).toMatchObject({ total: 1, done: 1, failed: 0 });
    expect(providerRequests).toBe(1);

    // Older categories go with the manual ones: nothing recorded whether they were picked by hand.
    for (const [include, total] of [
      [{ uncategorized: false, folders: true }, 1],
      [{ uncategorized: false, manual: true }, 2],
    ] as const) {
      expect(
        (await request(app).post("/api/ai-categorization/run").set(auth(runner.token)).send(runScope(include))).status,
      ).toBe(202);
      expect((await waitForRun(runner.token)).body.run).toMatchObject({ total, done: total, failed: 0 });
    }

    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrivedAtProvider = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await stopProvider();
    const heldUrl = await startProvider(async () => {
      arrived();
      await held;
      return { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(heldUrl);
    const started = await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send(runScope({ folders: true, ai: true, rule: true, manual: true }));
    expect(started.status).toBe(202);
    await arrivedAtProvider;
    const duplicate = await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send(runScope({ folders: true, ai: true, rule: true, manual: true }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("running");
    const cancelled = await request(app).post("/api/ai-categorization/run/cancel").set(auth(runner.token)).send({});
    expect(cancelled.body.run.cancelled).toBe(true);
    release();
    const stopped = await waitForRun(runner.token);
    expect(stopped.body.run).toMatchObject({ total: 6, done: 1, cancelled: true, failed: 0 });
  });

  it("counts manual and folder conflicts raised mid-run as completed work", async () => {
    const runner = await newUser();
    const target = await categoryFor(runner.id, "Conflict target");
    const folder = await categoryFor(runner.id, "Conflict folder", "folder");
    const first = await printFor(runner.id);
    const changedToManual = await printFor(runner.id);
    const changedToFolder = await printFor(runner.id);
    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrivedAtProvider = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const baseUrl = await startProvider(async () => {
      arrived();
      await held;
      return { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(baseUrl);
    await request(app).post("/api/ai-categorization/run").set(auth(runner.token)).send(runScope());
    await arrivedAtProvider;
    await prisma.print.update({
      where: { id: changedToManual.id },
      data: { categoryId: target.id, categorySource: "MANUAL" },
    });
    await prisma.print.update({
      where: { id: changedToFolder.id },
      data: { categoryId: folder.id, categorySource: "AI" },
    });
    release();
    const stopped = await waitForRun(runner.token);
    expect(first.id).toBeTruthy();
    expect(stopped.body.run).toMatchObject({ total: 3, done: 3, failed: 0, last_error: null });
    expect(providerRequests).toBe(1);
  });

  it("stops a run after five consecutive provider failures", async () => {
    setAiCategorizationRetryDelayForTest(async () => undefined);
    const runner = await newUser();
    await categoryFor(runner.id, "Failure target");
    for (let i = 0; i < 6; i++) await printFor(runner.id);
    const baseUrl = await startProvider(() => ({ status: 500 }));
    await enable(baseUrl);
    const started = await request(app).post("/api/ai-categorization/run").set(auth(runner.token)).send(runScope());
    expect(started.status).toBe(202);
    const stopped = await waitForRun(runner.token);
    expect(stopped.body.run).toMatchObject({ total: 6, done: 5, failed: 5 });
    expect(stopped.body.run.last_error).toContain("5 consecutive failures");
    expect(providerRequests).toBe(15);
  });

  it("stops a run when AI is disabled while it is in progress", async () => {
    const runner = await newUser();
    await categoryFor(runner.id, "Disable target");
    await printFor(runner.id);
    await printFor(runner.id);
    let release!: () => void;
    let arrived!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrivedAtProvider = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const baseUrl = await startProvider(async () => {
      arrived();
      await held;
      return { category_id: null, confidence: 1, reason: "none" };
    });
    await enable(baseUrl);
    await request(app).post("/api/ai-categorization/run").set(auth(runner.token)).send(runScope());
    await arrivedAtProvider;
    await setAiCategorizationSettings(DEFAULT_AI_CATEGORIZATION_SETTINGS);
    release();
    const stopped = await waitForRun(runner.token);
    expect(stopped.body.run).toMatchObject({ total: 2, done: 2, failed: 0 });
    expect(stopped.body.run.last_error).toContain("disabled");
  });

  it("uses the global concurrency limit for simultaneous recategorization", async () => {
    const runner = await newUser();
    const target = await categoryFor(runner.id, "Concurrent target");
    const baseUrl = await startProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { category_id: target.id, confidence: 1, reason: "fits" };
    });
    await enable(baseUrl, { mode: "auto", concurrency: 1 });
    const models = await Promise.all([printFor(runner.id), printFor(runner.id), printFor(runner.id)]);
    const responses = await Promise.all(
      models.map((model) => request(app).post(`/api/print/${model.id}/recategorize`).set(auth(runner.token)).send({})),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(providerMaxInFlight).toBe(1);
  });
});
