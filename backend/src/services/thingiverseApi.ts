import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "./importResolvers";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  isFlaresolverrEnabled,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

// The official, documented Thingiverse Developer API -- much less aggressively gated than
// www.thingiverse.com (that domain actively challenges automated requests, including its own
// legacy `download:{id}` links and the internal `/api/v2/*` endpoints the website's own frontend
// uses), and it requires its own Access Token (from an app registered at
// thingiverse.com/apps/create -- NOT a browser session cookie, confirmed by a clean
// INVALID_ACCESS_TOKEN response when a real logged-in session token was tried against it).
// BUT it is still sitting behind Cloudflare (`server: cloudflare`, `cf-mitigated: challenge`
// response headers) and confirmed live to start returning a Cloudflare managed-challenge page
// (HTTP 429, HTML body) after only a handful of rapid requests -- sticky for a while once
// tripped, every subsequent request fails the same way. classifyImportFailure/ThingiverseRateLimitError
// exist to surface that distinctly instead of misreporting it as "not found", and
// fetchThingiverseApiJson below falls back to FlareSolverr (when configured -- see
// flaresolverr.ts) to push through a challenge rather than just failing the whole batch.
const THINGIVERSE_API_BASE = "https://api.thingiverse.com";
const THINGIVERSE_API_HOSTNAME = new URL(THINGIVERSE_API_BASE).hostname;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const THINGIVERSE_PROVIDER = "thingiverse";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class ThingiverseAuthError extends Error {
  constructor() {
    super(
      "The Thingiverse Access Token configured for this instance was rejected. Ask an admin to " +
        "update it in Admin Settings (a new one can be generated at thingiverse.com/apps/create).",
    );
    this.name = "ThingiverseAuthError";
  }
}

/** api.thingiverse.com tripped its Cloudflare bot-management (a "managed challenge" HTML page,
 * HTTP 429) rather than answering the request -- distinct from a genuine 404 (Thing doesn't
 * exist/isn't accessible) or a rejected token, and worth its own bucket since the fix (wait,
 * then retry) is completely different. See classifyImportFailure in importJobRunner.ts. */
export class ThingiverseRateLimitError extends Error {
  constructor() {
    super(
      "Thingiverse blocked this request with a rate-limit challenge (Cloudflare). This usually " +
        "clears after a while -- wait, then retry the same import.",
    );
    this.name = "ThingiverseRateLimitError";
  }
}

export function parseThingiverseThingUrl(url: string): { thingId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return null;
  const m1 = parsed.pathname.match(/thing:(\d+)/i);
  if (m1) return { thingId: m1[1] };
  const m2 = parsed.pathname.match(/\/things\/(\d+)/i);
  return m2 ? { thingId: m2[1] } : null;
}

/** A user's own "Likes" page (`thingiverse.com/{username}/likes`) is how a lot of people keep a
 * personal collection of prints worth making -- the site's own bookmark/save mechanism. Distinct
 * from parseThingiverseThingUrl above: this identifies the *listing* page, not a single Thing. */
export function parseThingiverseLikesUrl(url: string): { username: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return null;
  const m = parsed.pathname.match(/^\/([^/]+)\/likes\/?$/i);
  return m ? { username: m[1] } : null;
}

async function rawApiFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Same detect-a-Cloudflare-block-then-proxy-through-FlareSolverr pattern as importService.ts's
 * fetchWithGuard (used for Printables/MakerWorld page scraping), adapted for a JSON API instead
 * of an HTML page: once api.thingiverse.com has been seen returning its managed-challenge page
 * for this run, every subsequent call goes straight through FlareSolverr's real headless browser
 * for a while (shouldProxyHost's TTL) instead of wasting a direct request that would just get
 * challenged again. A browser-rendered JSON response comes back as Chrome's own JSON-viewer DOM,
 * not raw text -- extractJsonFromBrowserBody unwraps that. Only ever used for the JSON API calls
 * (GET, no body) -- file downloads from Thingiverse's CDN are a separate, unguarded path (see
 * downloadPlainFileToTemp in importService.ts): FlareSolverr renders pages, it can't relay
 * arbitrary binary bytes back, so it isn't a fit there. */
async function fetchThingiverseApiJson(path: string, accessToken: string): Promise<unknown> {
  const url = `${THINGIVERSE_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;

  let res: Response;
  let viaBrowser = false;
  if (isFlaresolverrEnabled() && shouldProxyHost(THINGIVERSE_API_HOSTNAME)) {
    const solved = await fetchViaFlaresolverr(url);
    if (solved) {
      viaBrowser = true;
      res = new Response(solved.body, { status: solved.status });
    } else {
      res = await rawApiFetch(url);
    }
  } else {
    res = await rawApiFetch(url);
    if ((res.status === 429 || res.status === 403) && isFlaresolverrEnabled() && looksLikeCloudflareBlock(res.headers)) {
      const solved = await fetchViaFlaresolverr(url);
      if (solved) {
        viaBrowser = true;
        res = new Response(solved.body, { status: solved.status });
      }
    }
  }

  const text = await res.text();
  let data: unknown = null;
  if (text.trim()) {
    try {
      data = viaBrowser ? extractJsonFromBrowserBody(text) : JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (res.status === 429) throw new ThingiverseRateLimitError();
  if (res.status === 401 || res.status === 403) throw new ThingiverseAuthError();
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return data;
}

/** Called before storing an Access Token pasted into Admin Settings > Thingiverse (see
 * routes/settings.ts' POST /settings/thingiverse), so a mistyped/revoked token is rejected up
 * front instead of only surfacing as a failed import later. Reuses the same fetch path (and its
 * FlareSolverr/rate-limit handling) as every other Thingiverse call here, against /users/me --
 * the official API's own "who am I" endpoint, so a success means the token is genuinely valid,
 * not just well-formed. A transient Cloudflare rate-limit (ThingiverseRateLimitError) is treated
 * the same as an invalid token here: either way this specific check can't confirm the token
 * right now, and the caller's message covers both cases rather than guessing which one it was. */
export async function verifyThingiverseAccessToken(accessToken: string): Promise<boolean> {
  try {
    const data = await fetchThingiverseApiJson("/users/me", accessToken);
    return isRecord(data);
  } catch {
    return false;
  }
}

export type ThingiversePlateFile = { name: string; url: string };
export type ThingiverseGalleryImage = { name: string; url: string };

export type ThingiverseThingResolution = {
  meta: Partial<ImportedPageMetadata>;
  /** Every real file bundled with the Thing (STL/3MF/etc, but also non-model files like PDFs --
   * callers filter by extension), taken from `zip_data.files`. Direct, public CDN URLs -- no
   * auth needed to actually fetch the bytes, only to resolve the Thing itself. */
  plateFiles: ThingiversePlateFile[];
  /** Renders/photos bundled with the Thing, from `zip_data.images` -- fed to
   * attachImportedPreviewImages as extra gallery images alongside the cover thumbnail. */
  galleryImages: ThingiverseGalleryImage[];
};

function extractCreatorAuthor(creator: Record<string, unknown>): { creator: string | null; author: ImportedAuthorInfo | null } {
  const name = typeof creator.name === "string" && creator.name.trim() ? creator.name.trim() : null;
  const externalId = creator.id != null ? String(creator.id) : null;
  if (!externalId) return { creator: name, author: null };
  const publicUrl = typeof creator.public_url === "string" && creator.public_url.trim() ? creator.public_url.trim() : null;
  const author: ImportedAuthorInfo = {
    provider: THINGIVERSE_PROVIDER,
    externalId,
    name,
    // The official API has no separate handle/username field distinct from the display name.
    handle: name,
    bio: null,
    bioTranslated: null,
    links: publicUrl ? [publicUrl] : [],
    avatarUrl: typeof creator.thumbnail === "string" && creator.thumbnail.trim() ? creator.thumbnail.trim() : null,
    backgroundUrl: typeof creator.cover === "string" && creator.cover.trim() ? creator.cover.trim() : null,
  };
  return { creator: name, author };
}

/** Resolves a Thing's metadata (title, description, tags, author, category, preview) and its
 * real, directly-downloadable file list, all from the official api.thingiverse.com API. Returns
 * null for a Thing that doesn't exist / isn't accessible with this token (404); throws
 * ThingiverseAuthError for a rejected token (401/403) so the caller can surface that distinctly
 * from "this one Thing is unavailable". */
export async function resolveThingiverseThing(thingId: string, accessToken: string): Promise<ThingiverseThingResolution | null> {
  const detail = await fetchThingiverseApiJson(`/things/${thingId}`, accessToken);
  if (!isRecord(detail)) return null;

  const meta: Partial<ImportedPageMetadata> = {};
  if (typeof detail.name === "string" && detail.name.trim()) meta.title = detail.name.trim();
  if (typeof detail.description === "string" && detail.description.trim()) meta.description = detail.description.trim();
  if (Array.isArray(detail.tags)) {
    const tags = detail.tags
      .map((t) => (isRecord(t) && typeof t.name === "string" ? t.name.trim() : null))
      .filter((t): t is string => Boolean(t));
    if (tags.length) meta.tags = tags;
  }
  const defaultImage = isRecord(detail.default_image) ? detail.default_image : null;
  const previewImageUrl =
    (defaultImage && typeof defaultImage.url === "string" && defaultImage.url.trim() && defaultImage.url) ||
    (typeof detail.thumbnail === "string" && detail.thumbnail.trim() && detail.thumbnail) ||
    null;
  if (previewImageUrl) meta.previewImageUrl = previewImageUrl;

  if (isRecord(detail.creator)) {
    const { creator, author } = extractCreatorAuthor(detail.creator);
    if (creator) meta.creator = creator;
    if (author) meta.author = author;
  }

  // A separate call (per the official API's shape -- categories aren't inlined on the Thing
  // resource) but cheap and best-effort: category matching just doesn't happen if it fails.
  const categoriesUrl = typeof detail.categories_url === "string" ? detail.categories_url : null;
  if (categoriesUrl) {
    try {
      const categories = await fetchThingiverseApiJson(`/things/${thingId}/categories`, accessToken);
      if (Array.isArray(categories)) {
        const ids = categories
          .map((c) => (isRecord(c) && typeof c.id === "number" ? c.id : null))
          .filter((id): id is number => id !== null);
        if (ids.length) {
          meta.siteCategoryIds = ids;
          meta.categorySite = THINGIVERSE_PROVIDER;
        }
      }
    } catch {
      // Categories are a nice-to-have on top of a Thing that already resolved -- never fail
      // the whole import over this one being unreachable.
    }
  }

  const zipData = isRecord(detail.zip_data) ? detail.zip_data : null;
  const plateFiles: ThingiversePlateFile[] = Array.isArray(zipData?.files)
    ? zipData.files
        .filter((f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && typeof f.url === "string")
        .map((f) => ({ name: f.name as string, url: f.url as string }))
    : [];
  const galleryImages: ThingiverseGalleryImage[] = Array.isArray(zipData?.images)
    ? zipData.images
        .filter((f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && typeof f.url === "string")
        .map((f) => ({ name: f.name as string, url: f.url as string }))
    : [];

  return { meta, plateFiles, galleryImages };
}

export type ThingiverseThingSummary = { thingId: string; title: string; cover: string | null };

const LISTING_PAGE_SIZE = 30;
const LISTING_MAX_ENTRIES = 300;

/** Shared pager for any api.thingiverse.com endpoint that returns a plain JSON array of Thing
 * summaries, page by page (`GET .../likes`, `GET /collections/{id}/things`, ... -- confirmed
 * identical item shape for both live). Stops on a short/empty page or maxItems, whichever comes
 * first; maxItems is a safety cap against a pathological/huge list, not a UX limit, mirroring
 * fetchMakerworldCollectionEntries's same cap for MakerWorld collections. List entries carry no
 * zip_data/categories/description -- that's fetched per-item at actual import time via
 * resolveThingiverseThing, same as it already is for a single pasted Thing URL. */
async function paginateThingiverseThings(
  pathForPage: (page: number) => string,
  accessToken: string,
  maxItems: number,
): Promise<{ entries: ThingiverseThingSummary[]; truncated: boolean }> {
  const entries: ThingiverseThingSummary[] = [];
  let page = 1;
  for (;;) {
    const data = await fetchThingiverseApiJson(pathForPage(page), accessToken);
    if (!Array.isArray(data) || !data.length) break;
    for (const item of data) {
      if (!isRecord(item) || item.id == null) continue;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : `Thing ${item.id}`;
      const cover =
        (typeof item.thumbnail === "string" && item.thumbnail.trim() && item.thumbnail) ||
        (typeof item.preview_image === "string" && item.preview_image.trim() && item.preview_image) ||
        null;
      entries.push({ thingId: String(item.id), title: name, cover });
      if (entries.length >= maxItems) break;
    }
    if (data.length < LISTING_PAGE_SIZE || entries.length >= maxItems) break;
    page += 1;
  }
  return { entries, truncated: entries.length >= maxItems };
}

export async function fetchThingiverseUserLikes(
  username: string,
  accessToken: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<{ entries: ThingiverseThingSummary[]; truncated: boolean }> {
  return paginateThingiverseThings(
    (page) => `/users/${encodeURIComponent(username)}/likes?page=${page}&per_page=${LISTING_PAGE_SIZE}`,
    accessToken,
    maxItems,
  );
}

/** A user-curated, named "Collection" -- the site's other bookmark mechanism besides the
 * automatic per-account "Likes" list (see fetchThingiverseUserLikes above). Unlike Likes, a
 * Collection has a real user-given name (fetchThingiverseCollectionTitle below), which is what
 * lets the import land in a Thingport Collection named after it instead of a generic bucket. */
export async function fetchThingiverseCollectionThings(
  collectionId: string,
  accessToken: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<{ entries: ThingiverseThingSummary[]; truncated: boolean }> {
  return paginateThingiverseThings(
    (page) => `/collections/${encodeURIComponent(collectionId)}/things?page=${page}&per_page=${LISTING_PAGE_SIZE}`,
    accessToken,
    maxItems,
  );
}

export async function fetchThingiverseCollectionTitle(collectionId: string, accessToken: string): Promise<string | null> {
  const data = await fetchThingiverseApiJson(`/collections/${encodeURIComponent(collectionId)}`, accessToken);
  return isRecord(data) && typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
}

/** A user's own Collection page (`thingiverse.com/{username}/collections/{id}` or
 * `.../collections/{id}/things`) -- distinct from parseThingiverseLikesUrl (the automatic Likes
 * list) and parseThingiverseThingUrl (a single Thing). Only the numeric id is needed for the API
 * calls above; the username in the URL is cosmetic (Thingiverse doesn't validate it matches the
 * collection's actual owner when resolving by id). */
export function parseThingiverseCollectionUrl(url: string): { collectionId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return null;
  const m = parsed.pathname.match(/\/collections\/(\d+)/i);
  return m ? { collectionId: m[1] } : null;
}
