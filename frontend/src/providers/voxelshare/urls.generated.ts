// GENERATED from providers/voxelshare/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIsSite } from "../_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types.generated";
import manifest from "./manifest.generated";

const SITE_ORIGIN = manifest.site;

function isHost(hostname: string): boolean {
  return hostIsSite(hostname, manifest.hosts[0]);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
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

/** `/en/models/<id>-<slug>`. The page keeps the print profile it shows to itself, so a link names one only with
 *  Thingport's own `#profileId-<id>`. */
export function parseVoxelshareModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH);
  if (!m) return null;
  return { modelId: m[1], requestedProfileId: digitsId(parsed!.hash.match(/profileId-(\d{1,20})/i)?.[1]) };
}

/** By its id, which the site sends on to the page with its name in it. */
export function voxelshareModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/models/${modelId}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** A collection, the user's own private ones too: `/en/collection/<id>-<slug>`, the same from a profile or a search,
 *  or one picked in the print list (`?collectionId=`). */
export function parseVoxelshareCollectionUrl(url: string): string | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const direct = parsed.pathname.match(COLLECTION_PATH)?.[1];
  if (direct) return direct;
  return PRINT_LIST_PATH.test(parsed.pathname) ? digitsId(parsed.searchParams.get("collectionId")) : null;
}

export function voxelshareCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/en/collection/${collectionId}`;
}

/** The signed-in user's likes, `/en/print_list?recordTab=like`. The page names no user: it's whoever is signed in, and
 *  the site shows nobody another's. */
export function isVoxelshareLikesUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && PRINT_LIST_PATH.test(parsed.pathname) && parsed.searchParams.get("recordTab") === "like");
}

export const VOXELSHARE_LIKES_URL = `${SITE_ORIGIN}/en/print_list?recordTab=like`;
/** The id a sync keeps for the user's likes; the page names no user, so there's one per Thingport user. */
export const VOXELSHARE_LIKES_KEY = "likes";

/** A creator's page: their models. */
export function voxelshareUserUrl(userId: string): string {
  return `${SITE_ORIGIN}/en/profile/${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseVoxelshareModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    if (isVoxelshareLikesUrl(url))
      return { kind: "likes", externalId: VOXELSHARE_LIKES_KEY, url: VOXELSHARE_LIKES_URL };
    const collectionId = parseVoxelshareCollectionUrl(url);
    return collectionId
      ? { kind: "collection", externalId: collectionId, url: voxelshareCollectionUrl(collectionId) }
      : null;
  },
  modelUrl: (modelId) => voxelshareModelUrl(modelId),
};
