// GENERATED from providers/makeronline/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";

const SITE_ORIGIN = "https://www.makeronline.com";

function isHost(hostname: string): boolean {
  return /^(www\.)?makeronline\.com$/i.test(hostname);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

const LANG = String.raw`(?:[a-z]{2}(?:[-_][a-z]{2})?/)?`;
const MODEL_PATH = new RegExp(String.raw`^/${LANG}model/(?:[^/]+/)?(\d+)(?:\.html)?/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^/${LANG}user/collectionDetail/(?:([\w-]+)/)?(\d+)(?:\.html)?/?$`, "i");
const LIKES_PATH = new RegExp(String.raw`^/${LANG}user/likes/models(?:\.html)?/?$`, "i");

/** `/en/model/<title>/<id>.html`, the title and language optional. MakerOnline keeps no print profile in its links;
 *  Thingport's own `#profileId-<id>` names one, as for MakerWorld. */
export function parseMakeronlineModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH);
  if (!m) return null;
  return { modelId: m[1], requestedProfileId: parsed!.hash.match(/profileId-(\d+)/i)?.[1] ?? null };
}

export function makeronlineModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/model/${modelId}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** `/en/user/collectionDetail/<owner id>/<collection id>.html`; older links leave the owner out. */
export function parseMakeronlineCollectionUrl(url: string): { collectionId: string; ownerId: string | null } | null {
  const m = parseUrl(url)?.pathname.match(COLLECTION_PATH);
  return m ? { collectionId: m[2], ownerId: m[1] ?? null } : null;
}

export function makeronlineCollectionUrl(ownerId: string | null, collectionId: string): string {
  return `${SITE_ORIGIN}/en/user/collectionDetail/${ownerId ? `${ownerId}/` : ""}${collectionId}.html`;
}

/** The signed-in user's likes, `/en/user/likes/models.html`; the page names no user, so it's always the viewer's. */
export function isMakeronlineLikesUrl(url: string): boolean {
  return LIKES_PATH.test(parseUrl(url)?.pathname ?? "");
}

export const MAKERONLINE_LIKES_URL = `${SITE_ORIGIN}/en/user/likes/models.html`;
/** The id a sync keeps for the user's likes; the likes page names no user, so there's one per Thingport user. */
export const MAKERONLINE_LIKES_KEY = "likes";

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseMakeronlineModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    const collection = parseMakeronlineCollectionUrl(url);
    if (collection) {
      const { collectionId, ownerId } = collection;
      return { kind: "collection", externalId: collectionId, url: makeronlineCollectionUrl(ownerId, collectionId) };
    }
    // The page names no user: it's always the signed-in one's, read with their token.
    if (isMakeronlineLikesUrl(url))
      return { kind: "likes", externalId: MAKERONLINE_LIKES_KEY, url: MAKERONLINE_LIKES_URL };
    return null;
  },
  modelUrl: (modelId) => makeronlineModelUrl(modelId),
};
