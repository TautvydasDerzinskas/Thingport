import { hostIsSite } from "../_lib/hosts";
import { LIKES_ID_PREFIX } from "../_lib/lists";
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

// The site calls its models items. Their pages, and its users', take the name after the id or not.
const MODEL_PATH = /^\/items\/(\d{1,12})(?:-[^/]*)?\/?$/;
const USER_PATH = /^\/users\/(\d{1,12})(?:-([^/]+))?\/?$/;
const ID = /^\d{1,12}$/;

/** `/items/<id>-<name>`, the name optional. Pinshape has no print profiles. */
export function parsePinshapeModelUrl(url: string): { modelId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { modelId: m[1] } : null;
}

export function pinshapeModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/items/${modelId}`;
}

/** A collection is the browse page showing it: `/items?collection_id=<id>`. */
export function parsePinshapeCollectionUrl(url: string): { collectionId: string } | null {
  const parsed = parseUrl(url);
  if (!parsed || !/^\/items\/?$/.test(parsed.pathname)) return null;
  const id = parsed.searchParams.get("collection_id")?.trim() ?? "";
  return ID.test(id) ? { collectionId: id } : null;
}

export function pinshapeCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/items?collection_id=${collectionId}`;
}

/** Someone's likes, anyone's to read: their profile on its Likes tab, `/users/<id>-<name>?tab=likes` (or `#likes`, as
 *  its older links have it). `name` is the one in the address, as it's written there. */
export function parsePinshapeLikesUrl(url: string): { userId: string; name: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(USER_PATH);
  if (!parsed || !m || (parsed.searchParams.get("tab") !== "likes" && parsed.hash !== "#likes")) return null;
  return { userId: m[1], name: m[2] ?? null };
}

export function pinshapeLikesUrl(userId: string, name: string | null = null): string {
  return `${SITE_ORIGIN}/users/${userId}${name ? `-${name}` : ""}?tab=likes`;
}

/** What a sync of someone's likes is kept by: their id, which stays when they rename. */
export function pinshapeLikesKey(userId: string): string {
  return `${LIKES_ID_PREFIX}${userId}`;
}

/** Whose likes they are, as their name is written in the address, or their id where it has none. */
function likesOwner(likes: { userId: string; name: string | null }): string {
  if (!likes.name) return likes.userId;
  try {
    return decodeURIComponent(likes.name);
  } catch {
    return likes.name;
  }
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parsePinshapeModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parsePinshapeCollectionUrl(url);
    if (collection) {
      return {
        kind: "collection",
        externalId: collection.collectionId,
        url: pinshapeCollectionUrl(collection.collectionId),
      };
    }
    const likes = parsePinshapeLikesUrl(url);
    if (!likes) return null;
    return {
      kind: "likes",
      externalId: pinshapeLikesKey(likes.userId),
      url: pinshapeLikesUrl(likes.userId, likes.name),
      likesOf: likesOwner(likes),
    };
  },
  modelUrl: (modelId) => pinshapeModelUrl(modelId),
};
