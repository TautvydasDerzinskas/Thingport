// Browser-bound imports still use a request-local background task when their short-lived
// credentials cannot be persisted. Other single imports are queued as durable ImportJobs.
// The extension polls either kind instead of holding a request open: Chromium kills a
// service worker whose fetch() takes over 30s to answer.

import crypto from "node:crypto";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";

export type ImportTaskState =
  | { status: "running" }
  | { status: "done"; result: unknown }
  | { status: "error"; detail: string; http_status: number };

type ImportTask = { userId: string; state: ImportTaskState; finishedAt: number | null };

// Long enough for a client to come back after a stall; a client polls every couple of seconds.
const FINISHED_TASK_TTL_MS = 10 * 60 * 1000;

const tasks = new Map<string, ImportTask>();

function pruneFinished(): void {
  const cutoff = Date.now() - FINISHED_TASK_TTL_MS;
  for (const [id, task] of tasks) {
    if (task.finishedAt !== null && task.finishedAt < cutoff) tasks.delete(id);
  }
}

export function startImportTask(userId: string, run: () => Promise<unknown>): string {
  pruneFinished();
  const id = crypto.randomUUID();
  const task: ImportTask = { userId, state: { status: "running" }, finishedAt: null };
  tasks.set(id, task);
  run().then(
    (result) => {
      task.state = { status: "done", result };
      task.finishedAt = Date.now();
    },
    (err: unknown) => {
      if (!(err instanceof HttpError)) console.error(`Import task ${id} failed:`, err);
      task.state =
        err instanceof HttpError
          ? { status: "error", detail: err.message, http_status: err.status }
          : { status: "error", detail: "Internal server error", http_status: 500 };
      task.finishedAt = Date.now();
    },
  );
  return id;
}

/** Null for an unknown, expired or someone else's task. */
export function getImportTask(id: string, userId: string): ImportTaskState | null {
  pruneFinished();
  const task = tasks.get(id);
  return task && task.userId === userId ? task.state : null;
}

export type DurableImportTaskState =
  | { status: "queued" }
  | { status: "running" }
  | { status: "done"; result: unknown }
  | { status: "error"; detail: string; http_status: number };

/** Persistent compatibility endpoint for the extension's task polling. */
export async function getPersistentImportTask(
  id: string,
  userId: string,
): Promise<DurableImportTaskState | ImportTaskState | null> {
  const job = await prisma.importJob.findFirst({ where: { id, userId, type: "SINGLE" } });
  if (!job) return getImportTask(id, userId);
  if (job.status === "DONE") return { status: "done", result: job.result };
  if (job.status === "PAUSED")
    return { status: "error", detail: "Import was paused; resume it from the import queue", http_status: 409 };
  if (job.status === "ERROR")
    return {
      status: "error",
      detail: job.errorMessage ?? "Internal server error",
      http_status: job.errorHttpStatus ?? 500,
    };
  return { status: job.status === "QUEUED" ? "queued" : "running" };
}
