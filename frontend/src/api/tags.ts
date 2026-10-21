import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, assertOkWithMessage } from "./client";

export type TagSortMode = "popular" | "name" | "newest";

export type TagSummary = {
  name: string;
  count: number;
  bookmarked: boolean;
  /** One picture of its newest models, built and cached by the server; null while none has a picture. */
  mosaic_url: string | null;
  /** The same of their grey renders alone, for the browser to tint; null while none has a render yet. */
  render_mosaic_url: string | null;
};

export type TagSummaryPage = {
  items: TagSummary[];
  /** Tags matching `min_count`. */
  total: number;
  /** Every tag, whatever its count. */
  total_all: number;
  has_more: boolean;
};

const postJson = (path: string, body: unknown) =>
  fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

export const tagsApi = {
  listSummary: async (params: {
    sort: TagSortMode;
    limit: number;
    offset: number;
    minCount: number;
  }): Promise<TagSummaryPage> => {
    const query = new URLSearchParams({
      sort: params.sort,
      limit: String(params.limit),
      offset: String(params.offset),
      min_count: String(params.minCount),
    });
    const res = await fetch(`${apiBase()}/tags/summary?${query}`, { headers: authHeaders() });
    assertOk(res, "Failed to list tags");
    return res.json();
  },

  /** Takes the tag off every model that has it. */
  remove: async (tag: string): Promise<{ models: number }> => {
    const res = await fetch(`${apiBase()}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to delete tag");
    return res.json();
  },

  /** How many models would carry the merged tag: the same whichever is kept. */
  previewMerge: async (tags: string[]): Promise<{ models: number }> => {
    const res = await postJson("/tags/merge/preview", { tags });
    await assertOkWithMessage(res, "Failed to preview the merge");
    return res.json();
  },

  /** Puts `primary` in place of the others on every model, and removes the others. `added`: models that gained it. */
  merge: async (primary: string, tags: string[]): Promise<{ tag: string; merged: string[]; added: number }> => {
    const res = await postJson("/tags/merge", { primary, tags });
    await assertOkWithMessage(res, "Merge failed");
    return res.json();
  },

  /** Takes each off every model that has it. */
  removeMany: async (tags: string[]): Promise<{ deleted: string[] }> => {
    const res = await postJson("/tags/delete", { tags });
    await assertOkWithMessage(res, "Failed to delete tags");
    return res.json();
  },

  listBookmarked: async (): Promise<string[]> => {
    const res = await fetch(`${apiBase()}/tags/bookmarked`, { headers: authHeaders() });
    assertOk(res, "Failed to list bookmarked tags");
    return res.json();
  },

  bookmark: async (tag: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/tags/${encodeURIComponent(tag)}/bookmark`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to bookmark tag");
  },

  unbookmark: async (tag: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/tags/${encodeURIComponent(tag)}/bookmark`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Failed to remove bookmark");
  },
};
