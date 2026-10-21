import { createHash } from "node:crypto";
import { Prisma, type Print } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { createLogger } from "../logger";
import { createLog } from "./auditLog";
import { createNotification } from "./notificationService";
import { resolveAiProvider, type ResolvedAiProvider } from "./aiConnectionService";
import { askProvider, limited, noSecretError, previewPart, type ProviderContent } from "./aiProviderClient";
import { getAiDescriptionPrefs, type AiDescriptionActions, type AiDescriptionPrefs } from "./settingsService";

const log = createLogger("ai-descriptions");

export type AiDescriptionSettings = AiDescriptionPrefs & ResolvedAiProvider;

export async function getAiDescriptionSettings(): Promise<AiDescriptionSettings> {
  const prefs = await getAiDescriptionPrefs();
  return { ...prefs, ...(await resolveAiProvider(prefs.aiConnectionId)) };
}

export function aiDescriptionsEnabled(settings: AiDescriptionSettings): boolean {
  return settings.enabled && Boolean(settings.baseUrl && settings.model);
}

const suggestionSchema = z.object({ notes: z.string(), model: z.string(), createdAt: z.string() });
type Suggestion = z.infer<typeof suggestionSchema>;

export type DescriptionOutcome = "suggested" | "applied" | "unchanged" | "skipped";

// Past this a description is left alone: a rewrite of it would outgrow what most models answer in one go.
const MAX_DESCRIPTION_CHARS = 12_000;
// A whole description comes back, which on a CPU takes minutes, so the answer streams and is waited on piece by
// piece: as long as the model keeps writing, however slowly. Reading a long description before the first piece
// gets at least FIRST_PIECE_MS, or the model's own timeout if that's longer.
const FIRST_PIECE_MS = 120_000;
const BETWEEN_PIECES_MS = 60_000;

const RULES: Record<Exclude<keyof AiDescriptionActions, "generateMissing">, string> = {
  removeSelfPromotion:
    "Remove self-promotion: links or calls to visit the author's profile, shop, social media, Patreon or Ko-fi, " +
    "and links or mentions meant to advertise their other models.",
  removeUnrelated:
    "Remove text unrelated to the model itself, such as requests for likes, boosts, ratings, follows, comments, " +
    "makes or donations.",
  translate: "If the description is not in English, translate it to English.",
  fixSpelling: "Fix obvious spelling and grammar mistakes without rewording anything else.",
  improveFormatting:
    "Improve the formatting: clear paragraphs, and Markdown lists or headings where they make it easier to read.",
};

/** What the AI looked at: the description and what it was asked to do. A run skips a model while this is unchanged. */
function checkedHash(notes: string | null, settings: AiDescriptionPrefs): string {
  const generate = settings.actions.generateMissing && settings.sendImage;
  return createHash("sha256")
    .update(JSON.stringify([notes ?? "", settings.actions, generate]))
    .digest("hex")
    .slice(0, 32);
}

/** Every image a description shows, as Markdown or HTML, by address. */
function imagesIn(notes: string): Set<string> {
  const found = new Set<string>();
  for (const match of notes.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) found.add(match[1]);
  for (const match of notes.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) found.add(match[1]);
  return found;
}

// Around the description in the prompt, so the model sees where it starts and ends. Named rather than symbols like
// "<<<", which a small model copied into its answer as if they were part of the text.
const DESCRIPTION_START = "--- DESCRIPTION START ---";
const DESCRIPTION_END = "--- DESCRIPTION END ---";

/** The answer without a start or end marker the model echoed back anyway, the old "<<<"/">>>" ones included. */
function withoutMarkers(answer: string): string {
  return answer
    .trim()
    .replace(/^(?:-{3} DESCRIPTION START -{3}|<<<)[ \t]*\n?/i, "")
    .replace(/\n?[ \t]*(?:-{3} DESCRIPTION END -{3}|>>>)$/i, "")
    .trim();
}

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Why a model was left alone without asking the AI, for the owner who asked about that one. */
type SkipReason = "no_description" | "too_long" | "nothing_selected" | "no_image" | "checked";
type Rewrite = { notes: string } | "unchanged" | { skipped: SkipReason };

async function requestRewrite(print: Print, settings: AiDescriptionSettings, attempts = 3): Promise<Rewrite> {
  const notes = print.notes?.trim() ?? "";
  const generating = !notes;
  if (generating && !(settings.actions.generateMissing && settings.sendImage)) return { skipped: "no_description" };
  if (notes.length > MAX_DESCRIPTION_CHARS) return { skipped: "too_long" };
  const rules = (Object.keys(RULES) as (keyof typeof RULES)[]).filter((key) => settings.actions[key]);
  if (!generating && !rules.length) return { skipped: "nothing_selected" };
  const image = await previewPart(print.id, settings.sendImage);
  if (generating && !image) return { skipped: "no_image" };

  const content: ProviderContent = [
    {
      type: "text",
      text: [
        "You edit the description of a 3D-printable model's listing. The description is Markdown.",
        ...(generating
          ? [
              "The model has no description. Write a short, factual one (two to four sentences) saying what the " +
                "printed object is and what it is for, from the title, the tags and the image. Don't invent print " +
                "settings, sizes or materials.",
            ]
          : [
              "Make only these changes:",
              ...rules.map((key) => `- ${RULES[key]}`),
              // The removals above are about promotion and noise; these say outright what they must never take.
              "Always keep, even when a change above would touch it:",
              "- Print instructions: printer and slicer settings, layer height, infill, walls, supports, " +
                "orientation, filament or material, temperatures, and any other advice on printing it.",
              "- Every image, whether Markdown (![...](...)), an HTML <img> tag or an image inside a link, exactly " +
                "as written and in the same place in the text.",
              "- Instructions and steps for assembling, finishing or using the model, in the same order, with the " +
                "images between them.",
              "- Sizes, part lists, hardware needed, licence and credits, and any HTML markup as it is.",
              "Never invent facts. Return the whole description, not only the parts you changed, and without " +
                `the ${DESCRIPTION_START} and ${DESCRIPTION_END} lines around it.`,
              "If none of these changes apply, set changed to false.",
            ]),
        "",
        "The model:",
        `Title: ${print.title ?? print.name}`,
        `Tags: ${print.tags.join(", ") || "none"}`,
        ...(generating ? [] : [DESCRIPTION_START, notes, DESCRIPTION_END]),
      ].join("\n"),
    },
  ];
  if (image) content.push(image);
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { changed: { type: "boolean" }, description: { type: "string" } },
    required: ["changed", "description"],
  };
  const before = imagesIn(notes);
  return askProvider<Rewrite>({
    settings,
    content,
    schemaName: "description",
    schema,
    // The whole description comes back, so the budget grows with it. 2 characters a token, not the usual 3 or
    // 4: image URLs and HTML escaped into JSON take more.
    answerTokens: Math.min(32768, Math.ceil(notes.length / 2) + 1024),
    attempts,
    log: log.child({ print: print.id, model: settings.model }),
    noAnswer: "no description",
    stream: { firstChunkMs: Math.max(settings.timeoutMs, FIRST_PIECE_MS), idleMs: BETWEEN_PIECES_MS },
    read: (json, unusable) => {
      const parsed = z.object({ changed: z.boolean(), description: z.string() }).safeParse(json);
      if (!parsed.success) throw unusable("AI provider returned an invalid description");
      const rewritten = withoutMarkers(parsed.data.description);
      if (!parsed.data.changed && !generating) return "unchanged";
      if (!rewritten) {
        if (generating) throw unusable("AI provider returned an empty description");
        return "unchanged";
      }
      if (!generating && same(rewritten, notes)) return "unchanged";
      // Images are the model's own pictures; a rewrite that loses one isn't offered.
      const after = imagesIn(rewritten);
      if ([...before].some((url) => !after.has(url)))
        throw unusable("AI provider dropped an image from the description");
      return { notes: rewritten };
    },
  });
}

/** Applies a rewrite, keeping the first original so it can be reverted. Null when the description changed meanwhile. */
async function applyRewrite(print: Print, notes: string, settings: AiDescriptionPrefs): Promise<boolean> {
  const { count } = await prisma.print.updateMany({
    where: { id: print.id, notes: print.notes },
    data: {
      notes,
      aiDescriptionOriginal: print.aiDescriptionOriginal ?? print.notes ?? "",
      aiDescriptionAppliedAt: new Date(),
      aiDescriptionSuggestion: Prisma.DbNull,
      aiDescriptionCheckedHash: checkedHash(notes, settings),
    },
  });
  return count > 0;
}

/** What the model page shows of Improved descriptions for one model; nothing while the feature is off. */
export async function aiDescriptionOut(print: Pick<Print, "aiDescriptionSuggestion" | "aiDescriptionOriginal">) {
  if (!aiDescriptionsEnabled(await getAiDescriptionSettings())) return undefined;
  const suggestion = suggestionSchema.safeParse(print.aiDescriptionSuggestion);
  return {
    ai_description_suggestion: suggestion.success
      ? { notes: suggestion.data.notes, created_at: suggestion.data.createdAt }
      : null,
    ai_description_original: print.aiDescriptionOriginal,
  };
}

/** Errors a run expects on some models: one deleted meanwhile. */
function isExpectedSkip(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

/** `source` only labels the log line. `force` ignores that nothing changed since the last pass. */
export async function improvePrintDescription(
  userId: string,
  printId: string,
  options: { source?: "import" | "run"; force?: boolean } = {},
): Promise<DescriptionOutcome> {
  return (await improveWithReason(userId, printId, options)).outcome;
}

async function improveWithReason(
  userId: string,
  printId: string,
  options: { source?: "import" | "run" | "request"; force?: boolean },
): Promise<{ outcome: DescriptionOutcome; reason?: SkipReason }> {
  const fields = { print: printId, source: options.source ?? "run" };
  const started = Date.now();
  try {
    const result = await improveOne(userId, printId, options.force ?? false);
    log.info("description checked", { ...fields, ...result, ms: Date.now() - started });
    return result;
  } catch (error) {
    if (isExpectedSkip(error)) log.info("description skipped", { ...fields, reason: (error as Error).message });
    else log.warn("description failed", { ...fields, error: noSecretError(error), ms: Date.now() - started });
    throw error;
  }
}

async function improveOne(
  userId: string,
  printId: string,
  force: boolean,
): Promise<{ outcome: DescriptionOutcome; reason?: SkipReason }> {
  const settings = await getAiDescriptionSettings();
  if (!aiDescriptionsEnabled(settings)) throw new HttpError(503, "Improved descriptions are off", "ai_disabled");
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  const hash = checkedHash(print.notes, settings);
  if (!force && print.aiDescriptionCheckedHash === hash) return { outcome: "skipped", reason: "checked" };

  const rewrite = await limited(settings.connectionId ?? "", settings.concurrency, () =>
    requestRewrite(print, settings),
  );
  if (rewrite === "unchanged") {
    await prisma.print.updateMany({
      where: { id: print.id, notes: print.notes },
      data: { aiDescriptionCheckedHash: hash, aiDescriptionSuggestion: Prisma.DbNull },
    });
    return { outcome: "unchanged" };
  }
  if ("skipped" in rewrite) return { outcome: "skipped", reason: rewrite.skipped };
  const { notes } = rewrite;
  if (settings.mode === "auto") {
    return { outcome: (await applyRewrite(print, notes, settings)) ? "applied" : "unchanged" };
  }
  const suggestion: Suggestion = { notes, model: settings.model!, createdAt: new Date().toISOString() };
  const { count } = await prisma.print.updateMany({
    where: { id: print.id, notes: print.notes },
    data: { aiDescriptionSuggestion: suggestion as unknown as Prisma.InputJsonValue, aiDescriptionCheckedHash: hash },
  });
  return { outcome: count ? "suggested" : "unchanged" };
}

// Models waiting on the provider for their owner's request, so a second click doesn't ask twice.
const queuedPrints = new Set<string>();

/**
 * Improves one model's description in the background, for its owner who asked, and tells them the outcome as a
 * notification: a whole description takes minutes on a slow model. It doesn't skip a model with nothing new: they
 * asked about this one. What they can act on (the feature off, a missing model) is thrown before anything is queued.
 */
export async function queueAiDescription(userId: string, printId: string): Promise<void> {
  if (!aiDescriptionsEnabled(await getAiDescriptionSettings())) {
    throw new HttpError(503, "Improved descriptions are off", "ai_disabled");
  }
  const print = await ownPrint(userId, printId);
  // One at a time: a new suggestion would replace the one awaiting review unseen.
  if (print.aiDescriptionSuggestion !== null) {
    throw new HttpError(409, "Accept or reject the suggested description first", "suggestion_pending");
  }
  if (queuedPrints.has(printId)) return;
  queuedPrints.add(printId);
  void improveWithReason(userId, printId, { source: "request", force: true })
    .then(
      (result) => notifyOutcome(userId, printId, result),
      (error) => notifyFailure(userId, printId, error),
    )
    .catch((error) => log.warn("could not notify the description outcome", { print: printId, error }))
    .finally(() => queuedPrints.delete(printId));
}

const SKIPPED: Record<SkipReason, string> = {
  no_description:
    "It has no description, and writing one needs the preview image to be sent. An admin can turn that on.",
  no_image: "It has no description, and no preview image to write one from.",
  too_long: "Its description is too long to rewrite in one go.",
  nothing_selected: "No changes are turned on for Improved descriptions. An admin can choose them.",
  checked: "Nothing changed since its last check.",
};

async function notifyOutcome(
  userId: string,
  printId: string,
  { outcome, reason }: { outcome: DescriptionOutcome; reason?: SkipReason },
): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, select: { name: true, title: true } });
  if (!print) return;
  const name = print.title || print.name;
  const [title, body] =
    outcome === "suggested"
      ? [`AI suggests a better description for "${name}"`, "Open the model to compare it and accept or reject it."]
      : outcome === "applied"
        ? [`AI improved the description of "${name}"`, "The original is kept, so you can revert it on the model page."]
        : outcome === "unchanged"
          ? [`The description of "${name}" needs no changes`, null]
          : [`Couldn't improve the description of "${name}"`, reason ? SKIPPED[reason] : null];
  await createNotification(userId, { type: "ai", title, body, internalPath: `/models/${printId}` });
}

async function notifyFailure(userId: string, printId: string, error: unknown): Promise<void> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId }, select: { name: true, title: true } });
  if (!print) return;
  await createNotification(userId, {
    type: "ai",
    title: `Couldn't improve the description of "${print.title || print.name}"`,
    body: noSecretError(error).message,
    internalPath: `/models/${printId}`,
  });
}

/** Import creation never waits on a provider. */
export function enqueueAiDescription(userId: string, printId: string): void {
  void getAiDescriptionSettings().then(
    (settings) => {
      if (!aiDescriptionsEnabled(settings) || !settings.onImport) return;
      // improvePrintDescription logs its own outcome and failure.
      return improvePrintDescription(userId, printId, { source: "import" }).catch(() => undefined);
    },
    (error) => log.warn("could not read the settings for an imported model", { print: printId, error }),
  );
}

async function ownPrint(userId: string, printId: string): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  return print;
}

export async function acceptAiDescription(userId: string, printId: string): Promise<void> {
  const print = await ownPrint(userId, printId);
  const suggestion = suggestionSchema.safeParse(print.aiDescriptionSuggestion);
  if (!suggestion.success) throw new HttpError(404, "No suggested description found");
  if (!(await applyRewrite(print, suggestion.data.notes, await getAiDescriptionPrefs()))) {
    throw new HttpError(409, "The description changed meanwhile", "stale");
  }
}

/** The suggestion goes; the model is skipped by later runs until its description or the options change. */
export async function rejectAiDescription(userId: string, printId: string): Promise<void> {
  const print = await ownPrint(userId, printId);
  if (!suggestionSchema.safeParse(print.aiDescriptionSuggestion).success) {
    throw new HttpError(404, "No suggested description found");
  }
  await prisma.print.update({ where: { id: print.id }, data: { aiDescriptionSuggestion: Prisma.DbNull } });
}

/** Puts back the description from before the AI changed it, and keeps later runs from changing it again. */
export async function revertAiDescription(userId: string, printId: string): Promise<void> {
  const print = await ownPrint(userId, printId);
  if (print.aiDescriptionOriginal === null) throw new HttpError(404, "No original description to restore");
  const original = print.aiDescriptionOriginal || null;
  await prisma.print.update({
    where: { id: print.id },
    data: {
      notes: original,
      aiDescriptionOriginal: null,
      aiDescriptionAppliedAt: null,
      aiDescriptionSuggestion: Prisma.DbNull,
      aiDescriptionCheckedHash: checkedHash(original, await getAiDescriptionPrefs()),
    },
  });
}

/** A description edited by hand makes a pending suggestion stale, and the kept original no longer the one to revert to. */
export async function forgetAiDescription(printId: string): Promise<void> {
  await prisma.print.update({
    where: { id: printId },
    data: { aiDescriptionSuggestion: Prisma.DbNull, aiDescriptionOriginal: null, aiDescriptionAppliedAt: null },
  });
}

export type DescriptionSuggestionOut = {
  id: string;
  name: string;
  title: string | null;
  original: string;
  suggested: string;
  model: string;
  created_at: string;
};

export async function listAiDescriptionSuggestions(userId: string, limit: number, offset: number) {
  const where = { userId, aiDescriptionSuggestion: { not: Prisma.DbNull } };
  const [total, rows] = await Promise.all([
    prisma.print.count({ where }),
    prisma.print.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: offset,
      take: limit,
      select: { id: true, name: true, title: true, notes: true, aiDescriptionSuggestion: true },
    }),
  ]);
  const items: DescriptionSuggestionOut[] = rows.flatMap((row) => {
    const suggestion = suggestionSchema.safeParse(row.aiDescriptionSuggestion);
    if (!suggestion.success) return [];
    return [
      {
        id: row.id,
        name: row.name,
        title: row.title,
        original: row.notes ?? "",
        suggested: suggestion.data.notes,
        model: suggestion.data.model,
        created_at: suggestion.data.createdAt,
      },
    ];
  });
  return { total, items };
}

export async function listAiDescriptionsApplied(userId: string, limit: number, offset: number) {
  const where = { userId, aiDescriptionOriginal: { not: null } };
  const [total, rows] = await Promise.all([
    prisma.print.count({ where }),
    prisma.print.findMany({
      where,
      orderBy: { aiDescriptionAppliedAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        name: true,
        title: true,
        notes: true,
        aiDescriptionOriginal: true,
        aiDescriptionAppliedAt: true,
      },
    }),
  ]);
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      original: row.aiDescriptionOriginal ?? "",
      current: row.notes ?? "",
      applied_at: row.aiDescriptionAppliedAt?.toISOString() ?? null,
    })),
  };
}

export type AiDescriptionRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  suggested: number;
  applied: number;
  /** The AI found nothing to change. */
  unchanged: number;
  /** Nothing new since the last pass, or nothing the options could do. */
  skipped: number;
  failed: number;
  cancelled: boolean;
  lastError: string | null;
};

const runs = new Map<string, AiDescriptionRun>();

/** Anyone's run, so the feature isn't switched off under it. */
export function aiDescriptionRunActive(): boolean {
  return [...runs.values()].some((run) => run.running);
}

export function currentAiDescriptionRun(userId: string): AiDescriptionRun | null {
  return runs.get(userId) ?? null;
}

/** Every model the user owns, where the ones with nothing new are skipped without asking the AI; or the models
 *  picked in a grid, which are asked about even with nothing new, as a request for one model is. */
export function startAiDescriptionRun(userId: string, printIds?: string[]): AiDescriptionRun | null {
  if (runs.get(userId)?.running) return null;
  const run: AiDescriptionRun = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    suggested: 0,
    applied: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
    lastError: null,
  };
  runs.set(userId, run);
  log.info("run started", { user: userId, printIds: printIds?.length });
  void runAiDescriptions(userId, run, printIds)
    .catch((error) => {
      run.failed++;
      run.lastError = noSecretError(error).message;
      log.error("run crashed", { user: userId, error: noSecretError(error) });
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      const summary = { user: userId, ...run, lastError: run.lastError ?? undefined };
      if (run.failed) log.warn("run finished with failures", summary);
      else log.info("run finished", summary);
      void createLog({ userId, action: "ai_description_run", details: { ...run } });
      void notifyRunFinished(userId, run).catch((error) =>
        log.warn("could not notify the description run", { user: userId, error }),
      );
    });
  return run;
}

async function runAiDescriptions(userId: string, run: AiDescriptionRun, printIds?: string[]): Promise<void> {
  const prints = await prisma.print.findMany({
    where: { userId, ...(printIds ? { id: { in: printIds } } : {}) },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  run.total = prints.length;
  let consecutiveFailures = 0;
  for (const print of prints) {
    if (run.cancelled) break;
    let stop = false;
    try {
      const outcome = await improvePrintDescription(userId, print.id, { source: "run", force: Boolean(printIds) });
      consecutiveFailures = 0;
      run[outcome]++;
    } catch (error) {
      if (isExpectedSkip(error)) {
        run.skipped++;
      } else if (error instanceof HttpError && error.code === "ai_disabled") {
        run.lastError = noSecretError(error).message;
        stop = true;
      } else {
        run.failed++;
        consecutiveFailures++;
        run.lastError = noSecretError(error).message;
        if (consecutiveFailures >= 5) {
          run.lastError = "AI provider is failing repeatedly; run stopped after 5 consecutive failures";
          stop = true;
        }
      }
    }
    run.done++;
    if (stop) break;
  }
}

export function cancelAiDescriptionRun(userId: string): AiDescriptionRun | null {
  const run = runs.get(userId);
  if (!run) return null;
  run.cancelled = true;
  return run;
}

function models(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

async function notifyRunFinished(userId: string, run: AiDescriptionRun): Promise<void> {
  if (!run.total) return;
  // Only what happened: "0 descriptions improved" tells the owner nothing.
  const parts = [
    run.applied && models(run.applied, "description was improved", "descriptions were improved"),
    run.suggested && models(run.suggested, "model got a suggested description", "models got a suggested description"),
    run.unchanged && models(run.unchanged, "description needed no changes", "descriptions needed no changes"),
    run.failed && models(run.failed, "description couldn't be checked", "descriptions couldn't be checked"),
  ].filter(Boolean);
  const lastError = run.failed && run.lastError ? ` Last error: ${run.lastError}` : "";
  await createNotification(userId, {
    type: "ai",
    title: run.cancelled
      ? `Improving descriptions stopped after ${run.done} of ${run.total} models`
      : `Improving descriptions finished ${run.total} ${run.total === 1 ? "model" : "models"}`,
    body: parts.length ? `${parts.join(". ")}.${lastError}` : null,
  });
}
