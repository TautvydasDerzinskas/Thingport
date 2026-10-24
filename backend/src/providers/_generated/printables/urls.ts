// GENERATED from providers/printables/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
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

export function parsePrintablesModelUrl(url: string): { modelId: string } | null {
  const m = parseUrl(url)?.pathname.match(/\/model\/(\d+)/i);
  return m ? { modelId: m[1] } : null;
}

/** A user's liked models, which Printables shows to that user only. */
export function parsePrintablesLikesUrl(url: string): { handle: string } | null {
  const m = parseUrl(url)?.pathname.match(/^\/(?:[a-z]{2}\/)?@([^/]+)\/collections\/liked\/?$/i);
  return m ? { handle: decodeURIComponent(m[1]) } : null;
}

/** The `@handle` segment is cosmetic; only the id is used. */
export function parsePrintablesCollectionUrl(url: string): { collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(/\/collections\/(\d+)/i);
  return m ? { collectionId: m[1] } : null;
}

export function printablesModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/model/${modelId}`;
}

/** Under its owner's handle where it's known, as the site links it; the handle is cosmetic. */
export function printablesCollectionUrl(collectionId: string, owner?: string | null): string {
  return owner
    ? `${printablesUserUrl(owner)}/collections/${collectionId}`
    : `${SITE_ORIGIN}/collections/${collectionId}`;
}

export function printablesLikesUrl(handle: string): string {
  return `${printablesUserUrl(handle)}/collections/liked`;
}

export function printablesUserUrl(handle: string): string {
  return `${SITE_ORIGIN}/@${encodeURIComponent(handle)}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parsePrintablesModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parsePrintablesCollectionUrl(url);
    if (collection) {
      const id = collection.collectionId;
      return { kind: "collection", externalId: id, url: printablesCollectionUrl(id) };
    }
    const likes = parsePrintablesLikesUrl(url);
    if (!likes) return null;
    // Only Thingport Grab can read these, as their owner (the backend's providerListingsService.ts).
    return {
      kind: "likes",
      externalId: `${LIKES_ID_PREFIX}${likes.handle.toLowerCase()}`,
      url: printablesLikesUrl(likes.handle),
      likesOf: likes.handle,
    };
  },
  modelUrl: printablesModelUrl,
};
