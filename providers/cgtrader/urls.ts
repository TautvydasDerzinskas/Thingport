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

// A model's page is `/<catalogue>/<category>/<subcategory>/<slug>`, its catalogue saying whether it's printable and
// whether it's free -- which the site sends to whichever is right. `/products/<slug>` redirects there too, and so does
// `/products/<id>`, the only form a number is ever in: the slug is all its own links carry, so it's what Thingport
// keeps. A catalogue's listings have one or two segments after it, never three.
const SLUG = String.raw`[a-z0-9][a-z0-9-]{0,200}`;
const MODEL_PATH = new RegExp(String.raw`^/(?:free-)?3d-(?:print-)?models/${SLUG}/${SLUG}/(${SLUG})/?$`, "i");
const PRODUCT_PATH = new RegExp(String.raw`^/products/(${SLUG})/?$`, "i");
const LIKES_PATH = /^\/profile\/liked_models\/?$/;
// Its one wishlist redirects to its own id, `/profile/wish-lists/<id>`.
const WISHLIST_PATH = /^\/profile\/wish-lists(?:\/\d{1,12})?\/?$/;

export function parseCgtraderModelUrl(url: string): { slug: string } | null {
  const path = parseUrl(url)?.pathname;
  const m = path?.match(MODEL_PATH) ?? path?.match(PRODUCT_PATH);
  return m ? { slug: m[1].toLowerCase() } : null;
}

/** Whether a link names a model by its number rather than its slug, as only a hand-made `/products/<id>` does. */
export function isCgtraderModelId(slug: string): boolean {
  return /^\d{1,12}$/.test(slug);
}

/** A model's page by its slug (or its number), which the site redirects to the model's own address. */
export function cgtraderModelUrl(slug: string): string {
  return `${SITE_ORIGIN}/products/${slug}`;
}

export const CGTRADER_LIKES_URL = `${SITE_ORIGIN}/profile/liked_models`;
export const CGTRADER_WISHLIST_URL = `${SITE_ORIGIN}/profile/wish-lists`;
/** What a sync keeps each list by; the pages name no user, so there's one of each per Thingport user. */
export const CGTRADER_LIKES_KEY = "likes";
export const CGTRADER_WISHLIST_KEY = "wishlist";

/** Which of the user's own lists a link is: their liked models or their wishlist, both theirs alone to see. */
export function parseCgtraderListUrl(url: string): "likes" | "wishlist" | null {
  const path = parseUrl(url)?.pathname ?? "";
  if (LIKES_PATH.test(path)) return "likes";
  return WISHLIST_PATH.test(path) ? "wishlist" : null;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseCgtraderModelUrl(url);
    return model && { externalId: model.slug, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const list = parseCgtraderListUrl(url);
    if (list === "likes") return { kind: "likes", externalId: CGTRADER_LIKES_KEY, url: CGTRADER_LIKES_URL };
    return list && { kind: "bookmarks", externalId: CGTRADER_WISHLIST_KEY, url: CGTRADER_WISHLIST_URL };
  },
  modelUrl: (slug) => cgtraderModelUrl(slug),
};
