import type { ImportJob, Print, QueueImportResult } from "../shared/api";
import type { ImportSinglePayload, QueueImportPayload } from "../shared/messages";
import { apiCall } from "./api";
import { recordRecentImport } from "./recentImports";

const JOB_POLL_INTERVAL_MS = 1000;

export async function pollJobToCompletion(jobId: string): Promise<ImportJob> {
  for (;;) {
    const job = await apiCall<ImportJob>("GET", `/import/jobs/${jobId}`);
    if (job.status !== "RUNNING" && job.status !== "QUEUED") return job;
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

type ImportTaskState =
  | { status: "queued" | "running" }
  | { status: "done"; result: Print }
  | { status: "error"; detail: string; http_status: number };

/** Each poll is an extension API call (chrome.storage in apiCall), which keeps the worker alive. */
async function pollImportTask(taskId: string): Promise<Print> {
  for (;;) {
    const task = await apiCall<ImportTaskState>("GET", `/import/tasks/${taskId}`);
    if (task.status === "done") return task.result;
    if (task.status === "error") throw new Error(task.detail);
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/** One message covering import and collection filing, so both complete even if the tab navigates
 *  away: the background outlives the content script. */
/** `notify: false` for each model of a run that sends its own summary at the end. */
export async function importSingle(
  { url, entries, collectionId, resolved, files, title }: ImportSinglePayload,
  { notify = true }: { notify?: boolean } = {},
): Promise<Print | null> {
  // A page-resolved download lets the backend skip the resolution calls that trip MakerWorld's
  // CAPTCHA. The profile id lets another profile of an existing model be added as a file.
  const extra = resolved?.downloadUrl
    ? {
        resolved_download_url: resolved.downloadUrl,
        resolved_instance_id: resolved.instanceId || null,
        makerworld_design: resolved.design ?? null,
      }
    : files?.length
      ? { resolved_files: files }
      : null;

  let print: Print | null;
  if (entries) {
    const { job_id } = await apiCall<{ job_id: string }>("POST", "/import/zip", { url, entries, ...extra });
    const job = await pollJobToCompletion(job_id);
    if (job.status === "ERROR") throw new Error(job.error_message || "Import failed");
    print = job.result_print_id ? { id: job.result_print_id } : null;
  } else {
    // Asynchronous so the request never outlives the worker: Chromium kills an extension service
    // worker whose fetch() takes over 30s to answer. An older instance ignores `async` and
    // answers with the print itself.
    const started = await apiCall<Print | { task_id: string }>("POST", "/import?async=1", {
      url,
      ...extra,
      ...(notify ? {} : { notify: false }),
    });
    print = "task_id" in started ? await pollImportTask(started.task_id) : started;
  }

  if (collectionId && print?.id) {
    await apiCall("POST", `/collection/${collectionId}/items/${print.id}`).catch(() => undefined);
  }
  // Skip no-op imports. Adding a profile returns the existing model, moved to the front.
  if (print?.id && print.import_outcome !== "already_imported") {
    await recordRecentImport(print, title ?? null, url).catch(() => undefined);
  }
  return print;
}

/** "Add to the queue": nothing is fetched now; the link waits, paused, until it's started from the
 *  instance's Administration > Import queue, which then imports it with the panel's choices. */
export async function queueImport({ url, collectionId, scope, title }: QueueImportPayload): Promise<QueueImportResult> {
  return apiCall<QueueImportResult>("POST", "/import/queue", {
    url,
    collection_id: collectionId ?? null,
    scope: scope ?? "url",
    title: title ?? null,
  });
}
