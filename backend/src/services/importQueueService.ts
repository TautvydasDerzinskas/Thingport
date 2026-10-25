// The import queue behind the admin "Import queue" page and the extension's "Add to the queue". Links
// sent from the extension collect in one PAUSED LINKS job per user until someone starts it; the
// admin page starts, pauses, retries and cleans up LINKS jobs of every user.

import type { ImportJob, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createNotification } from "./notificationService";
import { HttpError } from "../utils/fileUtils";
import { createKeyedLock } from "../utils/concurrency";
import { resetFailedItems } from "./importJobService";
import { isRunnerLive, runnerSettled, type QueuedLinkOptions } from "./importJobRunner";
import { liftProviderHolds } from "../providers/registry";
import { wakeImportScheduler, MANAGED_TYPES } from "./importScheduler";

/** Starts a LINKS job's PENDING links, or with `retryFailed` puts its FAILED links back first.
 *  Resolves once the job is persisted as QUEUED; `run` is retained for older callers. `manual` is a person clicking start or retry: it lifts the MakerWorld
 *  CAPTCHA cooloff, which would otherwise fail every link without trying. */
export async function startLinksJob(
  job: ImportJob,
  opts: { retryFailed?: boolean; manual?: boolean } = {},
): Promise<{ run: Promise<void> }> {
  if (job.type === "COLLECTION" || job.type === "ZIP" || job.type === "PROFILES") {
    if (!job.payload) throw new HttpError(400, "This older import has no saved request; start a new import");
    if (
      job.status !== "PAUSED" &&
      job.status !== "ERROR" &&
      !(opts.retryFailed && job.status === "DONE" && job.failedCount > 0)
    ) {
      throw new HttpError(409, "Only a paused or failed import can be started");
    }
    if (job.type === "ZIP" && job.status !== "PAUSED") {
      throw new HttpError(
        400,
        "ZIP entries may already be imported. Select only the remaining entries in a new import.",
      );
    }
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "QUEUED", errorMessage: null, failedCount: 0, processed: 0, imported: 0, alreadyInLibrary: 0 },
    });
    if (!count) throw new HttpError(409, "This import changed while it was being started");
    if (opts.manual) liftProviderHolds();
    wakeImportScheduler();
    return { run: Promise.resolve() };
  }
  if (job.type === "SINGLE") {
    if (job.status !== "PAUSED" && job.status !== "ERROR") {
      throw new HttpError(409, "Only a paused or failed import can be started");
    }
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "QUEUED", errorMessage: null, errorHttpStatus: null, failedCount: 0, processed: 0 },
    });
    if (!count) throw new HttpError(409, "This import changed while it was being started");
    if (opts.manual) liftProviderHolds();
    wakeImportScheduler();
    return { run: Promise.resolve() };
  }
  if (job.type !== "LINKS") throw new HttpError(400, "Only a link-list import can be started or retried");
  if (job.status === "RUNNING" || job.status === "QUEUED") throw new HttpError(409, "This import is already running");
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
      status: "QUEUED",
      errorMessage: null,
      processed: await prisma.importJobItem.count({ where: { jobId: job.id, status: { in: ["DONE", "FAILED"] } } }),
      failedCount: await prisma.importJobItem.count({ where: { jobId: job.id, status: "FAILED" } }),
    },
  });
  if (!count) throw new HttpError(409, "This import changed while it was being started, reload and try again");
  if (opts.manual) liftProviderHolds();
  wakeImportScheduler();
  return { run: Promise.resolve() };
}

/** Pausing only flips the status: the runner finishes the link it's on, then stops. */
export async function pauseLinksJob(job: ImportJob): Promise<void> {
  if (job.type === "COLLECTION" || job.type === "ZIP" || job.type === "PROFILES") {
    if (!job.payload) throw new HttpError(400, "This older import has no saved request");
    // These runners finish the current batch; they have no safe mid-batch pause checkpoint.
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "PAUSED" },
    });
    if (!count) throw new HttpError(409, "Only a waiting batch import can be paused");
    return;
  }
  if (job.type !== "LINKS" && job.type !== "SINGLE") throw new HttpError(400, "This import cannot be paused");
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: { in: ["RUNNING", "QUEUED"] } },
    data: { status: "PAUSED" },
  });
  if (!count) throw new HttpError(400, "Only a running or queued import can be paused");
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
  if (job.status === "QUEUED" || job.status === "RUNNING" || isRunnerLive(job.id)) {
    throw new HttpError(409, "Pause this import first, and wait for its current link to finish");
  }
}

async function deleteJob(job: ImportJob): Promise<void> {
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
    where: { status: "DONE", failedCount: 0 },
  });
  return count;
}

// ---- Bulk runs: "Start all" and "Retry all failed" ----

// The database scheduler owns the ordering; these counters are retained for older admin clients.
export async function bulkRunState(): Promise<{ running: boolean; currentJobId: string | null; remaining: number }> {
  const [current, remaining] = await Promise.all([
    prisma.importJob.findFirst({
      where: { type: { in: [...MANAGED_TYPES] }, status: "RUNNING" },
      select: { id: true },
    }),
    prisma.importJob.count({ where: { type: { in: [...MANAGED_TYPES] }, status: "QUEUED" } }),
  ]);
  return { running: Boolean(current) || remaining > 0, currentJobId: current?.id ?? null, remaining };
}

async function enqueueBulk(entries: { id: string }[], retryFailed: boolean): Promise<number> {
  if (entries.length) liftProviderHolds();
  let queued = 0;
  for (const entry of entries) {
    try {
      await startLinksJob(await getQueueJob(entry.id), { retryFailed });
      queued++;
    } catch (err) {
      console.warn(`[import] could not queue ${entry.id}:`, err);
    }
  }
  return queued;
}

/** Every PAUSED link-list job, oldest first. */
export async function startAllPaused(): Promise<number> {
  const jobs = await prisma.importJob.findMany({
    where: { type: { in: [...MANAGED_TYPES] }, status: "PAUSED" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return enqueueBulk(jobs, false);
}

/** Every finished link-list job that has failed links, oldest first. */
export async function retryAllFailed(): Promise<number> {
  const jobs = await prisma.importJob.findMany({
    where: {
      OR: [
        { type: "SINGLE", status: "ERROR" },
        { type: { in: ["COLLECTION", "PROFILES"] }, status: "ERROR" },
        { type: { in: ["COLLECTION", "PROFILES"] }, status: "DONE", failedCount: { gt: 0 } },
        { type: "LINKS", status: { in: ["DONE", "ERROR"] }, items: { some: { status: "FAILED" } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return enqueueBulk(jobs, true);
}

/** Stops a bulk run: what hasn't started is dropped, and every running link-list job is paused. */
export async function pauseAll(): Promise<number> {
  const { count } = await prisma.importJob.updateMany({
    where: {
      OR: [
        { type: { in: ["SINGLE", "LINKS"] }, status: { in: ["RUNNING", "QUEUED"] } },
        { type: { in: ["COLLECTION", "ZIP", "PROFILES"] }, status: "QUEUED" },
      ],
    },
    data: { status: "PAUSED" },
  });
  return count;
}
