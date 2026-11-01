import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import { MANIFESTS, type ProviderId } from "../providers/index.generated";
import type { AdminImportJob } from "./admin";
import type { Print } from "./prints";

export type ImportInspectInfo = {
  filename: string;
  mime: string;
  is_zip: boolean;
};

export type ZipEntryInfo = {
  path: string;
  size: number;
};

export type ImportCollectionEntry = {
  design_id: string;
  title: string;
  cover: string | null;
  already_imported: boolean;
};

export type ImportCollectionEntriesResult = {
  title: string | null;
  total: number;
  truncated: boolean;
  entries: ImportCollectionEntry[];
};

export type ImportJobType = "COLLECTION" | "ZIP" | "PROFILES" | "LINKS";

export type MakerworldProfileScope = "url" | "designer" | "all";
// QUEUED: waiting its turn in the line. PAUSED: on hold until someone starts it.
export type ImportJobStatus = "RUNNING" | "DONE" | "ERROR" | "PAUSED" | "QUEUED";

export type ImportJob = {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
  source_url: string;
  source_label: string | null;
  provider: string | null;
  total: number;
  processed: number;
  imported: number;
  already_in_library: number;
  failed_count: number;
  error_message: string | null;
  result_collection_id: string | null;
  // Set when the job created exactly one Print, so the UI can open it.
  result_print_id: string | null;
};

/** One queued link of a LINKS job. */
export type ImportJobItem = {
  id: string;
  url: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  attempts: number;
  error_message: string | null;
  /** Set on links sent from the extension's "Add to the queue". */
  title: string | null;
  collection_id: string | null;
  scope: MakerworldProfileScope | null;
};

/** The server fills in the saved sign-in itself; a request carrying one has to run now, and would skip the line. */
type ImportLinkPayload = {
  url: string;
  title?: string;
  notes?: string;
  tags?: string[];
  category_id?: string;
  filename?: string;
  // Solved captcha, checked and consumed by whichever request starts the import.
  captcha_id?: string;
  captcha_answer?: string;
};

/** "profile_added": an existing MakerWorld model gained another profile's file. */
export type ImportOutcome = "created" | "profile_added" | "already_imported";

/** A job as the queue lists it. `can_*` say what the server would allow right now. */
export type QueueJobOut = ImportJob & {
  /** One pasted link: no bar, no list of links, no Pause. */
  single: boolean;
  /** Place in the line, 1 is next up. Null unless QUEUED. */
  position: number | null;
  queued_at: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  pending_count: number;
  running_count: number;
  done_count: number;
  failed_items_count: number;
  /** PAUSED while this is true: still finishing the link it's on. */
  runner_live: boolean;
  collection_sync_id: string | null;
  /** A sync job waiting on its own lane: it starts by itself, and has no place in the line. */
  sync_waiting: boolean;
  /** A problem someone should look at. Older failures sit in Finished without it. */
  attention: boolean;
  failure_reason: string | null;
  outcome: ImportOutcome | null;
  /** The page title of a links job's only link, when it has just the one. */
  link_title: string | null;
  can_start: boolean;
  can_pause: boolean;
  can_retry: boolean;
  can_delete: boolean;
};

/** The line as one person may see it. `person` is an opaque key, the same for all of someone's jobs. */
export type LineOut = {
  /** The job the line is on. Syncs and imports that skip the line never show here. */
  now: { mine: boolean; person: string; job_id: string | null } | null;
  /** Up to the viewer's last job, empty when they have none in line. `job_id` is only there on their own. */
  rows: { position: number; mine: boolean; person: string; job_id: string | null }[];
  length: number;
};

export type QueueSettingsOut = { start_grab_links: boolean };

export type QueueOut = {
  jobs: QueueJobOut[];
  /** Every finished job not needing attention, which `jobs` holds only the newest of. */
  finished_total: number;
  line: LineOut;
  settings: QueueSettingsOut;
};

/** The admin list of every user's jobs. A backend older than the line sends the rows without the queue's fields. */
export type AdminQueueJobOut = Partial<QueueJobOut> & AdminImportJob;

export type AdminQueueOut = {
  jobs: AdminQueueJobOut[];
  /** Every finished job not needing attention, whoever's it is, which `jobs` holds only the newest of. A backend older
   *  than these sends neither. */
  finished_total?: number;
  /** The same, per user id. */
  finished_by_owner?: Record<string, number>;
};

/** Where a job stands after joining the line again. */
export type QueuePlace = { job_id: string; status: ImportJobStatus; position: number | null; sync_waiting: boolean };

/** What submitting an import can answer. */
export type QueueSubmitAnswer =
  /** A job: in line at `position`, or with none when it runs at once, as on a backend older than the line. */
  | { kind: "job"; position: number | null }
  /** A provider whose files come through Thingport Grab: no job, these models wait for it. */
  | { kind: "grab"; queued: number }
  /** Imported before answering: a request that has to run now, or a backend older than the line. */
  | { kind: "print"; print: Print & { import_outcome?: ImportOutcome } };

export function toSubmitAnswer(body: Record<string, unknown> | null): QueueSubmitAnswer {
  if (typeof body?.queued === "number") return { kind: "grab", queued: body.queued };
  if (typeof body?.id === "string" && !("job_id" in body)) {
    return { kind: "print", print: body as unknown as Print & { import_outcome?: ImportOutcome } };
  }
  // Accepted, whatever else it says: reporting a failure here would have the link submitted twice.
  return { kind: "job", position: typeof body?.position === "number" ? body.position : null };
}

async function queueCall<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, fallback: string, body?: unknown) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
    // fetch refuses a GET with a body.
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return res.json() as Promise<T>;
}

async function submitToQueue(path: string, payload: unknown, fallback: string): Promise<QueueSubmitAnswer> {
  return toSubmitAnswer(await queueCall<Record<string, unknown>>("POST", `${path}?queue=1`, fallback, payload));
}

const ownJob = (jobId: string) => `/import/queue/jobs/${encodeURIComponent(jobId)}`;

/** The viewer's own imports: what's in the line, what they can do with it. */
export const importQueueApi = {
  /** Null from a backend older than the line, which has no such route. */
  get: async (): Promise<QueueOut | null> => {
    const res = await fetch(`${apiBase()}/import/queue`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load the import queue"));
    return res.json();
  },

  saveSettings: (settings: QueueSettingsOut) =>
    queueCall<QueueSettingsOut>("PUT", "/import/queue/settings", "Failed to save the queue settings", settings),

  submitLink: (payload: ImportLinkPayload) => submitToQueue("/import", payload, "Import failed"),

  submitLinks: (payload: Omit<ImportLinkPayload, "url"> & { urls: string[]; scope?: MakerworldProfileScope }) =>
    submitToQueue("/import/links", payload, "Import failed"),

  submitZip: (payload: ImportLinkPayload & { entries: string[] }) =>
    submitToQueue("/import/zip", payload, "Zip import failed"),

  /** `collection_title` is what the job is called while it waits, before anything has read the list. */
  submitList: (provider: ProviderId, payload: ImportLinkPayload & { model_ids: string[]; collection_title?: string }) =>
    submitToQueue(`/import/${provider}/list`, payload, "Import failed"),

  submitProfiles: (
    provider: ProviderId,
    payload: ImportLinkPayload & { scope: Exclude<MakerworldProfileScope, "url"> },
  ) => submitToQueue(`/import/${provider}/profiles`, payload, "Import failed"),

  start: (jobId: string) => queueCall<QueuePlace>("POST", `${ownJob(jobId)}/start`, "Failed to start"),
  retry: (jobId: string) => queueCall<QueuePlace>("POST", `${ownJob(jobId)}/retry`, "Failed to retry"),
  /** Hold when it's waiting, Pause when it's running. */
  pause: (jobId: string) => queueCall<{ ok: true }>("POST", `${ownJob(jobId)}/pause`, "Failed to pause"),
  remove: (jobId: string) => queueCall<{ ok: true }>("DELETE", ownJob(jobId), "Failed to delete"),
  removeLink: (itemId: string) =>
    queueCall<{ jobDeleted: boolean }>(
      "DELETE",
      `/import/queue/items/${encodeURIComponent(itemId)}`,
      "Failed to remove the link",
    ),
  startAll: () => queueCall<{ queued: number }>("POST", "/import/queue/start-all", "Failed to start the queue"),
  retryFailed: () => queueCall<{ queued: number }>("POST", "/import/queue/retry-failed", "Failed to retry"),
  pauseAll: () => queueCall<{ paused: number }>("POST", "/import/queue/pause-all", "Failed to pause the queue"),
  clearFinished: () => queueCall<{ deleted: number }>("POST", "/import/queue/clear-finished", "Failed to clear"),
};

const anyJob = (jobId: string) => `/admin/import-queue/jobs/${encodeURIComponent(jobId)}`;

/** Without `queue=1` a bulk route keeps its old, wider meaning, for old tabs. */
function bulkPath(action: string, userId?: string | null): string {
  const params = new URLSearchParams({ queue: "1" });
  if (userId) params.set("user_id", userId);
  return `/admin/import-queue/${action}?${params}`;
}

/** Every user's imports, for admins. */
export const adminQueueApi = {
  get: () => queueCall<AdminQueueOut>("GET", "/admin/import-queue?queue=1", "Failed to load the import queue"),

  links: (jobId: string) =>
    queueCall<ImportJobItem[]>("GET", `${anyJob(jobId)}/items`, "Failed to load the import's links"),

  start: (jobId: string) => queueCall<{ ok: true }>("POST", `${anyJob(jobId)}/start`, "Failed to start"),
  retry: (jobId: string) => queueCall<{ ok: true }>("POST", `${anyJob(jobId)}/retry`, "Failed to retry"),
  pause: (jobId: string) => queueCall<{ ok: true }>("POST", `${anyJob(jobId)}/pause`, "Failed to pause"),
  remove: (jobId: string) => queueCall<{ ok: true }>("DELETE", anyJob(jobId), "Failed to delete"),
  removeLink: (itemId: string) =>
    queueCall<{ jobDeleted: boolean }>(
      "DELETE",
      `/admin/import-queue/items/${encodeURIComponent(itemId)}`,
      "Failed to remove the link",
    ),
  startAll: (userId?: string | null) =>
    queueCall<{ queued: number }>("POST", bulkPath("start-all", userId), "Failed to start the queue"),
  retryFailed: (userId?: string | null) =>
    queueCall<{ queued: number }>("POST", bulkPath("retry-failed", userId), "Failed to retry"),
  pauseAll: (userId?: string | null) =>
    queueCall<{ paused: number }>("POST", bulkPath("pause-all", userId), "Failed to pause the queue"),
  clearFinished: (userId?: string | null) =>
    queueCall<{ deleted: number }>("POST", bulkPath("clear-finished", userId), "Failed to clear"),
};

/** What linking a model to a provider's page would bring. */
export type SourcePreview = {
  provider: ProviderId;
  source_url: string | null;
  /** The model that already has this source, which another can't take; the rest is empty then. */
  linked_print: { id: string; name: string } | null;
  title: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  cover_url: string | null;
  image_count: number;
  tag_count: number;
  has_description: boolean;
};

export const importsApi = {
  preview: async (url: string): Promise<SourcePreview> => {
    const res = await fetch(`${apiBase()}/import/preview`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Couldn't read this model"));
    return res.json();
  },

  inspectLink: async (payload: ImportLinkPayload): Promise<ImportInspectInfo> => {
    const res = await fetch(`${apiBase()}/import/inspect`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Inspect failed");
      throw new Error(message);
    }
    return res.json();
  },

  listZipEntries: async (payload: ImportLinkPayload): Promise<{ filename: string; entries: ZipEntryInfo[] }> => {
    const res = await fetch(`${apiBase()}/import/zip/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      throw new UnauthorizedError();
    }
    if (!res.ok) {
      const message = await readErrorMessage(res, "Zip listing failed");
      throw new Error(message);
    }
    return res.json();
  },

  /** A provider's collection, likes or bookmarks, to pick models from. */
  listEntries: async (provider: ProviderId, payload: ImportLinkPayload): Promise<ImportCollectionEntriesResult> => {
    const res = await fetch(`${apiBase()}/import/${provider}/list/entries`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Could not load this list"));
    return res.json();
  },

  /** A provider that gives its files only to its own pages: the link waits for Thingport Grab's next visit there. */
  queueForGrab: async (
    provider: ProviderId,
    payload: ImportLinkPayload & { scope: MakerworldProfileScope },
  ): Promise<{ queued: number }> => {
    const res = await fetch(`${apiBase()}/import/${provider}/queue`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, `${MANIFESTS[provider].name} import failed`));
    return res.json();
  },

  /** Per-link state of a queue job, for its card's list of links. */
  getImportJobItems: async (jobId: string): Promise<ImportJobItem[]> => {
    const res = await fetch(`${apiBase()}/import/jobs/${jobId}/items`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load the import queue"));
    return res.json();
  },
};
