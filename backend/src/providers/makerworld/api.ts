import { credentialRequest } from "../credentialRequest";
import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../../config";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
} from "../../services/flaresolverr";
import {
  type ImportedAuthorInfo,
  type ImportedPageMetadata,
  type ParametricSourceInfo,
} from "../../services/importResolvers";
import {
  makerworldAuthorFromDesignCreator,
  makerworldInstanceCover,
  makerworldInstanceTitles,
  makerworldMetaFromDesign,
} from "./pageData";
import { maybeSleep, sleep } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import {
  isCaptchaChallenge,
  isDownloadLimitReply,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
  MakerworldDownloadLimitError,
  noteCaptchaChallenge,
} from "./captcha";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import manifest from "./manifest.generated";
import { makerworldModelUrl, parseMakerworldModelUrl } from "./urls.generated";
export { parseMakerworldModelUrl };

export {
  MAKERWORLD_CAPTCHA_MESSAGE,
  makerworldCaptchaCooloffActive,
  MAKERWORLD_AUTH_CODE,
  MakerworldAuthError,
  MakerworldCaptchaError,
  MAKERWORLD_DOWNLOAD_LIMIT_CODE,
  MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE,
  MakerworldDownloadLimitError,
} from "./captcha";

// makerworld.com puts Cloudflare and a Geetest CAPTCHA in front of download resolution;
// api.bambulab.com is the same Bambu Cloud backend (same bearer token) without either.
const DESIGN_API_BASE = `${manifest.endpoints.cloudApi}/design-service`;
const PROFILE_DOWNLOAD_BASE = `${manifest.endpoints.cloudApi}/iot-service/api/user/profile`;
const AUTHOR_PROFILE_BASE = `${manifest.endpoints.api}/design-user-service/user/profile`;
// Only succeeds for a logged-in session, so it doubles as the cookie check.
const SELF_PREFERENCE_URL = `${manifest.endpoints.cloudApi}/design-user-service/my/preference`;
const CLOUD_API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const MAKERWORLD_PROVIDER = manifest.id;
const REFERER = `${manifest.site}/`;
const TOKEN_COOKIE = manifest.sessionCookies.token;
const TOKEN_PAIR = new RegExp(String.raw`(?:^|;\s*)${TOKEN_COOKIE}=([^;]+)`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloudApiHeaders(bearerToken: string): Record<string, string> {
  return {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    Authorization: `Bearer ${bearerToken}`,
    Referer: REFERER,
  };
}

// A single 418 is often a one-off flag rather than the IP-level block, so retry once before
// treating it as real and triggering the hours-long captcha cooloff.
const TRANSIENT_418_RETRY_DELAY_MS = 1500;

async function fetchCloudJson(url: string, bearerToken: string): Promise<{ status: number; data: unknown } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
    try {
      const res = await credentialRequest("makerworld-cloud", url, {
        headers: cloudApiHeaders(bearerToken),
        redirect: "follow",
        signal: controller.signal,
      });
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
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // A network failure, unlike a non-200 answer, is worth surfacing: falling back to page
      // scraping would only fail there too, with a less honest error.
      throw new HttpError(502, "Failed to reach the provider", undefined, true);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/** Pulls the `token` value out of a pasted `Cookie:` header, or accepts a bare token. */
export function extractMakerworldBearerToken(rawCookieOrToken: string | null | undefined): string | null {
  const raw = (rawCookieOrToken || "").trim().replace(/^Cookie:\s*/i, "");
  if (!raw) return null;
  const match = raw.match(TOKEN_PAIR);
  if (match) {
    const value = match[1].trim();
    if (value) return value;
  }
  if (!raw.includes(";") && !raw.includes("=") && !/\s/.test(raw)) {
    return raw;
  }
  return null;
}

/** "unverifiable" means the provider did not establish whether the cookie is valid. */
export type MakerworldCookieCheck =
  { result: "valid" } | { result: "invalid" } | { result: "unverifiable"; reason: "provider" | "network" };

export async function verifyMakerworldCookie(rawCookieOrToken: string): Promise<MakerworldCookieCheck> {
  const bearerToken = extractMakerworldBearerToken(rawCookieOrToken);
  if (!bearerToken) return { result: "invalid" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
  try {
    const res = await credentialRequest("makerworld-cloud", SELF_PREFERENCE_URL, {
      headers: {
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
        Referer: REFERER,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 401) return { result: "invalid" };
    if (!res.ok) return { result: "unverifiable", reason: "provider" };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { result: "unverifiable", reason: "provider" };
    }
    const uid = isRecord(data) ? data.uid : null;
    const hasUid =
      (typeof uid === "string" && uid.trim().length > 0) ||
      (typeof uid === "number" && Number.isFinite(uid) && uid > 0);
    return hasUid ? { result: "valid" } : { result: "unverifiable", reason: "provider" };
  } catch {
    return { result: "unverifiable", reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
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

async function fetchAuthorProfileJson(uid: string, paceMs?: number): Promise<unknown | null> {
  await maybeSleep(paceMs);
  const url = `${AUTHOR_PROFILE_BASE}/${uid}`;
  const headers: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json",
    Referer: REFERER,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUD_API_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
    if (res.status === 403 && looksLikeCloudflareBlock(res.headers)) {
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

/** `basic` enriched with the full author profile when it can be fetched (best-effort). */
export async function completeMakerworldAuthor(
  basic: ImportedAuthorInfo | null,
  paceMs?: number,
): Promise<ImportedAuthorInfo | null> {
  if (!basic || basic.provider !== MAKERWORLD_PROVIDER) return basic;
  const profile = await fetchMakerworldAuthorInfo(basic.externalId, paceMs);
  if (!profile) return basic;
  return {
    ...basic,
    name: profile.name ?? basic.name,
    handle: profile.handle ?? basic.handle,
    bio: profile.bio ?? basic.bio,
    bioTranslated: profile.bioTranslated ?? basic.bioTranslated,
    links: profile.links.length ? profile.links : basic.links,
    avatarUrl: profile.avatarUrl ?? basic.avatarUrl,
    backgroundUrl: profile.backgroundUrl ?? basic.backgroundUrl,
  };
}

export async function fetchMakerworldDesignAuthor(
  designId: string,
  bearerToken: string,
  paceMs?: number,
): Promise<ImportedAuthorInfo | null> {
  const design = await fetchMakerworldDesign(designId, bearerToken, paceMs);
  return design ? completeMakerworldAuthor(makerworldAuthorFromDesignCreator(design.designCreator), paceMs) : null;
}

/** Which print profiles ("instances") to import: the linked one (else the default), the
 * designer's own, or all including community uploads. */
export type MakerworldProfileScope = "url" | "designer" | "all";

function instanceIdOf(inst: Record<string, unknown>): string {
  return String(inst.id);
}

/** The primary profile comes first since it creates the model; the rest are added as files.
 * A profile is the designer's when `instanceCreator` matches `designCreator` -- `isOfficial`
 * and `isDefault` say nothing about who uploaded it. */
export function selectMakerworldProfiles(
  design: Record<string, unknown>,
  scope: MakerworldProfileScope,
  requestedInstanceId: string | null,
): string[] {
  const instances = Array.isArray(design.instances)
    ? design.instances.filter(isRecord).filter((inst) => inst.id != null)
    : [];
  const ids = instances.map(instanceIdOf);
  const defaultId = design.defaultInstanceId != null ? String(design.defaultInstanceId) : null;
  const primary =
    (requestedInstanceId && ids.includes(requestedInstanceId) ? requestedInstanceId : null) ??
    (defaultId && ids.includes(defaultId) ? defaultId : null) ??
    ids[0] ??
    null;
  if (!primary) return [];
  if (scope === "url") return [primary];

  const designerUid =
    isRecord(design.designCreator) && design.designCreator.uid != null ? String(design.designCreator.uid) : null;
  const wanted = instances
    .filter((inst) => {
      if (scope === "all") return true;
      const creator = isRecord(inst.instanceCreator) ? inst.instanceCreator : null;
      return designerUid !== null && creator?.uid != null && String(creator.uid) === designerUid;
    })
    .map(instanceIdOf);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

export async function fetchMakerworldDesign(
  designId: string,
  bearerToken: string,
  paceMs?: number,
): Promise<Record<string, unknown> | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  await maybeSleep(paceMs);
  const result = await fetchCloudJson(`${DESIGN_API_BASE}/design/${designId}`, bearerToken);
  if (!result) return null;
  if (isCaptchaChallenge(result.data)) {
    noteCaptchaChallenge();
    throw new MakerworldCaptchaError();
  }
  if (result.status === 401 || result.status === 403) throw new MakerworldAuthError();
  return result.status === 200 && isRecord(result.data) ? result.data : null;
}

/** A download request's JSON body, or null; a CAPTCHA, the daily limit and a rejected login are thrown. */
function downloadReplyBody(result: { status: number; data: unknown } | null): Record<string, unknown> | null {
  if (!result) return null;
  if (isCaptchaChallenge(result.data)) {
    noteCaptchaChallenge();
    throw new MakerworldCaptchaError();
  }
  if (isDownloadLimitReply(result.data)) throw new MakerworldDownloadLimitError();
  if (result.status === 401 || result.status === 403) throw new MakerworldAuthError();
  return result.status === 200 && isRecord(result.data) ? result.data : null;
}

/** The signed URL for everything the page's "Download STL/CAD files" offers, as one zip, and the name it gives it. */
async function fetchMakerworldRawFiles(
  designId: string,
  bearerToken: string,
  paceMs?: number,
): Promise<{ url: string; filename: string | null } | null> {
  await maybeSleep(paceMs);
  const body = downloadReplyBody(
    await fetchCloudJson(`${DESIGN_API_BASE}/design/${designId}/model?modelType=all&type=download`, bearerToken),
  );
  const url = body && pickString(body, ["url"]);
  return body && url ? { url, filename: pickString(body, ["name"]) } : null;
}

/**
 * The raw files of a design that does have print profiles, wanted only for the scripts it is generated from: its
 * own download is a profile's 3MF, which carries none of them.
 *
 * Best-effort on purpose. It spends one of the account's daily downloads and may meet the CAPTCHA or the daily
 * limit, and none of that is worth failing an import that already has the model's plates. Skipped during the
 * CAPTCHA cooloff, as a request into the block would only extend it for every other MakerWorld import.
 */
export async function resolveMakerworldSourcesUrl(
  designId: string,
  bearerToken: string,
  paceMs?: number,
): Promise<string | null> {
  if (makerworldCaptchaCooloffActive()) return null;
  try {
    return (await fetchMakerworldRawFiles(designId, bearerToken, paceMs))?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * The scripts a design is generated from, with the zip to fetch them from where the creator shared them.
 *
 * `known` is what the caller read off the design already, or null where what it holds has no file list to read it
 * from: the design is fetched for one then. Best-effort, as the zip is -- a design that can't be read leaves the
 * model's plates without a script rather than failing the import.
 */
export async function resolveMakerworldParametricSource(
  designId: string,
  known: ParametricSourceInfo | undefined | null,
  bearerToken: string,
  paceMs?: number,
): Promise<ParametricSourceInfo | undefined> {
  let source = known;
  if (source === null) {
    const design = await fetchMakerworldDesign(designId, bearerToken, paceMs).catch(() => null);
    source = design ? makerworldMetaFromDesign(design).parametricSource : undefined;
  }
  // Only worth a download when the creator shared them.
  if (!source || source.withheld) return source;
  return { ...source, zipUrl: await resolveMakerworldSourcesUrl(designId, bearerToken, paceMs) };
}

/** A design with no print profiles, only the raw files the page's "Download STL/CAD files" offers: all of them, as
 *  one zip, which the import unpacks. It belongs to no profile. */
async function resolveMakerworldRawFiles(
  designId: string,
  design: Record<string, unknown>,
  bearerToken: string,
  paceMs?: number,
): Promise<MakerworldCloudResolution | null> {
  const raw = await fetchMakerworldRawFiles(designId, bearerToken, paceMs);
  if (!raw) return null;
  const { url, filename } = raw;
  const meta = makerworldMetaFromDesign(design);
  const author = await completeMakerworldAuthor(meta.author, paceMs);
  return {
    downloadUrl: url,
    meta: {
      ...meta,
      creator: author?.name ?? meta.creator,
      filename,
      author,
      makerworldProfile: { instanceId: null },
    },
  };
}

/**
 * Resolves a design to a signed download URL via api.bambulab.com. Null means fall back to page
 * scraping. `paceMs` is awaited before every request so collection imports stay evenly spaced.
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
  // The profiles selectMakerworldProfiles counts, so a job that found none gets the raw files here too.
  const instances = Array.isArray(design.instances)
    ? design.instances.filter(isRecord).filter((inst) => inst.id != null)
    : [];
  if (!instances.length) return resolveMakerworldRawFiles(designId, design, bearerToken, paceMs);

  const modelId = typeof design.modelId === "string" && design.modelId.trim() ? design.modelId.trim() : null;
  if (!modelId) return null;

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
  const body = downloadReplyBody(
    await fetchCloudJson(`${PROFILE_DOWNLOAD_BASE}/${profileId}?model_id=${encodeURIComponent(modelId)}`, bearerToken),
  );
  if (!body || body.message !== "success" || typeof body.url !== "string" || !body.url.trim()) return null;

  const meta = makerworldMetaFromDesign(design);
  const author = await completeMakerworldAuthor(meta.author, paceMs);
  // What is downloaded here is one profile's 3MF, so the scripts the design is generated from need fetching of
  // their own.
  const parametricSource = await resolveMakerworldParametricSource(
    designId,
    meta.parametricSource,
    bearerToken,
    paceMs,
  );

  return {
    downloadUrl: body.url,
    meta: {
      ...meta,
      creator: author?.name ?? meta.creator,
      filename: pickString(body, ["filename"]),
      author,
      parametricSource,
      makerworldProfile: {
        instanceId: selected.id != null ? String(selected.id) : null,
        coverUrl: makerworldInstanceCover(design, selected.id != null ? String(selected.id) : null),
        titles: makerworldInstanceTitles(design),
      },
    },
  };
}

/** MakerWorld's trending models, from the same list its "Trending" tab shows. Public; no sign-in. */
export async function fetchMakerworldTrending(limit: number): Promise<TrendingModel[]> {
  const res = await fetch(
    `${manifest.endpoints.cloudApi}/search-service/select/design/nav?navKey=Trending&offset=0&limit=${limit}`,
    {
      headers: { Accept: "application/json", "User-Agent": IMPORT_BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(CLOUD_API_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`MakerWorld returned HTTP ${res.status}`);
  const data = asRecord(await res.json());
  return recordsOf(data?.hits).flatMap((hit) => {
    const id = asText(hit.id);
    if (!id || hit.nsfw === true) return [];
    return [
      {
        id,
        title: asText(hit.title) ?? id,
        url: makerworldModelUrl(id),
        image: webImage(hit.cover),
        likes: asCount(hit.likeCount),
        author: asText(asRecord(hit.designCreator)?.name),
        paid: false,
      },
    ];
  });
}
