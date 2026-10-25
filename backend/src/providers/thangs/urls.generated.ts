// GENERATED from providers/thangs/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

// `/designer/<user>/3d-model/<name>-<id>`, also under `/prints` (print-only models) and with a subpage after it
// (`/3d-print/<sku>`, `/image/<id>`, ...); the name may be left out. `/m/<id>` is the site's own short link.
const MODEL_PATH = /^\/(?:prints\/)?designer\/[^/]+\/3d-model\/(?:[^/]*-)?(\d+)(?:\/.*)?$/i;
const SHORT_MODEL_PATH = /^\/m\/(\d+)\/?$/i;
const COLLECTION_PATH = /^(\/designer\/[^/]+\/collection\/(?:[^/]*-)?(\d+))(?:\/.*)?$/i;
const OWN_COLLECTION_PATH = /^(\/(?:mythangs\/collections|c)\/(\d+))\/?$/i;

export const THANGS_LIKES_KEY = "likes";
export const THANGS_LIKES_URL = `${SITE_ORIGIN}/mythangs/liked-models`;

export function parseThangsModelUrl(url: string): { modelId: string } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH) ?? parsed?.pathname.match(SHORT_MODEL_PATH);
  return m ? { modelId: m[1] } : null;
}

/** Thangs redirects its short link to the model's page, whatever its name and designer. */
export function thangsModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/m/${modelId}`;
}

/** A collection: `/designer/<user>/collection/<name>-<id>`, or the owner's own `/mythangs/collections/<id>`. `url` is
 *  the same page without a sort, scope or query. */
export function parseThangsCollectionUrl(url: string): { collectionId: string; url: string } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(COLLECTION_PATH) ?? parsed?.pathname.match(OWN_COLLECTION_PATH);
  return m ? { collectionId: m[2], url: `${SITE_ORIGIN}${m[1]}` } : null;
}

/** The page the site itself links a collection at: its owner's, named after it. */
export function thangsCollectionUrl(collectionId: string, owner: string | null, name: string | null): string {
  if (!owner) return `${SITE_ORIGIN}/mythangs/collections/${collectionId}`;
  const slug = name ? `${encodeURIComponent(name)}-` : "";
  return `${SITE_ORIGIN}/designer/${encodeURIComponent(owner)}/collection/${slug}${collectionId}`;
}

/** The user's own liked models; the page names no user, as it's always the signed-in one's. */
export function isThangsLikesUrl(url: string): boolean {
  return /^\/mythangs\/liked-models\/?$/i.test(parseUrl(url)?.pathname ?? "");
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseThangsModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parseThangsCollectionUrl(url);
    if (collection) return { kind: "collection", externalId: collection.collectionId, url: collection.url };
    // The page names no user: it's always the signed-in one's, read as the account Thingport has.
    if (isThangsLikesUrl(url)) return { kind: "likes", externalId: THANGS_LIKES_KEY, url: THANGS_LIKES_URL };
    return null;
  },
  modelUrl: thangsModelUrl,
};
