import { authHeaders } from "../utils/auth";
import { ForbiddenError, apiBase, assertOk } from "./client";
import type { Print } from "./prints";
import { type ProviderId, TRENDING_PROVIDER_IDS, type TrendingProviderId } from "../providers/_generated";

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

export type FeedItem = { title: string; link: string | null; published: string | null; feed: string };

/** Up when the address answered below a server error; `ms` is how long it took. */
export type MonitorResult = { url: string; up: boolean; status: number | null; ms: number | null };

export type SystemStats = {
  cpu: { usage: number; cores: number; model: string | null; load: [number, number, number] };
  memory: { total: number; used: number };
  /** Seconds since Thingport and its host started. */
  uptime: { thingport: number; host: number };
};

/** The providers the trending panel can show, in its order: those whose manifest gives them a list. */
export const TRENDING_PROVIDERS = TRENDING_PROVIDER_IDS;
export type TrendingProvider = TrendingProviderId;

export type TrendingModel = {
  id: string;
  title: string;
  /** The model's page on the provider's site. */
  url: string;
  image: string | null;
  likes: number | null;
  author: string | null;
  paid: boolean;
};

/** A provider's list, or what has to be set up before it can be read. Some providers have no trending list, so their
 *  popular, featured or recommended one stands in, as `kind` says. */
export type TrendingResult =
  | {
      status: "ok";
      kind: "trending" | "popular" | "featured" | "recommended";
      moreUrl: string;
      models: TrendingModel[];
    }
  | { status: "needsSetup"; setup: `${ProviderId}${string}`; moreUrl: string };

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

  /** Every listed feed's items together, newest first; `failed` names the feeds that couldn't be read. */
  getFeeds: async (urls: string[]): Promise<{ items: FeedItem[]; failed: string[] }> => {
    const params = new URLSearchParams(urls.map((url) => ["url", url]));
    const res = await fetch(`${apiBase()}/dashboard/feeds?${params}`, { headers: authHeaders() });
    assertOk(res, "Failed to load the feeds");
    return res.json();
  },

  getMonitors: async (urls: string[]): Promise<MonitorResult[]> => {
    const params = new URLSearchParams(urls.map((url) => ["url", url]));
    const res = await fetch(`${apiBase()}/dashboard/monitors?${params}`, { headers: authHeaders() });
    assertOk(res, "Failed to check the services");
    return (await res.json()).results;
  },

  /** Admins only. */
  getSystem: async (): Promise<SystemStats> => {
    const res = await fetch(`${apiBase()}/dashboard/system`, { headers: authHeaders() });
    if (res.status === 403) throw new ForbiddenError();
    assertOk(res, "Failed to load the server's stats");
    return res.json();
  },

  getTrending: async (provider: TrendingProvider): Promise<TrendingResult> => {
    const res = await fetch(`${apiBase()}/dashboard/trending?provider=${provider}`, { headers: authHeaders() });
    assertOk(res, "Failed to load the trending models");
    return res.json();
  },

  /** The longer recently-added list, for the panel's "See more". */
  getRecentlyAdded: async (): Promise<DashboardModel[]> => {
    const res = await fetch(`${apiBase()}/dashboard/recently-added`, { headers: authHeaders() });
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
