// The one worker behind the import queue. Jobs that joined the line (status QUEUED, oldest queuedAt first) run here one
// at a time across every user, since they all reach the providers from the same IP and bursts are what trip their
// limits. A sync's job has a lane of its own (collectionSyncRunner.ts) and never joins; whatever must run right away
// runs where it was asked for. Busy or not is what's in memory here, never read off RUNNING rows: those can be stale.

import type { ImportJob } from "@prisma/client";
import { IMPORT_STALL_LIMIT_MINUTES } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { isProviderId, MANIFESTS } from "../providers/index.generated";
import { liftProviderHolds, PROVIDERS, withLinkAuth } from "../providers/registry";
import type { ListImportBody, ProfileScope } from "../providers/types";
import { enabledImportUrl } from "../routes/importRequest";
import { createKeyedLock } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { type ImportActivity, withImportActivity } from "./importActivity";
import {
  isRunnerLive,
  type LinksImportJobBody,
  markJobFailed,
  profilesImportJob,
  runLinksImportJob,
  runListImportJob,
  runZipImportJob,
  SYNC_JOB_INTERRUPTED,
  trackRunner,
} from "./importJobRunner";
import { hasSavedRequest, jobPayload, linkTotals, QUEUE_ATTENTION_PATH } from "./importJobService";
import type { ImportRequestBody } from "./importService";
import { createNotification } from "./notificationService";

const log = createLogger("import");

const POLL_RETRY_MIN_MS = 5_000;
const POLL_RETRY_MAX_MS = 60_000;
const SAFETY_TICK_MS = 30_000;

const LINK_INTERRUPTED = "Import interrupted; this model may be incomplete in your library. Delete it before retrying.";
const JOB_INTERRUPTED =
  "Import interrupted. Some models or files may already be in your library; check before retrying.";
const STALLED = "This import stopped responding, so the line moved on. If Retry isn't offered, restart the server.";

/** Mutable, and read when used, so a test needn't wait an hour. */
export const importWorkerTuning = {
  /** How long a job may show no sign of life before the line moves on without it. */
  stallLimitMs: IMPORT_STALL_LIMIT_MINUTES * 60_000,
  stallCheckMs: 60_000,
  /** The least a sync giving way to the line waits between looks. */
  syncGiveWayMs: 5_000,
  /** How long Start and Retry wait for a runner that's finishing up. */
  runnerWaitMs: 10_000,
  /** How long a recovery that failed waits before trying again. */
  recoveryRetryMs: 30_000,
};

/** Serialises what changes a job's place or its links: adding a Grab link, removing a link, Start and Retry, and the
 *  worker's claim. Not re-entrant, so never nested; network work never runs under it. */
export const withImportUserLock = createKeyedLock();

// ---- Started by a person ----

// Lifting a provider's pause is for a person's Start or Retry, and has to happen when it's that job's turn: an hour
// later the click has long been spent. In memory, because the cooloffs it lifts are too.
const manualStarts = new Set<string>();

export function markManualStart(jobId: string): void {
  manualStarts.add(jobId);
}

export function forgetManualStart(jobId: string): void {
  manualStarts.delete(jobId);
}

function takeManualStart(jobId: string): void {
  if (manualStarts.delete(jobId)) liftProviderHolds();
}

// ---- What a job runs with ----

/** A category deleted while the job waited doesn't fail it: its models come in without one. */
async function ownCategoryId(userId: string, categoryId: unknown): Promise<string | null> {
  if (typeof categoryId !== "string" || !categoryId) return null;
  return (await prisma.category.count({ where: { id: categoryId, userId } })) ? categoryId : null;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The stored request, as the routes pass it, with the owner's saved sign-in for LINK_PROVIDER as of now. The sign-in
 *  is never stored on the job. */
async function storedBody(job: ImportJob, url: string): Promise<ImportRequestBody> {
  const payload = jobPayload(job);
  return withLinkAuth<ImportRequestBody>(job.userId, {
    url,
    title: textOrNull(payload.title),
    filename: textOrNull(payload.filename),
    notes: textOrNull(payload.notes),
    tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
    category_id: await ownCategoryId(job.userId, payload.category_id),
  });
}

/** The shared body a LINKS job runs with. */
export async function linksJobBody(job: ImportJob): Promise<LinksImportJobBody> {
  const payload = jobPayload(job);
  return {
    ...(await storedBody(job, job.sourceUrl)),
    scope: payload.scope === "designer" || payload.scope === "all" ? payload.scope : "url",
    // Only for a sync: a job its sync left behind runs in the line, which can't wait a minute a link.
    itemDelayMs: job.collectionSyncId && typeof payload.item_delay_ms === "number" ? payload.item_delay_ms : undefined,
  };
}

// ---- Claiming and running one job ----

type Launched = { run: Promise<void> };
const NOTHING_TO_RUN: Launched = { run: Promise.resolve() };

/** A LINKS job's claim and launch. Null when the job changed since it was read. */
async function claimLinksJob(job: ImportJob): Promise<Launched | null> {
  let body: LinksImportJobBody;
  try {
    body = await linksJobBody(job);
  } catch (err) {
    await markJobFailed(job.id, err);
    return NOTHING_TO_RUN;
  }
  return withImportUserLock(job.userId, async () => {
    // On the message too: a Hold on a sync job waiting its turn leaves the status as it was.
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: job.status, errorMessage: job.errorMessage },
      data: { status: "RUNNING", errorMessage: null, startedAt: new Date() },
    });
    if (!count) return null;
    try {
      // No runner is alive, so a RUNNING item was cut off (a restart, or a pause mid-link).
      await prisma.importJobItem.updateMany({
        where: { jobId: job.id, status: "RUNNING" },
        data: { status: "PENDING" },
      });
      await prisma.importJob.updateMany({ where: { id: job.id }, data: await linkTotals(job.id) });
    } catch (err) {
      await markJobFailed(job.id, err);
      return NOTHING_TO_RUN;
    }
    takeManualStart(job.id);
    return { run: runLinksImportJob(job.id, job.userId, body) };
  });
}

/** Runs a LINKS job its lane has got to, from what was read: a Hold made meanwhile stays a hold. `run` settles when
 *  its runner stops. A job with nothing left still runs, to its end and its notification. */
export async function launchLinksJob(job: ImportJob): Promise<Launched> {
  if (isRunnerLive(job.id)) {
    throw new HttpError(409, "This import is still finishing its current link, try again shortly");
  }
  const launched = await claimLinksJob(job);
  if (!launched) throw new HttpError(409, "This import changed while it was being started, reload and try again");
  return launched;
}

/** A job of any other type, from its stored request, the way the route that made it would have run it right away. */
async function runBatchJob(job: ImportJob): Promise<void> {
  try {
    if (!hasSavedRequest(job)) throw new HttpError(400, "This older import has no saved request");
    const payload = jobPayload(job);
    const url = await enabledImportUrl(job.sourceUrl);
    const body = await storedBody(job, url);
    if (job.type === "ZIP") {
      await runZipImportJob(job.id, job.userId, { ...body, entries: payload.entries as string[] });
      return;
    }
    if (!job.provider || !isProviderId(job.provider)) throw new Error(`Unknown provider "${job.provider}"`);
    const provider = job.provider;
    const name = MANIFESTS[provider].name;
    if (job.type === "PROFILES") {
      const run = profilesImportJob(provider);
      if (!run) throw new HttpError(404, `${name} has no print profiles to import together`);
      await run(job.id, job.userId, { ...body, scope: payload.scope as Exclude<ProfileScope, "url"> });
      return;
    }
    const lists = PROVIDERS[provider].lists;
    if (!lists) throw new HttpError(404, `${name} has no lists to import`);
    const listBody: ListImportBody = {
      ...body,
      model_ids: payload.model_ids as string[],
      collection_title: textOrNull(payload.collection_title),
    };
    const start = await lists.start(job.userId, url, listBody);
    if ("waitForGrab" in start) throw new Error(`${provider} waits for Grab, so it has no job to run`);
    await ("run" in start ? start.run(job.id) : runListImportJob(job.id, job.userId, provider, start.batch, listBody));
  } catch (err) {
    await markJobFailed(job.id, err);
  }
}

/** Takes the job off the line and starts it. Null when someone got to it first: held, deleted or started since. */
async function claimJob(job: ImportJob): Promise<Launched | null> {
  if (job.type === "LINKS") return claimLinksJob(job);
  return withImportUserLock(job.userId, async () => {
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (!count) return null;
    takeManualStart(job.id);
    return { run: trackRunner(job.id, runBatchJob(job)) };
  });
}

/** When the job last wrote anything of its own. */
async function lastWrite(jobId: string): Promise<number> {
  const [job, items] = await Promise.all([
    prisma.importJob.findUnique({ where: { id: jobId }, select: { updatedAt: true } }),
    prisma.importJobItem.aggregate({ where: { jobId }, _max: { updatedAt: true } }),
  ]);
  return Math.max(job?.updatedAt.getTime() ?? 0, items._max.updatedAt?.getTime() ?? 0);
}

/** Settles once the job has shown no sign of life for the stall limit, marked or not: a read that hangs can't be
 *  cancelled from here, and a paused job's hung link can't hold the line either. Its runner stays on the books until it
 *  ends, which is why a job this happened to doesn't offer Retry. */
function watchOver(jobId: string, activity: ImportActivity): { stalled: Promise<void>; disarm: () => void } {
  let timer: NodeJS.Timeout | undefined;
  let checking = false;
  const stalled = new Promise<void>((resolve) => {
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        if (Date.now() - activity.lastActivity < importWorkerTuning.stallLimitMs) return;
        const newest = Math.max(activity.lastActivity, await lastWrite(jobId));
        if (Date.now() - newest < importWorkerTuning.stallLimitMs) return;
        log.warn("job stopped responding, moving on", { job: jobId });
        await prisma.importJob.updateMany({
          where: { id: jobId, status: "RUNNING" },
          data: { status: "ERROR", errorMessage: STALLED },
        });
        clearInterval(timer);
        resolve();
      } catch (err) {
        // The database, not the job: there's nothing to go by until it's back.
        log.warn("couldn't check on a running job", { job: jobId, error: err });
      } finally {
        checking = false;
      }
    };
    timer = setInterval(() => void check(), importWorkerTuning.stallCheckMs);
    timer.unref();
  });
  return { stalled, disarm: () => clearInterval(timer) };
}

/** A job from the line ended in an error: its owner joined it and walked away. Never rejects: a notification lost
 *  isn't worth failing what comes after it. */
async function notifyJobFailed(job: ImportJob): Promise<void> {
  await createNotification(job.userId, {
    type: "import",
    title: job.sourceLabel ? `Couldn't finish importing "${job.sourceLabel}"` : "Couldn't finish an import",
    body: job.errorMessage,
    externalUrl: job.sourceUrl,
    internalPath: QUEUE_ATTENTION_PATH,
  }).catch((err) => log.error("couldn't notify about a failed job", { job: job.id, error: err }));
}

// Jobs whose end couldn't be written, the database being down: tried again before the next job is read.
const unsettled = new Set<string>();

/** A job's run is over: it must have left RUNNING, and if it ended in an error its owner hears of it. */
async function settleJob(jobId: string): Promise<void> {
  await prisma.importJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { status: "ERROR", errorMessage: JOB_INTERRUPTED },
  });
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  unsettled.delete(jobId);
  if (job?.status === "ERROR") await notifyJobFailed(job);
}

async function runJob(job: ImportJob): Promise<void> {
  const activity: ImportActivity = { lastActivity: Date.now() };
  const claimed = await withImportActivity(activity, () => claimJob(job));
  if (!claimed) return;
  const watchdog = watchOver(job.id, activity);
  try {
    // Never rejects, nor does the rest of a run the line has moved on from: nobody holds that.
    const run = claimed.run.catch((err) => log.error("job's runner failed", { job: job.id, error: err }));
    await Promise.race([run, watchdog.stalled]);
  } finally {
    watchdog.disarm();
  }
  try {
    await settleJob(job.id);
  } catch (err) {
    unsettled.add(job.id);
    log.warn("couldn't write how a job ended, trying again", { job: job.id, error: err });
  }
}

// ---- The drain ----

let gateOpen = true;
// The database switch's own hold, apart from the gate: a recovery at boot opens that one when it finally works, which
// mustn't happen halfway through a switch, and a switch mustn't open it before that recovery has worked.
let switching = false;
let woken = false;
let draining: Promise<void> | null = null;
let currentJobId: string | null = null;
let safetyTick: NodeJS.Timeout | null = null;
let retryMs = 0;
let retryTimer: NodeJS.Timeout | null = null;

const mayClaim = () => gateOpen && !switching;

/** A failed read of the line: the database is down, or was switched for one without QUEUED. Said once, and tried
 *  again with more and more patience. */
function pollFailed(err: unknown): void {
  if (!retryMs) log.error("couldn't read the import line, trying again", { error: err });
  retryMs = Math.min(retryMs ? retryMs * 2 : POLL_RETRY_MIN_MS, POLL_RETRY_MAX_MS);
  retryTimer ??= setTimeout(() => {
    retryTimer = null;
    wakeImportWorker();
  }, retryMs);
  retryTimer.unref();
}

/** Runs the line until it's empty or the gate shuts. */
async function workThroughLine(): Promise<void> {
  for (;;) {
    if (!mayClaim()) return;
    for (const jobId of unsettled) await settleJob(jobId);
    const job = await prisma.importJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    });
    retryMs = 0;
    if (!job) return;
    currentJobId = job.id;
    try {
      // Shut while that read was out, and whoever shut it may be waiting to see nothing start.
      if (!mayClaim()) return;
      await runJob(job);
    } finally {
      currentJobId = null;
    }
  }
}

/** Never rejects: no handler exists for an unhandled rejection, so one would take the whole server down. */
async function drain(): Promise<void> {
  woken = false;
  try {
    await workThroughLine();
  } catch (err) {
    pollFailed(err);
  }
}

/** Every enqueue calls this. It's all tests need: they never run server.ts. */
export function wakeImportWorker(): void {
  woken = true;
  if (!mayClaim() || draining) return;
  draining = drain().finally(() => {
    draining = null;
    // Woken after the last look at the line.
    if (woken && mayClaim()) wakeImportWorker();
  });
}

/** Settles when the worker has nothing left to do, for now. */
export async function importWorkerIdle(): Promise<void> {
  for (;;) {
    if (!draining) return;
    await draining;
  }
}

export function importWorkerStatus(): { currentJobId: string | null } {
  return { currentJobId };
}

/** Nothing new is claimed until the gate opens again. The job it's on carries on. */
export function holdImportWorker(): void {
  gateOpen = false;
}

export function resumeImportWorker(): void {
  gateOpen = true;
  wakeImportWorker();
}

/** Opens the gate for good. The tick is for a wake lost to an error. */
export function startImportWorker(): void {
  safetyTick ??= setInterval(wakeImportWorker, SAFETY_TICK_MS);
  safetyTick.unref();
  resumeImportWorker();
}

// ---- After a restart ----

/** Settles what a stopped process left RUNNING. `before`, for trying again once work may have started: only what
 *  hasn't been written to since. An interrupted link is never replayed by itself: createPrint commits before its plates,
 *  so a half-made model would read as imported. */
export async function recoverImportJobs(before?: Date): Promise<void> {
  const untouched = before ? { updatedAt: { lte: before } } : {};
  await prisma.importJob.updateMany({
    where: { status: "RUNNING", collectionSyncId: { not: null }, ...untouched },
    data: { status: "PAUSED", errorMessage: SYNC_JOB_INTERRUPTED },
  });
  const cutOff = await prisma.importJob.findMany({
    where: { status: "RUNNING", type: "LINKS", queuedAt: { not: null }, ...untouched },
    select: { id: true },
  });
  for (const { id } of cutOff) {
    // Its other links finish, in the place it had. A job with none left runs to its end, which is how it reports this.
    await prisma.$transaction([
      prisma.importJobItem.updateMany({
        where: { jobId: id, status: "RUNNING" },
        data: { status: "FAILED", errorMessage: LINK_INTERRUPTED },
      }),
      prisma.importJob.updateMany({
        where: { id, status: "RUNNING", ...untouched },
        data: { status: "QUEUED", startedAt: null },
      }),
    ]);
  }
  // A batch has nothing left to run to its end and report it. Another try can't tell twice: it has left RUNNING by then.
  const batches = await prisma.importJob.findMany({
    where: { status: "RUNNING", queuedAt: { not: null }, ...untouched },
  });
  for (const job of batches) {
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "RUNNING", ...untouched },
      data: { status: "ERROR", errorMessage: JOB_INTERRUPTED },
    });
    if (count) await notifyJobFailed({ ...job, errorMessage: JOB_INTERRUPTED });
  }
  // Jobs that never were in line, as it has always been for them. Their links stay as they are.
  await prisma.importJob.updateMany({
    where: { status: "RUNNING", ...untouched },
    data: { status: "ERROR", errorMessage: "Interrupted by server restart" },
  });
}

/** Keeps trying a recovery that failed at boot, the gate staying shut until it works. */
export function startImportWorkerAfterRecovery(before: Date): void {
  setTimeout(() => {
    recoverImportJobs(before).then(startImportWorker, (err) => {
      console.error("Failed to recover import jobs on startup:", err);
      startImportWorkerAfterRecovery(before);
    });
  }, importWorkerTuning.recoveryRetryMs).unref();
}

// ---- The database switch ----

/** False when a switch is already under way. Until it ends nothing new is claimed and no sync starts. */
export function beginDatabaseSwitch(): boolean {
  if (switching) return false;
  switching = true;
  return true;
}

export function endDatabaseSwitch(): void {
  switching = false;
  wakeImportWorker();
}

export function isDatabaseSwitching(): boolean {
  return switching;
}

/** Job ids held in memory belong to the database that just went. */
export function forgetJobsOfLastDatabase(): void {
  manualStarts.clear();
  unsettled.clear();
  // The new one gets its own patience, and its own line in the log.
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryMs = 0;
}

// Set while a recovery on the database switched to is still owed: RUNNING rows from before this were left by nothing
// that's alive.
let recoveryOwedSince: Date | null = null;
let recoveryRetry: NodeJS.Timeout | null = null;

function retryRecoveryLater(before: Date): void {
  recoveryOwedSince = before;
  recoveryRetry = setTimeout(() => {
    recoveryRetry = null;
    recoverImportJobs(before).then(
      () => {
        if (recoveryOwedSince === before) recoveryOwedSince = null;
      },
      () => {
        // A newer switch took over while this one was out.
        if (recoveryOwedSince === before) retryRecoveryLater(before);
      },
    );
  }, importWorkerTuning.recoveryRetryMs);
  recoveryRetry.unref();
}

/** Its RUNNING rows have no runner here, and nothing else would settle them. Never rejects: the switch has happened by
 *  now, and a database on an older schema fails here (and in the worker's polls) until someone migrates it. */
export async function recoverAfterDatabaseSwitch(): Promise<void> {
  const swappedAt = new Date();
  if (recoveryRetry) clearTimeout(recoveryRetry);
  recoveryRetry = null;
  recoveryOwedSince = null;
  try {
    await recoverImportJobs();
  } catch (err) {
    log.error("couldn't recover import jobs on the database switched to, trying again", { error: err });
    retryRecoveryLater(swappedAt);
  }
}

/** RUNNING rows that may have something behind them. */
export function countRunningRows(): Promise<number> {
  const since = recoveryOwedSince ? { updatedAt: { gt: recoveryOwedSince } } : {};
  return prisma.importJob.count({ where: { status: "RUNNING", ...since } });
}
