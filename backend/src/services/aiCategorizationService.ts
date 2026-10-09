import fs from "node:fs/promises";
import { Prisma, type CategorySource, type Print } from "@prisma/client";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { previewImagePath } from "./previewImageService";
import { createLog } from "./auditLog";
import { setPrintCategory } from "./printCategoryService";
import { aiCategorizationEnabled, getAiCategorizationSettings, type AiCategorizationSettings } from "./settingsService";

const suggestionSchema = z.object({
  categoryId: z.string(),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().max(300),
  model: z.string(),
  createdAt: z.string(),
});

type Suggestion = z.infer<typeof suggestionSchema>;
type Candidate = { id: string; path: string };
type ProviderResult = { categoryId: string | null; confidence: number; reason: string };
export type CategorizationOutcome = "applied" | "suggested" | "no_match" | "unchanged";

let active = 0;
const waiters: (() => void)[] = [];
let retryDelay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Keeps timeout and retry tests fast without changing production backoff behavior. */
export function setAiCategorizationRetryDelayForTest(delay?: (milliseconds: number) => Promise<void>): void {
  retryDelay = delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
}

async function limited<T>(limit: number, task: () => Promise<T>): Promise<T> {
  // A waiter can be woken while another request takes the slot first, so it retries acquisition.
  if (active >= limit) {
    await new Promise<void>((resolve) => waiters.push(resolve));
    return limited(limit, task);
  }
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

function noSecretError(error: unknown): Error {
  if (error instanceof Error) return new Error(error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]"));
  return new Error("AI provider request failed");
}

function plainText(value: string | null): string {
  return (value ?? "")
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(/^[\t ]{0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

export async function aiCategoryPaths(userId: string): Promise<Map<string, string>> {
  const categories = await prisma.category.findMany({
    where: { userId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const paths = new Map<string, string>();
  for (const category of categories) {
    if (category.kind !== "category") continue;
    const names: string[] = [];
    let current: typeof category | undefined = category;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    paths.set(category.id, names.join(" > "));
  }
  return paths;
}

async function candidateCategories(userId: string, rejected: string[]): Promise<Candidate[]> {
  const rejectedSet = new Set(rejected);
  return [...(await aiCategoryPaths(userId))]
    .filter(([id]) => !rejectedSet.has(id))
    .map(([id, path]) => ({ id, path }));
}

async function previewPart(
  printId: string,
  enabled: boolean,
): Promise<{ type: "image_url"; image_url: { url: string } } | null> {
  if (!enabled) return null;
  const image = await prisma.previewImage.findFirst({ where: { printId }, orderBy: { position: "asc" } });
  if (!image) return null;
  try {
    const data = await sharp(await fs.readFile(previewImagePath(image.id)))
      .resize(512, 512, { fit: "inside" })
      .jpeg()
      .toBuffer();
    return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${data.toString("base64")}` } };
  } catch {
    return null;
  }
}

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

async function requestProvider(
  print: Print,
  candidates: Candidate[],
  settings: AiCategorizationSettings,
): Promise<ProviderResult> {
  const image = await previewPart(print.id, settings.sendImage);
  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
    {
      type: "text",
      text: [
        "Classify this 3D-print model into one candidate category. Return null if none fits.",
        `Title: ${print.title ?? print.name}`,
        `Tags: ${print.tags.join(", ") || "none"}`,
        `Creator: ${print.creator ?? "unknown"}`,
        `Source: ${print.sourceProvider ?? "unknown"}`,
        `Description: ${plainText(print.notes) || "none"}`,
        "Candidates:",
        ...candidates.map((candidate) => `${candidate.id}: ${candidate.path}`),
      ].join("\n"),
    },
  ];
  if (image) content.push(image);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category_id: { anyOf: [{ type: "string", enum: candidates.map((candidate) => candidate.id) }, { type: "null" }] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", maxLength: 300 },
    },
    required: ["category_id", "confidence", "reason"],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await fetch(chatUrl(settings.baseUrl!), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          temperature: 0,
          max_tokens: 300,
          response_format: { type: "json_schema", json_schema: { name: "categorization", strict: true, schema } },
          messages: [{ role: "user", content }],
        }),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === 2) throw new Error(`AI provider returned HTTP ${response.status}`);
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30000, retryAfter * 1000)
            : attempt === 0
              ? 1000
              : 3000;
        await retryDelay(delay);
        continue;
      }
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      const raw = body.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("AI provider returned no classification");
      const unfenced = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = z
        .object({ category_id: z.string().nullable(), confidence: z.number().finite(), reason: z.string() })
        .safeParse(JSON.parse(unfenced));
      if (!parsed.success || parsed.data.confidence < 0 || parsed.data.confidence > 1)
        throw new Error("AI provider returned invalid classification");
      if (
        parsed.data.category_id !== null &&
        !candidates.some((candidate) => candidate.id === parsed.data.category_id)
      ) {
        throw new Error("AI provider returned a category outside the candidate list");
      }
      return {
        categoryId: parsed.data.category_id,
        confidence: parsed.data.confidence,
        reason: parsed.data.reason.slice(0, 300),
      };
    } catch (error) {
      const retryable = error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
      if (!retryable || attempt === 2) throw noSecretError(error);
      await retryDelay(attempt === 0 ? 1000 : 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("AI provider request failed");
}

function isFolder(print: Print & { category?: { kind: string } | null }): boolean {
  return print.category?.kind === "folder";
}

async function clearSuggestion(
  printId: string,
  expected?: { categoryId: string | null; categorySource: CategorySource | null },
) {
  const where: Prisma.PrintWhereInput = { id: printId };
  if (expected) Object.assign(where, expected);
  await prisma.print.updateMany({ where, data: { aiSuggestion: Prisma.DbNull } });
}

export async function categorizePrint(
  userId: string,
  printId: string,
  options: { force?: boolean } = {},
): Promise<CategorizationOutcome> {
  const settings = await getAiCategorizationSettings();
  if (!aiCategorizationEnabled(settings)) throw new HttpError(503, "AI categorization is disabled", "ai_disabled");
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, include: { category: true } });
  if (!print) throw new HttpError(404, "Print not found");
  if (isFolder(print)) throw new HttpError(409, "Models in folders are not AI-categorized", "folder");
  if (print.categorySource === "MANUAL" && !options.force) {
    throw new HttpError(409, "This category was set manually", "manual_category");
  }
  const candidates = await candidateCategories(userId, print.aiRejectedCategoryIds);
  if (!candidates.length) {
    await clearSuggestion(print.id);
    return "no_match";
  }

  const answer = await limited(settings.concurrency, () => requestProvider(print, candidates, settings));
  const expected = { categoryId: print.categoryId, categorySource: print.categorySource };
  if (answer.categoryId === null) {
    await clearSuggestion(print.id, expected);
    return "no_match";
  }
  if (answer.categoryId === print.categoryId) {
    await clearSuggestion(print.id, expected);
    return "unchanged";
  }
  const suggestion: Suggestion = {
    categoryId: answer.categoryId,
    confidence: answer.confidence,
    reason: answer.reason,
    model: settings.model!,
    createdAt: new Date().toISOString(),
  };
  if (settings.mode === "auto" && answer.confidence >= settings.threshold) {
    try {
      const applied = await setPrintCategory(userId, print.id, answer.categoryId, "AI", {
        expected,
        clearSuggestion: true,
      });
      if (applied) return "applied";
      return "unchanged";
    } catch (error) {
      // A colliding model name is reviewable, unlike a broken provider request.
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
  const where: Prisma.PrintWhereInput = { id: print.id, categoryId: expected.categoryId };
  if (!options.force) {
    // SQL's `!=` excludes NULL, but uncategorized prints intentionally have no source.
    where.OR = [{ categorySource: null }, { categorySource: { not: "MANUAL" } }];
  }
  const stored = await prisma.print.updateMany({
    where,
    data: { aiSuggestion: suggestion as unknown as Prisma.InputJsonValue },
  });
  return stored.count ? "suggested" : "unchanged";
}

/** Import creation deliberately never waits on a provider. */
export function enqueueAiCategorization(userId: string, printId: string): void {
  void getAiCategorizationSettings()
    .then((settings) => {
      if (!aiCategorizationEnabled(settings) || !settings.onImport) return;
      return categorizePrint(userId, printId);
    })
    .catch((error) => console.warn("[ai-categorize]", printId, noSecretError(error).message));
}

export async function acceptAiSuggestion(userId: string, printId: string): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const suggestion = suggestionSchema.safeParse(print.aiSuggestion);
  if (!suggestion.success) throw new HttpError(404, "No AI suggestion found");
  const category = await prisma.category.findFirst({ where: { id: suggestion.data.categoryId, userId } });
  if (!category) throw new HttpError(409, "Suggested category no longer exists", "stale");
  await setPrintCategory(userId, print.id, category.id, "AI", { clearSuggestion: true });
}

export async function rejectAiSuggestion(userId: string, printId: string): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const suggestion = suggestionSchema.safeParse(print.aiSuggestion);
  if (!suggestion.success) throw new HttpError(404, "No AI suggestion found");
  await prisma.print.update({
    where: { id: print.id },
    data: {
      aiSuggestion: Prisma.DbNull,
      aiRejectedCategoryIds: [...new Set([...print.aiRejectedCategoryIds, suggestion.data.categoryId])],
    },
  });
}

export async function aiSuggestionOut(
  userId: string,
  value: unknown,
  categoryPaths?: Map<string, string>,
): Promise<{
  category_id: string;
  category_path: string;
  confidence: number;
  reason: string;
  model: string;
  created_at: string;
} | null> {
  const suggestion = suggestionSchema.safeParse(value);
  if (!suggestion.success) return null;
  const path = (categoryPaths ?? (await aiCategoryPaths(userId))).get(suggestion.data.categoryId);
  if (!path) return null;
  return {
    category_id: suggestion.data.categoryId,
    category_path: path,
    confidence: suggestion.data.confidence,
    reason: suggestion.data.reason,
    model: suggestion.data.model,
    created_at: suggestion.data.createdAt,
  };
}

export type AiCategorizationRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  applied: number;
  suggested: number;
  noMatch: number;
  failed: number;
  cancelled: boolean;
  lastError: string | null;
};

const runs = new Map<string, AiCategorizationRun>();

export function currentAiCategorizationRun(userId: string): AiCategorizationRun | null {
  return runs.get(userId) ?? null;
}

export async function aiCategorizationCounts(userId: string) {
  const [uncategorized, folder, grouped] = await Promise.all([
    prisma.print.count({ where: { userId, categoryId: null } }),
    prisma.print.count({ where: { userId, category: { is: { kind: "folder" } } } }),
    prisma.print.groupBy({
      by: ["categorySource"],
      where: { userId, categoryId: { not: null }, category: { is: { kind: "category" } } },
      _count: { categorySource: true },
    }),
  ]);
  const counts = { uncategorized, ai: 0, rule: 0, legacy: 0, manual: 0, folder };
  for (const row of grouped) {
    if (row.categorySource === "AI") counts.ai = row._count.categorySource;
    else if (row.categorySource === "RULE") counts.rule = row._count.categorySource;
    else if (row.categorySource === "LEGACY") counts.legacy = row._count.categorySource;
    else if (row.categorySource === "MANUAL") counts.manual = row._count.categorySource;
  }
  return counts;
}

export function startAiCategorizationRun(
  userId: string,
  scope: { includeAi: boolean; includeRule: boolean; includeLegacy: boolean },
): AiCategorizationRun | null {
  const running = runs.get(userId);
  if (running?.running) return null;
  const run: AiCategorizationRun = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    applied: 0,
    suggested: 0,
    noMatch: 0,
    failed: 0,
    cancelled: false,
    lastError: null,
  };
  runs.set(userId, run);
  void runAiCategorization(userId, run, scope)
    .catch((error) => {
      run.failed++;
      run.lastError = noSecretError(error).message;
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      void createLog({ userId, action: "ai_categorization_run", details: { ...run } });
    });
  return run;
}

async function runAiCategorization(
  userId: string,
  run: AiCategorizationRun,
  scope: { includeAi: boolean; includeRule: boolean; includeLegacy: boolean },
): Promise<void> {
  const prints = await prisma.print.findMany({
    where: { userId },
    include: { category: { select: { kind: true } } },
    orderBy: { createdAt: "asc" },
  });
  const selected = prints.filter((print) => {
    if (print.category?.kind === "folder" || print.categorySource === "MANUAL") return false;
    if (!print.categoryId) return true;
    return (
      (print.categorySource === "AI" && scope.includeAi) ||
      (print.categorySource === "RULE" && scope.includeRule) ||
      (print.categorySource === "LEGACY" && scope.includeLegacy)
    );
  });
  run.total = selected.length;
  let consecutiveProviderFailures = 0;
  for (const print of selected) {
    if (run.cancelled) break;
    let stop = false;
    try {
      const outcome = await categorizePrint(userId, print.id);
      consecutiveProviderFailures = 0;
      if (outcome === "applied") run.applied++;
      else if (outcome === "suggested") run.suggested++;
      else if (outcome === "no_match") run.noMatch++;
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 409 &&
        (error.code === "manual_category" || error.code === "folder")
      ) {
        consecutiveProviderFailures = 0;
      } else if (error instanceof HttpError && error.status === 503 && error.code === "ai_disabled") {
        run.lastError = noSecretError(error).message;
        stop = true;
      } else {
        run.failed++;
        consecutiveProviderFailures++;
        if (consecutiveProviderFailures >= 5) {
          run.lastError = "AI provider is failing repeatedly; run stopped after 5 consecutive failures";
          stop = true;
        } else {
          run.lastError = noSecretError(error).message;
        }
      }
    }
    run.done++;
    if (stop) break;
  }
}

export function cancelAiCategorizationRun(userId: string): AiCategorizationRun | null {
  const run = runs.get(userId);
  if (!run) return null;
  run.cancelled = true;
  return run;
}

export async function testAiCategorizationProvider(): Promise<
  { ok: true; latencyMs: number; model: string } | { ok: false; error: string }
> {
  const settings = await getAiCategorizationSettings();
  if (!aiCategorizationEnabled(settings)) return { ok: false, error: "AI categorization is disabled" };
  const start = Date.now();
  try {
    const fake = {
      id: "test-print",
      userId: "test-user",
      name: "Calibration cube",
      nameNormalized: "calibration cube",
      title: null,
      notes: null,
      creator: null,
      tags: [],
      categoryId: null,
      categorySource: null,
      aiRejectedCategoryIds: [],
      sourceProvider: null,
    } as unknown as Print;
    await requestProvider(
      fake,
      [
        { id: "a", path: "Calibration" },
        { id: "b", path: "Other" },
      ],
      settings,
    );
    return { ok: true, latencyMs: Date.now() - start, model: settings.model! };
  } catch (error) {
    return { ok: false, error: noSecretError(error).message };
  }
}
