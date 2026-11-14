// The dashboard's trending panel: each provider's trending (or, where it has none, featured or recommended) models,
// read through the server and kept a while, as every user of the instance sees the same lists.

import { TtlCache } from "../utils/ttlCache";
import {
  MANIFESTS,
  manifestOf,
  type ProviderId,
  type Region,
  TRENDING_PROVIDER_IDS,
  type TrendingProviderId,
} from "../providers/index.generated";
import { PROVIDERS } from "../providers/registry";
import type { TrendingModel } from "./trendingModel";

// Each provider's list, its kind and its page come from its manifest; how it's read, from its module.
export const TRENDING_PROVIDERS = TRENDING_PROVIDER_IDS;
export type TrendingProvider = TrendingProviderId;

/** What the list is: some providers have no trending list, so their featured or recommended one stands in. */
export type TrendingKind = "trending" | "popular" | "featured" | "recommended";

/** A provider that can't be read until someone sets it up: an admin's instance token or key, or the user's own. Its
 *  provider's own code, worded under dashboard.trending.setup in the app. */
export type TrendingSetup = `${ProviderId}${string}`;

export type TrendingResult =
  | { status: "ok"; kind: TrendingKind; moreUrl: string; models: TrendingModel[] }
  | { status: "needsSetup"; setup: TrendingSetup; moreUrl: string };

// Fetched at the most a panel can show, so any panel's count is a slice of the same list.
export const TRENDING_MAX = 20;
// Trending lists move over hours, not minutes.
const CACHE_MS = 30 * 60 * 1000;
const cache = new TtlCache<TrendingModel[]>(CACHE_MS);

function source(provider: TrendingProvider) {
  const { kind, moreUrl } = MANIFESTS[provider].capabilities.trending;
  return { kind, moreUrl, ...PROVIDERS[provider].trending! };
}

/** The region whose own list the user sees, where the provider gives them one; null for its main site's. */
async function regionOf(provider: TrendingProvider, userId: string): Promise<Region | null> {
  const id = await PROVIDERS[provider].trending!.region?.(userId);
  return manifestOf(provider).regions?.find((region) => region.id === id && region.trending) ?? null;
}

/** A provider's list, from the cache when it's fresh. Setup is checked every time, so adding a token shows at once.
 *  Each of its sites' lists is kept apart. */
export async function getTrending(provider: TrendingProvider, userId: string): Promise<TrendingResult> {
  const { kind, fetch, perUser, ...main } = source(provider);
  const region = await regionOf(provider, userId);
  const moreUrl = region?.trending?.moreUrl ?? main.moreUrl;
  const key = region ? `${provider}:${region.id}` : provider;
  const cached = perUser ? null : cache.get(key);
  if (cached) return { status: "ok", kind, moreUrl, models: cached };
  const models = await fetch(userId, TRENDING_MAX, region?.id ?? null);
  if (typeof models === "string") return { status: "needsSetup", setup: models, moreUrl };
  if (!perUser) cache.set(key, models);
  return { status: "ok", kind, moreUrl, models };
}
