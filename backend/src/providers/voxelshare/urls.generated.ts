// GENERATED from providers/voxelshare/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIsSite } from "../_lib/hosts.generated";
import { regionalId, splitRegionalId } from "../_lib/regions.generated";
import type { ListLink, ModelLink, ProviderUrls, RegionId } from "../_lib/types.generated";
import manifest from "./manifest.generated";

/** Each site's own origin and the language its links are written in: its main one, and its China one. */
const SITES: Readonly<Record<"main" | RegionId, { origin: string; lang: string }>> = {
  main: { origin: manifest.site, lang: "en" },
  cn: { origin: manifest.regions[0].site, lang: "zh" },
};

const siteOf = (region: RegionId | null) => SITES[region ?? "main"];

/** The site a host is, by its region; undefined for any other host. */
function regionOfHost(hostname: string): RegionId | null | undefined {
  for (const region of manifest.regions) {
    if (region.hosts.some((domain) => hostIsSite(hostname, domain))) return region.id;
  }
  return hostIsSite(hostname, manifest.hosts[0]) ? null : undefined;
}

function isHost(hostname: string): boolean {
  return regionOfHost(hostname) !== undefined;
}

function parseUrl(url: string): { url: URL; region: RegionId | null } | null {
  try {
    const parsed = new URL(url);
    const region = regionOfHost(parsed.hostname);
    return region === undefined ? null : { url: parsed, region };
  } catch {
    return null;
  }
}

/** VoxelShare's ids: models, print profiles and collections are numbers of up to 17 digits, too big for a JavaScript
 *  number, so they're kept as their digits. */
function digitsId(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && /^\d{1,20}$/.test(text) ? text : null;
}

// Its pages are under a language (en, zh, ja, ...); one without goes to English.
const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
// A model's id, then its name as a slug, which the site corrects when it's wrong or missing.
const MODEL_PATH = new RegExp(String.raw`^/${LANG}models/(\d{1,20})(?:-[^/]*)?/?$`, "i");
// A collection on its own, from someone's profile, or from a search.
const COLLECTION_PATH = new RegExp(
  String.raw`^/${LANG}(?:profile/[^/]+/|search/)?collection/(\d{1,20})(?:-[^/]*)?/?$`,
  "i",
);
// The signed-in user's print list: their collections, the models in them, and their likes, by `?recordTab=`.
const PRINT_LIST_PATH = new RegExp(String.raw`^/${LANG}print_list/?$`, "i");

/** `/en/models/<id>-<slug>` on either site: its id there, and which site (null for the main one). The page keeps the
 *  print profile it shows to itself, so a link names one only with Thingport's own `#profileId-<id>`. */
export function parseVoxelshareModelUrl(
  url: string,
): { modelId: string; region: RegionId | null; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.url.pathname.match(MODEL_PATH);
  if (!parsed || !m) return null;
  return {
    modelId: m[1],
    region: parsed.region,
    requestedProfileId: digitsId(parsed.url.hash.match(/profileId-(\d{1,20})/i)?.[1]),
  };
}

/** A model's page by the id it's kept under, which names the site (`cn-123` the China one's), and which the site
 *  sends on to the page with its name in it. */
export function voxelshareModelUrl(externalId: string, profileId?: string | null): string {
  const { region, id } = splitRegionalId(externalId, manifest.regions);
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/models/${id}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** A collection, the user's own private ones too, on either site: `/en/collection/<id>-<slug>`, the same from a
 *  profile or a search, or one picked in the print list (`?collectionId=`). */
export function parseVoxelshareCollectionUrl(url: string): { collectionId: string; region: RegionId | null } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const direct = parsed.url.pathname.match(COLLECTION_PATH)?.[1];
  const picked = PRINT_LIST_PATH.test(parsed.url.pathname)
    ? digitsId(parsed.url.searchParams.get("collectionId"))
    : null;
  const collectionId = direct ?? picked;
  return collectionId ? { collectionId, region: parsed.region } : null;
}

/** A collection's page by the id it's kept under, which names the site. */
export function voxelshareCollectionUrl(externalId: string): string {
  const { region, id } = splitRegionalId(externalId, manifest.regions);
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/collection/${id}`;
}

/** The signed-in user's likes on either site, `/en/print_list?recordTab=like`: which site, or undefined for another
 *  link. The page names no user: it's whoever is signed in, and the site shows nobody another's. */
export function voxelshareLikesRegion(url: string): RegionId | null | undefined {
  const parsed = parseUrl(url);
  const likes =
    parsed && PRINT_LIST_PATH.test(parsed.url.pathname) && parsed.url.searchParams.get("recordTab") === "like";
  return likes ? parsed.region : undefined;
}

export function isVoxelshareLikesUrl(url: string): boolean {
  return voxelshareLikesRegion(url) !== undefined;
}

/** The id a sync keeps for the user's likes on a site; the page names no user, so there's one per Thingport user
 *  and site: `likes`, and `cn-likes` for the China one. */
export function voxelshareLikesKey(region: RegionId | null): string {
  return regionalId(region, "likes");
}

/** The user's likes page on a site. */
export function voxelshareLikesUrl(region: RegionId | null): string {
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/print_list?recordTab=like`;
}

/** A creator's page on a site: their models. */
export function voxelshareUserUrl(userId: string, region: RegionId | null = null): string {
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/profile/${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseVoxelshareModelUrl(url);
    return (
      model && { externalId: regionalId(model.region, model.modelId), requestedProfileId: model.requestedProfileId }
    );
  },
  parseList(url): ListLink | null {
    const likes = voxelshareLikesRegion(url);
    if (likes !== undefined)
      return { kind: "likes", externalId: voxelshareLikesKey(likes), url: voxelshareLikesUrl(likes) };
    const collection = parseVoxelshareCollectionUrl(url);
    if (!collection) return null;
    const externalId = regionalId(collection.region, collection.collectionId);
    return { kind: "collection", externalId, url: voxelshareCollectionUrl(externalId) };
  },
  modelUrl: (externalId) => voxelshareModelUrl(externalId),
};
