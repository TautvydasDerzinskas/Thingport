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

// Its pages come under a language (`/es`, `/jp`, `/ua`, …) or none. A model's page is `/3d-model-<slug>-<id>`, and
// only its number counts: the site sends any other slug to the model's own, though not none at all, which is a 404.
// A collection is `/bookmarks/3d-collection-<id>`, a private one's too, which shows only to its owner, signed in. The
// signed-in user's Default Collection, always private, is `/mybookmarks/default`.
const LANG = String.raw`(?:/[a-z]{2})?`;
const MODEL_PATH = new RegExp(String.raw`^${LANG}/3d-model-[a-z0-9-]*?-(\d{1,12})/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^${LANG}/bookmarks/3d-collection-(\d{1,12})/?$`, "i");
const DEFAULT_PATH = new RegExp(String.raw`^${LANG}/mybookmarks/default/?$`, "i");

/** `/3d-model-<slug>-<id>`, under a language or not. 3DExport has no print profiles. */
export function parseThreedexportModelUrl(url: string): { itemId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { itemId: m[1] } : null;
}

/** A model's page by its number, which the site redirects to the model's own address. */
export function threedexportModelUrl(itemId: string): string {
  return `${SITE_ORIGIN}/3d-model-item-${itemId}`;
}

/** A collection by its number: anyone's public one, or one of the user's own, private or not. */
export function parseThreedexportCollectionUrl(url: string): { collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(COLLECTION_PATH);
  return m ? { collectionId: m[1] } : null;
}

/** A collection's page, which shows a private one to its owner alone. */
export function threedexportCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/bookmarks/3d-collection-${collectionId}`;
}

/** Whether a link is to the signed-in user's Default Collection, which names no one. */
export function isThreedexportDefaultUrl(url: string): boolean {
  return DEFAULT_PATH.test(parseUrl(url)?.pathname ?? "");
}

export const THREEDEXPORT_DEFAULT_URL = `${SITE_ORIGIN}/mybookmarks/default`;
/** What a sync of the Default Collection is kept by; it's whoever's signed in, so there's one per Thingport user. */
export const THREEDEXPORT_DEFAULT_KEY = "default";
/** The page listing the user's own collections. */
export const THREEDEXPORT_BOOKMARKS_URL = `${SITE_ORIGIN}/mybookmarks`;

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseThreedexportModelUrl(url);
    return model && { externalId: model.itemId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    if (isThreedexportDefaultUrl(url)) {
      return { kind: "bookmarks", externalId: THREEDEXPORT_DEFAULT_KEY, url: THREEDEXPORT_DEFAULT_URL };
    }
    const collection = parseThreedexportCollectionUrl(url);
    return (
      collection && {
        kind: "collection",
        externalId: collection.collectionId,
        url: threedexportCollectionUrl(collection.collectionId),
      }
    );
  },
  modelUrl: (itemId) => threedexportModelUrl(itemId),
};
