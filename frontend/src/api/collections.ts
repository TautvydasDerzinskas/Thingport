import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage } from "./client";
import type { Print } from "./prints";

export type SystemCollectionKey = "favorites" | "history";

export type Collection = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  item_count: number;
  cover_items: Print[];
  created_at: string;
  /** Set only for the built-in "Favourites"/"Browsing History" pseudo-collections -- these can't
   *  be edited or deleted, and their card/detail title should come from a translated label keyed
   *  off this instead of `name`. */
  system_key: SystemCollectionKey | null;
  /** Whether this user has bookmarked this collection into the sidebar's quick-access list --
   *  always false for a system pseudo-collection, which can't be bookmarked. */
  bookmarked: boolean;
};

export type CollectionInput = {
  name: string;
  description?: string | null;
  tags?: string[];
};

/** One row of the "Add to collection" picker -- a real (non-system) collection this user owns,
 *  flagged with whether the print being edited is currently a member. */
export type CollectionMembership = {
  id: string;
  name: string;
  in_collection: boolean;
};

export const collectionsApi = {
  list: async (): Promise<Collection[]> => {
    const res = await fetch(`${apiBase()}/collections`, { headers: authHeaders() });
    assertOk(res, "Failed to list collections");
    return res.json();
  },

  get: async (id: string): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, { headers: authHeaders() });
    assertOk(res, "Failed to load collection");
    return res.json();
  },

  create: async (input: CollectionInput): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collections`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Create collection failed"));
    return res.json();
  },

  update: async (id: string, input: CollectionInput): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Update collection failed"));
    return res.json();
  },

  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Delete collection failed");
  },

  /** Drops one print's membership in a (real, non-system) collection -- the print itself is
   *  untouched. Used by the model card's "Remove from collection" menu item, shown only while
   *  browsing an actual collection. */
  removeItem: async (collectionId: string, printId: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items/${printId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Remove from collection failed");
  },

  /** Adds one print to a (real, non-system) collection -- the reverse of removeItem. Used by the
   *  "Add to collection" picker. */
  addItem: async (collectionId: string, printId: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items/${printId}`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "Add to collection failed");
  },

  /** Every real (non-system) collection this user owns, flagged with whether `printId` is
   *  currently a member -- backs the "Add to collection" picker. */
  listForPrint: async (printId: string): Promise<CollectionMembership[]> => {
    const res = await fetch(`${apiBase()}/print/${printId}/collections`, { headers: authHeaders() });
    assertOk(res, "Failed to list collections");
    return res.json();
  },

  /** Adds/removes a (real, non-system) collection from the sidebar's quick-access "Bookmarks"
   *  list -- same shape as tagsApi.bookmark/unbookmark. Used by the Collections grid card's "..."
   *  menu and the collection detail page's title-row toggle. */
  bookmark: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}/bookmark`, { method: "POST", headers: authHeaders() });
    assertOk(res, "Failed to bookmark collection");
  },

  unbookmark: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}/bookmark`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Failed to remove bookmark");
  },
};
