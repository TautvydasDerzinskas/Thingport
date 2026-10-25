// GENERATED from providers/threedprintsocial/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

// It's a Manyfold server. Models and collections go by a 12-character public id; creators by their slug, which is
// also their Fediverse handle there.
const PUBLIC_ID = /^[a-z0-9]{12}$/;
const MODEL_PATH = /^\/models\/([a-z0-9]{12})\/?$/;
const COLLECTION_PATH = /^\/collections\/([a-z0-9]{12})\/?$/;
const CREATOR_PATH = /^\/creators\/([A-Za-z0-9_-]{1,64})\/?$/;
const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
// Pages under /creators/ that aren't a creator's.
const NOT_CREATORS = new Set(["new"]);

/** What a sync of a creator's models is kept by, beside the collections' public ids. */
export const CREATOR_ID_PREFIX = "creator:";

/** `/models/<id>`. 3DPrint.social has no print profiles. */
export function parsePrintSocialModelUrl(url: string): { modelId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { modelId: m[1] } : null;
}

export function printSocialModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/models/${modelId}`;
}

/** `/collections/<id>`, or the models page filtered to it, `/models?collection=<id>`, as a model's page links it. */
export function parsePrintSocialCollectionUrl(url: string): { collectionId: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const m = parsed.pathname.match(COLLECTION_PATH);
  if (m) return { collectionId: m[1] };
  const id = /^\/models\/?$/.test(parsed.pathname) ? (parsed.searchParams.get("collection") ?? "") : "";
  return PUBLIC_ID.test(id) ? { collectionId: id } : null;
}

export function printSocialCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/collections/${collectionId}`;
}

/** A creator's page, `/creators/<slug>`, or the models page filtered to them, `/models?creator=<slug>`: their models,
 *  as a list of its own. */
export function parsePrintSocialCreatorUrl(url: string): { slug: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const m = parsed.pathname.match(CREATOR_PATH);
  const slug = m ? m[1] : /^\/models\/?$/.test(parsed.pathname) ? (parsed.searchParams.get("creator") ?? "") : "";
  return SLUG.test(slug) && !NOT_CREATORS.has(slug) ? { slug } : null;
}

export function printSocialCreatorUrl(slug: string): string {
  return `${SITE_ORIGIN}/creators/${slug}`;
}

/** What a sync of a creator's models is kept by. */
export function printSocialCreatorKey(slug: string): string {
  return `${CREATOR_ID_PREFIX}${slug}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parsePrintSocialModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parsePrintSocialCollectionUrl(url);
    if (collection) {
      return {
        kind: "collection",
        externalId: collection.collectionId,
        url: printSocialCollectionUrl(collection.collectionId),
      };
    }
    // A creator's models sync like a collection: it has nothing else to call them.
    const creator = parsePrintSocialCreatorUrl(url);
    return (
      creator && {
        kind: "collection",
        externalId: printSocialCreatorKey(creator.slug),
        url: printSocialCreatorUrl(creator.slug),
      }
    );
  },
  modelUrl: (modelId) => printSocialModelUrl(modelId),
  authorUrl: (slug) => printSocialCreatorUrl(slug),
};
