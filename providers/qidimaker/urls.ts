import { hostIsSite } from "../_lib/hosts";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";
import manifest from "./manifest";

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

/** QIDI Maker's ids: models, print profiles, collections and users are all numbers of up to 20 digits, too big for a
 *  JavaScript number, so they're kept as their digits. */
function digitsId(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && /^\d{1,20}$/.test(text) ? text : null;
}

// Its pages are under a language (en, de, zh-TW, ...), and QIDI Studio shows the same ones under studio/.
const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?(?:studio/)?`;
const MODEL_PATH = new RegExp(String.raw`^/${LANG}models/detail/(\d{1,20})/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^/${LANG}collections/detail/(\d{1,20})/?$`, "i");
const SPECIAL_LIST_PATH = new RegExp(String.raw`^/${LANG}(?:my/)?collections/detail/?$`, "i");
// Its lists of a kind of its own, by `?type=`: the user's likes. Browse and download history aren't lists to sync.
const LIKES_TYPE = "1";

/** `/en/models/detail/<id>`; `?profile_id=<id>` names a print profile, as the page writes it when one is picked, so
 *  it wins over Thingport's own `#profileId-<id>`, which a page opened from Thingport may still carry. */
export function parseQidimakerModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH);
  if (!m) return null;
  const fromHash = parsed!.hash.match(/profileId-(\d{1,20})/i)?.[1];
  return { modelId: m[1], requestedProfileId: digitsId(parsed!.searchParams.get("profile_id")) ?? digitsId(fromHash) };
}

export function qidimakerModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/models/detail/${modelId}${profileId ? `?profile_id=${profileId}` : ""}`;
}

/** A collection, the user's own private ones too: `/en/collections/detail/<id>`. */
export function parseQidimakerCollectionUrl(url: string): string | null {
  return parseUrl(url)?.pathname.match(COLLECTION_PATH)?.[1] ?? null;
}

export function qidimakerCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/en/collections/detail/${collectionId}`;
}

/** The signed-in user's likes, `/en/my/collections/detail?type=1`. The page names no user: it's whoever is signed in,
 *  and the site shows nobody another's. */
export function isQidimakerLikesUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && SPECIAL_LIST_PATH.test(parsed.pathname) && parsed.searchParams.get("type") === LIKES_TYPE);
}

export const QIDIMAKER_LIKES_URL = `${SITE_ORIGIN}/en/my/collections/detail?type=${LIKES_TYPE}`;
/** The id a sync keeps for the user's likes; the page names no user, so there's one per Thingport user. */
export const QIDIMAKER_LIKES_KEY = "likes";

/** A creator's page: their models. */
export function qidimakerUserUrl(userId: string): string {
  return `${SITE_ORIGIN}/en/my/models/${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseQidimakerModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    if (isQidimakerLikesUrl(url)) return { kind: "likes", externalId: QIDIMAKER_LIKES_KEY, url: QIDIMAKER_LIKES_URL };
    const collectionId = parseQidimakerCollectionUrl(url);
    return collectionId
      ? { kind: "collection", externalId: collectionId, url: qidimakerCollectionUrl(collectionId) }
      : null;
  },
  modelUrl: (modelId) => qidimakerModelUrl(modelId),
};
