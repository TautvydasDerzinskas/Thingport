// GENERATED from providers/eufymake/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
const MODEL_PATH = new RegExp(String.raw`^/${LANG}models/([0-9a-f]{32})(?:/.*)?$`, "i");
const LIKES_PATH = new RegExp(String.raw`^/${LANG}user/me/?$`, "i");

/** `/models/<id>/<name>/`, the name optional. eufyMake has no print profiles. */
export function parseEufymakeModelUrl(url: string): { modelId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { modelId: m[1].toLowerCase() } : null;
}

export function eufymakeModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/models/${modelId}/`;
}

/** The signed-in user's own page, `/user/me/`. It opens on their models, and its Liked tab doesn't change the
 *  address, so the page stands for their likes: their models are no list Thingport syncs. */
export function isEufymakeLikesUrl(url: string): boolean {
  return LIKES_PATH.test(parseUrl(url)?.pathname ?? "");
}

export const EUFYMAKE_LIKES_URL = `${SITE_ORIGIN}/user/me/`;
/** The id a sync keeps for the user's likes; the page names no user, so there's one per Thingport user. */
export const EUFYMAKE_LIKES_KEY = "likes";

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseEufymakeModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    return isEufymakeLikesUrl(url) ? { kind: "likes", externalId: EUFYMAKE_LIKES_KEY, url: EUFYMAKE_LIKES_URL } : null;
  },
  modelUrl: (modelId) => eufymakeModelUrl(modelId),
};
