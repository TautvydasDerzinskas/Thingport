import type { TFunction } from "i18next";
import type {
  AdminQueueJobOut,
  ImportJobItem,
  ImportJobStatus,
  ImportJobType,
  LineOut,
  QueueJobOut,
  QueueOut,
  QueueSubmitAnswer,
} from "../../api/imports";
import { importProviderInfo } from "../../constants/importProviders";
import { detectImportProvider } from "../../utils/importLinkDetection";
import { relativeTime } from "../../utils/relativeTime";

// What the queue shows, worked out away from React. No error boundary sits above it, so a crash here would blank the
// app: whatever comes off the wire goes through toQueueJob first, and every lookup has a fallback.

export type QueueSection = "run" | "att" | "wait" | "done";
export type QueueScope = "mine" | "everyone";

export const QUEUE_SECTIONS: QueueSection[] = ["run", "att", "wait", "done"];

export type JobOwner = { id: string; display_name: string; email: string };

export type QueueJob = QueueJobOut & { owner: JobOwner | null };

/** A row off the wire. A backend older than the line sends only what its admin page needed. */
export type RawQueueJob = Partial<QueueJobOut> & { id: string; owner?: JobOwner | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTENTION_WINDOW_MS = 7 * DAY_MS;
// Enqueueing takes a moment after the row is made; longer than this, it was started or retried later on.
const REJOINED_AFTER_MS = 60_000;
const JUST_NOW_MS = 60_000;

const numberOr0 = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

function toQueueJobFields(raw: RawQueueJob) {
  return {
    id: raw.id,
    type: raw.type as ImportJobType,
    status: raw.status as ImportJobStatus,
    source_url: textOrNull(raw.source_url) ?? "",
    source_label: textOrNull(raw.source_label),
    provider: textOrNull(raw.provider),
    total: numberOr0(raw.total),
    processed: numberOr0(raw.processed),
    imported: numberOr0(raw.imported),
    already_in_library: numberOr0(raw.already_in_library),
    failed_count: numberOr0(raw.failed_count),
    error_message: textOrNull(raw.error_message),
    result_collection_id: textOrNull(raw.result_collection_id),
    result_print_id: textOrNull(raw.result_print_id),
    owner: typeof raw.owner?.id === "string" ? raw.owner : null,
    single: raw.single === true,
    position: typeof raw.position === "number" ? raw.position : null,
    queued_at: textOrNull(raw.queued_at),
    started_at: textOrNull(raw.started_at),
    created_at: textOrNull(raw.created_at) ?? "",
    updated_at: textOrNull(raw.updated_at) ?? "",
    pending_count: numberOr0(raw.pending_count),
    running_count: numberOr0(raw.running_count),
    done_count: numberOr0(raw.done_count),
    failed_items_count: numberOr0(raw.failed_items_count),
    runner_live: raw.runner_live === true,
    collection_sync_id: textOrNull(raw.collection_sync_id),
    sync_waiting: raw.sync_waiting === true,
    failure_reason: textOrNull(raw.failure_reason) ?? textOrNull(raw.error_message),
    outcome: raw.outcome ?? null,
  };
}

/** The server's rule, for rows that come without it. */
function olderBackendAttention(job: ReturnType<typeof toQueueJobFields>, now: number): boolean {
  const problem = job.status === "ERROR" || (job.status === "DONE" && job.failed_count > 0 && job.type !== "ZIP");
  return problem && now - Date.parse(job.updated_at) < ATTENTION_WINDOW_MS;
}

/** What an admin could do to a row of a backend older than the line: LINKS jobs only, and nothing while a runner lives. */
function olderBackendActions(job: ReturnType<typeof toQueueJobFields>) {
  const links = job.type === "LINKS";
  const idle = job.status !== "RUNNING" && !job.runner_live;
  return {
    // An ERROR job was cut off with links still waiting (a restart, say), and starts like a paused one.
    can_start:
      links &&
      (job.status === "PAUSED" || job.status === "ERROR") &&
      !job.runner_live &&
      job.pending_count + job.running_count > 0,
    can_pause: links && job.status === "RUNNING",
    can_retry: links && idle && job.failed_items_count > 0,
    can_delete: idle,
  };
}

/** A job with every field filled in, whichever backend it came from. */
export function toQueueJob(raw: RawQueueJob, now: number = Date.now()): QueueJob {
  const job = toQueueJobFields(raw);
  const older = olderBackendActions(job);
  return {
    ...job,
    attention: raw.attention ?? olderBackendAttention(job, now),
    can_start: raw.can_start ?? older.can_start,
    can_pause: raw.can_pause ?? older.can_pause,
    can_retry: raw.can_retry ?? older.can_retry,
    can_delete: raw.can_delete ?? older.can_delete,
  };
}

function toQueueJobs(rows: unknown, now: number): QueueJob[] {
  if (!Array.isArray(rows)) return [];
  return (rows as RawQueueJob[]).filter((row) => typeof row?.id === "string").map((row) => toQueueJob(row, now));
}

export const EMPTY_LINE: LineOut = { now: null, rows: [], length: 0 };

function toLine(raw: Partial<LineOut> | null | undefined): LineOut {
  if (!raw) return EMPTY_LINE;
  const person = (entry: { person?: unknown }) => (typeof entry.person === "string" ? entry.person : "");
  return {
    now: raw.now ? { mine: raw.now.mine === true, person: person(raw.now), job_id: textOrNull(raw.now.job_id) } : null,
    rows: (Array.isArray(raw.rows) ? raw.rows : [])
      .filter((row) => typeof row?.position === "number")
      .map((row) => ({
        position: row.position,
        mine: row.mine === true,
        person: person(row),
        job_id: textOrNull(row.job_id),
      })),
    length: numberOr0(raw.length),
  };
}

export type QueueSnapshot = {
  jobs: QueueJob[];
  finishedTotal: number;
  line: LineOut;
  startGrabLinks: boolean;
};

export function toQueueSnapshot(raw: Partial<QueueOut> | null | undefined, now: number = Date.now()): QueueSnapshot {
  return {
    jobs: toQueueJobs(raw?.jobs, now),
    finishedTotal: numberOr0(raw?.finished_total),
    line: toLine(raw?.line),
    startGrabLinks: raw?.settings?.start_grab_links === true,
  };
}

export type EveryoneQueue = {
  jobs: QueueJob[];
  /** Rows from a backend older than the line, whose bulk routes ignore who they're asked to act for. */
  olderBackend: boolean;
};

export function toEveryoneQueue(
  raw: { jobs?: AdminQueueJobOut[] } | null | undefined,
  now: number = Date.now(),
): EveryoneQueue {
  const rows = Array.isArray(raw?.jobs) ? raw.jobs : [];
  return { jobs: toQueueJobs(rows, now), olderBackend: rows.some((row) => typeof row?.can_start !== "boolean") };
}

// ---- What a job is

export const isSyncJob = (job: QueueJob) => Boolean(job.collection_sync_id);

const isFinished = (job: QueueJob) => job.status === "DONE" || job.status === "ERROR";

/** Numbered in the line, or a sync job waiting on its own lane, which starts by itself just the same. */
export const isInLine = (job: QueueJob) => job.status === "QUEUED" || job.sync_waiting;

/** Paused, but the link it was on is still running. A sync waiting for its lane has given that link up already. */
const isPausing = (job: QueueJob) => job.status === "PAUSED" && job.runner_live && !job.sync_waiting;

const isImporting = (job: QueueJob) => job.status === "RUNNING" || isPausing(job);

const isOnHold = (job: QueueJob) => job.status === "PAUSED" && !job.sync_waiting && !job.runner_live;

const hasFailures = (job: QueueJob) => job.failed_count > 0 || job.failed_items_count > 0;

export function sectionOf(job: QueueJob): QueueSection {
  switch (job.status) {
    case "RUNNING":
      return "run";
    case "QUEUED":
      return "wait";
    case "PAUSED":
      return isPausing(job) ? "run" : "wait";
    case "ERROR":
    case "DONE":
      return job.attention ? "att" : "done";
    default:
      // A status this build doesn't know: somewhere it can at least be seen and deleted.
      return "done";
  }
}

export type JobState = "running" | "queued" | "paused" | "pausing" | "error" | "partial" | "done" | "unknown";

export function jobState(job: QueueJob): JobState {
  if (job.sync_waiting) return "queued";
  switch (job.status) {
    case "RUNNING":
      return "running";
    case "QUEUED":
      return "queued";
    case "PAUSED":
      return job.runner_live ? "pausing" : "paused";
    case "ERROR":
      return "error";
    case "DONE":
      if (!hasFailures(job)) return "done";
      // One link either came in or it didn't: there's no "some" of it.
      return job.single ? "error" : "partial";
    default:
      return "unknown";
  }
}

export type ChipTone = "warning" | "info" | "neutral" | "error" | "success";

const CHIPS: Record<JobState, { tone: ChipTone; live: boolean }> = {
  running: { tone: "warning", live: true },
  queued: { tone: "info", live: false },
  paused: { tone: "neutral", live: false },
  pausing: { tone: "neutral", live: true },
  error: { tone: "error", live: false },
  partial: { tone: "warning", live: false },
  done: { tone: "success", live: false },
  unknown: { tone: "neutral", live: false },
};

/** The status chip: `live` pulses, while something is still happening. */
export function jobChip(job: QueueJob, t: TFunction) {
  const state = jobState(job);
  return {
    ...CHIPS[state],
    state,
    label: t(`importQueue.status.${state}`),
    hint: t(`importQueue.statusHint.${state}`),
  };
}

export type PrimaryAction = { kind: "pause" | "hold" | "start" | "retry"; label: string };

/** The one button on a card. The server's `can_*` decide what's possible; which of them to offer depends on the state. */
export function primaryAction(job: QueueJob, t: TFunction): PrimaryAction | null {
  const pause = (kind: "pause" | "hold"): PrimaryAction | null =>
    job.can_pause ? { kind, label: t(`importQueue.action.${kind}`) } : null;
  const start: PrimaryAction = { kind: "start", label: t("importQueue.action.start") };
  const failed = job.failed_items_count || job.failed_count;
  const retry: PrimaryAction = {
    kind: "retry",
    label: failed > 1 ? t("importQueue.action.retryMany", { count: failed }) : t("importQueue.action.retry"),
  };
  if (job.status === "RUNNING") return pause("pause");
  if (isInLine(job)) return pause("hold");
  if (job.status === "PAUSED") {
    // Pausing: the link it's on still has to finish.
    if (job.runner_live) return null;
    return job.can_start ? start : job.can_retry ? retry : null;
  }
  return job.can_retry ? retry : job.can_start ? start : null;
}

// ---- Links of a job

/** Only a job of several links has any to list. */
export const hasLinkList = (job: QueueJob) => job.type === "LINKS" && !job.single;

export function canRemoveLink(job: QueueJob, item: Pick<ImportJobItem, "status">): boolean {
  return job.status !== "RUNNING" && !job.runner_live && item.status !== "DONE";
}

/** Still marked as importing on a job nothing is running: a restart or a pause cut it off, and Start runs it again. */
export function linkWasCutOff(job: QueueJob, item: Pick<ImportJobItem, "status">): boolean {
  return item.status === "RUNNING" && job.status !== "RUNNING" && !job.runner_live;
}

/** Changes whenever a job's links may have, so an open list reads them again only then. */
export function linksVersion(job: QueueJob): string {
  return [
    job.status,
    job.updated_at,
    job.processed,
    job.pending_count,
    job.running_count,
    job.done_count,
    job.failed_items_count,
  ].join("|");
}

const LINK_STATUSES = new Set<string>(["PENDING", "RUNNING", "DONE", "FAILED"]);

/** A link's status in words, for its icon's accessible name. */
export function linkStatusText(item: Pick<ImportJobItem, "status">, t: TFunction): string | null {
  return LINK_STATUSES.has(item.status) ? t(`importQueue.itemStatus.${item.status}`) : null;
}

/** Which print profiles a link brings, when it's more than the one it points at. */
export function linkScopeText(item: Pick<ImportJobItem, "scope">, t: TFunction): string | null {
  return item.scope === "designer" || item.scope === "all" ? t(`importQueue.linkScope.${item.scope}`) : null;
}

/** A link fit for an href: with https:// where it was typed without one, and never another kind of URL. */
export function webLink(url: string): string | null {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export type JobOpenTarget = { kind: "model" | "collection"; path: string } | { kind: "source"; url: string };

/** What "Open" leads to in the menu. Someone else's model isn't in the viewer's library, so that's its source. */
export function jobOpenTarget(job: QueueJob, viewerId: string | null): JobOpenTarget | null {
  const mine = !job.owner || job.owner.id === viewerId;
  if (mine && job.status === "DONE") {
    if (job.single && job.result_print_id) return { kind: "model", path: `/models/${job.result_print_id}` };
    if (job.result_collection_id)
      return { kind: "collection", path: `/models/collections/${job.result_collection_id}` };
  }
  const url = webLink(job.source_url);
  return url ? { kind: "source", url } : null;
}

// ---- Card text

export type QueueTextContext = { t: TFunction; locale: string; now?: number };

const SYNC_LABEL_PREFIX = "Sync: ";
const GRAB_LABEL = "Sent from Thingport Grab";

/** A zip has no label until it has run, and people know it by the file's name, not its address. */
function zipFileName(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.toLowerCase().endsWith(".zip") ? name : null;
  } catch {
    return null;
  }
}

/** The server writes these two in English. A job with neither label nor URL still needs a name. */
export function jobLabel(job: QueueJob, t: TFunction): string {
  const label = job.source_label?.trim() ?? "";
  if (label === GRAB_LABEL) return t("importQueue.sentFromGrab");
  const shown = isSyncJob(job) && label.startsWith(SYNC_LABEL_PREFIX) ? label.slice(SYNC_LABEL_PREFIX.length) : label;
  if (shown.trim()) return shown.trim();
  const zipName = job.type === "ZIP" && job.source_url ? zipFileName(job.source_url) : null;
  return zipName || job.source_url || t("importQueue.untitled");
}

const JOB_TYPES = new Set<string>(["LINKS", "COLLECTION", "ZIP", "PROFILES"]);

function jobTypeLabel(job: QueueJob, t: TFunction): string | null {
  if (job.single) return t("importQueue.type.SINGLE");
  return JOB_TYPES.has(job.type) ? t(`importQueue.type.${job.type}`) : null;
}

/** The job's provider. Link lists often have none set, and their first link tells. */
export function jobProvider(job: QueueJob): string | null {
  return job.provider ?? (job.source_url ? detectImportProvider(job.source_url) : null);
}

function agoText(iso: string | null, key: "started" | "added", { t, locale, now = Date.now() }: QueueTextContext) {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(at)) return null;
  if (now - at < JUST_NOW_MS) return t(`importQueue.when.${key}JustNow`);
  return t(`importQueue.when.${key}`, { time: relativeTime(iso as string, locale) });
}

function finishedText(iso: string, { t, locale, now = Date.now() }: QueueTextContext) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  if (now - at < JUST_NOW_MS) return t("importQueue.when.justNow");
  const date = new Date(at);
  const today = new Date(now);
  const startOfDay = (d: Date, days = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
  const day = startOfDay(date);
  if (day === startOfDay(today)) {
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
    return t("importQueue.when.today", { time });
  }
  if (day === startOfDay(today, -1)) return t("importQueue.when.yesterday");
  const year = date.getFullYear() === today.getFullYear() ? undefined : "numeric";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year }).format(date);
}

/** "Started 12 minutes ago", "Added yesterday", "Waiting", "On hold", "Today, 08:12", "Oct 28". */
export function whenText(job: QueueJob, context: QueueTextContext): string | null {
  const { t } = context;
  if (job.sync_waiting) return t("importQueue.when.waiting");
  switch (job.status) {
    case "RUNNING":
      return agoText(job.started_at ?? job.created_at, "started", context);
    case "QUEUED":
      return job.queued_at && Date.parse(job.queued_at) - Date.parse(job.created_at) > REJOINED_AFTER_MS
        ? t("importQueue.when.waiting")
        : agoText(job.created_at, "added", context);
    case "PAUSED":
      if (isPausing(job)) return agoText(job.started_at ?? job.created_at, "started", context);
      return job.queued_at || job.started_at ? t("importQueue.when.onHold") : agoText(job.created_at, "added", context);
    default:
      return finishedText(job.updated_at, context);
  }
}

/** The card's second line: type, provider and when. */
export function jobCaption(job: QueueJob, context: QueueTextContext): string {
  const provider = importProviderInfo(jobProvider(job))?.label;
  return [jobTypeLabel(job, context.t), provider, whenText(job, context)].filter(Boolean).join(" · ");
}

/** "8 links", "1 model"; null when it isn't known yet, as for print profiles before they've run. */
function unitText(job: QueueJob, t: TFunction): string | null {
  if (job.total <= 0) return null;
  const unit = job.total === 1 ? (job.single ? "model" : "link") : job.type === "LINKS" ? "link" : "model";
  return t(`importQueue.unit.${unit}`, { count: job.total });
}

/** Where a waiting job stands: "Next up · 8 links", "2 imports ahead · 1 model". A sync job has no place, only a promise. */
export function inLineText(job: QueueJob, t: TFunction): string | null {
  if (job.sync_waiting) return t("importQueue.statusHint.queued");
  if (job.status !== "QUEUED" || job.position === null) return null;
  const place =
    job.position <= 1 ? t("importQueue.line.nextUp") : t("importQueue.line.ahead", { count: job.position - 1 });
  return [place, unitText(job, t)].filter(Boolean).join(" · ");
}

/** The pill in front of a job in line. */
export function positionPill(job: QueueJob, t: TFunction): { text: string; title: string } | null {
  if (job.status !== "QUEUED" || job.position === null) return null;
  return {
    text: `#${job.position}`,
    title: job.position <= 1 ? t("importQueue.line.nextUp") : t("importQueue.line.place", { n: job.position }),
  };
}

export type JobBar = {
  /** 0 to 100. */
  value: number;
  /** Running with no total yet, so how far along can't be said. */
  indeterminate: boolean;
  tone: "accent" | "warning" | "error";
  /** Sweeps while it runs. */
  live: boolean;
  text: string | null;
};

export function jobBar(job: QueueJob, t: TFunction): JobBar | null {
  const running = job.status === "RUNNING";
  if (job.status === "QUEUED" || job.single || !(job.processed > 0 || isImporting(job))) return null;
  const values = { processed: job.processed, total: job.total, failed: job.failed_count };
  return {
    value: job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0,
    indeterminate: running && job.total <= 0,
    tone: job.status === "ERROR" ? "error" : job.failed_count > 0 ? "warning" : "accent",
    live: running,
    text:
      job.total <= 0
        ? null
        : job.failed_count > 0
          ? t("importQueue.progressFailed", values)
          : t("importQueue.progress", values),
  };
}

// Baked in English on the server. All of these mean a restart cut the job off.
const INTERRUPTED_REASONS = new Set([
  "Interrupted by server restart",
  "Import interrupted. Some models or files may already be in your library; check before retrying.",
  "Import interrupted; this model may be incomplete in your library. Delete it before retrying.",
]);
const STALLED_REASON =
  "This import stopped responding, so the line moved on. If Retry isn't offered, restart the server.";
const NO_REQUEST_REASON = "This older import has no saved request";
// A batch's notification, when it knows nothing more. On the card it only repeats the bar, in English, sends people where
// they already are, and goes stale when a link is removed.
const BARE_FAILURE_COUNT = /^\d+ failed — retry them from the import queue\.?$/;

/** Why a job stopped or failed. Nothing while it's on its way again: a Start or Retry leaves that behind. */
export function whyText(job: QueueJob, t: TFunction): string | null {
  if (isImporting(job) || isInLine(job)) return null;
  const reason = job.failure_reason;
  if (reason && !BARE_FAILURE_COUNT.test(reason)) {
    if (INTERRUPTED_REASONS.has(reason)) {
      if (job.type === "ZIP") return t("importQueue.why.interruptedZip");
      // An older collection or profiles import saved nothing to retry with, so don't talk about retrying.
      return t(job.can_retry || job.can_start ? "importQueue.why.interrupted" : "importQueue.why.interruptedNoRetry");
    }
    if (reason === STALLED_REASON) return t("importQueue.why.stalled");
    if (reason === NO_REQUEST_REASON) return t("importQueue.why.noRequest");
    return reason;
  }
  const failed = job.failed_items_count || job.failed_count;
  if (failed <= 0) return null;
  return t(hasLinkList(job) ? "importQueue.why.linksFailed" : "importQueue.why.modelsFailed", { count: failed });
}

/** What the delete confirmation says. A sync won't bring back links it has seen once. */
export function deleteConfirmText(job: QueueJob, t: TFunction) {
  const label = jobLabel(job, t);
  return {
    title: t("importQueue.delete.title"),
    message: t(isSyncJob(job) ? "importQueue.delete.messageSync" : "importQueue.delete.message", { label }),
    confirmLabel: t("importQueue.delete.confirm"),
  };
}

/** What Clear finished asks first: Finished also holds old failures, whose links can't be retried once they're gone. */
export function clearFinishedConfirmText(t: TFunction) {
  return {
    title: t("importQueue.clear.title"),
    message: t("importQueue.clear.message"),
    confirmLabel: t("importQueue.clear.confirm"),
  };
}

// ---- The top bar's indicator

export type IndicatorState = {
  kind: "running" | "inLine" | "finished" | "attention" | "hold" | "idle";
  /** `arc` is 0 to 100; null shows the track alone. No ring at all when null. */
  ring: { arc: number | null } | null;
  comet: boolean;
  /** The number in the middle, which is what's still to come. */
  number: number | null;
  numberTone: "accent" | "info";
  glyph: "tray" | "tick" | null;
  arrowTone: "accent" | "error";
  badge: { count: number; tone: "error" | "neutral" } | null;
  /** Where clicking leads: what the indicator was showing. */
  section: QueueSection;
  /** Null when no totals are known yet. */
  percent: number | null;
  inLine: number;
  attention: number;
  hold: number;
  /** The viewer's best place in the line. A waiting sync job has none. */
  nextPlace: number | null;
  /** Nothing else to show, but a synced collection of theirs is coming in. */
  syncing: boolean;
};

function percentOf(allJobs: QueueJob[]): number | null {
  // A single link has no steps to count: "Importing, 0%" would stand there until it's done.
  const jobs = allJobs.filter((job) => !job.single);
  const total = jobs.reduce((sum, job) => sum + job.total, 0);
  if (total <= 0) return null;
  const processed = jobs.reduce((sum, job) => sum + job.processed, 0);
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}

/** The imports the viewer started, at a glance, whatever the modal is showing. A sync comes in by itself, for hours, so
 *  it stays out of the ring, the comet and the number; what it needs from them still counts. `flash`: they all just
 *  finished. */
export function indicatorState(jobs: QueueJob[], flash: boolean): IndicatorState {
  const started = jobs.filter((job) => !isSyncJob(job));
  const running = started.filter(isImporting);
  const inLine = started.filter(isInLine).length;
  const places = started.flatMap((job) => (job.status === "QUEUED" && job.position !== null ? [job.position] : []));
  const attention = jobs.filter((job) => sectionOf(job) === "att").length;
  const hold = jobs.filter(isOnHold).length;
  const common = {
    ring: null,
    comet: false,
    number: null,
    numberTone: "accent",
    glyph: null,
    arrowTone: "accent",
    badge: attention > 0 ? { count: attention, tone: "error" } : null,
    percent: null,
    inLine,
    attention,
    hold,
    nextPlace: places.length ? Math.min(...places) : null,
    syncing: false,
  } satisfies Partial<IndicatorState>;

  if (running.length) {
    const percent = percentOf(running);
    return {
      ...common,
      kind: "running",
      ring: { arc: percent ?? 0 },
      comet: true,
      number: running.length + inLine,
      percent,
      section: "run",
    };
  }
  if (inLine) {
    return { ...common, kind: "inLine", ring: { arc: null }, number: inLine, numberTone: "info", section: "wait" };
  }
  if (flash) {
    return {
      ...common,
      kind: "finished",
      ring: { arc: 100 },
      glyph: "tick",
      section: attention ? "att" : "done",
    };
  }
  if (attention) return { ...common, kind: "attention", glyph: "tray", arrowTone: "error", section: "att" };
  if (hold) {
    return { ...common, kind: "hold", glyph: "tray", badge: { count: hold, tone: "neutral" }, section: "wait" };
  }
  const syncing = jobs.find((job) => isImporting(job) || isInLine(job));
  return {
    ...common,
    kind: "idle",
    glyph: "tray",
    syncing: Boolean(syncing),
    section: syncing ? sectionOf(syncing) : "run",
  };
}

export function indicatorTip(state: IndicatorState, t: TFunction): string {
  const needs = state.attention ? t("importQueue.indicator.needsAttention", { count: state.attention }) : null;
  const inLine = () => t("importQueue.indicator.inLine", { count: state.inLine });
  const parts = (): (string | null)[] => {
    switch (state.kind) {
      case "running":
        return [
          state.percent === null
            ? t("importQueue.indicator.importingNoPercent")
            : t("importQueue.indicator.importing", { pct: state.percent }),
          state.inLine ? inLine() : null,
          needs,
        ];
      case "inLine": {
        const place =
          state.nextPlace === null
            ? inLine()
            : state.nextPlace <= 1
              ? t("importQueue.indicator.nextUp")
              : t("importQueue.indicator.nextPlace", { n: state.nextPlace });
        return [place, needs];
      }
      case "finished":
        return [t("importQueue.indicator.finished"), needs];
      case "attention":
        return [needs];
      case "hold":
        return [t("importQueue.indicator.onHold", { count: state.hold })];
      default:
        return [t(state.syncing ? "importQueue.indicator.syncing" : "importQueue.indicator.empty")];
    }
  };
  return parts().filter(Boolean).join(". ");
}

export function indicatorLabel(state: IndicatorState, t: TFunction): string {
  return t("importQueue.indicator.label", { tip: indicatorTip(state, t) });
}

// ---- The dialog

export function dialogTitle(scope: QueueScope, t: TFunction): string {
  return t(scope === "everyone" ? "importQueue.titleEveryone" : "importQueue.title");
}

export function panelSubtitle(section: QueueSection, scope: QueueScope, t: TFunction): string {
  if (section !== "wait") return t(`importQueue.panel.${section}.sub`);
  return t(scope === "everyone" ? "importQueue.panel.wait.subAll" : "importQueue.panel.wait.subMine");
}

/** How a section's count stands out on the rail. */
export const SECTION_COUNT_TONES: Record<QueueSection, "active" | "alert" | "neutral"> = {
  run: "active",
  att: "alert",
  wait: "neutral",
  done: "neutral",
};

export type SectionCounts = Record<QueueSection, number>;

/** `finishedTotal`: the list holds only the newest finished jobs, and this is how many there really are. */
export function sectionCounts(list: QueueJob[], finishedTotal = 0): SectionCounts {
  const counts: SectionCounts = { run: 0, att: 0, wait: 0, done: 0 };
  for (const job of list) counts[sectionOf(job)] += 1;
  counts.done = Math.max(counts.done, finishedTotal);
  return counts;
}

export const runningNow = (list: QueueJob[]) => list.filter(isImporting).length;

export const ownerName = (owner: JobOwner) => owner.display_name || owner.email || owner.id;

export type QueuePerson = { id: string; name: string; email: string; count: number };

/** Everyone with an import in the list, and how many, whichever section they're in. */
export function peopleOf(jobs: QueueJob[]): QueuePerson[] {
  const people = new Map<string, QueuePerson>();
  for (const { owner } of jobs) {
    if (!owner) continue;
    const person = people.get(owner.id);
    if (person) person.count += 1;
    else people.set(owner.id, { id: owner.id, name: ownerName(owner), email: owner.email ?? "", count: 1 });
  }
  return [...people.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

export function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toLocaleUpperCase())
    .join("");
}

/** What the dialog lists: the viewer's own, or everyone's, narrowed to one person. Places in the line stay as they are. */
export function visibleJobs(
  scope: QueueScope,
  own: QueueJob[],
  everyone: QueueJob[],
  person: string | null = null,
): QueueJob[] {
  if (scope === "mine") return own;
  return person ? everyone.filter((job) => job.owner?.id === person) : everyone;
}

export type PanelAction = {
  kind: "pauseAll" | "retryAll" | "startAll" | "clearFinished";
  label: string;
  /** The button stands out, or it's outlined. */
  primary: boolean;
  disabled: boolean;
};

/** The button at the top of a panel; none while its section is empty, or when it would act on more people than the
 *  list shows, as a backend older than the line ignores who a bulk action is for. */
export function panelAction(
  section: QueueSection,
  list: QueueJob[],
  counts: SectionCounts,
  t: TFunction,
  { actsOnAll = false }: { actsOnAll?: boolean } = {},
): PanelAction | null {
  if (counts[section] === 0 || actsOnAll) return null;
  switch (section) {
    case "run": {
      const pausable = list.filter((job) => job.status === "RUNNING" && job.can_pause);
      return {
        kind: "pauseAll",
        label: t("importQueue.action.pauseAll"),
        primary: false,
        disabled: pausable.length === 0,
      };
    }
    case "att": {
      const count = list.filter((job) => sectionOf(job) === "att" && job.can_retry).length;
      return { kind: "retryAll", label: t("importQueue.action.retryAll", { count }), primary: true, disabled: !count };
    }
    case "wait": {
      const count = list.filter((job) => isOnHold(job) && job.can_start).length;
      return { kind: "startAll", label: t("importQueue.action.startAll", { count }), primary: true, disabled: !count };
    }
    default:
      return {
        kind: "clearFinished",
        label: t("importQueue.action.clearFinished", { count: counts.done }),
        primary: false,
        disabled: counts.done === 0,
      };
  }
}

export type QueueEmptyState = { icon: "run" | "wait" | "check"; title: string; text: string };

/** What an empty section says. Importing tells you when someone else is what you're waiting on. */
export function emptyState(
  section: QueueSection,
  { scope, line, own }: { scope: QueueScope; line: LineOut; own: QueueJob[] },
  t: TFunction,
): QueueEmptyState {
  switch (section) {
    case "run": {
      const othersBusy = line.now !== null && !line.now.mine && !own.some(isImporting);
      if (scope !== "mine" || !othersBusy) {
        return { icon: "run", title: t("importQueue.empty.running.title"), text: t("importQueue.empty.running.text") };
      }
      const places = own.flatMap((job) => (job.status === "QUEUED" && job.position !== null ? [job.position] : []));
      return {
        icon: "wait",
        title: t("importQueue.empty.running.busyTitle"),
        text: places.length
          ? t("importQueue.empty.running.busyNext", { n: Math.min(...places) })
          : t("importQueue.empty.running.busyNone"),
      };
    }
    case "att":
      return { icon: "check", title: t("importQueue.empty.att.title"), text: t("importQueue.empty.att.text") };
    case "wait":
      return { icon: "wait", title: t("importQueue.empty.wait.title"), text: t("importQueue.empty.wait.text") };
    default:
      return { icon: "check", title: t("importQueue.empty.done.title"), text: t("importQueue.empty.done.text") };
  }
}

export type QueueRow =
  | { kind: "card"; key: string; job: QueueJob }
  /** The job the line is on: `job` when it's the viewer's. */
  | { kind: "now"; key: string; mine: boolean; person: string; job: QueueJob | null }
  /** Someone else's place, or a run of them: nothing but where and whose. */
  | { kind: "private"; key: string; person: string; from: number; to: number };

const card = (job: QueueJob): QueueRow => ({ kind: "card", key: job.id, job });

const byPlace = (a: QueueJob, b: QueueJob) => (a.position ?? Infinity) - (b.position ?? Infinity);

/** Waiting's In line group for one viewer: what's on now, then every place up to their last job, theirs in full and
 *  anyone else's as a private row, one person's run of jobs merged into one. Sync jobs have no place, so they go last. */
export function ladderRows(line: LineOut, own: QueueJob[]): QueueRow[] {
  const queued = own.filter((job) => job.status === "QUEUED").toSorted(byPlace);
  const syncWaiting = own.filter((job) => job.sync_waiting).map(card);
  if (!queued.length) return syncWaiting;

  const mine = new Map(own.map((job) => [job.id, job]));
  const rows: QueueRow[] = [];
  if (line.now) {
    const { mine: isMine, person, job_id: jobId } = line.now;
    rows.push({ kind: "now", key: "now", mine: isMine, person, job: (jobId && mine.get(jobId)) || null });
  }
  const placed = new Set<string>();
  const last = line.rows.findLastIndex((row) => row.mine);
  for (let n = 0; n <= last; n += 1) {
    const row = line.rows[n];
    const job = row.mine && row.job_id ? mine.get(row.job_id) : undefined;
    if (job) {
      rows.push(card(job));
      placed.add(job.id);
      continue;
    }
    let end = n;
    while (
      end < last &&
      !line.rows[end + 1].mine &&
      line.rows[end + 1].person === row.person &&
      line.rows[end + 1].position === line.rows[end].position + 1
    ) {
      end += 1;
    }
    rows.push({
      kind: "private",
      key: `place-${row.position}`,
      person: row.person,
      from: row.position,
      to: line.rows[end].position,
    });
    n = end;
  }
  // The two lists are read one after the other, so a job can be in one and not yet in the other.
  rows.push(...queued.filter((job) => !placed.has(job.id)).map(card));
  rows.push(...syncWaiting);
  return rows;
}

export function nowRowText(row: Extract<QueueRow, { kind: "now" }>, t: TFunction): string {
  return row.mine && row.job
    ? t("importQueue.line.yourImport", { label: jobLabel(row.job, t) })
    : t("importQueue.line.private");
}

export function privateRowText(row: Extract<QueueRow, { kind: "private" }>, t: TFunction) {
  const count = row.to - row.from + 1;
  return {
    pill: count > 1 ? `#${row.from}-${row.to}` : `#${row.from}`,
    text: count > 1 ? t("importQueue.line.privateMany", { count }) : t("importQueue.line.private"),
  };
}

export type QueueGroup = {
  id: "inLine" | "onHold" | "all";
  /** "In line · 3"; the unlabelled group of the other sections has none. */
  label: string | null;
  hint: string | null;
  /** Draws the rail joining its rows. */
  ladder: boolean;
  rows: QueueRow[];
};

const newestFirst = (a: QueueJob, b: QueueJob) => Date.parse(b.updated_at) - Date.parse(a.updated_at);
const oldestFirst = (a: QueueJob, b: QueueJob) => Date.parse(a.created_at) - Date.parse(b.created_at);
const startedFirst = (a: QueueJob, b: QueueJob) =>
  Date.parse(a.started_at ?? a.created_at) - Date.parse(b.started_at ?? b.created_at);

/** A section's groups, in order. Groups with nothing in them are left out. */
export function queueGroups(
  section: QueueSection,
  { list, scope, line, autoStart }: { list: QueueJob[]; scope: QueueScope; line: LineOut; autoStart: boolean },
  t: TFunction,
): QueueGroup[] {
  if (section !== "wait") {
    const jobs = list.filter((job) => sectionOf(job) === section);
    if (!jobs.length) return [];
    const rows = jobs.toSorted(section === "run" ? startedFirst : newestFirst).map(card);
    return [{ id: "all", label: null, hint: null, ladder: false, rows }];
  }

  const inLine = list.filter(isInLine);
  const onHold = list.filter(isOnHold).toSorted(oldestFirst);
  const groups: QueueGroup[] = [];
  if (inLine.length) {
    const mine = scope === "mine";
    const numbered = inLine.filter((job) => job.status === "QUEUED").toSorted(byPlace);
    const rows = mine ? ladderRows(line, list) : [...numbered, ...inLine.filter((job) => job.sync_waiting)].map(card);
    groups.push({
      id: "inLine",
      label: `${t("importQueue.group.inLine")} · ${inLine.length}`,
      hint: t(mine ? "importQueue.group.inLineHintMine" : "importQueue.group.inLineHintAll"),
      ladder: mine && numbered.length > 0,
      rows,
    });
  }
  if (onHold.length) {
    groups.push({
      id: "onHold",
      label: `${t("importQueue.group.onHold")} · ${onHold.length}`,
      hint: t(autoStart ? "importQueue.group.onHoldHintAuto" : "importQueue.group.onHoldHint"),
      ladder: false,
      rows: onHold.map(card),
    });
  }
  return groups;
}

// ---- What changed since the last poll

export type QueueDiff = {
  /** Jobs that ended since the last look. */
  finished: QueueJob[];
  /** They were the last of the viewer's: the indicator shows a tick. */
  flash: boolean;
};

/** The first snapshot only seeds, so a reload doesn't replay anything. A job on hold hasn't finished, nor has one that
 *  drops out of the list. A job not seen before only counts if it changed after everything that was: the list holds
 *  only the newest finished jobs, so deleting one lets an old one rise into it. */
export function diffSnapshots(previous: QueueJob[] | null, next: QueueJob[]): QueueDiff {
  if (!previous) return { finished: [], flash: false };
  const before = new Map(previous.map((job) => [job.id, job]));
  const newestSeen = previous.reduce((newest, job) => Math.max(newest, Date.parse(job.updated_at) || 0), 0);
  const finished = next.filter((job) => {
    if (!isFinished(job)) return false;
    const was = before.get(job.id);
    return was ? !isFinished(was) : Date.parse(job.updated_at) > newestSeen;
  });
  // A sync never shows on the indicator, so it neither brings the tick nor holds it back.
  const stillGoing = next.some((job) => !isSyncJob(job) && (isImporting(job) || isInLine(job)));
  return { finished, flash: finished.some((job) => !isSyncJob(job)) && !stillGoing };
}

export type QueueLocation = { path: string } | { section: QueueSection };

export type FinishToast = {
  message: string;
  severity: "success" | "warning" | "error";
  /** Where its Open button leads; none when there's nothing to open. */
  open: QueueLocation | null;
};

const SINGLE_OUTCOME_KEYS: Record<string, string> = {
  created: "uploadBar.imported",
  profile_added: "uploadBar.profileAdded",
  already_imported: "uploadBar.alreadyInLibrary",
};

function resultLocation(job: QueueJob): QueueLocation | null {
  if (job.result_print_id) return { path: `/models/${job.result_print_id}` };
  if (job.result_collection_id) return { path: `/models/collections/${job.result_collection_id}` };
  // Dedup hits count as results too.
  return job.imported + job.already_in_library > 1 ? { path: "/models" } : null;
}

/** A job that finished with failures, naming only what there's some of. */
function failuresText(
  counts: { imported: number; alreadyInLibrary: number; failedCount: number },
  t: TFunction,
): string {
  if (counts.imported) {
    return counts.alreadyInLibrary
      ? t("importQueue.toast.finishedWithFailures", counts)
      : t("importQueue.toast.finishedSomeFailed", { ...counts, count: counts.imported });
  }
  return counts.alreadyInLibrary
    ? t("importQueue.toast.finishedExistingFailed", counts)
    : t("importQueue.toast.finishedAllFailed", { count: counts.failedCount });
}

// As many finished jobs as the server lists, past those asking for attention.
const FINISHED_LISTED = 50;

/** How many finished beyond the list, by the server's total. Only worth asking of a full list: the total also moves when
 *  a job is cleared or an old failure ages into Finished, so short of that it could only be wrong. A job cleared
 *  meanwhile makes this come up short, never over. */
export function finishedBeyondList(finished: QueueJob[], totalBefore: number, totalNow: number): number {
  const listed = finished.filter((job) => !job.attention).length;
  return listed < FINISHED_LISTED ? 0 : Math.max(0, totalNow - totalBefore - listed);
}

/** One toast for whatever finished in one poll, as a new toast closes the one before. A sync has its own notification,
 *  and can finish at any hour. `beyondList`: more that finished than made the list. */
export function finishToastOf(finished: QueueJob[], t: TFunction, beyondList = 0): FinishToast | null {
  const jobs = finished.filter((job) => !isSyncJob(job));
  if (!jobs.length) return null;
  const troubled = jobs.find((job) => job.status === "ERROR" || hasFailures(job));

  if (jobs.length > 1) {
    const count = jobs.length + beyondList;
    return troubled
      ? {
          message: t("importQueue.toast.finishedManyFailed", { count }),
          severity: "warning",
          open: { section: sectionOf(troubled) },
        }
      : {
          message: t("importQueue.toast.finishedMany", { count }),
          severity: "success",
          open: { path: "/models" },
        };
  }

  const [job] = jobs;
  const name = jobLabel(job, t);
  if (job.status === "ERROR" || (job.single && troubled)) {
    return {
      message: t("importQueue.toast.finishFailed", { name }),
      severity: "error",
      open: { section: sectionOf(job) },
    };
  }
  if (job.single) {
    // Neither outcome nor model: the link went on to wait for Thingport Grab, so nothing's been imported.
    const key = SINGLE_OUTCOME_KEYS[job.outcome ?? ""] ?? (job.result_print_id ? SINGLE_OUTCOME_KEYS.created : null);
    return {
      message: t(key ?? "importQueue.toast.finishedPlain", { name }),
      severity: "success",
      open: resultLocation(job),
    };
  }
  const counts = {
    imported: job.imported,
    alreadyInLibrary: job.already_in_library,
    failedCount: job.failed_items_count || job.failed_count,
  };
  if (troubled) {
    return { message: failuresText(counts, t), severity: "warning", open: { section: sectionOf(job) } };
  }
  return {
    message: job.already_in_library
      ? t(job.imported ? "importQueue.toast.finishedWithExisting" : "importQueue.toast.finishedOnlyExisting", counts)
      : t("importQueue.toast.finishedImported", { count: job.imported }),
    severity: "success",
    open: resultLocation(job),
  };
}

/** The toast when an import is accepted. A print or a wait for Grab is the caller's to announce. */
export function submittedText(answer: QueueSubmitAnswer, t: TFunction): string | null {
  if (answer.kind !== "job") return null;
  if (answer.position !== null) {
    return answer.position <= 1
      ? t("importQueue.toast.added")
      : t("importQueue.toast.addedPlace", { n: answer.position });
  }
  return answer.status === "QUEUED" ? t("importQueue.toast.addedPlain") : t("importQueue.toast.started");
}

// ---- Polling

export const POLL_ACTIVE_MS = 1500;
export const POLL_IDLE_MS = 8000;
export const POLL_HIDDEN_MS = 30_000;
export const POLL_OLDER_BACKEND_MS = 5 * 60 * 1000;

/** Fast while something the viewer started moves, so progress reads live; otherwise slow, to notice links Grab sends. A
 *  job with nothing ahead of it counts as moving: it's about to run, and may be done before a slow poll sees it. A sync
 *  can run for hours and shows nowhere but the open modal, so it doesn't count. */
export function pollDelay({
  supported,
  hidden,
  dialogOpen,
  jobs,
  line,
}: {
  supported: boolean;
  hidden: boolean;
  dialogOpen: boolean;
  jobs: QueueJob[];
  line: LineOut;
}): number {
  if (!supported) return POLL_OLDER_BACKEND_MS;
  if (hidden) return POLL_HIDDEN_MS;
  const moving = jobs.some((job) => (isImporting(job) && !isSyncJob(job)) || (job.status === "QUEUED" && !line.now));
  return dialogOpen || moving ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

/** Everyone's list only while it's on screen, and it's a heavier read: fast only while anything is moving. */
export function everyoneDelay({ hidden, jobs }: { hidden: boolean; jobs: QueueJob[] }): number {
  if (hidden) return POLL_HIDDEN_MS;
  const moving = jobs.some((job) => job.status === "RUNNING" || job.status === "QUEUED" || job.runner_live);
  return moving ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

// ---- Links into the dialog

/** "?import-queue=<section>", in stored notifications and Grab's links. */
export const QUEUE_PARAM = "import-queue";

/** Where an address of the old page leads. The home page doesn't redirect, so the param survives to open the dialog. */
export function queueLinkPath(value: string | null): string {
  return `/?${QUEUE_PARAM}=${encodeURIComponent(value ?? "")}`;
}

/** These addresses hand the param on to the home page themselves. Read here too, taking it off the URL would undo that. */
export const handsOnQueueParam = (pathname: string) => pathname === "/admin-queue" || pathname === "/import-queue";

/** A section opens the viewer's own imports there. A bare link is what the old admin page's address becomes: an admin
 *  had everyone's list there, and everyone else has only their own. */
export function deepLinkTarget(value: string, isAdmin: boolean): { section: QueueSection; scope: QueueScope } {
  const section = QUEUE_SECTIONS.find((id) => id === value);
  return section ? { section, scope: "mine" } : { section: "wait", scope: isAdmin ? "everyone" : "mine" };
}
