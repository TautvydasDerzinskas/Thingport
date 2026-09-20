import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../config";
import { extractJsonFromBrowserBody, fetchViaFlaresolverr, isFlaresolverrEnabled, looksLikeCloudflareBlock } from "./flaresolverr";
import { decodeHtmlEntities, htmlToPlainText, type ImportedAuthorInfo, type ImportedPageMetadata } from "./importResolvers";
import { maybeSleep, sleep } from "../utils/concurrency";
import {
  isCaptchaChallenge,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
  noteCaptchaChallenge,
} from "./makerworldCaptcha";

export { MAKERWORLD_CAPTCHA_MESSAGE, makerworldCaptchaCooloffActive, MakerworldAuthError, MakerworldCaptchaError } from "./makerworldCaptcha";

// MakerWorld's own website (makerworld.com) sits behind Cloudflare bot management and a
// separate Geetest CAPTCHA on its download-resolution endpoints. api.bambulab.com is the
// same Bambu Cloud backend the official apps (Bambu Studio, Bambu Handy) talk to -- same
// account, same bearer token -- but isn't behind either defense. Confirmed against live
// traffic; the same finding is independently documented by other reverse-engineering
// projects (kloshi-io/makerworld-api-reverse, maziggy/bambuddy, Pr0zak/YASTL).
const DESIGN_API_BASE = "https://api.bambulab.com/v1/design-service";
const PROFILE_DOWNLOAD_BASE = "https://api.bambulab.com/v1/iot-service/api/user/profile";
// This one lives on makerworld.com rather than api.bambulab.com (unlike the two above) -- but
// like the other makerworld.com /api/v1/* paths already used elsewhere (favorites/collections),
// it's a clean, unauthenticated, non-Cloudflare-gated JSON endpoint. Confirmed live.
const AUTHOR_PROFILE_BASE = "https://makerworld.com/api/v1/design-user-service/user/profile";
// Same host/service family as AUTHOR_PROFILE_BASE above, but the "who am I" variant -- requires
// a valid bearer and returns the *authenticated* account's own preferences, so unlike the public
// author-profile lookup this is exactly what a cookie test needs: it can only succeed for a
// currently-logged-in session, not merely a well-formed token.
const SELF_PREFERENCE_URL = "https://makerworld.com/api/v1/design-user-service/my/preference";
const CLOUD_API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const MAKERWORLD_PROVIDER = "makerworld";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloudApiHeaders(bearerToken: string): Record<string, string> {
  return {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    Authorization: `Bearer ${bearerToken}`,
    Referer: "https://makerworld.com/",
  };
}

// A single 418 is sometimes just a request-scoped flag that clears on the very next call,
// not yet the full IP-level block -- confirmed independently by maziggy/bambuddy (#2790),
// which retries once after a short backoff before treating a 418 as real. One retry costs
// little on the (rare) 418 path and can save an entire batch import from tripping the harder,
// hours-long cooloff (see CAPTCHA_COOLOFF_MS below) over what would have been a one-off blip.
const TRANSIENT_418_RETRY_DELAY_MS = 1500;

async function fetchCloudJson(
  url: string,
  bearerToken: string,
): Promise<{ status: number; data: unknown } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: cloudApiHeaders(bearerToken), redirect: "follow", signal: controller.signal });
      if (res.status === 418 && attempt === 0) {
        await sleep(TRANSIENT_418_RETRY_DELAY_MS);
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      if (text.trim()) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      return { status: res.status, data };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/** Users paste the raw browser `Cookie:` header into Settings (unchanged UX) -- this pulls
 * just the `token` value out of it to use as a Bearer credential against api.bambulab.com,
 * or accepts a bare pasted token directly (no `;`/`=`/whitespace) as a convenience. */
export function extractMakerworldBearerToken(rawCookieOrToken: string | null | undefined): string | null {
  const raw = (rawCookieOrToken || "").trim();
  if (!raw) return null;
  const match = raw.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) {
    const value = match[1].trim();
    if (value) return value;
  }
  if (!raw.includes(";") && !raw.includes("=") && !/\s/.test(raw)) {
    return raw;
  }
  return null;
}

/** Called before storing a cookie pasted into Profile > MakerWorld (see routes/settings.ts'
 * PATCH /settings/makerworld), so a stale/expired/mistyped paste is rejected up front instead of
 * only surfacing as a failed import later. A malformed paste (extractMakerworldBearerToken
 * finding no usable token at all) is rejected without a network call; otherwise this is the
 * same self-profile request api.bambulab.com/MakerWorld clients use right after login, so a 200
 * here means the account is genuinely logged in, not just that the string looks token-shaped. */
export async function verifyMakerworldCookie(rawCookieOrToken: string): Promise<boolean> {
  const bearerToken = extractMakerworldBearerToken(rawCookieOrToken);
  if (!bearerToken) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
  try {
    const res = await fetch(SELF_PREFERENCE_URL, {
      headers: {
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
        Referer: "https://makerworld.com/",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 403 && isFlaresolverrEnabled() && looksLikeCloudflareBlock(res.headers)) {
      // This endpoint answers 200 with an empty body through FlareSolverr's browser when the
      // session isn't actually logged in, so a bare status check would accept any string here.
      // Assert on the parsed body instead -- only a genuinely authenticated session has a `uid`.
      const solved = await fetchViaFlaresolverr(SELF_PREFERENCE_URL, `token=${bearerToken}`);
      if (!solved) return false;
      const data = extractJsonFromBrowserBody(solved.body);
      return isRecord(data) && data.uid != null;
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseMakerworldModelUrl(url: string): { designId: string; requestedInstanceId: string | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.toLowerCase().endsWith("makerworld.com")) return null;
  const designMatch = parsed.pathname.match(/\/models?\/(\d+)/i);
  if (!designMatch) return null;
  const hashMatch = parsed.hash.match(/profileid-(\d+)/i);
  return { designId: designMatch[1], requestedInstanceId: hashMatch ? hashMatch[1] : null };
}

export type MakerworldCloudResolution = {
  downloadUrl: string;
  meta: ImportedPageMetadata;
};

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Same defensive fallback used for the other makerworld.com /api/v1/* endpoints (collections):
 * not seen behind Cloudflare's challenge in practice, but retry once through FlareSolverr
 * rather than failing outright if that ever changes. No bearer token needed -- author profiles
 * are public. `paceMs`, when set (collection batch imports -- see resolveMakerworldViaCloudApi),
 * is awaited before the request so this call keeps the same pacing as every other one in the
 * sequence. */
async function fetchAuthorProfileJson(uid: string, paceMs?: number): Promise<unknown | null> {
  await maybeSleep(paceMs);
  const url = `${AUTHOR_PROFILE_BASE}/${uid}`;
  const headers: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json",
    Referer: "https://makerworld.com/",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    if (res.status === 403 && isFlaresolverrEnabled() && looksLikeCloudflareBlock(res.headers)) {
      const solved = await fetchViaFlaresolverr(url, null);
      if (!solved) return null;
      return extractJsonFromBrowserBody(solved.body);
    }
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches the richer author record (bio, links, background image) for a MakerWorld uid, for
 * the Author table. Best-effort: a failure here shouldn't fail the import, since `creator`
 * (plain string, from the design's own embedded designCreator summary) already covers the
 * simple display case. */
async function fetchMakerworldAuthorInfo(uid: string, paceMs?: number): Promise<ImportedAuthorInfo | null> {
  const data = await fetchAuthorProfileJson(uid, paceMs);
  if (!isRecord(data)) return null;
  const personal = isRecord(data.personal) ? data.personal : {};
  const links = Array.isArray(personal.links)
    ? personal.links.filter((link): link is string => typeof link === "string" && link.trim().length > 0)
    : [];
  return {
    provider: MAKERWORLD_PROVIDER,
    externalId: uid,
    name: pickString(data, ["name"]),
    handle: pickString(personal, ["handle"]) ?? pickString(data, ["handle"]),
    bio: pickString(personal, ["bio"]),
    bioTranslated: pickString(personal, ["bioTranslated"]),
    links,
    avatarUrl: pickString(data, ["avatar"]),
    backgroundUrl: pickString(personal, ["backgroundUrl"]),
  };
}

export type MakerworldGalleryImage = { url: string; filename: string };

/** The model page's photo gallery -- design.designExtension.design_pictures -- distinct from
 * coverUrl/coverPortrait/coverLandscape, which are just crops of the same single cover image
 * for different UI contexts. Confirmed live: a model can have several of these (renders and/or
 * isRealLifePhoto: 1 real-world photos of the print). */
function extractGalleryImages(design: Record<string, unknown>): MakerworldGalleryImage[] {
  const extension = design.designExtension;
  if (!isRecord(extension)) return [];
  const pictures = extension.design_pictures;
  if (!Array.isArray(pictures)) return [];
  const images: MakerworldGalleryImage[] = [];
  for (const picture of pictures) {
    if (!isRecord(picture)) continue;
    const url = typeof picture.url === "string" ? picture.url.trim() : "";
    if (!url) continue;
    const filename = typeof picture.name === "string" && picture.name.trim() ? picture.name.trim() : null;
    images.push({ url, filename: filename ?? url.split("/").pop() ?? "preview.jpg" });
  }
  return images;
}

/** design.categories -- a flat array of `{id, name, ...}` objects, most-specific first (e.g.
 * "Cosplay Weapons" then its parent "Props & Cosplays"). Used to auto-land the import into a
 * Category whose makerworldCatIds overlaps one of these (see importService.ts's
 * resolveCategoryIdByCategory); every id is kept, not just the first, so a category configured for
 * either the specific or the parent category still matches. */
function extractCategoryIds(design: Record<string, unknown>): number[] {
  const categories = design.categories;
  if (!Array.isArray(categories)) return [];
  const ids: number[] = [];
  for (const category of categories) {
    if (!isRecord(category)) continue;
    const id = category.id;
    if (typeof id === "number" && Number.isInteger(id)) ids.push(id);
    else if (typeof id === "string" && /^\d+$/.test(id)) ids.push(Number(id));
  }
  return ids;
}

/**
 * Resolves a MakerWorld design to a real, directly-downloadable (signed S3) URL entirely
 * through api.bambulab.com -- no Cloudflare, no cookie-gated web session, no HTML scraping.
 * Returns null for anything that should fall back to the existing page-scraping resolver
 * (missing/malformed data); throws MakerworldCaptchaError/MakerworldAuthError for the two
 * failure shapes worth telling the user about specifically.
 *
 * `paceMs`, when set, is awaited before *every* outbound request this makes (design fetch,
 * profile/download-link fetch, author-profile fetch) -- used by collection batch imports (see
 * importJobRunner.ts's runCollectionImportJob) to keep every single call in the whole sequence
 * evenly spaced, not just the gap between one model and the next. Left unset for single-model
 * imports, which have not been observed to need it.
 */
export async function resolveMakerworldViaCloudApi(
  designId: string,
  requestedInstanceId: string | null,
  bearerToken: string,
  paceMs?: number,
): Promise<MakerworldCloudResolution | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();

  await maybeSleep(paceMs);
  const designResult = await fetchCloudJson(`${DESIGN_API_BASE}/design/${designId}`, bearerToken);
  if (!designResult) return null;
  if (isCaptchaChallenge(designResult.data)) {
    noteCaptchaChallenge();
    throw new MakerworldCaptchaError();
  }
  if (designResult.status === 401 || designResult.status === 403) throw new MakerworldAuthError();
  if (designResult.status !== 200 || !isRecord(designResult.data)) return null;
  const design = designResult.data;

  const modelId = typeof design.modelId === "string" && design.modelId.trim() ? design.modelId.trim() : null;
  if (!modelId) return null;

  const instances = Array.isArray(design.instances) ? design.instances.filter(isRecord) : [];
  const defaultInstanceId = design.defaultInstanceId != null ? String(design.defaultInstanceId) : null;

  let selected: Record<string, unknown> | null = null;
  if (requestedInstanceId) {
    selected = instances.find((inst) => String(inst.id) === requestedInstanceId) ?? null;
  }
  if (!selected && defaultInstanceId) {
    selected = instances.find((inst) => String(inst.id) === defaultInstanceId) ?? null;
  }
  if (!selected) {
    selected = instances[0] ?? null;
  }
  if (!selected) return null;

  const profileId = selected.profileId != null ? String(selected.profileId) : null;
  if (!profileId) return null;

  await maybeSleep(paceMs);
  const downloadResult = await fetchCloudJson(
    `${PROFILE_DOWNLOAD_BASE}/${profileId}?model_id=${encodeURIComponent(modelId)}`,
    bearerToken,
  );
  if (!downloadResult) return null;
  if (isCaptchaChallenge(downloadResult.data)) {
    noteCaptchaChallenge();
    throw new MakerworldCaptchaError();
  }
  if (downloadResult.status === 401 || downloadResult.status === 403) throw new MakerworldAuthError();
  if (downloadResult.status !== 200 || !isRecord(downloadResult.data)) return null;
  const body = downloadResult.data;
  if (body.message !== "success" || typeof body.url !== "string" || !body.url.trim()) return null;

  const tags = Array.isArray(design.tags)
    ? design.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim())
    : [];
  const summary = typeof design.summary === "string" ? design.summary : null;
  const designCreator = isRecord(design.designCreator) ? design.designCreator : null;
  const creator = designCreator ? pickString(designCreator, ["nickName", "name", "handle"]) : null;
  const creatorUid = designCreator?.uid != null ? String(designCreator.uid) : null;
  const previewImageUrl = pickString(design, ["coverUrl", "coverPortrait", "coverLandscape"]);
  const title = pickString(design, ["title"]);
  const galleryImages = extractGalleryImages(design);
  const author = creatorUid ? await fetchMakerworldAuthorInfo(creatorUid, paceMs) : null;
  const siteCategoryIds = extractCategoryIds(design);

  return {
    downloadUrl: body.url,
    meta: {
      title: title ? decodeHtmlEntities(title) : null,
      tags,
      description: summary ? htmlToPlainText(summary) : null,
      creator: author?.name ?? creator,
      previewImageUrl,
      filename: pickString(body, ["filename"]),
      galleryImages,
      author,
      siteCategoryIds,
      categorySite: siteCategoryIds.length ? "makerworld" : null,
    },
  };
}
