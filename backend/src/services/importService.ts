import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  IMPORT_ALLOWED_EXTS,
  IMPORT_HTML_MAX_BYTES,
  IMPORT_MAX_BYTES,
  IMPORT_PREVIEW_IMAGE_DELAY_MS,
  IMPORT_TIMEOUT_SECONDS,
  IMPORT_USER_AGENT,
} from "../config";
import {
  HttpError,
  buildImportFilename,
  guessMimeFromPath,
  isHtmlContentType,
  mimeFromContentType,
  sanitizeFilename,
} from "../utils/fileUtils";
import { validateRemoteUrl } from "../utils/urlUtils";
import { readCapped } from "../utils/readCapped";
import { maybeSleep, sleep } from "../utils/concurrency";
import { fetchViaFlaresolverr, isFlaresolverrEnabled, looksLikeCloudflareBlock, shouldProxyHost } from "./flaresolverr";
import {
  emptyImportedPageMetadata,
  extractNextDataJson,
  extractPageMetadata,
  findDownloadUrl,
  makerworldHtmlHeaders,
  makerworldMetaFromDesign,
  resolveMakerworldCookie,
  resolveMakerworldDownloadUrl,
  type ImportCookies,
  type ImportedAuthorInfo,
  type ImportedPageMetadata,
} from "./importResolvers";
import {
  extractMakerworldBearerToken,
  MakerworldAuthError,
  MakerworldCaptchaError,
  makerworldCaptchaCooloffActive,
  MAKERWORLD_DOWNLOAD_LIMIT_CODE,
  MakerworldDownloadLimitError,
  parseMakerworldModelUrl,
  resolveMakerworldViaCloudApi,
  completeMakerworldAuthor,
  fetchMakerworldDesign,
} from "./makerworldCloudApi";
import { openSourceGaps, type SourceGap } from "./sourceGaps";
import {
  parseThingiverseThingUrl,
  resolveThingiverseThing,
  ThingiverseAuthError,
  ThingiverseRateLimitError,
  type ThingiversePlateFile,
} from "./thingiverseApi";
import {
  parsePrintablesModelUrl,
  resolvePrintablesDownloadLinks,
  resolvePrintablesModel,
  type PrintablesPlateFile,
} from "./printablesApi";
import { getThingiverseAccessToken } from "./settingsService";
import { upsertAuthorFromImport } from "./authorService";
import {
  addPlatesToPrint,
  createPrint,
  resolvePlateFilePath,
  type NewPlateInput,
  type PrintMetaInput,
} from "./printCreation";
import { plateThumbReplaceable, saveThumbFromBytes } from "./printService";
import { addPreviewImage, removeGeneratedPreviewImages } from "./previewImageService";
import { localizeDescriptionImages } from "./descriptionImageService";
import { prisma } from "../db";
import { recordActivity } from "./activityService";
import { Prisma } from "@prisma/client";
import type { Author, Plate, PreviewImage, Print } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export type ImportRequestBody = ImportCookies & {
  url: string;
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  category_id?: string | null;
  filename?: string | null;
  /** Download URL the Thingport Grab extension already resolved in the page; skips server-side
   *  resolution. */
  resolved_download_url?: string | null;
  /** The MakerWorld profile resolved_download_url downloads, when known. */
  resolved_instance_id?: string | null;
  /** The page's MakerWorld design data, so the backend needn't fetch a Cloudflare-gated page.
   *  Client-supplied -- see makerworldMetaFromExtension. */
  makerworld_design?: Record<string, unknown> | null;
  /** Internal only: per-request delay for MakerWorld collection imports. Never from the body. */
  makerworldPaceMs?: number;
};

function parseCharset(contentType: string | null): string {
  if (!contentType) return "utf-8";
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim().replace(/["']/g, "") : "utf-8";
}

async function rawFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    return await fetch(url, { headers, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads `url` through FlareSolverr and wraps the rendered body as an HTML Response. */
async function proxiedResponse(url: string, cookieHeader?: string | null): Promise<Response | null> {
  const solved = await fetchViaFlaresolverr(url, cookieHeader);
  if (!solved) return null;
  return new Response(solved.body, {
    status: solved.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function fetchWithGuard(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {}

    let res: Response;
    if (isFlaresolverrEnabled() && shouldProxyHost(hostname)) {
      res = (await proxiedResponse(url, headers.Cookie)) || (await rawFetch(url, headers));
    } else {
      res = await rawFetch(url, headers);
      if (res.status === 403 && isFlaresolverrEnabled() && looksLikeCloudflareBlock(res.headers)) {
        const proxied = await proxiedResponse(url, headers.Cookie);
        if (proxied) res = proxied;
      }
    }

    if (!res.ok) {
      throw new HttpError(res.status || 400, `Failed to fetch URL: ${res.statusText || res.status}`);
    }
    return res;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Failed to reach the provided URL", undefined, true);
  }
}

export type OpenImportResult = { response: Response; finalUrl: string; meta: ImportedPageMetadata };

/** Fallback for fetchMakerworldDesign when there's no MakerWorld login. */
async function fetchMakerworldPageDesign(
  designId: string,
  cookie: string | null,
  paceMs?: number,
): Promise<Record<string, unknown> | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  const url = `https://makerworld.com/en/models/${designId}`;
  await maybeSleep(paceMs);
  let res: Response;
  try {
    res = await fetchWithGuard(url, {
      "User-Agent": IMPORT_USER_AGENT,
      Accept: "*/*",
      ...makerworldHtmlHeaders(url, cookie),
    });
  } catch {
    return null;
  }
  if (!isHtmlContentType(res.headers.get("content-type") || "")) return null;
  const { buffer } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
  const nextData = extractNextDataJson(buffer.toString("utf-8"));
  const design = (nextData as { props?: { pageProps?: { design?: unknown } } } | null)?.props?.pageProps?.design;
  return design && typeof design === "object" && !Array.isArray(design) ? (design as Record<string, unknown>) : null;
}

export async function fetchMakerworldDesignForImport(
  designId: string,
  cookie: string | null,
  paceMs?: number,
): Promise<Record<string, unknown> | null> {
  const bearer = extractMakerworldBearerToken(cookie);
  return bearer ? fetchMakerworldDesign(designId, bearer, paceMs) : fetchMakerworldPageDesign(designId, cookie, paceMs);
}

/** Fallback for fetchMakerworldDesignAuthor when there's no MakerWorld login. */
export async function fetchMakerworldPageAuthor(
  designId: string,
  cookie: string | null,
  paceMs?: number,
): Promise<ImportedAuthorInfo | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  const url = `https://makerworld.com/en/models/${designId}`;
  await maybeSleep(paceMs);
  let res: Response;
  try {
    res = await fetchWithGuard(url, {
      "User-Agent": IMPORT_USER_AGENT,
      Accept: "*/*",
      ...makerworldHtmlHeaders(url, cookie),
    });
  } catch {
    return null;
  }
  if (!isHtmlContentType(res.headers.get("content-type") || "")) return null;
  const { buffer } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
  return completeMakerworldAuthor(extractPageMetadata(buffer.toString("utf-8"), "makerworld.com").author, paceMs);
}

function isMakerworldCdnUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(".bblmw.com");
  } catch {
    return false;
  }
}

/** Metadata from the design the extension sent. It's client-supplied, so image fetches are
 * limited to MakerWorld's CDN and the author can't overwrite an existing record. */
async function makerworldMetaFromExtension(url: string, body: ImportRequestBody): Promise<ImportedPageMetadata | null> {
  const design = body.makerworld_design;
  const parsed = parseMakerworldModelUrl(url);
  if (!design || !parsed || design.id == null || String(design.id) !== parsed.designId) return null;
  const meta = makerworldMetaFromDesign(design);
  meta.previewImageUrl = isMakerworldCdnUrl(meta.previewImageUrl) ? meta.previewImageUrl : null;
  meta.galleryImages = meta.galleryImages.filter((image) => isMakerworldCdnUrl(image.url));
  const basicAuthor = meta.author && {
    ...meta.author,
    avatarUrl: isMakerworldCdnUrl(meta.author.avatarUrl) ? meta.author.avatarUrl : null,
    unverified: true,
  };
  const author = await completeMakerworldAuthor(basicAuthor, body.makerworldPaceMs);
  return {
    ...meta,
    author,
    creator: author?.name ?? meta.creator,
    makerworldProfile: { instanceId: body.resolved_instance_id ?? null },
  };
}

type MakerworldCloudShortcut = { downloadUrl: string; meta: ImportedPageMetadata };

/** Null means fall back to page scraping; auth and CAPTCHA failures are rethrown as HttpErrors. */
async function tryMakerworldCloudApi(url: string, body: ImportRequestBody): Promise<MakerworldCloudShortcut | null> {
  const parsed = parseMakerworldModelUrl(url);
  if (!parsed) return null;
  const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));
  if (!bearerToken) return null;

  try {
    const resolved = await resolveMakerworldViaCloudApi(
      parsed.designId,
      parsed.requestedInstanceId,
      bearerToken,
      body.makerworldPaceMs,
    );
    return resolved;
  } catch (err) {
    if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
    if (err instanceof MakerworldDownloadLimitError) {
      throw new HttpError(429, err.message, MAKERWORLD_DOWNLOAD_LIMIT_CODE);
    }
    // 400, not 401: the frontend treats any 401 as an expired Thingport session and logs out.
    if (err instanceof MakerworldAuthError) throw new HttpError(400, err.message);
    throw err;
  }
}

/**
 * Fetches `url`, following HTML landing pages recursively until it reaches the model file.
 * `inheritedMeta` carries the landing page's metadata down to the final file response.
 */
export async function openImportResponse(
  url: string,
  body: ImportRequestBody,
  referer?: string | null,
  depth = 0,
  inheritedMeta: ImportedPageMetadata = emptyImportedPageMetadata(),
): Promise<OpenImportResult> {
  if (depth > 3) throw new HttpError(400, "Too many redirects while resolving download link");
  const validatedUrl = await validateRemoteUrl(url);

  let host = "";
  try {
    host = (new URL(validatedUrl).hostname || "").toLowerCase();
  } catch {
    host = "";
  }

  // Only at depth 0, so a resolved download URL isn't treated as a model page on recursion.
  if (depth === 0 && host.endsWith("makerworld.com") && !body.resolved_download_url) {
    const cloudResolved = await tryMakerworldCloudApi(validatedUrl, body);
    if (cloudResolved) {
      return openImportResponse(cloudResolved.downloadUrl, body, validatedUrl, depth + 1, cloudResolved.meta);
    }
  }
  if (depth === 0 && host.endsWith("makerworld.com") && body.resolved_download_url) {
    const fromExtension = await makerworldMetaFromExtension(validatedUrl, body);
    if (fromExtension) {
      return openImportResponse(body.resolved_download_url, body, validatedUrl, depth + 1, fromExtension);
    }
  }

  const headers: Record<string, string> = { "User-Agent": IMPORT_USER_AGENT, Accept: "*/*" };
  let makerworldCookie: string | null = null;
  if (host.endsWith("makerworld.com")) {
    makerworldCookie = resolveMakerworldCookie(body);
    Object.assign(headers, makerworldHtmlHeaders(referer || validatedUrl, makerworldCookie));
  }
  if (referer) headers.Referer = referer;

  await maybeSleep(body.makerworldPaceMs);
  const res = await fetchWithGuard(validatedUrl, headers);
  const finalUrl = res.url || validatedUrl;
  await validateRemoteUrl(finalUrl);

  const contentType = res.headers.get("content-type") || "";
  if (isHtmlContentType(contentType)) {
    const { buffer, truncated } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
    const html = buffer.toString(parseCharset(contentType) as BufferEncoding);

    let downloadUrl: string | null = null;
    let pageHost = "";
    try {
      pageHost = (new URL(finalUrl).hostname || "").toLowerCase();
    } catch {
      pageHost = "";
    }
    const extracted = extractPageMetadata(html, pageHost);
    const resolvedMeta: ImportedPageMetadata = {
      title: extracted.title ?? inheritedMeta.title,
      tags: extracted.tags.length ? extracted.tags : inheritedMeta.tags,
      description: extracted.description ?? inheritedMeta.description,
      creator: extracted.creator ?? inheritedMeta.creator,
      previewImageUrl: extracted.previewImageUrl ?? inheritedMeta.previewImageUrl,
      filename: extracted.filename ?? inheritedMeta.filename,
      galleryImages: extracted.galleryImages.length ? extracted.galleryImages : inheritedMeta.galleryImages,
      author: extracted.author ?? inheritedMeta.author,
      siteCategoryIds: extracted.siteCategoryIds.length ? extracted.siteCategoryIds : inheritedMeta.siteCategoryIds,
      categorySite: extracted.categorySite ?? inheritedMeta.categorySite,
      makerworldProfile: inheritedMeta.makerworldProfile,
    };
    if (pageHost.endsWith("makerworld.com") && extracted.author) {
      resolvedMeta.author = await completeMakerworldAuthor(extracted.author, body.makerworldPaceMs);
    }
    if (pageHost.endsWith("makerworld.com")) {
      // Skipped for an extension-resolved URL: these calls can trip the CAPTCHA cooloff.
      if (body.resolved_download_url) {
        downloadUrl = body.resolved_download_url;
        resolvedMeta.makerworldProfile = { instanceId: body.resolved_instance_id ?? null };
      } else {
        if (!makerworldCookie) makerworldCookie = resolveMakerworldCookie(body);
        const requestedInstanceId = parseMakerworldModelUrl(validatedUrl)?.requestedInstanceId ?? null;
        let resolved: Awaited<ReturnType<typeof resolveMakerworldDownloadUrl>>;
        try {
          resolved = await resolveMakerworldDownloadUrl(html, finalUrl, makerworldCookie, requestedInstanceId);
        } catch (err) {
          if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
          if (err instanceof MakerworldDownloadLimitError) {
            throw new HttpError(429, err.message, MAKERWORLD_DOWNLOAD_LIMIT_CODE);
          }
          throw err;
        }
        if (resolved) {
          downloadUrl = resolved.downloadUrl;
          resolvedMeta.makerworldProfile = resolved.profile;
        }
      }
    }
    if (!downloadUrl) {
      downloadUrl = findDownloadUrl(html, finalUrl);
    }
    if (!downloadUrl) {
      if (truncated) {
        throw new HttpError(
          400,
          "No downloadable model file found in the scanned portion of the page. Use a direct download link or increase IMPORT_HTML_MAX_KB.",
        );
      }
      throw new HttpError(400, "No downloadable model file found. Use a direct download link.");
    }
    return openImportResponse(downloadUrl, body, finalUrl, depth + 1, resolvedMeta);
  }

  return { response: res, finalUrl, meta: inheritedMeta };
}

async function streamToFileCapped(response: Response, destPath: string, maxBytes: number): Promise<number> {
  if (!response.body) {
    await fs.writeFile(destPath, Buffer.alloc(0));
    return 0;
  }
  const reader = response.body.getReader();
  const handle = await fs.open(destPath, "w");
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "Imported file exceeds size limit");
      }
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  return total;
}

/** Downloads `url` to a temp file without creating a Print (used by inspect/zip-entries/zip-extract). */
export async function downloadImportToTemp(
  url: string,
  body: ImportRequestBody,
): Promise<{ tempPath: string; filename: string; mime: string; meta: ImportedPageMetadata }> {
  return saveImportResponseToTemp(await openImportResponse(url, body), body);
}

/** Split out so a caller can inspect the resolved metadata before downloading the body. */
async function saveImportResponseToTemp(
  { response, finalUrl, meta }: OpenImportResult,
  body: ImportRequestBody,
): Promise<{ tempPath: string; filename: string; mime: string; meta: ImportedPageMetadata }> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > IMPORT_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(413, "Imported file exceeds size limit");
  }
  const filename = buildImportFilename(finalUrl, response.headers, body.filename ?? meta.filename);
  const mime = mimeFromContentType(response.headers.get("content-type"), filename);
  const suffix = path.extname(filename) || "";
  const tempPath = path.join(os.tmpdir(), `thingport-import-${crypto.randomBytes(8).toString("hex")}${suffix}`);
  try {
    await streamToFileCapped(response, tempPath, IMPORT_MAX_BYTES);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
  return { tempPath, filename, mime, meta };
}

/** Inspects a link without downloading the file body: returns the filename/mime/is_zip/title it
 * would resolve to. */
export async function inspectImportLink(
  url: string,
  body: ImportRequestBody,
): Promise<{ filename: string; mime: string; is_zip: boolean; title: string | null }> {
  const { response, finalUrl, meta } = await openImportResponse(url, body);
  await response.body?.cancel().catch(() => undefined);
  const filename = buildImportFilename(finalUrl, response.headers, body.filename ?? meta.filename);
  const mime = mimeFromContentType(response.headers.get("content-type"), filename);
  const isZip = path.extname(filename).toLowerCase() === ".zip";
  return { filename, mime, is_zip: isZip, title: meta.title };
}

const PREVIEW_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_IMAGE_MAX_COUNT = 20;

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await rawFetch(url, { "User-Agent": IMPORT_USER_AGENT, Accept: "image/*" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > PREVIEW_IMAGE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > PREVIEW_IMAGE_MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}

/** Best-effort: stores the page's cover (at position 0) and gallery as preview images, and seeds
 * the plate thumbnail from the cover when nothing better exists. A 3D render the app made while
 * the import ran (the model is browsable from creation) gives way to them. Never throws. */
export async function attachImportedPreviewImages(
  printId: string | undefined,
  plateId: string | undefined,
  coverImageUrl: string | null | undefined,
  galleryImages: { url: string; filename: string }[],
  paceMs?: number,
): Promise<void> {
  if (!printId) return;
  const seen = new Set<string>();
  const orderedUrls: string[] = [];
  if (coverImageUrl) {
    orderedUrls.push(coverImageUrl);
    seen.add(coverImageUrl);
  }
  for (const image of galleryImages) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    orderedUrls.push(image.url);
  }

  let firstAdded = false;
  const urls = orderedUrls.slice(0, PREVIEW_IMAGE_MAX_COUNT);
  const delayMs = paceMs ?? IMPORT_PREVIEW_IMAGE_DELAY_MS;
  for (let i = 0; i < urls.length; i++) {
    await sleep(delayMs);
    const buf = await fetchImageBytes(urls[i]);
    if (!buf) continue;
    const added = await addPreviewImage(printId, buf);
    if (added && !firstAdded) {
      firstAdded = true;
      await removeGeneratedPreviewImages(printId);
      if (plateId && (await plateThumbReplaceable(plateId))) await saveThumbFromBytes(plateId, buf);
    }
  }
}

const CATEGORY_SITE_CAT_IDS_FIELD = {
  makerworld: "makerworldCatIds",
  thingiverse: "thingiverseCatIds",
  printables: "printablesCatIds",
} as const;

/** Auto-categorizes an import when a category's `*CatIds` for this site overlap the model's own
 * category ids. Best-effort. */
export async function resolveCategoryIdByCategory(
  userId: string,
  categorySite: ImportedPageMetadata["categorySite"],
  siteCategoryIds: number[],
): Promise<string | null> {
  if (!categorySite || !siteCategoryIds.length) return null;
  const field = CATEGORY_SITE_CAT_IDS_FIELD[categorySite];
  const category = await prisma.category.findFirst({
    // Folders are the user's own tree; only categories take imports by site category id.
    where: { userId, kind: "category", [field]: { hasSome: siteCategoryIds } },
    orderBy: { position: "asc" },
  });
  return category?.id ?? null;
}

/** Provider + stable external id for a model URL, used to dedupe imports. Null if unknown. */
export function identifySourceModel(url: string): { provider: string; externalId: string } | null {
  const makerworld = parseMakerworldModelUrl(url);
  if (makerworld) return { provider: "makerworld", externalId: makerworld.designId };
  const thingiverse = parseThingiverseThingUrl(url);
  if (thingiverse) return { provider: "thingiverse", externalId: thingiverse.thingId };
  const printables = parsePrintablesModelUrl(url);
  if (printables) return { provider: "printables", externalId: printables.modelId };
  return null;
}

/** `state` refines already_imported for a MakerWorld URL naming a profile: "profile_missing"
 *  when every plate is a different profile, "profile_unknown" when some plates predate profile
 *  tracking. already_imported stays for older extension versions. `gaps` is what "Fetch
 *  missing details" could fill on the library's model. */
export type ImportStatus = {
  recognized: boolean;
  already_imported: boolean;
  print_id: string | null;
  state: "not_imported" | "imported" | "profile_missing" | "profile_unknown";
  gaps: SourceGap[];
};

/** Never fetches the provider's page, so it's cheap enough for the extension to call on every
 * page load. */
export async function checkImportStatus(userId: string, url: string): Promise<ImportStatus> {
  const source = identifySourceModel(url);
  if (!source) return { recognized: false, already_imported: false, print_id: null, state: "not_imported", gaps: [] };
  const print = await prisma.print.findFirst({
    where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
    include: { plates: { select: { sourceInstanceId: true } }, previewImages: { select: { generated: true } } },
  });
  if (!print) return { recognized: true, already_imported: false, print_id: null, state: "not_imported", gaps: [] };
  const gaps = openSourceGaps(print, print.previewImages);
  // Without a profile in the URL, any imported profile counts; asking MakerWorld on every page
  // view isn't worth it.
  const requestedInstanceId =
    source.provider === "makerworld" ? parseMakerworldModelUrl(url)?.requestedInstanceId : null;
  if (requestedInstanceId && !print.plates.some((plate) => plate.sourceInstanceId === requestedInstanceId)) {
    const state = print.plates.some((plate) => plate.sourceInstanceId == null) ? "profile_unknown" : "profile_missing";
    return { recognized: true, already_imported: false, print_id: print.id, state, gaps };
  }
  return { recognized: true, already_imported: true, print_id: print.id, state: "imported", gaps };
}

/** Inverse of identifySourceModel, for the "Open in {Provider}" link. */
export function buildImportSourceUrl(provider: string | null, externalId: string | null): string | null {
  if (!provider || !externalId) return null;
  if (provider === "makerworld") return `https://makerworld.com/en/models/${externalId}`;
  if (provider === "thingiverse") return `https://www.thingiverse.com/thing:${externalId}`;
  if (provider === "printables") return `https://www.printables.com/model/${externalId}`;
  return null;
}

async function findExistingImportedPrint(
  userId: string,
  source: { provider: string; externalId: string },
): Promise<{ print: Print; plates: Plate[]; author: Author | null; previewImages: PreviewImage[] } | null> {
  const print = await prisma.print.findFirst({
    where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
    include: { author: true },
  });
  if (!print) return null;
  const [plates, previewImages] = await Promise.all([
    prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } }),
    prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } }),
  ]);
  return { print, plates, author: print.author, previewImages };
}

type ExistingImportedPrint = NonNullable<Awaited<ReturnType<typeof findExistingImportedPrint>>>;

export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fsSync.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function plateContentSha256(plate: Plate): Promise<string | null> {
  if (plate.contentSha256) return plate.contentSha256;
  const filePath = resolvePlateFilePath(plate);
  if (!filePath || !fsSync.existsSync(filePath)) return null;
  const sha = await sha256OfFile(filePath);
  await prisma.plate.update({ where: { id: plate.id }, data: { contentSha256: sha } });
  return sha;
}

/** Re-import of a MakerWorld design: each profile's 3MF has its own settings, so a new profile is
 * added as another plate. Untagged plates are compared by SHA-256 first so a match is tagged
 * instead of duplicated. */
async function addMakerworldProfileToPrint(
  existing: ExistingImportedPrint,
  url: string,
  body: ImportRequestBody,
): Promise<ExistingImportedPrint & { alreadyImported: boolean; profileAdded?: boolean }> {
  const alreadyImported = { ...existing, alreadyImported: true };
  const hasProfile = (instanceId: string) => existing.plates.some((plate) => plate.sourceInstanceId === instanceId);

  // Checked before any MakerWorld request: resolving the default profile would cost one
  // CAPTCHA-prone lookup per design on a collection re-import.
  const wanted = body.resolved_instance_id ?? parseMakerworldModelUrl(url)?.requestedInstanceId ?? null;
  if (!wanted || hasProfile(wanted)) return alreadyImported;

  // Fetch the extension-resolved download as is: another page request per profile risks the CAPTCHA.
  const presolved = Boolean(body.resolved_download_url && body.resolved_instance_id);
  const opened = presolved
    ? await openImportResponse(body.resolved_download_url!, { ...body, resolved_download_url: null }, url)
    : await openImportResponse(url, body);
  const instanceId = presolved ? body.resolved_instance_id! : (opened.meta.makerworldProfile?.instanceId ?? null);
  // Unknown profile, or the resolver fell back to one already on the print.
  if (!instanceId || hasProfile(instanceId)) {
    await opened.response.body?.cancel().catch(() => undefined);
    return alreadyImported;
  }

  const { tempPath, filename, mime } = await saveImportResponseToTemp(opened, body);
  try {
    const untagged = existing.plates.filter((plate) => plate.sourceInstanceId == null);
    if (untagged.length) {
      const downloadedSha = await sha256OfFile(tempPath);
      for (const plate of untagged) {
        if ((await plateContentSha256(plate)) !== downloadedSha) continue;
        try {
          await prisma.plate.update({ where: { id: plate.id }, data: { sourceInstanceId: instanceId } });
        } catch (err) {
          // Race guard: a concurrent import of this same profile won.
          if (!isUniqueConstraintError(err)) throw err;
        }
        return { ...alreadyImported, plates: await platesOf(existing.print.id) };
      }
    }

    try {
      await addPlatesToPrint(existing.print.userId, existing.print.id, [
        { filename, mime, tempFilePath: tempPath, sourceInstanceId: instanceId },
      ]);
    } catch (err) {
      // Race guard: a concurrent import of this same profile won.
      if (isUniqueConstraintError(err)) return alreadyImported;
      throw err;
    }
    return { ...existing, plates: await platesOf(existing.print.id), alreadyImported: false, profileAdded: true };
  } finally {
    if (fsSync.existsSync(tempPath)) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function platesOf(printId: string): Promise<Plate[]> {
  return prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
}

/** Bulk version of the dedup lookup, for flagging already-imported entries in a listing. */
export async function findImportedExternalIds(
  userId: string,
  provider: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (!externalIds.length) return new Set();
  const prints = await prisma.print.findMany({
    where: { userId, sourceProvider: provider, sourceExternalId: { in: externalIds } },
    select: { sourceExternalId: true },
  });
  return new Set(prints.map((p) => p.sourceExternalId).filter((id): id is string => id !== null));
}

export const MULTI_FILE_PLATE_EXTS = new Set([...IMPORT_ALLOWED_EXTS].filter((ext) => ext !== ".zip"));

export type PlainDownloadResult = { input: NewPlateInput } | { rateLimited: true } | null;

/** Best-effort: null on failure so one bad file doesn't fail the whole import, except a 429,
 * which is reported so the caller can say why. */
export async function downloadPlainFileToTemp(url: string, suggestedName: string): Promise<PlainDownloadResult> {
  try {
    const res = await rawFetch(url, { "User-Agent": IMPORT_USER_AGENT, Accept: "*/*" });
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      return { rateLimited: true };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const filename = sanitizeFilename(suggestedName);
    const tempFilePath = path.join(
      os.tmpdir(),
      `thingport-thingiverse-${crypto.randomBytes(8).toString("hex")}${path.extname(filename)}`,
    );
    await streamToFileCapped(res, tempFilePath, IMPORT_MAX_BYTES);
    return { input: { filename, mime: guessMimeFromPath(filename), tempFilePath } };
  } catch {
    return null;
  }
}

/** Every model file bundled with the Thing becomes its own Plate on one Print. */
async function importThingiverseThing(
  userId: string,
  source: { provider: string; externalId: string },
  body: ImportRequestBody,
): Promise<{
  print: Print;
  plates: Plate[];
  author: Author | null;
  previewImages: PreviewImage[];
  alreadyImported: boolean;
}> {
  const accessToken = await getThingiverseAccessToken();
  if (!accessToken) {
    throw new HttpError(
      503,
      "Thingiverse import isn't configured for this instance yet -- ask an admin to add an Access Token in Admin Settings.",
    );
  }

  let resolved;
  try {
    resolved = await resolveThingiverseThing(source.externalId, accessToken);
  } catch (err) {
    if (err instanceof ThingiverseRateLimitError) throw new HttpError(429, err.message);
    // 400, not 401: see tryMakerworldCloudApi.
    if (err instanceof ThingiverseAuthError) throw new HttpError(400, err.message);
    throw err;
  }
  if (!resolved) {
    throw new HttpError(
      404,
      "This Thingiverse Thing could not be found, or isn't accessible with the configured Access Token.",
    );
  }
  const { meta, plateFiles, galleryImages } = resolved;

  const author = await upsertAuthorFromImport(meta.author ?? null);
  const categoryId =
    body.category_id ??
    (await resolveCategoryIdByCategory(userId, meta.categorySite ?? null, meta.siteCategoryIds ?? []));
  const printMeta: PrintMetaInput = {
    title: body.title ?? meta.title ?? null,
    notes: body.notes ?? meta.description ?? null,
    tags: body.tags && body.tags.length ? body.tags : (meta.tags ?? []),
    categoryId,
    categorySource: body.category_id ? "MANUAL" : categoryId ? "RULE" : null,
    creator: meta.creator ?? null,
    authorId: author?.id ?? null,
    sourceProvider: source.provider,
    sourceExternalId: source.externalId,
  };

  const modelFiles = plateFiles.filter((f: ThingiversePlateFile) =>
    MULTI_FILE_PLATE_EXTS.has(path.extname(f.name).toLowerCase()),
  );
  const downloadResults = await Promise.all(
    modelFiles.map((f: ThingiversePlateFile) => downloadPlainFileToTemp(f.url, f.name)),
  );
  const downloaded = downloadResults
    .filter((result): result is { input: NewPlateInput } => result !== null && "input" in result)
    .map((result) => result.input);
  if (!downloaded.length) {
    const wasRateLimited = downloadResults.some((result) => result !== null && "rateLimited" in result);
    if (wasRateLimited) {
      throw new HttpError(
        429,
        "Thingiverse blocked a file download with a rate-limit challenge (Cloudflare). This usually clears after a while -- wait, then retry the same import.",
      );
    }
    throw new HttpError(400, "None of this Thing's files could be downloaded.");
  }

  try {
    let result: { print: Print; plates: Plate[] };
    try {
      result = await createPrint(userId, printMeta, meta.title || `thing-${source.externalId}`, downloaded);
    } catch (err) {
      // Race guard: a concurrent import of the same source model won.
      if (isUniqueConstraintError(err)) {
        const existing = await findExistingImportedPrint(userId, source);
        if (existing) return { ...existing, alreadyImported: true };
      }
      throw err;
    }
    const gallery = galleryImages.map((img) => ({ url: img.url, filename: img.name }));
    await attachImportedPreviewImages(result.print.id, result.plates[0]?.id, meta.previewImageUrl ?? null, gallery);
    await localizeDescriptionImages(result.print.id);
    const previewImages = await prisma.previewImage.findMany({
      where: { printId: result.print.id },
      orderBy: { position: "asc" },
    });
    return { ...result, author, previewImages, alreadyImported: false };
  } finally {
    for (const input of downloaded) {
      if (input.tempFilePath && fsSync.existsSync(input.tempFilePath)) {
        await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
      }
    }
  }
}

async function importPrintablesModel(
  userId: string,
  source: { provider: string; externalId: string },
  body: ImportRequestBody,
): Promise<{
  print: Print;
  plates: Plate[];
  author: Author | null;
  previewImages: PreviewImage[];
  alreadyImported: boolean;
}> {
  const resolved = await resolvePrintablesModel(source.externalId);
  if (!resolved) {
    throw new HttpError(404, "This Printables model could not be found, or isn't public.");
  }
  const { meta, plateFiles, galleryImages } = resolved;

  const modelFiles = plateFiles.filter((f: PrintablesPlateFile) =>
    MULTI_FILE_PLATE_EXTS.has(path.extname(f.name).toLowerCase()),
  );
  if (!modelFiles.length) {
    throw new HttpError(
      400,
      "This Printables model has no downloadable model files (only sliced/print-ready files, if any).",
    );
  }
  const downloadLinks = await resolvePrintablesDownloadLinks(
    source.externalId,
    modelFiles.map((f) => f.id),
  );
  const downloadResults = await Promise.all(
    modelFiles
      .map((f) => ({ file: f, link: downloadLinks.get(f.id) }))
      .filter((entry): entry is { file: PrintablesPlateFile; link: string } => Boolean(entry.link))
      .map((entry) => downloadPlainFileToTemp(entry.link, entry.file.name)),
  );
  const downloaded = downloadResults
    .filter((result): result is { input: NewPlateInput } => result !== null && "input" in result)
    .map((result) => result.input);
  if (!downloaded.length) {
    throw new HttpError(400, "None of this model's files could be downloaded.");
  }

  const author = await upsertAuthorFromImport(meta.author ?? null);
  const categoryId =
    body.category_id ??
    (await resolveCategoryIdByCategory(userId, meta.categorySite ?? null, meta.siteCategoryIds ?? []));
  const printMeta: PrintMetaInput = {
    title: body.title ?? meta.title ?? null,
    notes: body.notes ?? meta.description ?? null,
    tags: body.tags && body.tags.length ? body.tags : (meta.tags ?? []),
    categoryId,
    categorySource: body.category_id ? "MANUAL" : categoryId ? "RULE" : null,
    creator: meta.creator ?? null,
    authorId: author?.id ?? null,
    sourceProvider: source.provider,
    sourceExternalId: source.externalId,
  };

  try {
    let result: { print: Print; plates: Plate[] };
    try {
      result = await createPrint(userId, printMeta, meta.title || `printables-${source.externalId}`, downloaded);
    } catch (err) {
      // Race guard: a concurrent import of the same source model won.
      if (isUniqueConstraintError(err)) {
        const existing = await findExistingImportedPrint(userId, source);
        if (existing) return { ...existing, alreadyImported: true };
      }
      throw err;
    }
    const gallery = galleryImages.map((img) => ({ url: img.url, filename: img.name }));
    await attachImportedPreviewImages(result.print.id, result.plates[0]?.id, meta.previewImageUrl ?? null, gallery);
    await localizeDescriptionImages(result.print.id);
    const previewImages = await prisma.previewImage.findMany({
      where: { printId: result.print.id },
      orderBy: { position: "asc" },
    });
    return { ...result, author, previewImages, alreadyImported: false };
  } finally {
    for (const input of downloaded) {
      if (input.tempFilePath && fsSync.existsSync(input.tempFilePath)) {
        await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
      }
    }
  }
}

type ImportResult = {
  print: Print;
  plates: Plate[];
  author: Author | null;
  previewImages: PreviewImage[];
  alreadyImported: boolean;
  /** Set when an existing MakerWorld print gained another profile's file. */
  profileAdded?: boolean;
};

/** Returns the existing print with `alreadyImported: true` instead of re-downloading a model
 * this user already imported. Every import path comes through here, so each new model is recorded
 * as one activity, whether it came alone or in a job. */
export async function importPrintFromUrl(userId: string, url: string, body: ImportRequestBody): Promise<ImportResult> {
  const result = await importNewOrExisting(userId, url, body);
  if (!result.alreadyImported && !result.profileAdded)
    void recordActivity(userId, "import", result.print.id, result.print.name);
  return result;
}

async function importNewOrExisting(userId: string, url: string, body: ImportRequestBody): Promise<ImportResult> {
  const source = identifySourceModel(url);
  if (source) {
    const existing = await findExistingImportedPrint(userId, source);
    if (existing && source.provider === "makerworld") return addMakerworldProfileToPrint(existing, url, body);
    if (existing) return { ...existing, alreadyImported: true };
  }

  if (source?.provider === "thingiverse") {
    return importThingiverseThing(userId, source, body);
  }
  if (source?.provider === "printables") {
    return importPrintablesModel(userId, source, body);
  }

  const { tempPath, filename, mime, meta } = await downloadImportToTemp(url, body);
  const author = await upsertAuthorFromImport(meta.author);
  const categoryId =
    body.category_id ?? (await resolveCategoryIdByCategory(userId, meta.categorySite, meta.siteCategoryIds));
  const printMeta: PrintMetaInput = {
    title: body.title ?? meta.title ?? null,
    notes: body.notes ?? meta.description ?? null,
    tags: body.tags && body.tags.length ? body.tags : meta.tags,
    categoryId,
    categorySource: body.category_id ? "MANUAL" : categoryId ? "RULE" : null,
    creator: meta.creator ?? null,
    authorId: author?.id ?? null,
    sourceProvider: source?.provider ?? null,
    sourceExternalId: source?.externalId ?? null,
  };

  try {
    let result: { print: Print; plates: Plate[] };
    try {
      result = await createPrint(userId, printMeta, path.parse(filename).name, [
        { filename, mime, tempFilePath: tempPath, sourceInstanceId: meta.makerworldProfile?.instanceId ?? null },
      ]);
    } catch (err) {
      // Race guard: a concurrent import of the same source model won.
      if (source && isUniqueConstraintError(err)) {
        const existing = await findExistingImportedPrint(userId, source);
        if (existing) return { ...existing, alreadyImported: true };
      }
      throw err;
    }
    await attachImportedPreviewImages(
      result.print.id,
      result.plates[0]?.id,
      meta.previewImageUrl,
      meta.galleryImages,
      body.makerworldPaceMs,
    );
    await localizeDescriptionImages(result.print.id);
    const previewImages = await prisma.previewImage.findMany({
      where: { printId: result.print.id },
      orderBy: { position: "asc" },
    });
    return { ...result, author, previewImages, alreadyImported: false };
  } finally {
    if (fsSync.existsSync(tempPath)) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}
