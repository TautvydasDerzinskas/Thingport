import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import { extractJsonFromBrowserBody, fetchViaFlaresolverr, isFlaresolverrEnabled, looksLikeCloudflareBlock } from "./flaresolverr";
import { maybeSleep } from "../utils/concurrency";
import {
  isCaptchaChallenge,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
  noteCaptchaChallenge,
} from "./makerworldCaptcha";

// MakerWorld's own /api/v1/design-service/favorites/* endpoints back the collection page's
// "load more" pagination. Same host as the design/download endpoints we already call directly
// (see makerworldCloudApi.ts) and, like those, not behind Cloudflare's bot-management challenge
// even unauthenticated. Public collections work fine without a token, but a private one (e.g.
// a user's own default/unshared collection) answers with a clean application-level 403
// ("The client does not have access rights to the content.") unless the same bearer token
// used for design/download resolution is sent -- confirmed against a live private collection.
// So the token is sent whenever we have one, same as everywhere else MakerWorld is called.
const COLLECTION_API_BASE = "https://makerworld.com/api/v1/design-service/favorites";
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

/** Same defensive fallback used elsewhere for MakerWorld's /api/v1/* paths: they haven't been
 * seen behind Cloudflare's challenge in practice, but if that ever changes, retry once through
 * FlareSolverr rather than failing outright.
 *
 * This surface turned out to answer with the exact same CAPTCHA-challenge shape and 401/403
 * auth failures as the design/download-resolution endpoints in makerworldCloudApi.ts do -- and,
 * for a large collection, its own pagination is its own burst (a 300-entry collection is 15
 * unpaced page fetches before a single model import even starts). Both modules now share one
 * cooldown (makerworldCaptcha.ts) and the same `paceMs`-before-every-call convention, so a
 * challenge tripped while just listing a collection is caught immediately -- instead of being
 * swallowed as "no more results" -- and doesn't get re-tripped by the import job that follows. */
async function fetchCollectionJson(url: string, bearerToken: string | null, paceMs?: number): Promise<unknown | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  await maybeSleep(paceMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    const res = await fetch(url, { headers: collectionHeaders(bearerToken), redirect: "follow", signal: controller.signal });
    if (res.status === 403 && isFlaresolverrEnabled() && looksLikeCloudflareBlock(res.headers)) {
      const solved = await fetchViaFlaresolverr(url, bearerToken ? `token=${bearerToken}` : null);
      if (!solved) return null;
      const data = extractJsonFromBrowserBody(solved.body);
      if (data === null) return null;
      if (isCaptchaChallenge(data)) {
        noteCaptchaChallenge();
        throw new MakerworldCaptchaError();
      }
      return data;
    }
    if (res.status === 401 || res.status === 403) throw new MakerworldAuthError();
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
    if (isCaptchaChallenge(data)) {
      noteCaptchaChallenge();
      throw new MakerworldCaptchaError();
    }
    return data;
  } catch (err) {
    if (err instanceof MakerworldCaptchaError || err instanceof MakerworldAuthError) throw err;
    return null;
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
  if (!parsed.hostname.toLowerCase().endsWith("makerworld.com")) return null;
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

/** Pages through the collection's design list (20 at a time, matching the site's own page
 * size) until it runs out, hits `total`, or hits maxItems -- whichever comes first. maxItems
 * is a safety cap, not a UX limit: it exists so a pathological or misreported `total` can't
 * turn this into an unbounded loop against a live upstream.
 *
 * `paceMs`, when set, is awaited (via fetchCollectionJson) before *every* page fetch, including
 * the first -- callers that already made a preceding MakerWorld call (e.g. the title fetch just
 * above) get that gap for free instead of needing their own separate delay. */
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
