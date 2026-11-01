import { Prisma, type CategorySource, type Print } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { createLogger } from "../logger";
import { createLog } from "./auditLog";
import { createNotification } from "./notificationService";
import { setPrintCategory } from "./printCategoryService";
import { resolveAiProvider, type ResolvedAiProvider } from "./aiConnectionService";
import {
  askProvider,
  limited,
  noSecretError,
  previewPart,
  setAiRetryDelayForTest,
  type ProviderContent,
  type ProviderSettings,
} from "./aiProviderClient";
import { getAiCategorizationPrefs, type AiCategorizationPrefs } from "./settingsService";

/** Categorization's own preferences with the AI it uses; base URL and model are null while there's no AI. */
export type AiCategorizationSettings = AiCategorizationPrefs & ResolvedAiProvider;

type RequestSettings = ProviderSettings & { sendImage: boolean };

export async function getAiCategorizationSettings(): Promise<AiCategorizationSettings> {
  const prefs = await getAiCategorizationPrefs();
  return { ...prefs, ...(await resolveAiProvider(prefs.aiConnectionId)) };
}

/** AI's suggestions are only shown while categorization is on; switched off, they stay stored for when it's back. */
export async function aiSuggestionsShown(): Promise<boolean> {
  return aiCategorizationEnabled(await getAiCategorizationSettings());
}

export function aiCategorizationEnabled(settings: AiCategorizationSettings): boolean {
  return settings.enabled && Boolean(settings.baseUrl && settings.model);
}

const suggestionSchema = z.object({
  categoryId: z.string(),
  confidence: z.number().finite().min(0).max(1),
  reason: z.string().max(300),
  model: z.string(),
  createdAt: z.string(),
  /** Set when no AI was involved: the category a provider's own maps to. */
  provider: z.string().optional(),
});

type Suggestion = z.infer<typeof suggestionSchema>;

const log = createLogger("ai-categorize");
type Candidate = { id: string; path: string };
type ProviderResult = { categoryId: string | null; confidence: number; reason: string };
export type CategorizationOutcome = "applied" | "suggested" | "no_match" | "unchanged";

/** Kept for the tests that already use it; the delay is shared by every AI feature. */
export const setAiCategorizationRetryDelayForTest = setAiRetryDelayForTest;

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

function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\s+/g, " ").trim();
}

type LabelledCandidate = Candidate & { label: string };

/** Names aren't unique, so two categories can share a path; a number on the repeats keeps every label pointing at
 * one category. */
function withLabels(candidates: Candidate[]): LabelledCandidate[] {
  const used = new Set<string>();
  return candidates.map((candidate) => {
    let label = candidate.path;
    for (let n = 2; used.has(label); n++) label = `${candidate.path} (${n})`;
    used.add(label);
    return { ...candidate, label };
  });
}

/** Providers without a grammar may change the case or spacing of a label, which counts only when it can't mean two
 * candidates; anything else isn't a candidate. */
function candidateByLabel(candidates: LabelledCandidate[], answer: string): LabelledCandidate | undefined {
  const exact = candidates.find((candidate) => candidate.label === answer);
  if (exact) return exact;
  const loose = candidates.filter((candidate) => normalizePath(candidate.label) === normalizePath(answer));
  return loose.length === 1 ? loose[0] : undefined;
}

async function requestProvider(
  print: Print,
  categories: Candidate[],
  settings: RequestSettings,
  attempts = 3,
): Promise<ProviderResult> {
  const candidates = withLabels(categories);
  const image = await previewPart(print.id, settings.sendImage);
  // A model that already has a category says so; on its own the model often misses an obvious fit.
  const current = print.categoryId ? candidates.find((candidate) => candidate.id === print.categoryId) : undefined;
  const content: ProviderContent = [
    {
      type: "text",
      text: [
        // "Classify this 3D-print model" pulled answers toward 3D printer categories; ask about the object instead.
        "Pick the candidate category that best fits this model. It is a file for a physical object that gets 3D printed, " +
          "so choose by what the printed object is or is used for, not by the fact that it is 3D printed. " +
          "Categories about 3D printers fit only parts and accessories for a 3D printer itself.",
        "Give a short reason first, then the full path of the candidate you pick, exactly as listed. " +
          "If the model has a current category that still fits, pick it again. Use null only if no candidate fits.",
        // What every model shares comes first, so a provider can reuse the prompt prefix it already read: on a CPU,
        // reading the candidate list again for each model took most of the time.
        "Candidates:",
        ...candidates.map((candidate) => candidate.label),
        "",
        "The model:",
        `Title: ${print.title ?? print.name}`,
        `Tags: ${print.tags.join(", ") || "none"}`,
        `Creator: ${print.creator ?? "unknown"}`,
        `Source: ${print.sourceProvider ?? "unknown"}`,
        ...(current ? [`Current category: ${current.label}`] : []),
        `Description: ${plainText(print.notes) || "none"}`,
      ].join("\n"),
    },
  ];
  if (image) content.push(image);
  const schema = {
    type: "object",
    additionalProperties: false,
    // Fields are generated in this order: the reason comes first so the answer follows it rather than being
    // justified afterwards.
    properties: {
      reason: { type: "string", maxLength: 300 },
      // By path: answering with a number, a small model named one category in its reason and then typed the
      // number of another from the long list. Near-identical ids were misread the same way.
      category: { anyOf: [{ type: "string", enum: candidates.map((candidate) => candidate.label) }, { type: "null" }] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["reason", "category", "confidence"],
  };

  return askProvider({
    settings,
    content,
    schemaName: "categorization",
    schema,
    // A 300-character reason plus the JSON around it needs room; 300 tokens cut answers off before the closing brace.
    answerTokens: 1024,
    attempts,
    log: log.child({ print: print.id, model: settings.model }),
    noAnswer: "no classification",
    read: (json, unusable, answer) => {
      const parsed = z
        .object({
          category: z.string().nullable(),
          confidence: z.number().finite(),
          reason: z.string(),
        })
        .safeParse(json);
      if (!parsed.success) throw unusable("AI provider returned invalid classification");
      // Providers that ignore the schema's range (Ollama) can answer a whole percentage such as 85.
      const { confidence: stated } = parsed.data;
      const confidence = Number.isInteger(stated) && stated > 1 && stated <= 100 ? stated / 100 : stated;
      if (confidence < 0 || confidence > 1) throw unusable("AI provider returned invalid classification");
      const chosen = parsed.data.category === null ? null : candidateByLabel(candidates, parsed.data.category);
      if (chosen === undefined) throw unusable("AI provider returned a category outside the candidate list");
      log.debug("provider answered", { print: print.id, ...answer, category: parsed.data.category, confidence });
      return {
        categoryId: chosen?.id ?? null,
        confidence,
        reason: parsed.data.reason.slice(0, 300),
      };
    },
  });
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

/** Errors a caller expects on some models (a manual category, a folder, a model deleted meanwhile). */
function isExpectedSkip(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    (error.status === 404 || (error.status === 409 && (error.code === "manual_category" || error.code === "folder")))
  );
}

/** `force` overrides a manual category; `folders` lets a model in a folder be categorized, which moves it out of the
 * folder once applied. Imports pass neither, so a model filed into a folder or by hand stays there. */
type CategorizeOptions = { force?: boolean; folders?: boolean };

async function loadCategorizable(userId: string, printId: string, options: CategorizeOptions) {
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, include: { category: true } });
  if (!print) throw new HttpError(404, "Print not found");
  const inFolder = isFolder(print);
  if (inFolder && !options.folders) throw new HttpError(409, "Models in folders are not AI-categorized", "folder");
  // Folder models are filed by hand too, but asking for folders is asking to move them.
  if (!inFolder && print.categorySource === "MANUAL" && !options.force) {
    throw new HttpError(409, "This category was set manually", "manual_category");
  }
  return { print, overrideManual: inFolder || Boolean(options.force) };
}

/** `source` only labels the log line: an import, a bulk run, or a request for one model. */
export async function categorizePrint(
  userId: string,
  printId: string,
  options: CategorizeOptions & { source?: "import" | "run" | "request" } = {},
): Promise<CategorizationOutcome> {
  const fields = { print: printId, source: options.source ?? "request" };
  const started = Date.now();
  try {
    const outcome = await categorizeOne(userId, printId, options);
    log.info("model categorized", { ...fields, outcome, ms: Date.now() - started });
    return outcome;
  } catch (error) {
    if (isExpectedSkip(error)) log.info("model skipped", { ...fields, reason: (error as Error).message });
    else log.warn("model categorization failed", { ...fields, error: noSecretError(error), ms: Date.now() - started });
    throw error;
  }
}

async function categorizeOne(
  userId: string,
  printId: string,
  options: CategorizeOptions,
): Promise<CategorizationOutcome> {
  const settings = await getAiCategorizationSettings();
  if (!aiCategorizationEnabled(settings)) throw new HttpError(503, "AI categorization is disabled", "ai_disabled");
  const { print, overrideManual } = await loadCategorizable(userId, printId, options);
  const candidates = await candidateCategories(userId, print.aiRejectedCategoryIds);
  if (!candidates.length) {
    await clearSuggestion(print.id);
    return "no_match";
  }

  const answer = await limited(settings.connectionId ?? "", settings.concurrency, () =>
    requestProvider(print, candidates, settings),
  );
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
  if (!overrideManual) {
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
  void getAiCategorizationSettings().then(
    (settings) => {
      if (!aiCategorizationEnabled(settings) || !settings.onImport) return;
      // categorizePrint logs its own outcome and failure.
      return categorizePrint(userId, printId, { source: "import" }).catch(() => undefined);
    },
    (error) => log.warn("could not read the AI settings for an imported model", { print: printId, error }),
  );
}

// Models waiting on the provider for one owner's request, so a second click doesn't ask twice.
const queuedPrints = new Set<string>();

/**
 * Categorizes one model in the background and tells its owner the outcome as a notification: a slow local model
 * would otherwise outlast the proxy in front of the request. What the caller can act on (AI turned off, a missing
 * model, a manual category to confirm) is still thrown here, before anything is queued.
 */
export async function queueAiCategorization(userId: string, printId: string, options: { force?: boolean } = {}) {
  const settings = await getAiCategorizationSettings();
  if (!aiCategorizationEnabled(settings)) throw new HttpError(503, "AI categorization is disabled", "ai_disabled");
  const categorize = { force: options.force, folders: true };
  const { print } = await loadCategorizable(userId, printId, categorize);
  // One at a time: a new suggestion would replace the one awaiting review unseen.
  if (print.aiSuggestion !== null) {
    throw new HttpError(409, "Accept or reject the suggested category first", "suggestion_pending");
  }
  if (queuedPrints.has(printId)) return;
  queuedPrints.add(printId);
  void categorizePrint(userId, printId, { ...categorize, source: "request" })
    .then(
      (outcome) => notifyOutcome(userId, printId, outcome),
      (error) => notifyFailure(userId, printId, error),
    )
    .catch((error) => log.warn("could not notify the AI categorization outcome", { print: printId, error }))
    .finally(() => queuedPrints.delete(printId));
}

async function notifyOutcome(userId: string, printId: string, outcome: CategorizationOutcome): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) return;
  const name = print.title || print.name;
  const paths = await aiCategoryPaths(userId);
  const suggestion = suggestionSchema.safeParse(print.aiSuggestion);
  const suggested = suggestion.success ? paths.get(suggestion.data.categoryId) : undefined;
  const current = print.categoryId ? paths.get(print.categoryId) : undefined;
  const title =
    outcome === "applied"
      ? `"${name}" was categorized as ${current ?? "a category"}`
      : outcome === "suggested"
        ? `AI suggests ${suggested ?? "a category"} for "${name}"`
        : outcome === "unchanged"
          ? `"${name}" keeps its category${current ? ` ${current}` : ""}`
          : `AI found no category that fits "${name}"`;
  await createNotification(userId, {
    type: "ai",
    title,
    body: outcome === "suggested" && suggestion.success ? suggestion.data.reason : null,
    internalPath: `/models/${printId}`,
  });
}

async function notifyFailure(userId: string, printId: string, error: unknown): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, select: { name: true, title: true } });
  if (!print) return;
  await createNotification(userId, {
    type: "ai",
    title: `Couldn't categorize "${print.title || print.name}"`,
    body: noSecretError(error).message,
    internalPath: `/models/${printId}`,
  });
}

export async function acceptAiSuggestion(userId: string, printId: string): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const suggestion = suggestionSchema.safeParse(print.aiSuggestion);
  if (!suggestion.success) throw new HttpError(404, "No AI suggestion found");
  const category = await prisma.category.findFirst({ where: { id: suggestion.data.categoryId, userId } });
  if (!category) throw new HttpError(409, "Suggested category no longer exists", "stale");
  // A provider's is the mapped category an import would have filed it under, so it's recorded the same way.
  const source = suggestion.data.provider ? "RULE" : "AI";
  await setPrintCategory(userId, print.id, category.id, source, { clearSuggestion: true });
}

/** Offers the category a provider's own maps to, in the slot an AI suggestion takes: it's reviewed the same way, and
 *  a later AI answer replaces it. Nothing moves until the owner accepts. Not offered when the model is already there
 *  or the owner turned that category down. */
export async function suggestMappedCategory(
  print: Pick<Print, "id" | "categoryId" | "aiRejectedCategoryIds">,
  categoryId: string,
  provider: string,
): Promise<void> {
  if (categoryId === print.categoryId || print.aiRejectedCategoryIds.includes(categoryId)) return;
  const suggestion: Suggestion = {
    categoryId,
    confidence: 1,
    reason: "",
    model: provider,
    createdAt: new Date().toISOString(),
    provider,
  };
  await prisma.print.update({
    where: { id: print.id },
    data: { aiSuggestion: suggestion as unknown as Prisma.InputJsonValue },
  });
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

/** `aiShown`: whether AI's suggestions are shown now. A provider's needs no AI, so it always is. */
export async function aiSuggestionOut(
  userId: string,
  value: unknown,
  categoryPaths?: Map<string, string>,
  aiShown = true,
): Promise<{
  category_id: string;
  category_path: string;
  confidence: number;
  reason: string;
  model: string;
  created_at: string;
  provider: string | null;
} | null> {
  const suggestion = suggestionSchema.safeParse(value);
  if (!suggestion.success) return null;
  if (!aiShown && !suggestion.data.provider) return null;
  const path = (categoryPaths ?? (await aiCategoryPaths(userId))).get(suggestion.data.categoryId);
  if (!path) return null;
  return {
    category_id: suggestion.data.categoryId,
    category_path: path,
    confidence: suggestion.data.confidence,
    reason: suggestion.data.reason,
    model: suggestion.data.model,
    created_at: suggestion.data.createdAt,
    provider: suggestion.data.provider ?? null,
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
  /** The category it had was already the best fit. */
  unchanged: number;
  failed: number;
  cancelled: boolean;
  lastError: string | null;
};

const runs = new Map<string, AiCategorizationRun>();

/** Anyone's run, so the feature isn't switched off under it. */
export function aiCategorizationRunActive(): boolean {
  return [...runs.values()].some((run) => run.running);
}

export function currentAiCategorizationRun(userId: string): AiCategorizationRun | null {
  return runs.get(userId) ?? null;
}

export async function aiCategorizationCounts(userId: string) {
  const [uncategorized, folder, grouped] = await Promise.all([
    // A tool's models are kept as the tool brought them (toolsService.ts), so no run takes them.
    prisma.print.count({ where: { userId, categoryId: null, toolId: null } }),
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

/** Which models a run takes. `manual` also takes older categories, which may have been picked by hand.
 *  `printIds` narrows it to the models picked in a grid; the flags still apply to those. */
export type AiRunScope = {
  uncategorized: boolean;
  folders: boolean;
  ai: boolean;
  rule: boolean;
  manual: boolean;
  printIds?: string[];
};

export function startAiCategorizationRun(userId: string, scope: AiRunScope): AiCategorizationRun | null {
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
    unchanged: 0,
    failed: 0,
    cancelled: false,
    lastError: null,
  };
  runs.set(userId, run);
  log.info("run started", { user: userId, ...scope, printIds: scope.printIds?.length });
  void runAiCategorization(userId, run, scope)
    .catch((error) => {
      run.failed++;
      run.lastError = noSecretError(error).message;
      log.error("run crashed", { user: userId, error: noSecretError(error) });
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      const summary = {
        user: userId,
        total: run.total,
        done: run.done,
        applied: run.applied,
        suggested: run.suggested,
        no_match: run.noMatch,
        unchanged: run.unchanged,
        failed: run.failed,
        cancelled: run.cancelled,
        last_error: run.lastError ?? undefined,
      };
      if (run.failed) log.warn("run finished with failures", summary);
      else log.info("run finished", summary);
      void createLog({ userId, action: "ai_categorization_run", details: { ...run } });
      void notifyRunFinished(userId, run).catch((error) =>
        log.warn("could not notify the AI categorization run", { user: userId, error }),
      );
    });
  return run;
}

async function runAiCategorization(userId: string, run: AiCategorizationRun, scope: AiRunScope): Promise<void> {
  const prints = await prisma.print.findMany({
    where: { userId, toolId: null, ...(scope.printIds ? { id: { in: scope.printIds } } : {}) },
    include: { category: { select: { kind: true } } },
    orderBy: { createdAt: "asc" },
  });
  const selected = prints.filter((print) => {
    if (print.category?.kind === "folder") return scope.folders;
    if (!print.categoryId) return scope.uncategorized;
    if (print.categorySource === "AI") return scope.ai;
    if (print.categorySource === "RULE") return scope.rule;
    return scope.manual;
  });
  run.total = selected.length;
  log.info("run selected models", { user: userId, total: run.total, library: prints.length });
  let consecutiveProviderFailures = 0;
  for (const print of selected) {
    if (run.cancelled) break;
    let stop = false;
    try {
      const outcome = await categorizePrint(userId, print.id, {
        force: scope.manual,
        folders: scope.folders,
        source: "run",
      });
      consecutiveProviderFailures = 0;
      if (outcome === "applied") run.applied++;
      else if (outcome === "suggested") run.suggested++;
      else if (outcome === "no_match") run.noMatch++;
      else run.unchanged++;
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 409 &&
        (error.code === "manual_category" || error.code === "folder")
      ) {
        consecutiveProviderFailures = 0;
      } else if (error instanceof HttpError && error.status === 503 && error.code === "ai_disabled") {
        run.lastError = noSecretError(error).message;
        log.warn("run stopped: AI categorization was turned off", { user: userId, done: run.done });
        stop = true;
      } else {
        run.failed++;
        consecutiveProviderFailures++;
        if (consecutiveProviderFailures >= 5) {
          run.lastError = "AI provider is failing repeatedly; run stopped after 5 consecutive failures";
          log.warn("run stopped after 5 consecutive failures", { user: userId, done: run.done + 1 });
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

function models(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function notifyRunFinished(userId: string, run: AiCategorizationRun): Promise<void> {
  if (!run.total) return;
  // Only what happened: "0 models have no fitting category" tells the owner nothing.
  const parts = [
    run.applied && models(run.applied, "model was categorized", "models were categorized"),
    run.suggested && models(run.suggested, "model got a suggested category", "models got a suggested category"),
    run.unchanged &&
      models(
        run.unchanged,
        "model already has the best fitting category",
        "models already have the best fitting category",
      ),
    run.noMatch && models(run.noMatch, "model has no fitting category", "models have no fitting category"),
    run.failed && models(run.failed, "model couldn't be categorized", "models couldn't be categorized"),
  ].filter(Boolean);
  const lastError = run.failed && run.lastError ? ` Last error: ${run.lastError}` : "";
  await createNotification(userId, {
    type: "ai",
    title: run.cancelled
      ? `AI categorization stopped after ${run.done} of ${run.total} models`
      : `AI categorization finished ${run.total} ${run.total === 1 ? "model" : "models"}`,
    body: parts.length ? `${parts.join(". ")}.${lastError}` : null,
  });
}

export function cancelAiCategorizationRun(userId: string): AiCategorizationRun | null {
  const run = runs.get(userId);
  if (!run) return null;
  if (run.running && !run.cancelled)
    log.info("run cancel requested", { user: userId, done: run.done, total: run.total });
  run.cancelled = true;
  return run;
}

// A model list comes back quickly or not at all; this only fills the settings form's suggestions.
const MODEL_LIST_TIMEOUT_MS = 10_000;

/**
 * The models a provider serves, from the OpenAI-style `GET /models` that Ollama, LM Studio, vLLM, OpenAI, OpenRouter
 * and Gemini all answer, so the settings form can suggest them.
 */
export async function listAiProviderModels(provider: {
  baseUrl: string | null;
  apiKey: string | null;
}): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  if (!provider.baseUrl) return { ok: false, error: "Set the API base URL first" };
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
      headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `AI provider returned HTTP ${response.status}` };
    const body = (await response.json()) as { data?: unknown };
    const ids = Array.isArray(body.data)
      ? body.data.flatMap((item) =>
          item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
            ? [(item as { id: string }).id]
            : [],
        )
      : [];
    return { ok: true, models: [...new Set(ids)].toSorted((a, b) => a.localeCompare(b)) };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `The AI provider did not answer within ${MODEL_LIST_TIMEOUT_MS / 1000} s`
        : noSecretError(error).message;
    return { ok: false, error: provider.apiKey ? message.replaceAll(provider.apiKey, "[redacted]") : message };
  }
}

/** Asks a provider to categorize a calibration cube, so a connection can be checked before it's saved. */
export async function testAiProvider(
  provider: ProviderSettings,
): Promise<{ ok: true; latencyMs: number; model: string } | { ok: false; error: string }> {
  if (!provider.baseUrl || !provider.model) return { ok: false, error: "Set the API base URL and model name first" };
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
      { ...provider, sendImage: false },
      // A test answers the admin who is waiting on it; one attempt says whether the connection works.
      1,
    );
    return { ok: true, latencyMs: Date.now() - start, model: provider.model };
  } catch (error) {
    const message = noSecretError(error).message;
    return { ok: false, error: provider.apiKey ? message.replaceAll(provider.apiKey, "[redacted]") : message };
  }
}
