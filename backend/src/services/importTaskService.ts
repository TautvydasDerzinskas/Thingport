// A single-URL import run in the background so the caller can poll instead of holding one request
// open. The extension needs this: Chromium kills an extension service worker whose fetch() takes
// over 30s to answer, which cut long MakerWorld imports off mid-request (nginx logged a 499).
// In memory on purpose: a task lives for one import, and a lost one just reads as "not found".

import crypto from "node:crypto";
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

export function hasRunningImportTasks(): boolean {
  return [...tasks.values()].some((task) => task.state.status === "running");
}

/** Null for an unknown, expired or someone else's task. */
export function getImportTask(id: string, userId: string): ImportTaskState | null {
  pruneFinished();
  const task = tasks.get(id);
  return task && task.userId === userId ? task.state : null;
}
