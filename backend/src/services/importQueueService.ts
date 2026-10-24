// The import queue behind the admin "Import queue" page and the extension's "Add to the queue". Links
// sent from the extension collect in one PAUSED LINKS job per user until someone starts it; the
// admin page starts, pauses, retries and cleans up LINKS jobs of every user.

import type { ImportJob, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createNotification } from "./notificationService";
import { HttpError } from "../utils/fileUtils";
import { createKeyedLock } from "../utils/concurrency";
import { getActiveJob, resetFailedItems } from "./importJobService";
import {
  isRunnerLive,
  runLinksImportJob,
  runnerSettled,
  type LinksImportJobBody,
  type QueuedLinkOptions,
} from "./importJobRunner";
import { getUserMakerworldCookie } from "../providers/makerworld/session";
import { liftCaptchaCooloffByHand } from "../providers/makerworld/captcha";

/** The shared body a LINKS job reruns with: its stored payload plus the owner's saved MakerWorld
 *  cookie. The cookie is never stored on the job. */
async function linksJobBody(job: ImportJob): Promise<LinksImportJobBody> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  const cookie = await getUserMakerworldCookie(job.userId);
  return {
    url: job.sourceUrl,
    notes: (payload.notes as string | null) ?? null,
    tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
    category_id: (payload.category_id as string | null) ?? null,
    scope: payload.scope === "designer" || payload.scope === "all" ? payload.scope : "url",
    makerworld_cookie: cookie ?? undefined,
    itemDelayMs: typeof payload.item_delay_ms === "number" ? payload.item_delay_ms : undefined,
  };
}

/** Starts a LINKS job's PENDING links, or with `retryFailed` puts its FAILED links back first.
 *  Resolves once the runner is launched; `run` settles when it stops (finished or paused), which is
 *  what the bulk run waits on. `manual` is a person clicking start or retry: it lifts the MakerWorld
 *  CAPTCHA cooloff, which would otherwise fail every link without trying. */
export async function startLinksJob(
  job: ImportJob,
  opts: { retryFailed?: boolean; manual?: boolean } = {},
): Promise<{ run: Promise<void> }> {
  if (job.type !== "LINKS") throw new HttpError(400, "Only a link-list import can be started or retried");
  if (job.status === "RUNNING" && isRunnerLive(job.id)) throw new HttpError(409, "This import is already running");
  // An ERROR job was cut off (a restart, or its runner crashed) with links still waiting, and has
  // no failed links for a retry to pick up, so it starts like a paused one.
  if (!opts.retryFailed && job.status !== "PAUSED" && job.status !== "ERROR") {
    throw new HttpError(400, "Only a paused or interrupted import can be started");
  }
  if (isRunnerLive(job.id)) {
    // A paused job's runner finishes the link it's on before it stops, which can take a while.
    if (job.status === "PAUSED") {
      throw new HttpError(409, "This import is still finishing its current link, try again shortly");
    }
    // A finished one is only writing its notification.
    await runnerSettled(job.id);
  }
  const active = await getActiveJob(job.userId);
  if (active && active.id !== job.id) throw new HttpError(409, "An import is already in progress");

  if (opts.retryFailed) {
    const failed = await resetFailedItems(job.id);
    // Links an interrupted run never reached are rerun too, so a retry alone can finish it.
    const waiting = await prisma.importJobItem.count({
      where: { jobId: job.id, status: { in: ["PENDING", "RUNNING"] } },
    });
    if (!failed && !waiting) throw new HttpError(400, "This import has no failed links to retry");
  }
  // No runner is alive, so a RUNNING item was cut off (a restart, or a pause mid-link).
  await prisma.importJobItem.updateMany({ where: { jobId: job.id, status: "RUNNING" }, data: { status: "PENDING" } });
  const pending = await prisma.importJobItem.count({ where: { jobId: job.id, status: "PENDING" } });
  if (!pending) throw new HttpError(400, "This import has no links waiting to import");

  // Conditional on the status read above, so two starts at once launch one runner.
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: job.status },
    data: {
      status: "RUNNING",
      errorMessage: null,
      processed: await prisma.importJobItem.count({ where: { jobId: job.id, status: { in: ["DONE", "FAILED"] } } }),
      failedCount: await prisma.importJobItem.count({ where: { jobId: job.id, status: "FAILED" } }),
    },
  });
  if (!count) throw new HttpError(409, "This import changed while it was being started, reload and try again");
  if (opts.manual) liftCaptchaCooloffByHand();
  const body = await linksJobBody(job);
  return { run: runLinksImportJob(job.id, job.userId, body) };
}

/** Pausing only flips the status: the runner finishes the link it's on, then stops. */
export async function pauseLinksJob(job: ImportJob): Promise<void> {
  if (job.type !== "LINKS") throw new HttpError(400, "Only a link-list import can be paused");
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  if (!count) throw new HttpError(400, "Only a running import can be paused");
}

// ---- Sending links to the queue (the extension) ----

// Two quick sends from the extension would otherwise each create a PAUSED job.
const withUserLock = createKeyedLock();

/** Sent once, when links start collecting in a new paused queue. The queue shows its own live count;
 *  this notification is never edited or removed with it. */
async function notifyQueueStarted(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  const isAdmin = user?.role === "ADMIN";
  await createNotification(userId, {
    type: "queue",
    title: "Links are waiting in the import queue",
    body: isAdmin
      ? "Paused until you start it from Administration > Import queue."
      : "Paused until an admin starts it from the import queue.",
    internalPath: isAdmin ? "/admin-queue" : null,
  });
}

export type QueueLinkResult = { job: ImportJob; itemId: string; duplicate: boolean; waiting: number };

/** Adds one link to the user's PAUSED queue, creating it on the first link. A link already waiting
 *  there isn't added twice. */
export async function queueLink(userId: string, url: string, options: QueuedLinkOptions): Promise<QueueLinkResult> {
  if (options.collection_id) {
    const collection = await prisma.collection.findFirst({ where: { id: options.collection_id, userId } });
    if (!collection) throw new HttpError(404, "Collection not found");
  }
  return withUserLock(userId, async () => {
    // A paused sync job is that sync's own; links sent from Grab start a queue of their own.
    let job = await prisma.importJob.findFirst({
      where: { userId, type: "LINKS", status: "PAUSED", collectionSyncId: null },
      orderBy: { createdAt: "asc" },
    });
    if (!job) {
      job = await prisma.importJob.create({
        data: {
          userId,
          type: "LINKS",
          status: "PAUSED",
          sourceUrl: url,
          sourceLabel: "Sent from Thingport Grab",
          payload: { notes: null, tags: [], category_id: null, scope: "url" },
        },
      });
      await notifyQueueStarted(userId);
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
    const waiting = await prisma.importJobItem.count({ where: { jobId: job.id, status: "PENDING" } });
    return { job, itemId, duplicate: Boolean(existing), waiting };
  });
}

// ---- Admin queue page ----

export type QueueJobRow = ImportJob & {
  user: { id: string; displayName: string; email: string };
  counts: { pending: number; running: number; done: number; failed: number };
  runnerLive: boolean;
};

const LIST_LIMIT = 200;

/** Every user's batch imports, newest first. Only LINKS jobs can be started or retried, but the
 *  others are listed too so the page shows everything that ran. */
export async function listQueueJobs(): Promise<QueueJobRow[]> {
  const jobs = await prisma.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    include: { user: { select: { id: true, displayName: true, email: true } } },
  });
  const grouped = jobs.length
    ? await prisma.importJobItem.groupBy({
        by: ["jobId", "status"],
        where: { jobId: { in: jobs.map((j) => j.id) } },
        _count: { status: true },
      })
    : [];
  return jobs.map((job) => {
    const counts = { pending: 0, running: 0, done: 0, failed: 0 };
    for (const g of grouped) {
      if (g.jobId !== job.id) continue;
      const key = g.status.toLowerCase() as keyof typeof counts;
      counts[key] = g._count.status;
    }
    return Object.assign(job, { counts, runnerLive: isRunnerLive(job.id) });
  });
}

export async function getQueueJob(jobId: string): Promise<ImportJob> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) throw new HttpError(404, "Import job not found");
  return job;
}

function assertIdle(job: ImportJob): void {
  if (job.status === "RUNNING" || isRunnerLive(job.id)) {
    throw new HttpError(409, "Pause this import first, and wait for its current link to finish");
  }
}

async function deleteJob(job: ImportJob): Promise<void> {
  bulkQueue = bulkQueue.filter((entry) => entry.jobId !== job.id);
  await prisma.importJob.delete({ where: { id: job.id } });
}

export async function deleteQueueJob(jobId: string): Promise<void> {
  const job = await getQueueJob(jobId);
  assertIdle(job);
  await deleteJob(job);
}

/** Drops one link from an idle job. A job left without links is deleted with it. */
export async function removeQueueItem(itemId: string): Promise<{ jobDeleted: boolean }> {
  const item = await prisma.importJobItem.findUnique({ where: { id: itemId }, include: { job: true } });
  if (!item) throw new HttpError(404, "Queue item not found");
  assertIdle(item.job);
  await prisma.importJobItem.delete({ where: { id: itemId } });
  const left = await prisma.importJobItem.count({ where: { jobId: item.jobId } });
  if (!left) {
    await deleteJob(item.job);
    return { jobDeleted: true };
  }
  await prisma.importJob.update({
    where: { id: item.jobId },
    data: {
      total: left,
      processed: await prisma.importJobItem.count({ where: { jobId: item.jobId, status: { in: ["DONE", "FAILED"] } } }),
      failedCount: await prisma.importJobItem.count({ where: { jobId: item.jobId, status: "FAILED" } }),
    },
  });
  return { jobDeleted: false };
}

/** Finished jobs with nothing left to retry. Jobs with failed links stay, so a retry is still
 *  possible. */
export async function clearFinishedJobs(): Promise<number> {
  const { count } = await prisma.importJob.deleteMany({
    where: { status: "DONE", failedCount: 0, NOT: { id: { in: bulkQueue.map((e) => e.jobId) } } },
  });
  return count;
}

// ---- Bulk runs: "Start all" and "Retry all failed" ----

// One job at a time, across all users: every job of a bulk run hits the same providers from the
// same IP, and parallel bursts are what trip MakerWorld's CAPTCHA.
type BulkEntry = { jobId: string; retryFailed: boolean };
let bulkQueue: BulkEntry[] = [];
let bulkCurrent: string | null = null;

export function bulkRunState(): { running: boolean; currentJobId: string | null; remaining: number } {
  return {
    running: bulkCurrent !== null || bulkQueue.length > 0,
    currentJobId: bulkCurrent,
    remaining: bulkQueue.length,
  };
}

async function drainBulkQueue(): Promise<void> {
  if (bulkCurrent !== null) return;
  try {
    for (let entry = bulkQueue.shift(); entry; entry = bulkQueue.shift()) {
      bulkCurrent = entry.jobId;
      try {
        const job = await prisma.importJob.findUnique({ where: { id: entry.jobId } });
        if (!job) continue;
        const { run } = await startLinksJob(job, { retryFailed: entry.retryFailed });
        await run;
      } catch (err) {
        // A job that can't start (deleted, already running, nothing left) is skipped, not fatal.
        console.warn(`[import] bulk run skipped job ${entry.jobId}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    bulkCurrent = null;
  }
}

/** Bulk runs are started by hand, so they lift the CAPTCHA cooloff once (see startLinksJob). Not
 *  per job: after a CAPTCHA, the jobs behind it should fail fast, not each probe MakerWorld again. */
function enqueueBulk(entries: BulkEntry[]): number {
  if (entries.length) liftCaptchaCooloffByHand();
  const known = new Set([bulkCurrent, ...bulkQueue.map((e) => e.jobId)]);
  const fresh = entries.filter((e) => !known.has(e.jobId));
  bulkQueue.push(...fresh);
  void drainBulkQueue();
  return fresh.length;
}

/** Every PAUSED link-list job, oldest first. */
export async function startAllPaused(): Promise<number> {
  const jobs = await prisma.importJob.findMany({
    where: { type: "LINKS", status: "PAUSED" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return enqueueBulk(jobs.map((j) => ({ jobId: j.id, retryFailed: false })));
}

/** Every finished link-list job that has failed links, oldest first. */
export async function retryAllFailed(): Promise<number> {
  const jobs = await prisma.importJob.findMany({
    where: { type: "LINKS", status: { in: ["DONE", "ERROR"] }, items: { some: { status: "FAILED" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return enqueueBulk(jobs.map((j) => ({ jobId: j.id, retryFailed: true })));
}

/** Stops a bulk run: what hasn't started is dropped, and every running link-list job is paused. */
export async function pauseAll(): Promise<number> {
  bulkQueue = [];
  const { count } = await prisma.importJob.updateMany({
    where: { type: "LINKS", status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  return count;
}
