import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "./importResolvers";
import { cleanThingiverseMarkdown } from "./descriptionMarkdown";
import type { ProviderCollectionCard } from "./providerCollectionCard";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";
import { getFlaresolverrUrl } from "./settingsService";

// The official API needs an app Access Token (not a session cookie). It's still behind Cloudflare
// and returns a sticky 429 challenge after a few rapid requests, hence ThingiverseRateLimitError
// and the FlareSolverr fallback.
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

const FLARESOLVERR_HINTS = {
  missing: " Setting up FlareSolverr in Admin Settings > Connections gets past it.",
  failed:
    " FlareSolverr couldn't get past it either: it may be down or unreachable. Check it in Admin Settings > Connections.",
};

/** Cloudflare's 429 challenge, distinct from a 404 or rejected token: the fix is to wait, or a working FlareSolverr. */
export class ThingiverseRateLimitError extends Error {
  constructor(flaresolverr?: keyof typeof FLARESOLVERR_HINTS) {
    super(
      "Thingiverse blocked this request with a rate-limit challenge (Cloudflare). This usually " +
        "clears after a while -- wait, then try again." +
        (flaresolverr ? FLARESOLVERR_HINTS[flaresolverr] : ""),
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
    return await fetch(url, {
      headers: { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Once a challenge is seen, calls go straight through FlareSolverr for a while. JSON API calls
 * only: FlareSolverr can't relay binary file downloads. */
async function fetchThingiverseApiJson(path: string, accessToken: string): Promise<unknown> {
  const { ok, data } = await fetchThingiverseApi(path, accessToken);
  return ok ? data : null;
}

async function fetchThingiverseApi(
  path: string,
  accessToken: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${THINGIVERSE_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;

  let res: Response;
  let viaBrowser = false;
  if (shouldProxyHost(THINGIVERSE_API_HOSTNAME)) {
    const solved = await fetchViaFlaresolverr(url);
    if (solved) {
      viaBrowser = true;
      res = new Response(solved.body, { status: solved.status });
    } else {
      res = await rawApiFetch(url);
    }
  } else {
    res = await rawApiFetch(url);
    if ((res.status === 429 || res.status === 403) && looksLikeCloudflareBlock(res.headers)) {
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
  // An unsolved challenge is a 403 too; it says nothing about the token.
  if (!viaBrowser && (res.status === 429 || res.headers.get("cf-mitigated") === "challenge")) {
    throw new ThingiverseRateLimitError((await getFlaresolverrUrl()) ? "failed" : "missing");
  }
  if (res.status === 429) throw new ThingiverseRateLimitError();
  if (res.status === 401 || res.status === 403) throw new ThingiverseAuthError();
  return { ok: res.ok, status: res.status, data };
}

/** Checks /users/me. A rate-limit counts as invalid, since the token can't be confirmed. */
export async function verifyThingiverseAccessToken(accessToken: string): Promise<boolean> {
  try {
    const data = await fetchThingiverseApiJson("/users/me", accessToken);
    return isRecord(data);
  } catch {
    return false;
  }
}

/** Like verifyThingiverseAccessToken, but tells a rejected token from Cloudflare's block and an unreachable API. */
export async function checkThingiverseAccessToken(
  accessToken: string,
): Promise<"ok" | "rejected" | "blocked" | "unreachable"> {
  try {
    const { ok, data } = await fetchThingiverseApi("/users/me", accessToken);
    return ok && isRecord(data) ? "ok" : "unreachable";
  } catch (err) {
    if (err instanceof ThingiverseAuthError) return "rejected";
    if (err instanceof ThingiverseRateLimitError) return "blocked";
    return "unreachable";
  }
}

export type ThingiversePlateFile = { name: string; url: string };
export type ThingiverseGalleryImage = { name: string; url: string };

export type ThingiverseThingResolution = {
  meta: Partial<ImportedPageMetadata>;
  /** Every file in `zip_data.files`, including non-model files (callers filter). Public CDN URLs. */
  plateFiles: ThingiversePlateFile[];
  /** From `zip_data.images`. */
  galleryImages: ThingiverseGalleryImage[];
};

function extractCreatorAuthor(creator: Record<string, unknown>): {
  creator: string | null;
  author: ImportedAuthorInfo | null;
} {
  const name = typeof creator.name === "string" && creator.name.trim() ? creator.name.trim() : null;
  const externalId = creator.id != null ? String(creator.id) : null;
  if (!externalId) return { creator: name, author: null };
  const publicUrl =
    typeof creator.public_url === "string" && creator.public_url.trim() ? creator.public_url.trim() : null;
  const author: ImportedAuthorInfo = {
    provider: THINGIVERSE_PROVIDER,
    externalId,
    name,
    handle: name,
    bio: null,
    bioTranslated: null,
    links: publicUrl ? [publicUrl] : [],
    avatarUrl: typeof creator.thumbnail === "string" && creator.thumbnail.trim() ? creator.thumbnail.trim() : null,
    backgroundUrl: typeof creator.cover === "string" && creator.cover.trim() ? creator.cover.trim() : null,
  };
  return { creator: name, author };
}

/** The Thing's description, with its separate instructions section (when it has one) appended. */
function thingiverseDescription(detail: Record<string, unknown>): string | null {
  const description = typeof detail.description === "string" ? cleanThingiverseMarkdown(detail.description) : null;
  const instructions = typeof detail.instructions === "string" ? cleanThingiverseMarkdown(detail.instructions) : null;
  if (!instructions) return description;
  return [description, `## Instructions\n\n${instructions}`].filter(Boolean).join("\n\n");
}

/** Null for a Thing that doesn't exist or isn't accessible; throws ThingiverseAuthError for a
 * rejected token. */
export async function resolveThingiverseThing(
  thingId: string,
  accessToken: string,
): Promise<ThingiverseThingResolution | null> {
  const detail = await fetchThingiverseApiJson(`/things/${thingId}`, accessToken);
  if (!isRecord(detail)) return null;

  const meta: Partial<ImportedPageMetadata> = {};
  if (typeof detail.name === "string" && detail.name.trim()) meta.title = detail.name.trim();
  const description = thingiverseDescription(detail);
  if (description) meta.description = description;
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

  // Best-effort: categories aren't inlined on the Thing resource.
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
    } catch {}
  }

  const zipData = isRecord(detail.zip_data) ? detail.zip_data : null;
  const plateFiles: ThingiversePlateFile[] = Array.isArray(zipData?.files)
    ? zipData.files
        .filter(
          (f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && typeof f.url === "string",
        )
        .map((f) => ({ name: f.name as string, url: f.url as string }))
    : [];
  const galleryImages: ThingiverseGalleryImage[] = Array.isArray(zipData?.images)
    ? zipData.images
        .filter(
          (f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && typeof f.url === "string",
        )
        .map((f) => ({ name: f.name as string, url: f.url as string }))
    : [];

  return { meta, plateFiles, galleryImages };
}

export type ThingiverseThingSummary = { thingId: string; title: string; cover: string | null };

const LISTING_PAGE_SIZE = 30;
const LISTING_MAX_ENTRIES = 300;

/** Pages through any endpoint returning a JSON array of Thing summaries. maxItems is a safety cap,
 * not a UX limit. */
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

export async function fetchThingiverseCollectionTitle(
  collectionId: string,
  accessToken: string,
): Promise<string | null> {
  const data = await fetchThingiverseApiJson(`/collections/${encodeURIComponent(collectionId)}`, accessToken);
  return isRecord(data) && typeof data.name === "string" && data.name.trim() ? data.name.trim() : null;
}

/** For a sync: null when Thingiverse answers 404 for the collection. Throws on any other failure,
 * so an outage is never taken for a deleted collection. */
export async function checkThingiverseCollection(
  collectionId: string,
  accessToken: string,
): Promise<{ title: string | null } | null> {
  const { ok, status, data } = await fetchThingiverseApi(
    `/collections/${encodeURIComponent(collectionId)}`,
    accessToken,
  );
  if (status === 404) return null;
  if (!ok || !isRecord(data)) throw new Error(`Couldn't read the Thingiverse collection (HTTP ${status})`);
  return { title: typeof data.name === "string" && data.name.trim() ? data.name.trim() : null };
}

/** For a Likes sync: null when Thingiverse answers 404 for the user. Throws on any other failure,
 * so an outage is never taken for a deleted account. */
export async function checkThingiverseUser(username: string, accessToken: string): Promise<boolean> {
  return (await fetchThingiverseUser(username, accessToken)) !== null;
}

/** The username in the URL is cosmetic; only the collection id is needed. */
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

/** A user's profile as the API gives it; null when there's no such user. */
export async function fetchThingiverseUser(
  username: string,
  accessToken: string,
): Promise<Record<string, unknown> | null> {
  const { ok, status, data } = await fetchThingiverseApi(`/users/${encodeURIComponent(username)}`, accessToken);
  if (status === 404) return null;
  if (!ok || !isRecord(data)) throw new Error(`Couldn't read the Thingiverse user (HTTP ${status})`);
  return data;
}

const LIKES_SAMPLE = 3;

/** How many models a user likes, and a few of them, for showing their likes as a collection. Null
 *  when there's no such user. */
export async function fetchThingiverseLikesSummary(
  username: string,
  accessToken: string,
): Promise<{ username: string; count: number; thumbnails: string[] } | null> {
  const user = await fetchThingiverseUser(username, accessToken);
  if (!user) return null;
  const name = typeof user.name === "string" && user.name ? user.name : username;
  const count = Number(user.like_count) || 0;
  const { entries } = count ? await fetchThingiverseUserLikes(name, accessToken, LIKES_SAMPLE) : { entries: [] };
  return { username: name, count, thumbnails: entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])) };
}

/** A profile link or a username. Null when Thingiverse knows no such user. */
export async function resolveThingiverseUser(input: string, accessToken: string): Promise<{ username: string } | null> {
  let value = input.trim();
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return null;
    value = url.pathname.split("/").find(Boolean) ?? "";
  } catch {
    // Not a link.
  }
  value = value.replace(/^@/, "");
  if (!value || !/^[\w.-]+$/.test(value)) return null;
  const user = await fetchThingiverseUser(value, accessToken);
  if (!user) return null;
  return { username: typeof user.name === "string" && user.name.trim() ? user.name.trim() : value };
}

function thingiverseCollectionCard(value: unknown): ProviderCollectionCard | null {
  if (!isRecord(value) || value.id == null) return null;
  const id = String(value.id);
  const owner = isRecord(value.creator) && typeof value.creator.name === "string" ? value.creator.name : null;
  // A collection carries up to four model images as thumbnail, thumbnail_1, ...
  const thumbnails = ["thumbnail", "thumbnail_1", "thumbnail_2", "thumbnail_3"].flatMap((key) => {
    const url = value[key];
    return typeof url === "string" && /^https?:\/\//.test(url) ? [url] : [];
  });
  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Collection ${id}`,
    url: `https://www.thingiverse.com/${owner ? `${encodeURIComponent(owner)}/` : ""}collections/${id}`,
    modelCount: typeof value.count === "number" ? value.count : Number(value.count) || 0,
    thumbnails: [...new Set(thumbnails)],
    private: value.is_private === true || value.is_private === 1,
    owner,
  };
}

export async function listThingiverseUserCollections(
  username: string,
  accessToken: string,
): Promise<ProviderCollectionCard[]> {
  const { ok, status, data } = await fetchThingiverseApi(
    `/users/${encodeURIComponent(username)}/collections`,
    accessToken,
  );
  if (!ok || !Array.isArray(data)) throw new Error(`Couldn't load the Thingiverse collections (HTTP ${status})`);
  return data.flatMap((item) => {
    const card = thingiverseCollectionCard(item);
    return card ? [card] : [];
  });
}

export async function fetchThingiverseCollectionCard(
  collectionId: string,
  accessToken: string,
): Promise<ProviderCollectionCard | null> {
  const { ok, status, data } = await fetchThingiverseApi(
    `/collections/${encodeURIComponent(collectionId)}`,
    accessToken,
  );
  if (status === 404) return null;
  if (!ok) throw new Error(`Couldn't read the Thingiverse collection (HTTP ${status})`);
  return thingiverseCollectionCard(data);
}
