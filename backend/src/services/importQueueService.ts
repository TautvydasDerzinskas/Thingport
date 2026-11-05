// The import queue: who is in the line, and everything a person or the extension does to a job from outside it. The
// worker that runs the line is services/importWorker.ts. Every change of state is compare-and-set on the status it read,
// a delete too. A foreign job id is a 404 wherever an owner is given, so nobody can probe someone else's.

import { createHash } from "node:crypto";
import type { ImportJob, Prisma } from "@prisma/client";
import { AUTH_SECRET } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { detectProvider, type ProviderId } from "../providers/index.generated";
import type { ProfileScope } from "../providers/types";
import { storedImportBody, type StoredRequest } from "../routes/importRequest";
import { HttpError } from "../utils/fileUtils";
import { syncCollection } from "./collectionSyncRunner";
import {
  isRunnerLive,
  isWaitingSyncJob,
  liveRunnerIds,
  parseQueuedLinkOptions,
  type QueuedLinkOptions,
  runnerSettled,
  SYNC_JOB_WAITING,
  SYNC_RESUME_MARKS,
} from "./importJobRunner";
import {
  countJobItems,
  createJobItems,
  hasSavedRequest,
  jobPayload,
  linkTotals,
  listJobItems,
  QUEUE_WAITING_PATH,
  resetFailedItems,
} from "./importJobService";
import {
  forgetManualStart,
  importWorkerStatus,
  importWorkerTuning,
  markManualStart,
  wakeImportWorker,
  withImportUserLock,
} from "./importWorker";
import { createNotification } from "./notificationService";

const log = createLogger("import");

/** What marks the job that Grab's "Add to the queue" collects links in, so they never join a pasted list with its own
 *  notes and tags, or a job a sync left behind. Old rows have it too. */
const GRAB_JOB_LABEL = "Sent from Thingport Grab";

// ---- The line ----

let lastTicket = 0;

/** When a job joins the line: after the last one to join, so jobs that join in one go keep their order. */
function nextTicket(): Date {
  lastTicket = Math.max(Date.now(), lastTicket + 1);
  return new Date(lastTicket);
}

/** The line in the worker's order, from the top. */
function lineOrder(db: Prisma.TransactionClient) {
  return db.importJob.findMany({
    where: { status: "QUEUED" },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true },
  });
}

/** A job's place in the line, 1 being next up; null when it isn't in line. */
export async function positionOf(jobId: string): Promise<number | null> {
  const place = (await lineOrder(prisma)).findIndex((job) => job.id === jobId);
  return place < 0 ? null : place + 1;
}

/** Who someone is in another person's view of the line: the same across their jobs and polls, and nothing to go on. */
export function personKey(userId: string): string {
  return createHash("sha256").update(`${AUTH_SECRET}:import-queue-person:${userId}`).digest("hex").slice(0, 12);
}

type LineSeat = { mine: boolean; person: string; job_id: string | null };

export type LineOut = {
  /** The job the worker is on; never a sync's, nor one started outside the line. */
  now: LineSeat | null;
  /** The line up to the viewer's last job; empty when they have nothing in it. */
  rows: (LineSeat & { position: number })[];
  length: number;
};

/** The line as one person may see it: other people's jobs say nothing but that they're someone's. */
export async function readLine(viewerId: string, db: Prisma.TransactionClient = prisma): Promise<LineOut> {
  const seat = (job: { id: string; userId: string }): LineSeat => {
    const mine = job.userId === viewerId;
    return { mine, person: personKey(job.userId), job_id: mine ? job.id : null };
  };
  const order = await lineOrder(db);
  const { currentJobId } = importWorkerStatus();
  const current = currentJobId
    ? await db.importJob.findUnique({ where: { id: currentJobId }, select: { id: true, userId: true, status: true } })
    : null;
  const lastOwn = order.map((job) => job.userId).lastIndexOf(viewerId);
  return {
    // A job that's pausing is still on its current link.
    now:
      current?.status === "RUNNING" || (current?.status === "PAUSED" && isRunnerLive(current.id))
        ? seat(current)
        : null,
    rows: order.slice(0, lastOwn + 1).map((job, index) => Object.assign(seat(job), { position: index + 1 })),
    length: order.length,
  };
}

// ---- Joining the line ----

export type EnqueuedJob = { job: ImportJob; position: number };

/** On hold first, with its links, and only then in line, so the worker can never claim a job half made. A crash in
 *  between leaves something on hold, which is harmless. */
async function enqueue(
  userId: string,
  type: ImportJob["type"],
  data: { sourceUrl: string; payload: Prisma.InputJsonValue } & Partial<
    Pick<ImportJob, "sourceLabel" | "provider" | "total">
  >,
  urls: string[] = [],
): Promise<EnqueuedJob> {
  const job = await prisma.importJob.create({ data: { userId, type, status: "PAUSED", ...data } });
  if (urls.length) await createJobItems(job.id, urls);
  const queuedAt = nextTicket();
  await prisma.importJob.updateMany({ where: { id: job.id, status: "PAUSED" }, data: { status: "QUEUED", queuedAt } });
  // Before the wake; a job already gone from the line by then has just been picked up.
  const position = (await positionOf(job.id)) ?? 1;
  wakeImportWorker();
  return { job: { ...job, status: "QUEUED", queuedAt }, position };
}

/** One link, as a LINKS job of one item. The same link already waiting as a single of this user answers that job. */
export function enqueueSingleImport(userId: string, url: string, body: StoredRequest): Promise<EnqueuedJob> {
  return withImportUserLock(userId, async () => {
    const waiting = await prisma.importJob.findFirst({
      where: { userId, type: "LINKS", status: "QUEUED", sourceUrl: url, payload: { path: ["single"], equals: true } },
    });
    if (waiting) return { job: waiting, position: (await positionOf(waiting.id)) ?? 1 };
    return enqueue(
      userId,
      "LINKS",
      {
        sourceUrl: url,
        sourceLabel: body.title?.trim() || null,
        provider: detectProvider(url),
        total: 1,
        payload: { ...storedImportBody(body), scope: "url", single: true },
      },
      [url],
    );
  });
}

export function enqueueLinksImport(
  userId: string,
  urls: string[],
  body: StoredRequest & { scope?: ProfileScope },
): Promise<EnqueuedJob> {
  const providers = new Set(urls.map((url) => detectProvider(url)));
  return enqueue(
    userId,
    "LINKS",
    {
      sourceUrl: urls[0],
      provider: providers.size === 1 ? [...providers][0] : null,
      total: urls.length,
      payload: { ...storedImportBody(body), scope: body.scope ?? "url" },
    },
    urls,
  );
}

export function enqueueZipImport(
  userId: string,
  url: string,
  body: StoredRequest & { entries: string[] },
): Promise<EnqueuedJob> {
  return enqueue(userId, "ZIP", {
    sourceUrl: url,
    sourceLabel: body.filename?.trim() || null,
    provider: detectProvider(url),
    total: body.entries.length,
    payload: { ...storedImportBody(body), entries: body.entries },
  });
}

/** `model_ids` as the provider's schema left them: the route has already validated and normalized them. */
export function enqueueListImport(
  userId: string,
  provider: ProviderId,
  url: string,
  body: StoredRequest & { model_ids: string[]; collection_title?: string | null },
): Promise<EnqueuedJob> {
  return enqueue(userId, "COLLECTION", {
    sourceUrl: url,
    sourceLabel: body.collection_title?.trim() || null,
    provider,
    total: body.model_ids.length,
    payload: {
      ...storedImportBody(body),
      model_ids: body.model_ids,
      collection_title: body.collection_title ?? null,
    },
  });
}

export function enqueueProfilesImport(
  userId: string,
  provider: ProviderId,
  url: string,
  body: StoredRequest & { scope: Exclude<ProfileScope, "url"> },
): Promise<EnqueuedJob> {
  return enqueue(userId, "PROFILES", {
    sourceUrl: url,
    provider,
    payload: { ...storedImportBody(body), scope: body.scope },
  });
}

// ---- Start and Retry ----

function isSingle(job: Pick<ImportJob, "payload">): boolean {
  return jobPayload(job).single === true;
}

/** What Start and Retry refuse by looking at the job alone. */
function refuseStart(job: ImportJob, retry: boolean): void {
  if (job.status === "QUEUED") return;
  if (job.type === "LINKS") {
    if (job.status === "RUNNING" && isRunnerLive(job.id)) throw new HttpError(409, "This import is already running");
    // An ERROR job was cut off (a restart, or its runner crashed) with links still waiting, and has
    // no failed links for a retry to pick up, so it starts like a paused one.
    if (!retry && job.status !== "PAUSED" && job.status !== "ERROR") {
      throw new HttpError(400, "Only a paused or interrupted import can be started");
    }
    return;
  }
  if (job.status === "RUNNING") throw new HttpError(409, "This import is already running");
  if (retry) {
    // No per-entry record: running it again would bring in what's already there a second time.
    if (job.type === "ZIP") throw new HttpError(400, "A zip import can't be retried: start a new one with what's left");
    if (job.status !== "ERROR" && !(job.status === "DONE" && job.failedCount > 0)) {
      throw new HttpError(400, "This import has nothing to retry");
    }
  } else if (job.status !== "PAUSED") {
    throw new HttpError(400, "Only a paused or interrupted import can be started");
  }
  if (!hasSavedRequest(job)) throw new HttpError(400, "This older import has no saved request");
}

/** A finished job's runner is only writing its notification, so that's worth a moment; anything longer is a 409. A
 *  paused job's is finishing its link, which can take a while. */
async function waitForRunner(job: ImportJob): Promise<void> {
  if (job.status === "PAUSED") {
    throw new HttpError(409, "This import is still finishing its current link, try again shortly");
  }
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    runnerSettled(job.id),
    new Promise((resolve) => {
      timer = setTimeout(resolve, importWorkerTuning.runnerWaitMs);
    }),
  ]);
  clearTimeout(timer);
  if (isRunnerLive(job.id)) throw new HttpError(409, "This import is still finishing, try again shortly");
}

/** Puts a LINKS job's links back to run: a retry's failed ones, and any a run was cut off on. No runner is alive. */
async function prepareLinks(job: ImportJob, retry: boolean): Promise<void> {
  if (retry) {
    const failed = await resetFailedItems(job.id);
    // Links an interrupted run never reached are rerun too, so a retry alone can finish it.
    const waiting = await countJobItems(job.id, { in: ["PENDING", "RUNNING"] });
    if (!failed && !waiting) throw new HttpError(400, "This import has no failed links to retry");
  }
  await prisma.importJobItem.updateMany({ where: { jobId: job.id, status: "RUNNING" }, data: { status: "PENDING" } });
  if (!(await countJobItems(job.id, "PENDING"))) throw new HttpError(400, "This import has no links waiting to import");
}

/** What a run says about itself goes when the next one is asked for. What a sync brought in so far stays through a
 *  plain Hold, or those models would never be announced. */
function restartedPayload(job: ImportJob): Prisma.InputJsonValue | undefined {
  if (!job.payload) return undefined;
  const kept = { ...jobPayload(job) };
  delete kept.failure_summary;
  delete kept.outcome;
  const stopped =
    job.status === "DONE" ||
    job.status === "ERROR" ||
    (job.status === "PAUSED" && job.errorMessage !== null && !SYNC_RESUME_MARKS.includes(job.errorMessage));
  if (stopped) delete kept.sync_new;
  return kept as Prisma.InputJsonValue;
}

/** What a job's card doesn't offer, its own routes don't take. The older routes keep their wider rules for whoever
 *  still uses them. */
async function refuseUnoffered(job: ImportJob, retry: boolean): Promise<void> {
  const [{ actions, counts }] = await describeJobs(prisma, [{ ...job }], new Date());
  if (retry ? actions.canRetry : actions.canStart) return;
  if (job.status === "RUNNING") throw new HttpError(409, "This import is already running");
  if (retry) throw new HttpError(400, "This import has no failed links to retry");
  throw new HttpError(
    400,
    counts.pending + counts.running
      ? "Some of this import's links failed: retry it"
      : "This import has no links waiting to import",
  );
}

export type StartedJob = { job: ImportJob; position: number | null; syncWaiting: boolean };

/** A person's Start or Retry, by a job of any type: to the back of the line, so nobody's number ever goes up by it. A
 *  job already in line keeps its place, or a double click would lose it. `manual` is a person clicking, which lifts a
 *  provider's pause when the job's turn comes. `asOffered` takes only what the job's card offers; a sync's job already
 *  waiting is a double click too. A sync's job never joins the line: it waits, marked, for its own lane, and a job its
 *  sync left behind is like any other. */
export async function startQueueJob(
  job: ImportJob,
  opts: { retryFailed?: boolean; manual?: boolean; asOffered?: boolean } = {},
): Promise<StartedJob> {
  const retry = opts.retryFailed === true;
  refuseStart(job, retry);
  if (job.status !== "QUEUED" && isRunnerLive(job.id)) await waitForRunner(job);
  const started = await withImportUserLock(job.userId, async () => {
    const fresh = await getQueueJob(job.id);
    if (fresh.status === "QUEUED") return fresh;
    refuseStart(fresh, retry);
    if (isRunnerLive(fresh.id)) throw new HttpError(409, "This import is still finishing, try again shortly");
    if (opts.asOffered) {
      if (isWaitingSyncJob(fresh)) return fresh;
      await refuseUnoffered(fresh, retry);
    }
    const isLinks = fresh.type === "LINKS";
    if (isLinks) await prepareLinks(fresh, retry);
    const totals = isLinks ? await linkTotals(fresh.id) : { processed: 0, failedCount: 0 };
    const place: Pick<ImportJob, "status" | "errorMessage"> & { queuedAt?: Date } = fresh.collectionSyncId
      ? { status: "PAUSED", errorMessage: SYNC_JOB_WAITING }
      : { status: "QUEUED", errorMessage: null, queuedAt: nextTicket() };
    const { count } = await prisma.importJob.updateMany({
      where: { id: fresh.id, status: fresh.status, errorMessage: fresh.errorMessage },
      data: {
        ...place,
        startedAt: null,
        payload: restartedPayload(fresh),
        ...totals,
        // Everything else a LINKS job counted stays: only the links it hasn't got yet run again.
        ...(isLinks ? {} : { imported: 0, alreadyInLibrary: 0, resultPrintId: null, resultCollectionId: null }),
      },
    });
    if (!count) throw new HttpError(409, "This import changed while it was being started, reload and try again");
    if (opts.manual) markManualStart(fresh.id);
    return { ...fresh, ...place };
  });
  if (started.collectionSyncId) {
    // Not waited for: the lane may be hours away. If this collection has its place already, the mark stays for a later look.
    void syncCollection(started.collectionSyncId, { resumeOnly: true }).catch((err) =>
      log.error("couldn't pick up a sync's job", { job: started.id, error: err }),
    );
    return { job: started, position: null, syncWaiting: true };
  }
  const position = (await positionOf(started.id)) ?? 1;
  wakeImportWorker();
  return { job: started, position, syncWaiting: false };
}

// ---- Hold and Pause ----

/** Hold takes a waiting job of any type out of the line. Pause only flips a running LINKS job's status: the runner
 *  finishes the link it's on, then stops. Other running jobs have no point to stop at. A sync's job waiting for its
 *  lane goes on hold by losing its mark. */
export async function pauseQueueJob(job: ImportJob): Promise<void> {
  if (job.status === "QUEUED") {
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "PAUSED" },
    });
    if (!count) throw new HttpError(409, "This import changed while it was being held, reload and try again");
    forgetManualStart(job.id);
    return;
  }
  if (isWaitingSyncJob(job)) {
    if (isRunnerLive(job.id)) {
      throw new HttpError(409, "This import is still finishing its current link, try again shortly");
    }
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "PAUSED", errorMessage: job.errorMessage },
      data: { errorMessage: null },
    });
    if (!count) throw new HttpError(409, "This import changed while it was being held, reload and try again");
    forgetManualStart(job.id);
    return;
  }
  if (job.type !== "LINKS") throw new HttpError(400, "Only a link-list import can be paused");
  if (job.status === "RUNNING" && isSingle(job)) throw new HttpError(400, "A single link can't be paused");
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  if (!count) throw new HttpError(400, "Only a running import can be paused");
}

// ---- Sending links to the queue (the extension) ----

/** Sent once, when links start collecting in a new held job. The queue shows its own live count;
 *  this notification is never edited or removed with it. */
async function notifyQueueStarted(userId: string): Promise<void> {
  await createNotification(userId, {
    type: "queue",
    title: "Links are waiting in the import queue",
    body: "Paused until you start it from the import queue.",
    internalPath: QUEUE_WAITING_PATH,
  });
}

export type QueueLinkResult = {
  job: ImportJob;
  itemId: string;
  duplicate: boolean;
  waiting: number;
  /** The owner has their links start by themselves, so this one joined the line. */
  started: boolean;
  position: number | null;
};

/** Adds one link to the user's Grab job, creating it on the first link: held until someone starts it, or in line for
 *  someone who has their links start by themselves. A link already waiting there isn't added twice. It never joins a
 *  job with a live runner, which has read its links already and would leave it stranded. */
export async function queueLink(userId: string, url: string, options: QueuedLinkOptions): Promise<QueueLinkResult> {
  if (options.collection_id) {
    const collection = await prisma.collection.findFirst({ where: { id: options.collection_id, userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
  }
  const result = await withImportUserLock(userId, async () => {
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { startGrabLinks: true } });
    const started = owner?.startGrabLinks === true;
    let job = await prisma.importJob.findFirst({
      where: {
        userId,
        type: "LINKS",
        status: started ? "QUEUED" : "PAUSED",
        collectionSyncId: null,
        sourceLabel: GRAB_JOB_LABEL,
        id: { notIn: liveRunnerIds() },
      },
      orderBy: { createdAt: "asc" },
    });
    const isNew = !job;
    if (!job) {
      job = await prisma.importJob.create({
        data: {
          userId,
          type: "LINKS",
          status: "PAUSED",
          sourceUrl: url,
          sourceLabel: GRAB_JOB_LABEL,
          payload: { notes: null, tags: [], category_id: null, scope: "url" },
        },
      });
      if (!started) await notifyQueueStarted(userId);
    }

    const existing = await prisma.importJobItem.findFirst({
      where: { jobId: job.id, url, status: { in: ["PENDING", "FAILED"] } },
    });
    let itemId: string;
    if (existing) {
      itemId = existing.id;
    } else {
      const payload: Prisma.InputJsonValue = {
        collection_id: options.collection_id ?? null,
        scope: options.scope ?? "url",
        title: options.title ?? null,
      };
      const item = await prisma.importJobItem.create({ data: { jobId: job.id, url, payload } });
      itemId = item.id;
      job = await prisma.importJob.update({
        where: { id: job.id },
        data: { total: await prisma.importJobItem.count({ where: { jobId: job.id } }) },
      });
    }
    // On hold until its first link is in, like any job joining the line.
    if (isNew && started) {
      job = await prisma.importJob.update({
        where: { id: job.id },
        data: { status: "QUEUED", queuedAt: nextTicket() },
      });
    }
    const waiting = await countJobItems(job.id, "PENDING");
    return { job, itemId, duplicate: Boolean(existing), waiting, started };
  });
  const position = result.started ? await positionOf(result.job.id) : null;
  if (result.started) wakeImportWorker();
  return { ...result, position };
}

// ---- Reading jobs ----

/** Old rows would otherwise fill Needs attention on the first load after an upgrade. */
const ATTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A finished job with something for its owner to deal with, and either from the line or recent. A partly failed zip
 *  has nothing to retry, so it just counts as finished. Keep beside isAttention. */
export function attentionWhere(now: Date): Prisma.ImportJobWhereInput {
  return {
    AND: [
      { OR: [{ status: "ERROR" }, { status: "DONE", failedCount: { gt: 0 }, type: { not: "ZIP" } }] },
      { OR: [{ queuedAt: { not: null } }, { updatedAt: { gte: new Date(now.getTime() - ATTENTION_WINDOW_MS) } }] },
    ],
  };
}

export function isAttention(
  job: Pick<ImportJob, "status" | "type" | "failedCount" | "queuedAt" | "updatedAt">,
  now: Date,
): boolean {
  const problem = job.status === "ERROR" || (job.status === "DONE" && job.failedCount > 0 && job.type !== "ZIP");
  return problem && (job.queuedAt !== null || job.updatedAt.getTime() >= now.getTime() - ATTENTION_WINDOW_MS);
}

/** Exactly the Finished section: what Clear finished acts on. */
function finishedWhere(now: Date): Prisma.ImportJobWhereInput {
  return { status: { in: ["DONE", "ERROR"] }, NOT: attentionWhere(now) };
}

type JobCounts = { pending: number; running: number; done: number; failed: number };
type JobActions = { canStart: boolean; canPause: boolean; canRetry: boolean; canDelete: boolean };

/** What can be done to a job right now. Nothing is possible while its runner is alive, but Pause on a running job. */
export function jobActions(
  job: Pick<ImportJob, "status" | "type" | "failedCount" | "payload" | "collectionSyncId" | "errorMessage">,
  counts: JobCounts,
  live: boolean,
): JobActions {
  const isLinks = job.type === "LINKS";
  const finished = job.status === "DONE" || job.status === "ERROR";
  const syncWaiting = isWaitingSyncJob(job);
  const linksWaiting = counts.pending + counts.running;
  const saved = hasSavedRequest(job);
  const canRetry = isLinks
    ? ((finished || (job.status === "PAUSED" && !syncWaiting)) && counts.failed > 0) || (finished && linksWaiting > 0)
    : job.type !== "ZIP" && saved && finished && (job.status === "ERROR" || job.failedCount > 0);
  const startable =
    (job.status === "PAUSED" && !syncWaiting) ||
    (job.status === "ERROR" && isLinks && linksWaiting > 0 && counts.failed === 0);
  return {
    canStart: !live && startable && (isLinks ? linksWaiting > 0 : saved),
    canPause:
      (job.status === "RUNNING" && isLinks && !isSingle(job)) || (!live && (job.status === "QUEUED" || syncWaiting)),
    canRetry: !live && canRetry,
    canDelete: !live && job.status !== "RUNNING",
  };
}

/** A job as the queue shows it. */
export type QueueJobView = ImportJob & {
  counts: JobCounts;
  runnerLive: boolean;
  position: number | null;
  syncWaiting: boolean;
  attention: boolean;
  firstFailure: string | null;
  /** The page title of a link list's only link. */
  linkTitle: string | null;
  actions: JobActions;
};

async function describeJobs<T extends ImportJob>(
  db: Prisma.TransactionClient,
  jobs: T[],
  now: Date,
): Promise<(T & QueueJobView)[]> {
  const ids = jobs.map((job) => job.id);
  const [grouped, failures, line] = ids.length
    ? [
        await db.importJobItem.groupBy({
          by: ["jobId", "status"],
          where: { jobId: { in: ids } },
          _count: { status: true },
        }),
        await db.importJobItem.findMany({
          where: { jobId: { in: ids }, status: "FAILED", errorMessage: { not: null } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          distinct: ["jobId"],
          select: { jobId: true, errorMessage: true },
        }),
        await lineOrder(db),
      ]
    : [[], [], []];
  const places = new Map(line.map((job, index) => [job.id, index + 1]));
  const firstFailures = new Map(failures.map((item) => [item.jobId, item.errorMessage]));
  const linkCounts = new Map<string, number>();
  for (const g of grouped) linkCounts.set(g.jobId, (linkCounts.get(g.jobId) ?? 0) + g._count.status);
  const onlyLinks = jobs.filter((job) => job.type === "LINKS" && linkCounts.get(job.id) === 1).map((job) => job.id);
  const titled = onlyLinks.length
    ? await db.importJobItem.findMany({
        where: { jobId: { in: onlyLinks } },
        select: { jobId: true, payload: true },
      })
    : [];
  const linkTitles = new Map(titled.map((item) => [item.jobId, parseQueuedLinkOptions(item.payload).title ?? null]));
  return jobs.map((job) => {
    const counts: JobCounts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const g of grouped) {
      if (g.jobId === job.id) counts[g.status.toLowerCase() as keyof JobCounts] = g._count.status;
    }
    const runnerLive = isRunnerLive(job.id);
    return Object.assign(job, {
      counts,
      runnerLive,
      position: places.get(job.id) ?? null,
      syncWaiting: isWaitingSyncJob(job),
      attention: isAttention(job, now),
      firstFailure: firstFailures.get(job.id) ?? null,
      linkTitle: linkTitles.get(job.id) ?? null,
      actions: jobActions(job, counts, runnerLive),
    });
  });
}

const newestFirst = (a: ImportJob, b: ImportJob) => b.createdAt.getTime() - a.createdAt.getTime();

const FINISHED_SHOWN = 50;

export type OwnQueue = {
  jobs: QueueJobView[];
  /** Every finished job that isn't asking for attention, the number Clear finished acts on. */
  finishedTotal: number;
  line: LineOut;
  startGrabLinks: boolean;
};

/** A person's own imports: everything unfinished and everything asking for attention however many, and the newest of
 *  the rest. In one snapshot, so a job and its number agree. */
export async function readOwnQueue(userId: string): Promise<OwnQueue> {
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      const open = await tx.importJob.findMany({
        where: { userId, OR: [{ status: { in: ["QUEUED", "RUNNING", "PAUSED"] } }, attentionWhere(now)] },
      });
      const finished = { userId, ...finishedWhere(now) };
      const newest = await tx.importJob.findMany({
        where: finished,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: FINISHED_SHOWN,
      });
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { startGrabLinks: true } });
      return {
        jobs: await describeJobs(tx, [...open, ...newest].toSorted(newestFirst), now),
        finishedTotal: await tx.importJob.count({ where: finished }),
        line: await readLine(userId, tx),
        startGrabLinks: owner?.startGrabLinks === true,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** Whether Grab's "Add to the queue" joins the line by itself from now on. What's on hold stays there. */
export async function setStartGrabLinks(userId: string, startGrabLinks: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { startGrabLinks } });
}

export type QueueJobRow = QueueJobView & { user: { id: string; displayName: string; email: string } };

const LIST_LIMIT = 200;

const withUser = { user: { select: { id: true, displayName: true, email: true } } };

const NEWEST_JOBS = { orderBy: { createdAt: "desc" }, take: LIST_LIMIT, include: withUser } as const;

/** Every user's imports, newest first, up to a limit. */
export async function listQueueJobs(): Promise<QueueJobRow[]> {
  return describeJobs(prisma, await prisma.importJob.findMany(NEWEST_JOBS), new Date());
}

type EveryonesQueue = {
  jobs: QueueJobRow[];
  /** What Clear finished acts on, which can be far more than `jobs` lists. */
  finishedTotal: number;
  finishedByOwner: Record<string, number>;
};

/** Every user's imports for the new queue: also everything unfinished or asking for attention beyond the limit, and
 *  how many have finished. In one snapshot. */
export async function readEveryonesQueue(): Promise<EveryonesQueue> {
  const now = new Date();
  return prisma.$transaction(
    async (tx) => {
      const jobs = await tx.importJob.findMany(NEWEST_JOBS);
      const beyond = await tx.importJob.findMany({
        where: {
          id: { notIn: jobs.map((job) => job.id) },
          OR: [{ status: { in: ["QUEUED", "RUNNING", "PAUSED"] } }, attentionWhere(now)],
        },
        include: withUser,
      });
      const finished = await tx.importJob.groupBy({
        by: ["userId"],
        where: finishedWhere(now),
        _count: { id: true },
      });
      return {
        jobs: await describeJobs(tx, [...jobs, ...beyond].toSorted(newestFirst), now),
        finishedTotal: finished.reduce((total, owner) => total + owner._count.id, 0),
        finishedByOwner: Object.fromEntries(finished.map((owner) => [owner.userId, owner._count.id])),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/** The job, unless `ownerId` is given and it's someone else's: that reads as if it weren't there. */
export async function getQueueJob(jobId: string, ownerId?: string): Promise<ImportJob> {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, ...(ownerId ? { userId: ownerId } : {}) } });
  if (!job) throw new HttpError(404, "Import job not found");
  return job;
}

function assertIdle(job: ImportJob): void {
  if (job.status === "RUNNING" || isRunnerLive(job.id)) {
    throw new HttpError(409, "Pause this import first, and wait for its current link to finish");
  }
}

async function deleteJob(job: ImportJob): Promise<void> {
  const { count } = await prisma.importJob.deleteMany({ where: { id: job.id, status: job.status } });
  if (!count) throw new HttpError(409, "This import changed, reload and try again");
  forgetManualStart(job.id);
}

/** Under the owner's lock, or it could land between queueLink finding the job and adding a link to it. */
export async function deleteQueueJob(jobId: string, ownerId?: string): Promise<void> {
  const { userId } = await getQueueJob(jobId, ownerId);
  await withImportUserLock(userId, async () => {
    const job = await getQueueJob(jobId, ownerId);
    assertIdle(job);
    await deleteJob(job);
  });
}

/** Drops one link from an idle job. A job left without links is deleted with it. */
export async function removeQueueItem(itemId: string, ownerId?: string): Promise<{ jobDeleted: boolean }> {
  const notFound = () => new HttpError(404, "Queue item not found");
  const item = await prisma.importJobItem.findFirst({
    where: { id: itemId, ...(ownerId ? { job: { userId: ownerId } } : {}) },
    select: { jobId: true, url: true, job: { select: { userId: true } } },
  });
  if (!item) throw notFound();
  return withImportUserLock(item.job.userId, async () => {
    const job = await prisma.importJob.findUnique({ where: { id: item.jobId } });
    if (!job) throw notFound();
    assertIdle(job);
    const removed = await prisma.importJobItem.deleteMany({ where: { id: itemId } });
    if (!removed.count) throw notFound();
    const left = await prisma.importJobItem.count({ where: { jobId: job.id } });
    if (!left) {
      await deleteJob(job);
      return { jobDeleted: true };
    }
    // The job goes by its first link until it has a name, and opens at it.
    const [next] = job.sourceUrl === item.url ? await listJobItems(job.id) : [];
    const totals = await linkTotals(job.id);
    await prisma.importJob.updateMany({
      where: { id: job.id },
      data: { ...(next ? { sourceUrl: next.url } : {}), total: left, ...totals },
    });
    // On hold with every link done, there's nothing to start or retry, so it has finished. Not a sync's: only its own
    // end says what it brought in.
    if (job.status === "PAUSED" && !job.collectionSyncId && !totals.failedCount && totals.processed === left) {
      await prisma.importJob.updateMany({
        where: { id: job.id, status: "PAUSED" },
        data: { status: "DONE", errorMessage: null },
      });
    }
    return { jobDeleted: false };
  });
}

// ---- All at once ----

/** Which jobs a bulk action covers, and what it means: `line` for the new queue's buttons, without it what the admin
 *  page has always meant by them, for a page open across an upgrade. */
export type BulkScope = { ownerId?: string; line?: boolean };

const ownerOf = (scope: BulkScope): Prisma.ImportJobWhereInput => (scope.ownerId ? { userId: scope.ownerId } : {});

/** Cleared by hand only. With `line`, exactly the Finished section, old failures included. Otherwise only jobs with
 *  nothing to retry, as the old page meant. */
export async function clearFinishedJobs(scope: BulkScope = {}): Promise<number> {
  const finished: Prisma.ImportJobWhereInput = scope.line
    ? finishedWhere(new Date())
    : { status: "DONE", failedCount: 0 };
  const { count } = await prisma.importJob.deleteMany({
    where: { ...finished, ...ownerOf(scope), id: { notIn: liveRunnerIds() } },
  });
  return count;
}

export async function bulkRunState(): Promise<{ running: boolean; currentJobId: string | null; remaining: number }> {
  const { currentJobId } = importWorkerStatus();
  const remaining = await prisma.importJob.count({ where: { status: "QUEUED" } });
  return { running: currentJobId !== null || remaining > 0, currentJobId, remaining };
}

/** Each job on its own: one refused is logged and skipped. A provider's pause is lifted once, by the first: after a
 *  CAPTCHA, the jobs behind it should fail fast, not each probe the site again. */
async function startEach(jobs: ImportJob[], opts: { retryFailed?: boolean }): Promise<number> {
  let started = 0;
  for (const job of jobs) {
    try {
      await startQueueJob(job, { ...opts, manual: started === 0 });
      started++;
    } catch (err) {
      log.warn("bulk action skipped a job", { job: job.id, error: err });
    }
  }
  return started;
}

/** New queue: everything on hold that can start, which leaves out a sync's job that's waiting for its lane anyway.
 *  Otherwise every PAUSED link-list job. Oldest first, either way. */
export async function startAllPaused(scope: BulkScope = {}): Promise<number> {
  const oldestFirst = { orderBy: { createdAt: "asc" } } as const;
  if (!scope.line) {
    const jobs = await prisma.importJob.findMany({
      where: { ...ownerOf(scope), type: "LINKS", status: "PAUSED" },
      ...oldestFirst,
    });
    return startEach(jobs, {});
  }
  const jobs = await prisma.importJob.findMany({
    where: { ...ownerOf(scope), status: "PAUSED" },
    ...oldestFirst,
  });
  const described = await describeJobs(prisma, jobs, new Date());
  return startEach(
    described.filter((job) => job.actions.canStart),
    {},
  );
}

/** New queue: everything asking for attention that can retry. Otherwise every finished link-list job with failed
 *  links, however old. Oldest first, either way. */
export async function retryAllFailed(scope: BulkScope = {}): Promise<number> {
  const oldestFirst = { orderBy: { createdAt: "asc" } } as const;
  if (!scope.line) {
    const jobs = await prisma.importJob.findMany({
      where: {
        ...ownerOf(scope),
        type: "LINKS",
        status: { in: ["DONE", "ERROR"] },
        items: { some: { status: "FAILED" } },
      },
      ...oldestFirst,
    });
    return startEach(jobs, { retryFailed: true });
  }
  const now = new Date();
  const jobs = await prisma.importJob.findMany({
    where: { ...ownerOf(scope), ...attentionWhere(now) },
    ...oldestFirst,
  });
  const described = await describeJobs(prisma, jobs, now);
  return startEach(
    described.filter((job) => job.actions.canRetry),
    { retryFailed: true },
  );
}

/** New queue: running link lists stop after their current link, and nobody's place in line is touched. Otherwise
 *  everything waiting is held too, though only the running ones count, as they did when only they could be stopped. */
export async function pauseAll(scope: BulkScope = {}): Promise<number> {
  const running: Prisma.ImportJobWhereInput = { ...ownerOf(scope), type: "LINKS", status: "RUNNING" };
  if (!scope.line) {
    await prisma.importJob.updateMany({ where: { ...ownerOf(scope), status: "QUEUED" }, data: { status: "PAUSED" } });
    await prisma.importJob.updateMany({
      where: {
        ...ownerOf(scope),
        status: "PAUSED",
        collectionSyncId: { not: null },
        errorMessage: { in: SYNC_RESUME_MARKS },
      },
      data: { errorMessage: null },
    });
    const { count } = await prisma.importJob.updateMany({ where: running, data: { status: "PAUSED" } });
    return count;
  }
  let paused = 0;
  for (const job of await prisma.importJob.findMany({ where: running })) {
    if (isSingle(job)) continue;
    try {
      await pauseQueueJob(job);
      paused++;
    } catch (err) {
      log.warn("bulk action skipped a job", { job: job.id, error: err });
    }
  }
  return paused;
}
