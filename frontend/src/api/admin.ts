import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";
import type { ImportJob } from "./imports";
import type { ProviderId } from "../providers/index.generated";

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
  can_delete_models: boolean;
  /** Their own models, which deleting them takes: a tool's aren't counted. */
  print_count: number;
  collection_count: number;
  makerworld_connected: boolean;
  /** How they can sign in: a password, and the single sign-on providers they've connected. */
  sign_in: { password: boolean; providers: Array<{ name: string; enabled: boolean }> };
  created_at: string;
};

export type HealthComponent =
  "database" | "storage" | "memory" | "internet" | "flaresolverr" | ProviderId | "grab" | "ai" | "smtp";
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
  | "api_token_mcp_tools_changed"
  | "api_token_rest_scopes_changed"
  | "mcp_access_changed"
  | "file_reuse_changed"
  | "license_files_changed"
  | "file_reuse_backfill_started"
  | "custom_widgets_changed"
  | "tool_installed"
  | "tool_uninstalled"
  | "tools_access_changed"
  | "user_invited"
  // Written by runs since removed; older logs still have them.
  | "authors_linked"
  | "descriptions_refetched"
  | "model_uploaded"
  | "model_imported"
  | "import_completed"
  | "model_edited"
  | "model_reimported"
  | "model_linked"
  | "model_deleted"
  | "models_merged"
  | "models_repaired"
  | "model_copied"
  | "collection_created"
  | "collection_edited"
  | "collection_sharing_changed"
  | "collection_deleted"
  | "collections_merged"
  | "collection_item_added"
  | "collection_item_removed"
  | "collection_sync_enabled"
  | "collection_sync_disabled"
  | "ai_categorization_run"
  | "ai_description_run"
  | "tag_deleted"
  | "tags_merged"
  | "user_role_changed"
  | "user_deleted"
  | "user_models_deleted"
  | "provider_toggled"
  | "sign_in_connected"
  | "sign_in_disconnected"
  | "grab_connected"
  | "grab_disconnected"
  | "social_settings_changed"
  | "chat_room_created"
  | "chat_room_edited"
  | "chat_room_deleted"
  | "federation_settings_changed"
  | "federation_requested"
  | "federation_approved"
  | "federation_declined"
  | "federation_paused"
  | "federation_resumed"
  | "federation_disconnected"
  | "federation_blocked"
  | "federation_unblocked"
  | "federation_user_requested";

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
  /** All of storage on disk; measured every few minutes at most. */
  total_bytes: number;
  /** Thumbnails, gallery and description images, 3D previews, tag mosaics. */
  picture_bytes: number;
  /** Slicer-ready 3MF copies and download bundles. */
  other_generated_bytes: number;
};

export type StorageFolder = {
  name: string;
  path: string;
  /** A user's folder (u-<id>) at the top: their display name. */
  label: string | null;
  files: number;
  bytes: number;
  /** A model's pictures folder, beside its files. */
  pictures: boolean;
};

/** "plate" is a model file, "file" a supporting or prepared one; the rest are the model's pictures. */
export type StorageFileKind = "plate" | "file" | "license" | "image" | "description" | "thumb" | "render";

export type StorageFile = {
  name: string;
  path: string;
  kind: StorageFileKind;
  plate_id: string | null;
  print_id: string;
  print_name: string;
  owner_id: string;
  size: number;
  /** "source": kept where it was picked up from; "missing": in neither place. */
  location: "managed" | "source" | "missing";
};

export type StorageListing = {
  path: string;
  crumbs: { name: string; path: string; label: string | null }[];
  folders: StorageFolder[];
  files: StorageFile[];
};

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

export const adminApi = {
  browseStorage: async (folder: string): Promise<StorageListing> => {
    const res = await fetch(`${apiBase()}/admin/storage/browse?${new URLSearchParams({ path: folder })}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to list stored files"));
    return res.json();
  },

  getStorageUsage: async (): Promise<StorageUsage> => {
    const res = await fetch(`${apiBase()}/admin/storage`, { headers: authHeaders() });
    assertOk(res, "Failed to load storage usage");
    return res.json();
  },

  /** `link` is null when the invitation went by email; without SMTP it's the link for the admin to send. */
  inviteUser: async (
    email: string,
  ): Promise<{ email: string; expires_at: string; expires_in_days: number; link: string | null }> => {
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

  /** Every model of theirs and its files; the account stays. */
  deleteUserModels: async (userId: string): Promise<{ deleted: number }> => {
    const res = await fetch(`${apiBase()}/admin/users/${encodeURIComponent(userId)}/delete-all-prints`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete the models"));
    return res.json();
  },

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
