// GENERATED from providers/thingiverse/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { LIKES_ID_PREFIX } from "../_lib/lists";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";

function isHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "thingiverse.com" || host === "www.thingiverse.com";
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseThingiverseThingUrl(url: string): { thingId: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const m1 = parsed.pathname.match(/thing:(\d+)/i);
  if (m1) return { thingId: m1[1] };
  const m2 = parsed.pathname.match(/\/things\/(\d+)/i);
  return m2 ? { thingId: m2[1] } : null;
}

export function parseThingiverseLikesUrl(url: string): { username: string } | null {
  const m = parseUrl(url)?.pathname.match(/^\/([^/]+)\/likes\/?$/i);
  return m ? { username: m[1] } : null;
}

/** The username in the URL is cosmetic; only the collection id is needed. */
export function parseThingiverseCollectionUrl(url: string): { collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(/\/collections\/(\d+)/i);
  return m ? { collectionId: m[1] } : null;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const thing = parseThingiverseThingUrl(url);
    return thing && { externalId: thing.thingId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parseThingiverseCollectionUrl(url);
    if (collection) {
      const id = collection.collectionId;
      return { kind: "collection", externalId: id, url: `https://www.thingiverse.com/collections/${id}` };
    }
    const likes = parseThingiverseLikesUrl(url);
    if (!likes) return null;
    // Thingiverse usernames aren't case-sensitive, so one user's Likes sync once however they're typed.
    return {
      kind: "likes",
      externalId: `${LIKES_ID_PREFIX}${likes.username.toLowerCase()}`,
      url: `https://www.thingiverse.com/${encodeURIComponent(likes.username)}/likes`,
      likesOf: likes.username,
    };
  },
  modelUrl: (thingId) => `https://www.thingiverse.com/thing:${thingId}`,
};
