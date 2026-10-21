import { authHeaders } from "../utils/auth";
import { apiBase, assertOk } from "./client";
import type { Print } from "./prints";

export type DashboardModel = {
  id: string;
  name: string;
  thumb_url: string | null;
  /** The first plate's render for the browser to tint; asking for one that isn't ready queues it. */
  render_url: string | null;
  view_count: number;
  print_count: number;
  created_at: string;
};

export type DashboardAuthor = {
  id: string;
  name: string | null;
  handle: string | null;
  avatar_url: string | null;
  model_count: number;
};

export type DashboardProvider = {
  provider: string;
  model_count: number;
};

export type DashboardSummary = {
  collection_count: number;
  model_count: number;
  author_count: number;
  category_count: number;
  top_viewed: DashboardModel[];
  top_printed: DashboardModel[];
  top_authors: DashboardAuthor[];
  top_providers: DashboardProvider[];
  recently_added: DashboardModel[];
};

export const dashboardApi = {
  getSummary: async (): Promise<DashboardSummary> => {
    const res = await fetch(`${apiBase()}/dashboard/summary`, { headers: authHeaders() });
    assertOk(res, "Failed to load dashboard");
    return res.json();
  },

  getTopViewed: async (): Promise<DashboardModel[]> => {
    const res = await fetch(`${apiBase()}/dashboard/top-viewed`, { headers: authHeaders() });
    assertOk(res, "Failed to load models");
    return res.json();
  },

  getTopPrinted: async (): Promise<DashboardModel[]> => {
    const res = await fetch(`${apiBase()}/dashboard/top-printed`, { headers: authHeaders() });
    assertOk(res, "Failed to load models");
    return res.json();
  },

  /** Today's model, by the browser's own date so it changes at the user's midnight. */
  getFeatured: async (date: string): Promise<{ print: Print | null }> => {
    const res = await fetch(`${apiBase()}/dashboard/featured?date=${encodeURIComponent(date)}`, {
      headers: authHeaders(),
    });
    assertOk(res, "Failed to load the featured model");
    return res.json();
  },

  getTopAuthors: async (): Promise<DashboardAuthor[]> => {
    const res = await fetch(`${apiBase()}/dashboard/top-authors`, { headers: authHeaders() });
    assertOk(res, "Failed to load authors");
    return res.json();
  },
};
