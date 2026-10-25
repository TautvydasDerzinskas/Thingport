import { Prisma } from "@prisma/client";
import { Client } from "pg";
import { prisma, getActiveDatabaseUrl } from "../db";
import { HttpError } from "../utils/fileUtils";
import { executeQueuedImport } from "./importJobExecution";
import { recoverImmediateImports } from "./immediateImport";

// A dedicated PostgreSQL session holds the global advisory lock across provider requests.
// Progress commits independently, without a long-running transaction or a pooled session lock.
export const IMPORT_WORKER_LOCK = 174830219;
export const MANAGED_TYPES = ["SINGLE", "LINKS", "COLLECTION", "ZIP", "PROFILES"] as const;
// Explicit browser sessions belong to another request/process, not the durable worker.
// A payload-less batch is a legacy direct runner and must likewise never be recovered here.
const DURABLE_JOB: Prisma.ImportJobWhereInput = {
  payload: { not: Prisma.DbNull },
  OR: [
    { payload: { path: ["immediate"], equals: Prisma.AnyNull } },
    { NOT: { payload: { path: ["immediate"], equals: true } } },
  ],
};
let draining: Promise<void> | null = null;
let wakeRequested = false;
let suspended = false;
const activeDrains = new Set<Promise<void>>();

/** Stop claims before swapping the shared Prisma client; let the current job finish on its database. */
export async function withImportSchedulerStopped<T>(change: () => Promise<T> | T): Promise<T> {
  if (suspended) throw new HttpError(409, "The import scheduler is already stopping");
  suspended = true;
  try {
    await Promise.allSettled(activeDrains);
    return await change();
  } finally {
    suspended = false;
    wakeImportScheduler();
  }
}

export function drainImportQueue(): Promise<void> {
  if (suspended) return Promise.resolve();
  const run = drainQueue().finally(() => activeDrains.delete(run));
  activeDrains.add(run);
  return run;
}

async function drainQueue(): Promise<void> {
  const lock = new Client({ connectionString: getActiveDatabaseUrl(), keepAlive: true });
  // pg emits errors for a dropped idle session. Stop claiming more work if ownership is lost.
  let lostLock = false;
  let working = false;
  lock.on("error", (err) => {
    lostLock = true;
    console.error("Import worker lock connection failed:", err);
    // Provider pipelines cannot yet be cancelled reliably. Continuing after losing the lock
    // permits another process to recover the same job while this one still writes its files.
    // Exit synchronously; the supervisor restarts us and recovery marks unsafe work as ERROR.
    if (working) process.exit(1);
  });
  try {
    await lock.connect();
    const {
      rows: [row],
    } = await lock.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [IMPORT_WORKER_LOCK]);
    if (!row.acquired) return;
    if (lostLock || suspended) return;
    // Recovery and claiming also write shared state: a lost session here must fail closed.
    working = true;
    await recoverImmediateImports();
    // Only the lock holder recovers: another API starting must never reset a live worker.
    await prisma.importJobItem.updateMany({
      where: {
        status: "RUNNING",
        job: { ...DURABLE_JOB, type: { in: [...MANAGED_TYPES] }, status: { in: ["RUNNING", "QUEUED"] } },
      },
      data: {
        status: "FAILED",
        errorMessage: "Import interrupted; this link may already be imported. Check your library before retrying.",
      },
    });
    await prisma.importJob.updateMany({
      where: { ...DURABLE_JOB, type: "SINGLE", status: "RUNNING" },
      data: {
        status: "ERROR",
        failedCount: 1,
        processed: 1,
        errorHttpStatus: 409,
        errorMessage:
          "Import interrupted. A model or some files may already be in your library; check the library before retrying this import.",
      },
    });
    // These batches have no committed per-item checkpoints. Even a provider-id lookup can
    // mistake a partially created Print for a complete import, so never silently replay them.
    await prisma.importJob.updateMany({
      where: { ...DURABLE_JOB, type: { in: ["ZIP", "COLLECTION", "PROFILES"] }, status: "RUNNING" },
      data: {
        status: "ERROR",
        errorMessage:
          "Batch import interrupted. Some models or files may already be in your library; check the library and import only the missing content.",
      },
    });
    await prisma.importJob.updateMany({
      where: {
        ...DURABLE_JOB,
        status: "RUNNING",
        type: "LINKS",
      },
      data: { status: "QUEUED", errorMessage: null },
    });
    working = false;
    for (;;) {
      if (lostLock || suspended) return;
      const job = await prisma.importJob.findFirst({
        where: { ...DURABLE_JOB, status: "QUEUED", type: { in: [...MANAGED_TYPES] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (!job || lostLock || suspended) return;
      working = true;
      const claim = await prisma.importJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "RUNNING", errorMessage: null },
      });
      if (claim.count) await executeQueuedImport(job);
      working = false;
    }
  } finally {
    // Closing the dedicated session releases the lock, including after unexpected failures.
    working = false;
    await lock.end();
  }
}

export function wakeImportScheduler(): void {
  if (suspended) return;
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
