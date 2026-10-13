import path from "node:path";
import * as cheerio from "cheerio";
import {
  IMPORT_ALLOWED_EXTS,
  IMPORT_BLOCKED_EXTS,
  IMPORT_BROWSER_USER_AGENT,
  IMPORT_EXT_PRIORITY,
  IMPORT_HTML_MAX_BYTES,
  IMPORT_TIMEOUT_SECONDS,
  IMPORT_USER_AGENT,
} from "../config";
import { isJsonContentType } from "../utils/fileUtils";
import { htmlToMarkdown } from "./descriptionMarkdown";
import { decodeHtmlEntities } from "../utils/htmlEntities";
import {
  isCaptchaChallenge,
  isDownloadLimitReply,
  MakerworldCaptchaError,
  MakerworldDownloadLimitError,
} from "./makerworldCaptcha";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

export type ImportCookies = {
  makerworld_cookie?: string | null;
};

function firstNonEmptyLine(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  let value = lines[0];
  for (const line of lines) {
    if (line.toLowerCase().startsWith("cookie:")) {
      value = line.slice("cookie:".length).trim();
      break;
    }
  }
  return value || null;
}

export function resolveMakerworldCookie(body: ImportCookies): string | null {
  const raw = (body.makerworld_cookie || "").trim();
  if (!raw) return null;
  return firstNonEmptyLine(raw);
}

export function makerworldHtmlHeaders(referer?: string | null, cookie?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
  };
  if (referer) headers.Referer = referer;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function makerworldApiHeaders(
  referer?: string | null,
  nonce?: string | null,
  cookie?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "X-BBL-Client-Type": "web",
    "X-BBL-Client-Version": "00.00.00.01",
    "X-BBL-App-Source": "makerworld",
    "X-BBL-Client-Name": "MakerWorld",
  };
  if (referer) headers.Referer = referer;
  if (nonce) headers["X-Nonce"] = nonce;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function rawFetchBuffer(
  url: string,
  headers: Record<string, string>,
  init?: { method?: string; body?: string },
): Promise<{ status: number; headers: Headers; buffer: Buffer; url: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    const res = await fetch(url, {
      method: init?.method || "GET",
      headers,
      body: init?.body,
      redirect: "follow",
      signal: controller.signal,
    });
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return { status: res.status, headers: res.headers, buffer, url: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET-only: FlareSolverr's POST submits a browser form, not a raw body. Returns the same shape
 * as rawFetchBuffer. */
async function proxiedBuffer(
  url: string,
  cookieHeader?: string | null,
): Promise<{ status: number; headers: Headers; buffer: Buffer; url: string } | null> {
  const solved = await fetchViaFlaresolverr(url, cookieHeader);
  if (!solved) return null;
  const json = extractJsonFromBrowserBody(solved.body);
  const bodyText = json !== null ? JSON.stringify(json) : solved.body;
  const contentType = json !== null ? "application/json" : "text/html; charset=utf-8";
  return {
    status: solved.status,
    headers: new Headers({ "content-type": contentType }),
    buffer: Buffer.from(bodyText, "utf-8"),
    url,
  };
}

async function fetchCappedBuffer(
  url: string,
  headers: Record<string, string>,
  init?: { method?: string; body?: string },
): Promise<{ status: number; headers: Headers; buffer: Buffer; url: string } | null> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  // fetchViaFlaresolverr returns null when it isn't configured, so no separate enabled check (a DB read).
  if (!isGet) {
    return rawFetchBuffer(url, headers, init);
  }

  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return rawFetchBuffer(url, headers, init);
  }

  if (shouldProxyHost(hostname)) {
    return (await proxiedBuffer(url, headers.Cookie)) || rawFetchBuffer(url, headers, init);
  }

  const result = await rawFetchBuffer(url, headers, init);
  if (result && result.status === 403 && looksLikeCloudflareBlock(result.headers)) {
    const proxied = await proxiedBuffer(url, headers.Cookie);
    if (proxied) return proxied;
  }
  return result;
}

async function fetchJsonFromUrl(
  url: string,
  referer?: string | null,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  const requestHeaders: Record<string, string> = { "User-Agent": IMPORT_USER_AGENT, Accept: "application/json" };
  if (referer) requestHeaders.Referer = referer;
  if (headers) Object.assign(requestHeaders, headers);
  const result = await fetchCappedBuffer(url, requestHeaders);
  if (!result) return null;
  if (result.buffer.length > IMPORT_HTML_MAX_BYTES) return null;
  const contentType = result.headers.get("content-type") || "";
  if (!isJsonContentType(contentType)) {
    const trimmed = result.buffer.toString("utf-8").trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  }
  try {
    return JSON.parse(result.buffer.toString("utf-8"));
  } catch {
    return null;
  }
}

function scoreDownloadUrl(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (lower.includes("download")) score += 6;
  if (lower.includes("files")) score += 2;
  IMPORT_EXT_PRIORITY.forEach((ext, idx) => {
    if (lower.includes(ext)) score += (IMPORT_EXT_PRIORITY.length - idx) * 10;
  });
  return score;
}

function isPotentialUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (/[<>{}"\\^`]/.test(value)) return false;
  return true;
}

function containsAllowedExt(url: string): boolean {
  const lower = url.toLowerCase();
  for (const ext of IMPORT_ALLOWED_EXTS) {
    const re = new RegExp(`${ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[?#&])`);
    if (re.test(lower)) return true;
  }
  return false;
}

function isAllowedDownloadCandidate(url: string): boolean {
  const lower = url.toLowerCase();
  let ext = "";
  try {
    ext = path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    ext = "";
  }
  if (ext) {
    if (IMPORT_ALLOWED_EXTS.has(ext)) return true;
    if (IMPORT_BLOCKED_EXTS.has(ext)) return false;
    if (lower.includes("download")) return true;
    return containsAllowedExt(lower);
  }
  if (containsAllowedExt(lower)) return true;
  return lower.includes("download");
}

/** Collects href/src/data-* link-ish attributes from every element in the page. */
function collectPageLinks(html: string): string[] {
  const links: string[] = [];
  const attrNames = ["href", "src", "data-download", "data-download-url", "data-url", "data-file", "data-href"];
  try {
    const $ = cheerio.load(html);
    $("*").each((_, el) => {
      const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs;
      if (!attribs) return;
      for (const name of attrNames) {
        const value = attribs[name];
        if (value) links.push(value);
      }
    });
  } catch {}
  return links;
}

export function findDownloadUrl(html: string, baseUrl: string): string | null {
  const links = collectPageLinks(html);
  const urlMatches = html.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  links.push(...urlMatches);

  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const rawLink of links) {
    const link = (rawLink || "").trim();
    if (!link || link.startsWith("#")) continue;
    if (/^javascript:/i.test(link) || /^mailto:/i.test(link)) continue;
    let absUrl: string;
    try {
      absUrl = new URL(link, baseUrl).toString();
    } catch {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(absUrl);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (seen.has(absUrl)) continue;
    seen.add(absUrl);
    if (isAllowedDownloadCandidate(absUrl)) candidates.push(absUrl);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => scoreDownloadUrl(b) - scoreDownloadUrl(a));
  return candidates[0];
}

function normalizeCandidateUrl(raw: string, baseUrl: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  if (!isPotentialUrl(value)) return null;
  let candidate = value;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return isAllowedDownloadCandidate(candidate) ? candidate : null;
  }
  if (candidate.startsWith("/") || candidate.includes("/")) {
    try {
      const abs = new URL(candidate, baseUrl).toString();
      return isAllowedDownloadCandidate(abs) ? abs : null;
    } catch {
      return null;
    }
  }
  return null;
}

function findDownloadUrlInJson(data: unknown, baseUrl: string): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = [data];
  while (stack.length) {
    const current = stack.pop();
    if (current && typeof current === "object" && !Array.isArray(current)) {
      stack.push(...Object.values(current as Record<string, unknown>));
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (typeof current === "string") {
      if (seen.has(current)) continue;
      seen.add(current);
      const url = normalizeCandidateUrl(current, baseUrl);
      if (url) candidates.push(url);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => scoreDownloadUrl(b) - scoreDownloadUrl(a));
  return candidates[0];
}

function extractDownloadUrlFromResponse(data: unknown, baseUrl: string): string | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const dict = data as Record<string, unknown>;
    for (const key of ["url", "downloadUrl", "download_url"]) {
      const value = dict[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    const inner = dict.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const innerDict = inner as Record<string, unknown>;
      for (const key of ["url", "downloadUrl", "download_url"]) {
        const value = innerDict[key];
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  return findDownloadUrlInJson(data, baseUrl);
}

export function extractNextDataJson(html: string): unknown | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const raw = (match[1] || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getPath(obj: unknown, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function makerworldDesignIdFromNextData(data: unknown): string | null {
  const designId = getPath(data, "props", "pageProps", "design", "id");
  return designId ? String(designId) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickDesignString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The design's photo gallery; the cover* fields are just crops of the single cover image. */
function makerworldGalleryImages(design: Record<string, unknown>): { url: string; filename: string }[] {
  const extension = design.designExtension;
  if (!isRecord(extension)) return [];
  const pictures = extension.design_pictures;
  if (!Array.isArray(pictures)) return [];
  const images: { url: string; filename: string }[] = [];
  for (const picture of pictures) {
    if (!isRecord(picture)) continue;
    const url = typeof picture.url === "string" ? picture.url.trim() : "";
    if (!url) continue;
    const filename = typeof picture.name === "string" && picture.name.trim() ? picture.name.trim() : null;
    images.push({ url, filename: filename ?? url.split("/").pop() ?? "preview.jpg" });
  }
  return images;
}

/** Most-specific first. All ids are kept so a category configured for a parent still matches. */
function makerworldCategoryIds(design: Record<string, unknown>): number[] {
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

/** Same shape from the design API, the page's __NEXT_DATA__, or the extension. Download-specific
 * fields are left to the caller. */
export function makerworldMetaFromDesign(design: unknown): ImportedPageMetadata {
  const meta = emptyImportedPageMetadata();
  if (!isRecord(design)) return meta;
  const title = pickDesignString(design, ["title"]);
  meta.title = title ? decodeHtmlEntities(title) : null;
  meta.tags = Array.isArray(design.tags)
    ? design.tags
        .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
        .map((tag) => tag.trim())
    : [];
  meta.description =
    typeof design.summary === "string" && design.summary.trim() ? htmlToMarkdown(design.summary) : null;
  const designCreator = isRecord(design.designCreator) ? design.designCreator : null;
  meta.creator = designCreator ? pickDesignString(designCreator, ["nickName", "name", "handle"]) : null;
  meta.author = makerworldAuthorFromDesignCreator(designCreator);
  meta.previewImageUrl = pickDesignString(design, ["coverUrl", "coverPortrait", "coverLandscape"]);
  meta.galleryImages = makerworldGalleryImages(design);
  meta.siteCategoryIds = makerworldCategoryIds(design);
  meta.categorySite = meta.siteCategoryIds.length ? "makerworld" : null;
  return meta;
}

/** Enough for a linked author with an avatar, without the Cloudflare-gated author-profile
 * endpoint. */
export function makerworldAuthorFromDesignCreator(creator: unknown): ImportedAuthorInfo | null {
  if (!creator || typeof creator !== "object") return null;
  const record = creator as Record<string, unknown>;
  if (record.uid == null || String(record.uid).trim() === "") return null;
  const pick = (keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  return {
    provider: "makerworld",
    externalId: String(record.uid).trim(),
    name: pick(["name", "nickName"]),
    handle: pick(["handle"]),
    bio: null,
    bioTranslated: null,
    links: [],
    avatarUrl: pick(["avatar", "avatarUrl", "headIcon"]),
    backgroundUrl: null,
  };
}

function genericTitleFromHtml(html: string): string | null {
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i);
  if (ogMatch && ogMatch[1].trim()) return decodeHtmlEntities(ogMatch[1].trim());
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1].trim()) return decodeHtmlEntities(titleMatch[1].trim());
  return null;
}

export type ImportedPageMetadata = {
  title: string | null;
  tags: string[];
  description: string | null;
  creator: string | null;
  previewImageUrl: string | null;
  /** A known-clean filename, when the resolver has one. */
  filename: string | null;
  /** Photo gallery, attached as supporting files; previewImageUrl is the cover. */
  galleryImages: { url: string; filename: string }[];
  /** Structured creator record; `creator` stays a plain display string. */
  author: ImportedAuthorInfo | null;
  /** The site's own category ids; each site has its own id namespace. */
  siteCategoryIds: number[];
  categorySite: "makerworld" | "thingiverse" | "printables" | null;
  /** Lets a second profile of an imported design be added as its own plate. MakerWorld only. */
  makerworldProfile?: MakerworldProfileRef;
};

export type MakerworldProfileRef = { instanceId: string | null };

export type ImportedAuthorInfo = {
  provider: string;
  externalId: string;
  name: string | null;
  handle: string | null;
  bio: string | null;
  bioTranslated: string | null;
  links: string[];
  avatarUrl: string | null;
  backgroundUrl: string | null;
  /** Came from the client: may create the author's record but never overwrites one. */
  unverified?: boolean;
};

export function emptyImportedPageMetadata(): ImportedPageMetadata {
  return {
    title: null,
    tags: [],
    description: null,
    creator: null,
    previewImageUrl: null,
    filename: null,
    galleryImages: [],
    author: null,
    siteCategoryIds: [],
    categorySite: null,
  };
}

/** Best-effort metadata for a landing page. Only MakerWorld has more than a title. */
export function extractPageMetadata(html: string, pageHost: string): ImportedPageMetadata {
  const meta = emptyImportedPageMetadata();
  if (pageHost.endsWith("makerworld.com")) {
    const fromDesign = makerworldMetaFromDesign(getPath(extractNextDataJson(html), "props", "pageProps", "design"));
    if (!fromDesign.title) fromDesign.title = genericTitleFromHtml(html);
    return fromDesign;
  }
  meta.title = genericTitleFromHtml(html);
  return meta;
}

/** The profile named in the URL hash (if the design has it), then the default (if the design still
 *  has it), then the first. MakerWorld can leave `defaultInstanceId` pointing at a deleted profile,
 *  whose download answers 403 "The client does not have access rights to the content." */
export function makerworldInstanceIdFromNextData(data: unknown, requestedInstanceId: string | null): string | null {
  const design = getPath(data, "props", "pageProps", "design") as Record<string, unknown> | undefined;
  if (!design) return null;
  if (requestedInstanceId && makerworldDesignHasInstance(design, requestedInstanceId)) return requestedInstanceId;
  const defaultInstance = design.defaultInstanceId;
  if (defaultInstance && makerworldDesignHasInstance(design, String(defaultInstance))) return String(defaultInstance);
  const instances = design.instances;
  if (Array.isArray(instances)) {
    for (const inst of instances) {
      if (inst && typeof inst === "object" && (inst as Record<string, unknown>).id) {
        return String((inst as Record<string, unknown>).id);
      }
    }
  }
  return null;
}

function makerworldDesignHasInstance(design: Record<string, unknown>, instanceId: string): boolean {
  const instances = design.instances;
  if (!Array.isArray(instances)) return false;
  return instances.some(
    (inst) => inst && typeof inst === "object" && String((inst as Record<string, unknown>).id) === instanceId,
  );
}

function makerworldNonceFromNextData(data: unknown): string | null {
  const nonce = getPath(data, "props", "pageProps", "x-nonce");
  return typeof nonce === "string" && nonce.trim() ? nonce : null;
}

function makerworldModelIdFromUrl(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/models\/(\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** A CAPTCHA reply (HTTP 418) or the daily download limit is thrown, not treated as "no URL": the
 *  fallbacks after it would only hit the same block and end in a misleading error. */
function makerworldDownloadUrlOrCaptcha(data: unknown, apiUrl: string): string | null {
  const url = data ? extractDownloadUrlFromResponse(data, apiUrl) : null;
  if (!url && isCaptchaChallenge(data)) throw new MakerworldCaptchaError();
  if (!url && isDownloadLimitReply(data)) throw new MakerworldDownloadLimitError();
  return url;
}

async function fetchMakerworldInstanceDownloadUrl(
  instanceId: string,
  pageUrl: string,
  cookie: string | null,
): Promise<string | null> {
  const apiUrl = `https://makerworld.com/api/v1/design-service/instance/${instanceId}/f3mf?type=download&fileType=3mfstl`;
  const data = await fetchJsonFromUrl(apiUrl, pageUrl, makerworldApiHeaders(pageUrl, null, cookie));
  return makerworldDownloadUrlOrCaptcha(data, apiUrl);
}

async function fetchMakerworldModelDownloadUrl(
  modelId: string,
  pageUrl: string,
  nonce: string | null,
  cookie: string | null,
): Promise<string | null> {
  const apiUrl = `https://makerworld.com/api/v1/models/${modelId}/download`;
  const data = await fetchJsonFromUrl(apiUrl, pageUrl, makerworldApiHeaders(pageUrl, nonce, cookie));
  return makerworldDownloadUrlOrCaptcha(data, apiUrl);
}

/** `requestedInstanceId` is passed separately because `pageUrl` never carries the hash. Every
 *  fallback past the instance-scoped endpoint is the default profile's file. */
export async function resolveMakerworldDownloadUrl(
  html: string,
  pageUrl: string,
  makerworldCookie: string | null,
  requestedInstanceId: string | null = null,
): Promise<{ downloadUrl: string; profile: MakerworldProfileRef } | null> {
  const nextData = extractNextDataJson(html);
  let designId: string | null = null;
  let nonce: string | null = null;
  let instanceId: string | null = null;
  let defaultInstanceId: string | null = null;
  const asDefault = (downloadUrl: string) => ({ downloadUrl, profile: { instanceId: defaultInstanceId } });
  if (nextData) {
    instanceId = makerworldInstanceIdFromNextData(nextData, requestedInstanceId);
    defaultInstanceId = makerworldInstanceIdFromNextData(nextData, null);
    // A generic URL in the page data belongs to the default profile.
    if (!requestedInstanceId || instanceId !== requestedInstanceId) {
      const url = findDownloadUrlInJson(nextData, pageUrl);
      if (url) return asDefault(url);
    }
    designId = makerworldDesignIdFromNextData(nextData);
    nonce = makerworldNonceFromNextData(nextData);
  }

  if (instanceId) {
    const url = await fetchMakerworldInstanceDownloadUrl(instanceId, pageUrl, makerworldCookie);
    if (url) return { downloadUrl: url, profile: { instanceId } };
  }

  const modelId = designId || makerworldModelIdFromUrl(pageUrl);
  if (!modelId) return null;
  const url = await fetchMakerworldModelDownloadUrl(modelId, pageUrl, nonce, makerworldCookie);
  if (url) return asDefault(url);

  const apiCandidates = [
    `https://makerworld.com/api/v1/models/${modelId}`,
    `https://makerworld.com/api/v1/models/${modelId}/files`,
    `https://makerworld.com/api/v1/model/${modelId}`,
    `https://makerworld.com/api/v1/model/${modelId}/files`,
  ];
  for (const apiUrl of apiCandidates) {
    const data = await fetchJsonFromUrl(apiUrl, pageUrl);
    if (!data) continue;
    const found = findDownloadUrlInJson(data, apiUrl);
    if (found) return asDefault(found);
  }
  return null;
}
