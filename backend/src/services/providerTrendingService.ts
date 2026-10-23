// The dashboard's trending panel: each provider's trending (or, where it has none, featured or recommended) models,
// read through the server and kept a while, as every user of the instance sees the same lists.

import { TtlCache } from "../utils/ttlCache";
import { fetchCrealitycloudRecommended } from "./crealitycloudApi";
import { fetchCults3dPopular } from "./cults3dApi";
import { getUserCults3dCredentials } from "./cults3dSessionService";
import { fetchMakeronlineTrending } from "./makeronlineApi";
import { fetchMakerworldTrending } from "./makerworldCloudApi";
import { fetchMyminifactoryPopular } from "./myminifactoryApi";
import { fetchNexprintRecommended } from "./nexprintApi";
import { fetchPrintablesTrending } from "./printablesApi";
import { getMyminifactoryApiKey, getThingiverseAccessToken } from "./settingsService";
import { fetchSnapmakerFeatured } from "./snapmakerApi";
import { fetchThangsTrending } from "./thangsApi";
import { fetchThingiversePopular } from "./thingiverseApi";
import type { TrendingModel } from "./trendingModel";

// Kept in sync by hand with the frontend's TRENDING_PROVIDERS.
export const TRENDING_PROVIDERS = [
  "printables",
  "makerworld",
  "thangs",
  "makeronline",
  "thingiverse",
  "myminifactory",
  "cults3d",
  "crealitycloud",
  "nexprint",
  "snapmaker",
] as const;
export type TrendingProvider = (typeof TRENDING_PROVIDERS)[number];

/** What the list is: some providers have no trending list, so their featured or recommended one stands in. */
export type TrendingKind = "trending" | "popular" | "featured" | "recommended";

/** A provider that can't be read until someone sets it up: an admin's instance token or key, or the user's own. */
export type TrendingSetup = "thingiverseToken" | "myminifactoryKey" | "cults3dKey";

export type TrendingResult =
  | { status: "ok"; kind: TrendingKind; moreUrl: string; models: TrendingModel[] }
  | { status: "needsSetup"; setup: TrendingSetup; moreUrl: string };

// Fetched at the most a panel can show, so any panel's count is a slice of the same list.
export const TRENDING_MAX = 20;
// Trending lists move over hours, not minutes.
const CACHE_MS = 30 * 60 * 1000;
const cache = new TtlCache<TrendingModel[]>(CACHE_MS);

type Source = {
  kind: TrendingKind;
  /** The list on the provider's own site, for "Show more". */
  moreUrl: string;
  fetch: (userId: string) => Promise<TrendingModel[] | TrendingSetup>;
};

const SOURCES: Record<TrendingProvider, Source> = {
  printables: {
    kind: "trending",
    moreUrl: "https://www.printables.com/model?ordering=trending",
    fetch: () => fetchPrintablesTrending(TRENDING_MAX),
  },
  makerworld: {
    kind: "trending",
    moreUrl: "https://makerworld.com/en",
    fetch: () => fetchMakerworldTrending(TRENDING_MAX),
  },
  thangs: {
    kind: "trending",
    moreUrl: "https://thangs.com/browse/trending",
    fetch: () => fetchThangsTrending(TRENDING_MAX),
  },
  makeronline: {
    kind: "trending",
    moreUrl: "https://www.makeronline.com/",
    fetch: () => fetchMakeronlineTrending(TRENDING_MAX),
  },
  thingiverse: {
    kind: "popular",
    moreUrl: "https://www.thingiverse.com/search?sort=popular&type=things",
    fetch: async () => {
      const token = await getThingiverseAccessToken();
      return token ? fetchThingiversePopular(TRENDING_MAX, token) : "thingiverseToken";
    },
  },
  myminifactory: {
    kind: "popular",
    moreUrl: "https://www.myminifactory.com/search/?sortBy=popularity",
    fetch: async () => {
      const key = await getMyminifactoryApiKey();
      return key ? fetchMyminifactoryPopular(TRENDING_MAX, key) : "myminifactoryKey";
    },
  },
  cults3d: {
    kind: "popular",
    moreUrl: "https://cults3d.com/en/creations/popular",
    fetch: async (userId) => {
      const credentials = await getUserCults3dCredentials(userId);
      return credentials ? fetchCults3dPopular(TRENDING_MAX, credentials) : "cults3dKey";
    },
  },
  crealitycloud: {
    kind: "recommended",
    moreUrl: "https://www.crealitycloud.com/",
    fetch: () => fetchCrealitycloudRecommended(TRENDING_MAX),
  },
  nexprint: {
    kind: "recommended",
    moreUrl: "https://www.nexprint.com/",
    fetch: () => fetchNexprintRecommended(TRENDING_MAX),
  },
  snapmaker: {
    kind: "featured",
    moreUrl: "https://space.snapmaker.com/",
    fetch: () => fetchSnapmakerFeatured(TRENDING_MAX),
  },
};

/** A provider's list, from the cache when it's fresh. Setup is checked every time, so adding a token shows at once. */
export async function getTrending(provider: TrendingProvider, userId: string): Promise<TrendingResult> {
  const source = SOURCES[provider];
  const cached = cache.get(provider);
  if (cached && provider !== "cults3d")
    return { status: "ok", kind: source.kind, moreUrl: source.moreUrl, models: cached };
  const models = await source.fetch(userId);
  if (typeof models === "string") return { status: "needsSetup", setup: models, moreUrl: source.moreUrl };
  // Cults3D reads with each user's own key, so its list isn't shared between them.
  if (provider !== "cults3d") cache.set(provider, models);
  return { status: "ok", kind: source.kind, moreUrl: source.moreUrl, models };
}
