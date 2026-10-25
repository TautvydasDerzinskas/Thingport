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
