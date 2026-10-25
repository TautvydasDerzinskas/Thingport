import type { ImportJob, Prisma } from "@prisma/client";
import { Client } from "pg";
import { prisma, getActiveDatabaseUrl } from "../db";
import { withLinkAuth } from "../providers/registry";
import { HttpError } from "../utils/fileUtils";
import { runLinksImportJob, runnerSettled, type LinksImportJobBody } from "./importJobRunner";
import { importAndDescribe, prepareSingleImport, type SingleImportBody } from "./singleImport";

// A dedicated PostgreSQL session holds the global advisory lock across provider requests.
// Progress commits independently, without a long-running transaction or a pooled session lock.
const WORKER_LOCK = 174830219;
const MANAGED_TYPES = ["SINGLE", "LINKS"] as const;
let draining: Promise<void> | null = null;
let wakeRequested = false;

export function storedImportBody(body: SingleImportBody): Prisma.InputJsonValue {
  const { makerworld_cookie: _cookie, ...stored } = body;
  return JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue;
}

export async function enqueueSingleImport(userId: string, body: SingleImportBody): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "SINGLE",
      status: "QUEUED",
      sourceUrl: body.url,
      total: 1,
      payload: storedImportBody(body),
    },
  });
  wakeImportScheduler();
  return job;
}

export async function enqueueLinksImport(
  userId: string,
  urls: string[],
  payload: Prisma.InputJsonValue,
): Promise<ImportJob> {
  // Items and readiness become visible together, so no worker can finish a half-created job.
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "LINKS",
      status: "QUEUED",
      sourceUrl: urls[0],
      total: urls.length,
      payload,
      items: { create: urls.map((url) => ({ url })) },
    },
  });
  wakeImportScheduler();
  return job;
}

export async function executeQueuedImport(job: ImportJob): Promise<void> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  try {
    if (job.type === "LINKS") {
      const body = await withLinkAuth<LinksImportJobBody>(job.userId, {
        url: job.sourceUrl,
        notes: typeof payload.notes === "string" ? payload.notes : null,
        tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : [],
        category_id: typeof payload.category_id === "string" ? payload.category_id : null,
        scope: payload.scope === "designer" || payload.scope === "all" ? payload.scope : "url",
        itemDelayMs: typeof payload.item_delay_ms === "number" ? payload.item_delay_ms : undefined,
      });
      await runLinksImportJob(job.id, job.userId, body);
    } else {
      if (job.type !== "SINGLE") throw new HttpError(400, "Unsupported queued import type");
      const { url, body } = await prepareSingleImport(job.userId, {
        ...payload,
        url: job.sourceUrl,
      } as SingleImportBody);
      const result = await importAndDescribe(job.userId, url, body);
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          processed: 1,
          imported: result.import_outcome === "already_imported" ? 0 : 1,
          alreadyInLibrary: result.import_outcome === "already_imported" ? 1 : 0,
          resultPrintId: result.id,
          result: JSON.parse(JSON.stringify(result)),
        },
      });
    }
  } catch (err) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "ERROR",
        failedCount: job.type === "SINGLE" ? 1 : job.failedCount,
        processed: job.type === "SINGLE" ? 1 : job.processed,
        errorMessage: err instanceof HttpError ? err.message : "Internal server error",
        errorHttpStatus: err instanceof HttpError ? err.status : 500,
      },
    });
    console.error(`Queued import ${job.id} failed:`, err);
  }
}

export async function drainImportQueue(): Promise<void> {
  const lock = new Client({ connectionString: getActiveDatabaseUrl(), keepAlive: true });
  // pg emits errors for a dropped idle session. Stop claiming more work if ownership is lost.
  let lostLock = false;
  lock.on("error", (err) => {
    lostLock = true;
    console.error("Import worker lock connection failed:", err);
  });
  try {
    await lock.connect();
    const {
      rows: [row],
    } = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [WORKER_LOCK]);
    if (!row.acquired) return;
    // Only the lock holder recovers: another API starting must never reset a live worker.
    await prisma.importJobItem.updateMany({
      where: { status: "RUNNING", job: { type: { in: [...MANAGED_TYPES] }, status: { in: ["RUNNING", "QUEUED"] } } },
      data: { status: "PENDING" },
    });
    await prisma.importJob.updateMany({
      where: { type: { in: [...MANAGED_TYPES] }, status: "RUNNING" },
      data: { status: "QUEUED", errorMessage: null },
    });
    for (;;) {
      if (lostLock) return;
      const job = await prisma.importJob.findFirst({
        where: { status: "QUEUED", type: { in: [...MANAGED_TYPES] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!job) return;
      const claim = await prisma.importJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "RUNNING", errorMessage: null },
      });
      if (claim.count) await executeQueuedImport(job);
    }
  } finally {
    // Closing the dedicated session releases the lock, including after unexpected failures.
    await lock.end();
  }
}

export function wakeImportScheduler(): void {
  if (draining) {
    wakeRequested = true;
    return;
  }
  wakeRequested = false;
  draining = drainImportQueue()
    .catch((err) => console.error("Import scheduler failed:", err))
    .finally(() => {
      draining = null;
      if (wakeRequested) wakeImportScheduler();
    });
}

export function startImportScheduler(): void {
  wakeImportScheduler();
  // Polling also covers another API process enqueuing while this process owns the worker lock.
  setInterval(wakeImportScheduler, 2_000).unref();
}

/** Collection sync callers historically wait for their import and its final notification. */
export async function waitForScheduledImport(jobId: string): Promise<void> {
  for (;;) {
    const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) {
      await runnerSettled(jobId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
