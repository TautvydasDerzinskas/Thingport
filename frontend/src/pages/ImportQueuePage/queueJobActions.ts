import type { AdminImportJob } from "../../api/admin";

type QueueJobState = Pick<
  AdminImportJob,
  "type" | "status" | "runner_live" | "pending_count" | "running_count" | "failed_items_count" | "failed_count"
>;

/** Match the scheduler's safe transitions, shared by individual and bulk actions. */
export function queueJobActions(job: QueueJobState) {
  const idle = job.status !== "RUNNING" && job.status !== "QUEUED" && !job.runner_live;
  const links = job.type === "LINKS";
  const batch = job.type === "COLLECTION" || job.type === "PROFILES";
  const canStart =
    idle &&
    (job.status === "PAUSED" || job.status === "ERROR") &&
    (links ? job.pending_count + job.running_count > 0 : job.type !== "ZIP" || job.status === "PAUSED");
  const canPause = job.status === "QUEUED" || (links && job.status === "RUNNING");
  const canRetry =
    idle &&
    (links
      ? job.failed_items_count > 0
      : job.type === "SINGLE"
        ? job.status === "ERROR"
        : batch && (job.status === "ERROR" || (job.status === "DONE" && job.failed_count > 0)));
  return { idle, canStart, canPause, canRetry };
}

/** Only LINKS jobs register a local runner; other jobs execute through the scheduler. */
export function isStalled(job: Pick<AdminImportJob, "type" | "status" | "runner_live">): boolean {
  return job.type === "LINKS" && job.status === "RUNNING" && !job.runner_live;
}
