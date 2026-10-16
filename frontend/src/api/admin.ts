import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";
import type { ImportJob, ImportJobItem } from "./imports";

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: "ADMIN" | "MEMBER";
  /** The first admin: may manage other admins, and can't be demoted or deleted. */
  is_owner: boolean;
  /** What the viewing admin may do to this user; the server enforces the same. */
  can_promote: boolean;
  can_demote: boolean;
  can_delete: boolean;
  print_count: number;
  collection_count: number;
  makerworld_connected: boolean;
  created_at: string;
};

export type HealthComponent = "database" | "storage" | "memory" | "flaresolverr" | "thingiverse" | "ai" | "smtp";
export type HealthStatus = "ok" | "warning" | "error" | "not_configured";

export type HealthResult = {
  component: HealthComponent;
  status: HealthStatus;
  /** What was found, e.g. "unreachable" or "low_space", for the page to explain. */
  code: string;
  /** The component's own error, as it gave it. */
  detail: string | null;
  facts: Record<string, string | number | null>;
  latency_ms: number | null;
  checked_at: string;
};

export type HealthReport = {
  /** By importance; a result is null until that component is first tested. */
  components: { component: HealthComponent; result: HealthResult | null }[];
  full_checked_at: string | null;
};

export type LogAction =
  | "user_logged_in"
  | "user_logged_out"
  | "password_reset_requested"
  | "password_reset"
  | "api_token_generated"
  | "api_token_revoked"
  | "user_invited"
  | "authors_linked"
  | "descriptions_refetched"
  | "model_uploaded"
  | "model_imported"
  | "import_completed"
  | "model_edited"
  | "model_reimported"
  | "model_deleted"
  | "collection_created"
  | "collection_edited"
  | "collection_deleted"
  | "collection_item_added"
  | "collection_item_removed"
  | "collection_sync_enabled"
  | "collection_sync_disabled"
  | "ai_categorization_run"
  | "ai_description_run"
  | "tag_deleted"
  | "user_role_changed"
  | "user_deleted";

export type LogEntry = {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  action: LogAction;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type StorageUsage = {
  model_bytes: number; // every plate + supporting/prepared file, across all users
  model_count: number;
};

export type AuthorLookupProblem =
  | "thingiverse_no_token"
  | "thingiverse_token_rejected"
  | "thingiverse_rate_limited"
  | "makerworld_captcha"
  | "makerworld_login_rejected";

export type AuthorLinkingRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  toLookUp: number;
  lookedUp: number;
  linked: number;
  notFound: number;
  problems: AuthorLookupProblem[];
};

export type DescriptionRefetchRun = {
  running: boolean;
  userId: string;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  updated: number;
  failed: number;
  problems: AuthorLookupProblem[];
};

/** `counts`: per user id, how many models have a source to refetch from. */
export type DescriptionRefetchStatus = { counts: Record<string, number>; run: DescriptionRefetchRun | null };

export type AuthorLinkingStatus = { linkable: number; lookup: number; run: AuthorLinkingRun | null };

/** Any user's batch import, as the admin import queue lists it. */
export type AdminImportJob = ImportJob & {
  owner: { id: string; display_name: string; email: string };
  pending_count: number;
  running_count: number;
  done_count: number;
  failed_items_count: number;
  /** False on a RUNNING job means its runner is gone (a restart): pause it, then start it again. */
  runner_live: boolean;
  created_at: string;
  updated_at: string;
};

/** "Start all" and "Retry all failed" run jobs one after another, across users. */
export type ImportQueueBulk = { running: boolean; currentJobId: string | null; remaining: number };

export type ImportQueue = { jobs: AdminImportJob[]; bulk: ImportQueueBulk };

async function queueAction<T>(method: "POST" | "DELETE", path: string, fallback: string): Promise<T> {
  const res = await fetch(`${apiBase()}/admin/import-queue${path}`, { method, headers: authHeaders() });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return res.json();
}

export const adminApi = {
  getStorageUsage: async (): Promise<StorageUsage> => {
    const res = await fetch(`${apiBase()}/admin/storage`, { headers: authHeaders() });
    assertOk(res, "Failed to load storage usage");
    return res.json();
  },

  inviteUser: async (email: string): Promise<{ email: string; expires_at: string; expires_in_days: number }> => {
    const res = await fetch(`${apiBase()}/admin/invitations`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to send the invitation"));
    return res.json();
  },

  /** The last results; nothing is tested. */
  getHealth: async (): Promise<HealthReport> => {
    const res = await fetch(`${apiBase()}/admin/health`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load system health"));
    return res.json();
  },

  /** One component, or every one when none is given. */
  testHealth: async (component?: HealthComponent): Promise<HealthReport> => {
    const res = await fetch(`${apiBase()}/admin/health/test`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(component ? { component } : {}),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to test"));
    return res.json();
  },

  listUsers: async (): Promise<AdminUser[]> => {
    const res = await fetch(`${apiBase()}/admin/users`, { headers: authHeaders() });
    assertOk(res, "Failed to load users");
    return res.json();
  },

  setUserRole: async (userId: string, role: AdminUser["role"]): Promise<void> => {
    const res = await fetch(`${apiBase()}/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ role }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to change the role"));
  },

  /** The account, its models and every file of them. */
  deleteUser: async (userId: string): Promise<{ models: number }> => {
    const res = await fetch(`${apiBase()}/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete the user"));
    return res.json();
  },

  getAuthorLinking: async (): Promise<AuthorLinkingStatus> => {
    const res = await fetch(`${apiBase()}/admin/triggers/link-authors`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to check for unlinked authors"));
    return res.json();
  },

  startAuthorLinking: async (): Promise<{ run: AuthorLinkingRun }> => {
    const res = await fetch(`${apiBase()}/admin/triggers/link-authors`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start linking authors"));
    return res.json();
  },

  getDescriptionRefetch: async (): Promise<DescriptionRefetchStatus> => {
    const res = await fetch(`${apiBase()}/admin/triggers/refetch-descriptions`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load description refetching"));
    return res.json();
  },

  startDescriptionRefetch: async (userId: string): Promise<{ run: DescriptionRefetchRun }> => {
    const res = await fetch(`${apiBase()}/admin/triggers/refetch-descriptions`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ user_id: userId }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start refetching descriptions"));
    return res.json();
  },

  deleteAllPrintsForUser: async (userId: string): Promise<{ deleted: number }> => {
    const res = await fetch(`${apiBase()}/admin/users/${userId}/delete-all-prints`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete models"));
    return res.json();
  },

  getImportQueue: async (): Promise<ImportQueue> => {
    const res = await fetch(`${apiBase()}/admin/import-queue`, { headers: authHeaders() });
    assertOk(res, "Failed to load the import queue");
    return res.json();
  },

  getImportQueueItems: async (jobId: string): Promise<ImportJobItem[]> => {
    const res = await fetch(`${apiBase()}/admin/import-queue/jobs/${jobId}/items`, { headers: authHeaders() });
    assertOk(res, "Failed to load the import's links");
    return res.json();
  },

  startQueueJob: (jobId: string) => queueAction<{ ok: true }>("POST", `/jobs/${jobId}/start`, "Failed to start"),
  retryQueueJob: (jobId: string) => queueAction<{ ok: true }>("POST", `/jobs/${jobId}/retry`, "Failed to retry"),
  pauseQueueJob: (jobId: string) => queueAction<{ ok: true }>("POST", `/jobs/${jobId}/pause`, "Failed to pause"),
  deleteQueueJob: (jobId: string) => queueAction<{ ok: true }>("DELETE", `/jobs/${jobId}`, "Failed to delete"),
  removeQueueItem: (itemId: string) =>
    queueAction<{ jobDeleted: boolean }>("DELETE", `/items/${itemId}`, "Failed to remove the link"),
  startAllQueued: () => queueAction<{ queued: number }>("POST", "/start-all", "Failed to start the queue"),
  retryAllFailed: () => queueAction<{ queued: number }>("POST", "/retry-failed", "Failed to retry"),
  pauseAllQueued: () => queueAction<{ paused: number }>("POST", "/pause-all", "Failed to pause the queue"),
  clearFinishedQueued: () => queueAction<{ deleted: number }>("POST", "/clear-finished", "Failed to clear"),

  listLogs: async (filter: { userId?: string; from?: string; to?: string }): Promise<LogEntry[]> => {
    const params = new URLSearchParams();
    if (filter.userId) params.set("user_id", filter.userId);
    if (filter.from) params.set("from", filter.from);
    if (filter.to) params.set("to", filter.to);
    const qs = params.toString();
    const res = await fetch(`${apiBase()}/admin/logs${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
    assertOk(res, "Failed to load logs");
    return res.json();
  },
};
