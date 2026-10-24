import path from "node:path";
import * as cheerio from "cheerio";
import {
  IMPORT_ALLOWED_EXTS,
  IMPORT_BLOCKED_EXTS,
  IMPORT_BROWSER_USER_AGENT,
  IMPORT_EXT_PRIORITY,
  IMPORT_HTML_MAX_BYTES,
  IMPORT_TIMEOUT_SECONDS,
} from "../config";
import { isJsonContentType } from "../utils/fileUtils";
import { type ProviderId } from "../providers/_generated";
import type { MakerworldProfileRef } from "../providers/makerworld/pageData";
import { decodeHtmlEntities } from "../utils/htmlEntities";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

export type ImportCookies = {
  makerworld_cookie?: string | null;
};

export function firstNonEmptyLine(raw: string): string | null {
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

export async function fetchJsonFromUrl(
  url: string,
  referer?: string | null,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  const requestHeaders: Record<string, string> = {
    "User-Agent": IMPORT_BROWSER_USER_AGENT,
    Accept: "application/json",
  };
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

export function findDownloadUrlInJson(data: unknown, baseUrl: string): string | null {
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

export function extractDownloadUrlFromResponse(data: unknown, baseUrl: string): string | null {
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

export function getPath(obj: unknown, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function genericTitleFromHtml(html: string): string | null {
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
  /** The site's own category ids; each site has its own id namespace. Thangs', which has no ids, are category paths. */
  siteCategoryIds: (number | string)[];
  categorySite: ProviderId | null;
  /** Lets a second profile of an imported design be added as its own plate. MakerWorld only. */
  makerworldProfile?: MakerworldProfileRef;
};

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

/** Best-effort metadata for a landing page: its title. MakerWorld's pages say more (makerworldPageMetadata). */
export function extractPageMetadata(html: string): ImportedPageMetadata {
  const meta = emptyImportedPageMetadata();
  meta.title = genericTitleFromHtml(html);
  return meta;
}
