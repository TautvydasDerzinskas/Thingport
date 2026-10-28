// GENERATED from providers/toymakr3d/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

// The site calls its models products, at `/product/<id>-<name>`. It resolves one by the id alone and sends any other
// name to the canonical page, so the id is what Thingport keeps.
const MODEL_PATH = /^\/product\/(\d{1,12})(?:-[^/]*)?\/?$/;
const LIKES_PATH = /^\/like-product\/?$/;

export function parseToymakr3dModelUrl(url: string): { modelId: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  return m ? { modelId: String(Number(m[1])) } : null;
}

/** A model's page by its id. The site has no address for one without a name, so this gives it the empty name it
 *  takes, which it answers with a redirect to the page's own. */
export function toymakr3dModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/product/${modelId}-`;
}

/** The page of the user's liked products, Toymakr3D's only list and their own to see. */
export function isToymakr3dLikesUrl(url: string): boolean {
  return LIKES_PATH.test(parseUrl(url)?.pathname ?? "");
}

export const TOYMAKR3D_LIKES_URL = `${SITE_ORIGIN}/like-product`;
/** What a sync keeps the likes by; the page names no user, so there's one per Thingport user. */
export const TOYMAKR3D_LIKES_KEY = "likes";

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseToymakr3dModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    return isToymakr3dLikesUrl(url)
      ? { kind: "likes", externalId: TOYMAKR3D_LIKES_KEY, url: TOYMAKR3D_LIKES_URL }
      : null;
  },
  modelUrl: (modelId) => toymakr3dModelUrl(modelId),
};
