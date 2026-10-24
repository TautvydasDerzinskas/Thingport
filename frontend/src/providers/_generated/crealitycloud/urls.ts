// GENERATED from providers/crealitycloud/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";

const SITE_ORIGIN = "https://www.crealitycloud.com";

function isHost(hostname: string): boolean {
  return /^(www\.)?crealitycloud\.com$/i.test(hostname);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
const MODEL_PATH = new RegExp(String.raw`^/${LANG}model-detail/([\w-]+)/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^/${LANG}collection/([\w-]+)/?$`, "i");
const LIKES_PATH = new RegExp(String.raw`^/${LANG}user/(\d+)/likes/?$`, "i");

/** `/model-detail/<alias>`, the alias being the model's name in its address; a link with its id instead redirects to
 *  the alias. Creality Cloud keeps no print profile in its links; Thingport's own `#profileId-<id>` names one. */
export function parseCrealitycloudModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH);
  if (!m) return null;
  return {
    modelId: m[1].toLowerCase(),
    requestedProfileId: parsed!.hash.match(/profileId-([0-9a-f]{24})/i)?.[1]?.toLowerCase() ?? null,
  };
}

export function crealitycloudModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/model-detail/${modelId}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** `/collection/<alias>`; the query its own links carry (`isUserUpload`, `from`) is left out. */
export function parseCrealitycloudCollectionUrl(url: string): { collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(COLLECTION_PATH);
  return m ? { collectionId: m[1] } : null;
}

export function crealitycloudCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/collection/${collectionId}`;
}

/** The user's likes, `/user/<id>/likes`. Creality Cloud shows them to their owner only. */
export function parseCrealitycloudLikesUrl(url: string): { userId: string } | null {
  const m = parseUrl(url)?.pathname.match(LIKES_PATH);
  return m ? { userId: m[1] } : null;
}

export function crealitycloudLikesUrl(userId: string): string {
  return `${SITE_ORIGIN}/user/${userId}/likes`;
}

/** The id a sync keeps for the user's likes. */
export function crealitycloudLikesKey(userId: string): string {
  return `likes-${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseCrealitycloudModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    const collection = parseCrealitycloudCollectionUrl(url);
    if (collection) {
      const id = collection.collectionId;
      return { kind: "collection", externalId: id, url: crealitycloudCollectionUrl(id) };
    }
    const likes = parseCrealitycloudLikesUrl(url);
    if (!likes) return null;
    // The user's own likes; Creality Cloud shows them to their owner only.
    const { userId } = likes;
    return { kind: "likes", externalId: crealitycloudLikesKey(userId), url: crealitycloudLikesUrl(userId) };
  },
  modelUrl: (modelId) => crealitycloudModelUrl(modelId),
};
