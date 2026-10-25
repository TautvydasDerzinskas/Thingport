// MakerWorld's model pages and download API, as a link import reads them (services/importService.ts).

import { IMPORT_BROWSER_USER_AGENT } from "../../config";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import {
  emptyImportedPageMetadata,
  extractDownloadUrlFromResponse,
  extractNextDataJson,
  fetchJsonFromUrl,
  findDownloadUrlInJson,
  firstNonEmptyLine,
  genericTitleFromHtml,
  getPath,
  type ImportCookies,
  type ImportedAuthorInfo,
  type ImportedPageMetadata,
  isRecord,
} from "../../services/importResolvers";
import { decodeHtmlEntities } from "../../utils/htmlEntities";
import manifest from "./manifest.generated";
import {
  isCaptchaChallenge,
  isDownloadLimitReply,
  MakerworldCaptchaError,
  MakerworldDownloadLimitError,
} from "./captcha";

const MAKERWORLD_API = manifest.endpoints.api;

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
    "X-BBL-App-Source": manifest.id,
    "X-BBL-Client-Name": manifest.name,
  };
  if (referer) headers.Referer = referer;
  if (nonce) headers["X-Nonce"] = nonce;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function makerworldDesignIdFromNextData(data: unknown): string | null {
  const designId = getPath(data, "props", "pageProps", "design", "id");
  return designId ? String(designId) : null;
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
  meta.categorySite = meta.siteCategoryIds.length ? manifest.id : null;
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
    provider: manifest.id,
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

/** `coverUrl`: the profile's own picture on MakerWorld, which becomes its plate's thumbnail. `titles`: every profile's
 *  name by id, which tells the design's profile files apart when they share a filename. */
export type MakerworldProfileRef = {
  instanceId: string | null;
  coverUrl?: string | null;
  titles?: Record<string, string>;
};

/** Every profile's name, by id. */
export function makerworldInstanceTitles(design: unknown): Record<string, string> {
  const instances = design && typeof design === "object" ? (design as Record<string, unknown>).instances : null;
  const titles: Record<string, string> = {};
  for (const inst of Array.isArray(instances) ? instances : []) {
    if (!inst || typeof inst !== "object") continue;
    const { id, title } = inst as Record<string, unknown>;
    if (id != null && typeof title === "string" && title.trim()) titles[String(id)] = title.trim();
  }
  return titles;
}

/** A profile's own picture: its `cover`, else the first of its `pictures`. */
export function makerworldInstanceCover(design: unknown, instanceId: string | null): string | null {
  if (!instanceId || !design || typeof design !== "object") return null;
  const instances = (design as Record<string, unknown>).instances;
  if (!Array.isArray(instances)) return null;
  const inst = instances.find(
    (candidate) =>
      candidate && typeof candidate === "object" && String((candidate as Record<string, unknown>).id) === instanceId,
  ) as Record<string, unknown> | undefined;
  if (!inst) return null;
  const firstPicture = Array.isArray(inst.pictures)
    ? (inst.pictures[0] as Record<string, unknown> | undefined)
    : undefined;
  for (const url of [inst.cover, firstPicture?.url]) {
    if (typeof url === "string" && /^https:\/\//i.test(url.trim())) return url.trim();
  }
  return null;
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
  const apiUrl = `${MAKERWORLD_API}/design-service/instance/${instanceId}/f3mf?type=download&fileType=3mfstl`;
  const data = await fetchJsonFromUrl(apiUrl, pageUrl, makerworldApiHeaders(pageUrl, null, cookie));
  return makerworldDownloadUrlOrCaptcha(data, apiUrl);
}

async function fetchMakerworldModelDownloadUrl(
  modelId: string,
  pageUrl: string,
  nonce: string | null,
  cookie: string | null,
): Promise<string | null> {
  const apiUrl = `${MAKERWORLD_API}/models/${modelId}/download`;
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
  let design: unknown = null;
  const asDefault = (downloadUrl: string) => ({
    downloadUrl,
    profile: {
      instanceId: defaultInstanceId,
      coverUrl: makerworldInstanceCover(design, defaultInstanceId),
      titles: makerworldInstanceTitles(design),
    },
  });
  if (nextData) {
    design = getPath(nextData, "props", "pageProps", "design");
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
    if (url) {
      const coverUrl = makerworldInstanceCover(design, instanceId);
      return { downloadUrl: url, profile: { instanceId, coverUrl, titles: makerworldInstanceTitles(design) } };
    }
  }

  const modelId = designId || makerworldModelIdFromUrl(pageUrl);
  if (!modelId) return null;
  const url = await fetchMakerworldModelDownloadUrl(modelId, pageUrl, nonce, makerworldCookie);
  if (url) return asDefault(url);

  const apiCandidates = [
    `${MAKERWORLD_API}/models/${modelId}`,
    `${MAKERWORLD_API}/models/${modelId}/files`,
    `${MAKERWORLD_API}/model/${modelId}`,
    `${MAKERWORLD_API}/model/${modelId}/files`,
  ];
  for (const apiUrl of apiCandidates) {
    const data = await fetchJsonFromUrl(apiUrl, pageUrl);
    if (!data) continue;
    const found = findDownloadUrlInJson(data, apiUrl);
    if (found) return asDefault(found);
  }
  return null;
}

/** A model page's metadata, from the design data it carries. */
export function makerworldPageMetadata(html: string): ImportedPageMetadata {
  const fromDesign = makerworldMetaFromDesign(getPath(extractNextDataJson(html), "props", "pageProps", "design"));
  if (!fromDesign.title) fromDesign.title = genericTitleFromHtml(html);
  return fromDesign;
}
