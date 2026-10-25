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

export function thingiverseThingUrl(thingId: string): string {
  return `${SITE_ORIGIN}/thing:${thingId}`;
}

/** Under its owner's name where it's known, as the site links it; the name is cosmetic. */
export function thingiverseCollectionUrl(collectionId: string, owner?: string | null): string {
  return `${SITE_ORIGIN}/${owner ? `${encodeURIComponent(owner)}/` : ""}collections/${collectionId}`;
}

export function thingiverseLikesUrl(username: string): string {
  return `${SITE_ORIGIN}/${encodeURIComponent(username)}/likes`;
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
      return { kind: "collection", externalId: id, url: thingiverseCollectionUrl(id) };
    }
    const likes = parseThingiverseLikesUrl(url);
    if (!likes) return null;
    // Thingiverse usernames aren't case-sensitive, so one user's Likes sync once however they're typed.
    return {
      kind: "likes",
      externalId: `${LIKES_ID_PREFIX}${likes.username.toLowerCase()}`,
      url: thingiverseLikesUrl(likes.username),
      likesOf: likes.username,
    };
  },
  modelUrl: thingiverseThingUrl,
};
