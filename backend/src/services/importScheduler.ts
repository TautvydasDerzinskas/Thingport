import { isProviderId, type ProviderId } from "../providers/index.generated";
import {
  enabledImportUrl,
  listImportSchema,
  profilesImportSchema,
  zipExtractRequestSchema,
} from "../routes/importRequest";
import { Prisma, type ImportJob } from "@prisma/client";
import { Client } from "pg";
import { prisma, getActiveDatabaseUrl } from "../db";
import { PROVIDERS, withLinkAuth } from "../providers/registry";
import { HttpError } from "../utils/fileUtils";
import {
  runLinksImportJob,
  runListImportJob,
  runZipImportJob,
  profilesImportJob,
  runnerSettled,
  type LinksImportJobBody,
} from "./importJobRunner";
import { importAndDescribe, prepareSingleImport, type SingleImportBody } from "./singleImport";
import { addModelsToCollection, isSystemCollectionId } from "./collectionService";

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

export function storedImportBody(body: SingleImportBody): Prisma.InputJsonValue {
  const { makerworld_cookie: _cookie, ...stored } = body;
  return JSON.parse(JSON.stringify(stored)) as Prisma.InputJsonValue;
}

export async function enqueueSingleImport(
  userId: string,
  body: SingleImportBody,
  mcp?: { collectionId?: string },
): Promise<ImportJob> {
  const job = await prisma.importJob.create({
    data: {
      userId,
      type: "SINGLE",
      status: "QUEUED",
      sourceUrl: body.url,
      total: 1,
      payload: storedImportBody({ ...body, ...(mcp ? { mcp } : {}) }),
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

type BatchType = "COLLECTION" | "ZIP" | "PROFILES";

function batchPayload(type: BatchType, body: unknown) {
  const parsed =
    type === "COLLECTION"
      ? listImportSchema.parse(body)
      : type === "PROFILES"
        ? profilesImportSchema.parse(body)
        : zipExtractRequestSchema.parse(body);
  const {
    makerworld_cookie: _cookie,
    resolved_download_url: _download,
    resolved_files: _files,
    resolved_instance_id: _instance,
    makerworld_design: _design,
    ...stored
  } = parsed;
  return stored;
}

export async function enqueueBatchImport(
  userId: string,
  type: BatchType,
  body: unknown,
  provider?: ProviderId,
): Promise<ImportJob> {
  const payload = batchPayload(type, body);
  const total = "model_ids" in payload ? payload.model_ids.length : "entries" in payload ? payload.entries.length : 0;
  const job = await prisma.importJob.create({
    data: {
      userId,
      type,
      status: "QUEUED",
      sourceUrl: payload.url,
      provider,
      total,
      payload: JSON.parse(JSON.stringify(payload)),
    },
  });
  wakeImportScheduler();
  return job;
}

async function executeBatchImport(job: ImportJob): Promise<void> {
  const type = job.type as BatchType;
  const payload = batchPayload(type, job.payload);
  const url = await enabledImportUrl(job.sourceUrl);
  const body = await withLinkAuth<SingleImportBody>(job.userId, { ...payload, url });
  if (type === "ZIP") {
    await runZipImportJob(job.id, job.userId, zipExtractRequestSchema.parse(body));
    return;
  }
  if (!job.provider || !isProviderId(job.provider)) throw new HttpError(400, "Unknown import provider");
  const provider = job.provider;
  if (type === "PROFILES") {
    const run = profilesImportJob(provider);
    if (!run) throw new HttpError(400, "Provider cannot import print profiles");
    await run(job.id, job.userId, profilesImportSchema.parse(body));
    return;
  }
  const lists = PROVIDERS[provider].lists;
  if (!lists || lists.waitsForGrab) throw new HttpError(400, "This provider requires Thingport Grab");
  const listBody = listImportSchema
    .extend({ model_ids: lists.modelIds ?? listImportSchema.shape.model_ids })
    .parse(body);
  // Includes MakerWorld's own paced runner; rebuild its closure from fresh credentials here.
  const start = await lists.start(job.userId, url, listBody);
  if ("waitForGrab" in start) throw new HttpError(400, "This provider requires Thingport Grab");
  if ("run" in start) await start.run(job.id);
  else await runListImportJob(job.id, job.userId, provider, start.batch, listBody);
}

export async function executeQueuedImport(job: ImportJob): Promise<void> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  try {
    if (job.type === "COLLECTION" || job.type === "ZIP" || job.type === "PROFILES") {
      await executeBatchImport(job);
    } else if (job.type === "LINKS") {
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
      const mcp = payload.mcp as { collectionId?: string } | undefined;
      // Recheck ownership at execution: a queued collection can be removed before its turn.
      if (mcp?.collectionId) {
        if (isSystemCollectionId(mcp.collectionId))
          throw new HttpError(400, "Models can't be added to that collection");
        const owned = await prisma.collection.count({ where: { id: mcp.collectionId, userId: job.userId } });
        if (!owned) throw new HttpError(404, "Collection not found");
      }
      const result = await importAndDescribe(job.userId, url, body);
      const filed = mcp?.collectionId
        ? (await addModelsToCollection(job.userId, mcp.collectionId, [result.id])).collection
        : null;
      const taskResult = mcp
        ? { model: result, collection: filed ? { id: filed.id, name: filed.name } : null }
        : result;
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          processed: 1,
          imported: result.import_outcome === "already_imported" ? 0 : 1,
          alreadyInLibrary: result.import_outcome === "already_imported" ? 1 : 0,
          resultPrintId: result.id,
          result: JSON.parse(JSON.stringify(taskResult)),
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
