import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { DEFAULT_AI_CATEGORIZATION_SETTINGS, setAiCategorizationSettings } from "../src/services/settingsService";
import { setAiCategorizationRetryDelayForTest } from "../src/services/aiCategorizationService";

const app = createApp();
const stamp = Date.now();
const STL = "solid test\nendsolid test";
let token: string;
let userId: string;
let userNumber = 0;
let printNumber = 0;
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
  | { status: number; headers?: Record<string, string>; content?: ProviderAnswer | string; never?: boolean };
type ProviderHandler = (body: Record<string, unknown>) => ProviderReply | Promise<ProviderReply>;

type User = { id: string; token: string };

function auth(value = token) {
  return { Authorization: `Bearer ${value}` };
}

function isAnswer(reply: ProviderReply): reply is ProviderAnswer {
  return "category_id" in reply;
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
        const reply = await handler(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if (!isAnswer(reply) && reply.never) return;
        const status = isAnswer(reply) ? 200 : reply.status;
        const headers = isAnswer(reply) ? {} : reply.headers || {};
        const content = isAnswer(reply)
          ? reply
          : (reply.content ?? { category_id: null, confidence: 1, reason: "none" });
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
          }),
        );
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
  const row = await prisma.category.create({ data: { userId: ownerId, name, kind } });
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
        content: `\`\`\`json\n${JSON.stringify({ category_id: target.id, confidence: 0.5, reason: longReason })}\n\`\`\``,
      },
      { status: 200, content: '{"category_id":null,"confidence":NaN,"reason":"bad"}' },
      { category_id: target.id, confidence: 1.1, reason: "bad" },
      { category_id: "not-a-candidate", confidence: 1, reason: "bad" },
    ];
    let schema: Record<string, unknown> | null = null;
    const baseUrl = await startProvider((body) => {
      schema = body.response_format as Record<string, unknown>;
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
    expect(JSON.stringify(schema)).toContain('"maxLength":300');

    for (let i = 0; i < 3; i++) {
      const invalid = await request(app)
        .post(`/api/print/${(await print()).id}/recategorize`)
        .set(auth())
        .send({});
      expect(invalid.status).toBe(502);
      expect(invalid.body.code).toBe("ai_failed");
    }
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
    expect(JSON.stringify(received[1])).not.toContain(first.id);

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
      const messages = body.messages as { content: { text: string }[] }[];
      return {
        category_id: messages[0].content[0].text.includes(ownCategory.id) ? ownCategory.id : otherCategory.id,
        confidence: 0.2,
        reason: "review",
      };
    });
    await enable(baseUrl);
    const ownPrint = await printFor(owner.id);
    const otherPrint = await printFor(other.id);
    await request(app).post(`/api/print/${ownPrint.id}/recategorize`).set(auth(owner.token)).send({});
    await request(app).post(`/api/print/${otherPrint.id}/recategorize`).set(auth(other.token)).send({});
    expect(JSON.stringify(bodies[0])).toContain(ownCategory.id);
    expect(JSON.stringify(bodies[0])).not.toContain(ownFolder.id);
    expect(JSON.stringify(bodies[0])).not.toContain(otherCategory.id);

    const suggestions = await request(app).get("/api/ai-categorization/suggestions").set(auth(owner.token));
    expect(suggestions.body.total).toBe(1);
    expect(suggestions.body.items.map((item: { id: string }) => item.id)).toEqual([ownPrint.id]);
  });

  it("honors run scope, excludes MANUAL and folders, rejects duplicate starts, and cancels", async () => {
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
      .send({ include_ai: false, include_rule: false, include_legacy: false });
    expect(onlyUncategorized.status).toBe(202);
    const firstRun = await waitForRun(runner.token);
    expect(firstRun.body.run).toMatchObject({ total: 1, done: 1, failed: 0 });
    expect(providerRequests).toBe(1);

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
      .send({ include_ai: true, include_rule: true, include_legacy: true });
    expect(started.status).toBe(202);
    await arrivedAtProvider;
    const duplicate = await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send({ include_ai: true, include_rule: true, include_legacy: true });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("running");
    const cancelled = await request(app).post("/api/ai-categorization/run/cancel").set(auth(runner.token)).send({});
    expect(cancelled.body.run.cancelled).toBe(true);
    release();
    const stopped = await waitForRun(runner.token);
    expect(stopped.body.run).toMatchObject({ total: 4, done: 1, cancelled: true, failed: 0 });
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
    await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send({ include_ai: false, include_rule: false, include_legacy: false });
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
    const started = await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send({ include_ai: false, include_rule: false, include_legacy: false });
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
    await request(app)
      .post("/api/ai-categorization/run")
      .set(auth(runner.token))
      .send({ include_ai: false, include_rule: false, include_legacy: false });
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
