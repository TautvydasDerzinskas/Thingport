// Public entry point: callers need not know how persistence, execution and worker ownership are split.
export { storedImportBody, enqueueSingleImport, enqueueLinksImport, enqueueBatchImport } from "./importJobQueue";
export { executeQueuedImport } from "./importJobExecution";
export {
  IMPORT_WORKER_LOCK,
  MANAGED_TYPES,
  drainImportQueue,
  wakeImportScheduler,
  startImportScheduler,
  withImportSchedulerStopped,
} from "./importWorker";

import { prisma } from "../db";
import { runnerSettled } from "./importJobRunner";
import { setTimeout as delay } from "node:timers/promises";

/** Collection sync callers historically wait for their import and its final notification. */
export async function waitForScheduledImport(
  jobId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  const deadline = options.timeoutMs === undefined ? Infinity : Date.now() + options.timeoutMs;
  for (;;) {
    if (options.signal?.aborted || Date.now() >= deadline) return false;
    const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) {
      // The request only needs the durable result. Internal collection sync also waits for
      // its local runner's final notification before continuing.
      if (!options.signal && options.timeoutMs === undefined) await runnerSettled(jobId);
      return true;
    }
    try {
      await delay(Math.min(100, Math.max(0, deadline - Date.now())), undefined, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) return false;
      throw error;
    }
  }
}
