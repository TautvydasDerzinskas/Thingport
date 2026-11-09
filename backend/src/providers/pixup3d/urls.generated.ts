// GENERATED from providers/pixup3d/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIsSite } from "../_lib/hosts.generated";
import { LIKES_ID_PREFIX } from "../_lib/lists.generated";
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

// Its pages come under a language (`/en`, `/jp`, `/zh-TW`, `/zh-CN`) or none. A model is a post, by its number alone;
// a member's page is `/p/<username>`, the username as they wrote it: the site answers no other case of it.
const LOCALE = String.raw`(?:/[a-z]{2}(?:-[a-z]{2})?)?`;
const USERNAME = String.raw`([A-Za-z0-9][A-Za-z0-9_.-]{0,99})`;
const MODEL_PATH = new RegExp(String.raw`^${LOCALE}/posts/(\d{1,12})/?$`, "i");
const WISHLIST_PATH = new RegExp(String.raw`^${LOCALE}/p/${USERNAME}/saved_posts/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^${LOCALE}/p/${USERNAME}/collections/(\d{1,9})/?$`, "i");

/** `/posts/<id>`, under a language or not. PIXUP has no print profiles. */
export function parsePixup3dModelUrl(url: string): { postId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { postId: m[1] } : null;
}

export function pixup3dModelUrl(postId: string): string {
  return `${SITE_ORIGIN}/en/posts/${postId}`;
}

/** A member's page. */
export function pixup3dProfileUrl(username: string): string {
  return `${SITE_ORIGIN}/en/p/${encodeURIComponent(username)}`;
}

/** Someone's wishlist, anyone's to read: `/p/<username>/saved_posts`. */
export function parsePixup3dWishlistUrl(url: string): { username: string } | null {
  const username = parseUrl(url)?.pathname.match(WISHLIST_PATH)?.[1];
  return username ? { username } : null;
}

export function pixup3dWishlistUrl(username: string): string {
  return `${pixup3dProfileUrl(username)}/saved_posts`;
}

/** What a sync of someone's wishlist is kept by: their username, as it's written. */
export function pixup3dWishlistKey(username: string): string {
  return `${LIKES_ID_PREFIX}${username}`;
}

/** One of a member's collections, which their profile numbers from 1: `/p/<username>/collections/<n>`. */
export function parsePixup3dCollectionUrl(url: string): { username: string; collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(COLLECTION_PATH);
  return m ? { username: m[1], collectionId: m[2] } : null;
}

export function pixup3dCollectionUrl(username: string, collectionId: string): string {
  return `${pixup3dProfileUrl(username)}/collections/${collectionId}`;
}

/** What a sync of a collection is kept by: whose it is and its number, as its numbers are only theirs. */
export function pixup3dCollectionKey(username: string, collectionId: string): string {
  return `${username}/${collectionId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parsePixup3dModelUrl(url);
    return model && { externalId: model.postId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parsePixup3dCollectionUrl(url);
    if (collection) {
      return {
        kind: "collection",
        externalId: pixup3dCollectionKey(collection.username, collection.collectionId),
        url: pixup3dCollectionUrl(collection.username, collection.collectionId),
      };
    }
    const wishlist = parsePixup3dWishlistUrl(url);
    return (
      wishlist && {
        kind: "likes",
        externalId: pixup3dWishlistKey(wishlist.username),
        url: pixup3dWishlistUrl(wishlist.username),
        likesOf: wishlist.username,
      }
    );
  },
  modelUrl: (postId) => pixup3dModelUrl(postId),
};
