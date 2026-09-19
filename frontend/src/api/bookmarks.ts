import { authHeaders } from "../utils/auth";
import { apiBase, assertOk } from "./client";

/** One row of the sidebar's quick-access "Bookmarks" section -- a bookmarked tag (just its name,
 *  same as tagsApi) or a bookmarked collection (id + name, resolved server-side). Both share one
 *  ordered list (see Sidebar/index.tsx), sorted by the manual drag order the backend keeps in
 *  Bookmark.order. */
export type BookmarkEntry =
  | { id: string; type: "tag"; tag: string }
  | { id: string; type: "collection"; collection_id: string; name: string };

export const bookmarksApi = {
  /** Every bookmarked tag and collection, tags and collections interleaved in one list already
   *  sorted by the user's manual order -- backs the sidebar's quick-access list directly. */
  list: async (): Promise<BookmarkEntry[]> => {
    const res = await fetch(`${apiBase()}/bookmarks`, { headers: authHeaders() });
    assertOk(res, "Failed to list bookmarks");
    return res.json();
  },

  /** Persists a full drag-and-drop reorder of the sidebar's bookmark list -- `ids` must be
   *  exactly this user's current bookmark ids (from `list()`), in their new order. */
  reorder: async (ids: string[]): Promise<BookmarkEntry[]> => {
    const res = await fetch(`${apiBase()}/bookmarks/reorder`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ bookmark_ids: ids }),
    });
    assertOk(res, "Failed to reorder bookmarks");
    return res.json();
  },
};
