import { authHeaders } from "../utils/auth";
import { apiBase, assertOk } from "./client";

/** Kept in sync by hand with the backend's NOTIFICATION_TYPES. Unknown types show as "general". */
export type NotificationType =
  "import" | "upload" | "sync" | "queue" | "consume" | "ai" | "system" | "chat" | "federation" | "share" | "general";

/** The tabs. "system" holds announcements from the Thingport repo. */
export type NotificationFilter = "all" | "unread" | "system";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  /** The title as a key under `notifications.messages` and its values; null shows `title`, the English. */
  message: { key: string; values?: Record<string, string | number> } | null;
  body: string | null;
  external_url: string | null;
  internal_path: string | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationsListResult = {
  items: Notification[];
  unread_count: number;
  /** Pass as `before` for the next page; null on the last one. */
  next_cursor: string | null;
};

export const notificationsApi = {
  list: async (
    options: { limit?: number; before?: string | null; filter?: NotificationFilter; since?: string | null } = {},
  ): Promise<NotificationsListResult> => {
    const params = new URLSearchParams();
    if (options.filter && options.filter !== "all") params.set("filter", options.filter);
    if (options.limit) params.set("limit", String(options.limit));
    if (options.before) params.set("before", options.before);
    if (options.since) params.set("since", options.since);
    const query = params.toString();
    const res = await fetch(`${apiBase()}/notifications${query ? `?${query}` : ""}`, { headers: authHeaders() });
    assertOk(res, "Failed to load notifications");
    return res.json();
  },

  /** Returns the time stamped on them; null from a backend too old to say. */
  markAllRead: async (): Promise<string | null> => {
    const res = await fetch(`${apiBase()}/notifications/read-all`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to mark notifications as read");
    const body = (await res.json()) as { read_at?: string };
    return body.read_at ?? null;
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/notifications/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    // Already gone, e.g. deleted in another tab, is what the caller wanted anyway.
    if (res.status === 404) return;
    assertOk(res, "Failed to delete the notification");
  },

  /** Deletes every notification in the tab. */
  clearAll: async (filter: NotificationFilter = "all", since: string | null = null): Promise<void> => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (since) params.set("since", since);
    const query = params.toString() ? `?${params}` : "";
    const res = await fetch(`${apiBase()}/notifications${query}`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Failed to delete notifications");
  },
};
