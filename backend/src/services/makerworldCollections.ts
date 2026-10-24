import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  isFlaresolverrEnabled,
  looksLikeCloudflareBlock,
} from "./flaresolverr";
import { maybeSleep } from "../utils/concurrency";
import { hostIs } from "../utils/urlUtils";
import type { ProviderCollectionCard } from "./providerCollectionCard";
import {
  isCaptchaChallenge,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
  noteCaptchaChallenge,
} from "./makerworldCaptcha";

// Not behind Cloudflare. Private collections return 403 without the bearer token, so it's sent
// whenever available.
const COLLECTION_API_BASE = "https://makerworld.com/api/v1/design-service/favorites";
// The same service without Cloudflare in front, for what the Browse tab of the sync dialog shows.
const BAMBU_DESIGN_API_BASE = "https://api.bambulab.com/v1/design-service";
const COLLECTION_PAGE_SIZE = 20;
const COLLECTION_MAX_ENTRIES = 300;

export type MakerworldCollectionEntry = {
  designId: string;
  title: string;
  cover: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collectionHeaders(bearerToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json",
    Referer: "https://makerworld.com/",
  };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
}

// What a strict fetch returns for a collection MakerWorld says doesn't exist.
const NOT_FOUND = Symbol("not found");

class MakerworldCollectionFetchError extends Error {
  constructor(detail: string) {
    super(`Couldn't read the MakerWorld collection (${detail})`);
    this.name = "MakerworldCollectionFetchError";
  }
}

/** Retries once through FlareSolverr if Cloudflare ever appears. Shares the CAPTCHA cooldown and
 * `paceMs` convention with makerworldCloudApi.ts, since a large collection's pagination is its
 * own burst. A `strict` fetch answers NOT_FOUND only for a 404 or 410 and throws on any other
 * failure, so a sync never takes an outage for a deleted collection. */
async function fetchCollectionJson(url: string, bearerToken: string | null, paceMs?: number): Promise<unknown | null>;
async function fetchCollectionJson(
  url: string,
  bearerToken: string | null,
  paceMs: number | undefined,
  strict: true,
): Promise<unknown | typeof NOT_FOUND>;
async function fetchCollectionJson(
  url: string,
  bearerToken: string | null,
  paceMs?: number,
  strict = false,
): Promise<unknown | typeof NOT_FOUND | null> {
  const fail = (detail: string) => {
    if (strict) throw new MakerworldCollectionFetchError(detail);
    return null;
  };
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  await maybeSleep(paceMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    const res = await fetch(url, {
      headers: collectionHeaders(bearerToken),
      redirect: "follow",
      signal: controller.signal,
    });
    // Cloudflare's 403 isn't MakerWorld turning the login down, which would pause the user's syncs.
    if (res.status === 403 && looksLikeCloudflareBlock(res.headers)) {
      if (!(await isFlaresolverrEnabled())) throw new MakerworldCollectionFetchError("blocked by Cloudflare");
      const solved = await fetchViaFlaresolverr(url, bearerToken ? `token=${bearerToken}` : null);
      if (!solved) return fail("blocked by Cloudflare");
      const data = extractJsonFromBrowserBody(solved.body);
      if (data === null) return fail("unreadable answer");
      if (isCaptchaChallenge(data)) {
        noteCaptchaChallenge();
        throw new MakerworldCaptchaError();
      }
      return data;
    }
    if (res.status === 401 || res.status === 403) throw new MakerworldAuthError();
    if (strict && (res.status === 404 || res.status === 410)) return NOT_FOUND;
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.trim()) return fail("empty answer");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return fail("unreadable answer");
    }
    if (isCaptchaChallenge(data)) {
      noteCaptchaChallenge();
      throw new MakerworldCaptchaError();
    }
    return data;
  } catch (err) {
    if (
      err instanceof MakerworldCaptchaError ||
      err instanceof MakerworldAuthError ||
      err instanceof MakerworldCollectionFetchError
    ) {
      throw err;
    }
    return fail(err instanceof Error ? err.message : "network error");
  } finally {
    clearTimeout(timeout);
  }
}

export function parseMakerworldCollectionUrl(url: string): { collectionId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!hostIs(parsed.hostname, "makerworld.com")) return null;
  const match = parsed.pathname.match(/\/collections\/(\d+)/i);
  return match ? { collectionId: match[1] } : null;
}

export async function fetchMakerworldCollectionTitle(
  collectionId: string,
  bearerToken: string | null = null,
  paceMs?: number,
): Promise<string | null> {
  const data = await fetchCollectionJson(`${COLLECTION_API_BASE}/${collectionId}`, bearerToken, paceMs);
  if (!isRecord(data)) return null;
  return typeof data.title === "string" && data.title.trim() ? data.title.trim() : null;
}

/** For a sync: null when MakerWorld says the collection doesn't exist any more. Throws on anything
 * else that goes wrong, a CAPTCHA or a private collection included. */
export async function checkMakerworldCollection(
  collectionId: string,
  bearerToken: string | null,
  paceMs?: number,
): Promise<{ title: string | null } | null> {
  const data = await fetchCollectionJson(`${COLLECTION_API_BASE}/${collectionId}`, bearerToken, paceMs, true);
  if (data === NOT_FOUND) return null;
  if (!isRecord(data)) throw new MakerworldCollectionFetchError("unexpected answer");
  return { title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : null };
}

/** maxItems is a safety cap against a misreported `total`, not a UX limit. `paceMs` is awaited
 * before every page, including the first. */
export async function fetchMakerworldCollectionEntries(
  collectionId: string,
  bearerToken: string | null = null,
  maxItems: number = COLLECTION_MAX_ENTRIES,
  paceMs?: number,
): Promise<{ total: number; entries: MakerworldCollectionEntry[]; truncated: boolean }> {
  const entries: MakerworldCollectionEntry[] = [];
  let total = 0;
  let offset = 0;

  for (;;) {
    const url = `${COLLECTION_API_BASE}/${collectionId}/designs?seed=0&collectionId=${collectionId}&limit=${COLLECTION_PAGE_SIZE}&offset=${offset}`;
    const data = await fetchCollectionJson(url, bearerToken, paceMs);
    if (!isRecord(data) || !Array.isArray(data.hits) || !data.hits.length) break;
    if (typeof data.total === "number") total = data.total;

    for (const hit of data.hits) {
      if (!isRecord(hit) || hit.id == null) continue;
      entries.push({
        designId: String(hit.id),
        title: typeof hit.title === "string" && hit.title.trim() ? hit.title.trim() : `Design ${hit.id}`,
        cover: typeof hit.cover === "string" && hit.cover.trim() ? hit.cover.trim() : null,
      });
      if (entries.length >= maxItems) break;
    }

    offset += COLLECTION_PAGE_SIZE;
    if (entries.length >= maxItems || entries.length >= total) break;
  }

  return { total, entries, truncated: total > entries.length };
}

// How MakerWorld marks a private collection; public ones are 2.
const PRIVATE_STATUS = 1;

function collectionCard(value: unknown): ProviderCollectionCard | null {
  if (!isRecord(value) || value.id == null) return null;
  const id = String(value.id);
  const covers = Array.isArray(value.designCover) ? value.designCover : [];
  return {
    id,
    name: typeof value.title === "string" && value.title.trim() ? value.title.trim() : `Collection ${id}`,
    url: `https://makerworld.com/en/collections/${id}`,
    modelCount: typeof value.designCnt === "number" ? value.designCnt : 0,
    thumbnails: covers.filter((url): url is string => typeof url === "string" && url.trim() !== "").slice(0, 4),
    private: value.status === PRIVATE_STATUS,
    owner: isRecord(value.creator) && typeof value.creator.handle === "string" ? value.creator.handle : null,
  };
}

/** The signed-in user's own collections, private ones included. */
export async function listMakerworldOwnCollections(bearerToken: string): Promise<ProviderCollectionCard[]> {
  const data = await fetchCollectionJson(`${BAMBU_DESIGN_API_BASE}/my/favorites/listlite?query=`, bearerToken);
  if (!isRecord(data) || !Array.isArray(data.hits)) throw new MakerworldCollectionFetchError("unexpected answer");
  return data.hits.flatMap((hit) => {
    const card = collectionCard(hit);
    return card ? [card] : [];
  });
}

/** Null when MakerWorld says there's no such collection. A private one needs its owner's token. */
export async function fetchMakerworldCollectionCard(
  collectionId: string,
  bearerToken: string | null,
): Promise<ProviderCollectionCard | null> {
  const data = await fetchCollectionJson(
    `${BAMBU_DESIGN_API_BASE}/favorites/${collectionId}`,
    bearerToken,
    undefined,
    true,
  );
  if (data === NOT_FOUND) return null;
  return collectionCard(data);
}
