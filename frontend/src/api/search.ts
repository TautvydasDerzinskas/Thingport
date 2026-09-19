import { authHeaders } from "../utils/auth";
import { apiBase, assertOk } from "./client";
import type { Print } from "./prints";

export type SearchCollectionResult = {
  id: string;
  name: string;
  item_count: number;
};

export type SearchTagResult = {
  tag: string;
  count: number;
};

export type SearchResult = {
  /** Full Print objects (same shape ModelCard already renders), pre-ranked by the backend --
   *  name matches outrank description/tag matches, see backend's searchService.ts. */
  models: Print[];
  collections: SearchCollectionResult[];
  tags: SearchTagResult[];
};

export const searchApi = {
  search: async (q: string): Promise<SearchResult> => {
    const res = await fetch(`${apiBase()}/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
    assertOk(res, "Search failed");
    return res.json();
  },
};
