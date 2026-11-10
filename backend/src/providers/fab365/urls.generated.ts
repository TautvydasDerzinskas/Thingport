// GENERATED from providers/fab365/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

// A model is an item, at `/items/<id>` by its number alone. Its favourites are the user's own page, `/my/likes`,
// which names no one, so there's one list per Thingport user.
const MODEL_PATH = /^\/items\/(\d{1,12})\/?$/;
const LIKES_PATH = /^\/my\/likes\/?$/;

export function parseFab365ModelUrl(url: string): { itemId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { itemId: m[1] } : null;
}

export function fab365ModelUrl(itemId: string): string {
  return `${SITE_ORIGIN}/items/${itemId}`;
}

/** The page of the user's favourites, Fab365's only list and their own to see. */
export function isFab365LikesUrl(url: string): boolean {
  return LIKES_PATH.test(parseUrl(url)?.pathname ?? "");
}

export const FAB365_LIKES_URL = `${SITE_ORIGIN}/my/likes`;
/** What a sync keeps the favourites by; the page names no user, so there's one per Thingport user. */
export const FAB365_LIKES_KEY = "likes";

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseFab365ModelUrl(url);
    return model && { externalId: model.itemId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    return isFab365LikesUrl(url) ? { kind: "likes", externalId: FAB365_LIKES_KEY, url: FAB365_LIKES_URL } : null;
  },
  modelUrl: (itemId) => fab365ModelUrl(itemId),
};
