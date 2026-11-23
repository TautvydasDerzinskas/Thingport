import fs from "node:fs/promises";
import { URLS } from "../providers/index.generated";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  IMPORT_BROWSER_USER_AGENT,
  IMPORT_DOWNLOAD_RETRY_DELAY_MS,
  IMPORT_HTML_MAX_BYTES,
  IMPORT_MAX_BYTES,
} from "../config";
import {
  HttpError,
  buildImportFilename,
  guessMimeFromPath,
  isHtmlContentType,
  mimeFromContentType,
} from "../utils/fileUtils";
import { normalizeFileName } from "../files/names";
import { validateRemoteUrl } from "../utils/urlUtils";
import { readCapped, readChunk } from "../utils/readCapped";
import { fetchWithGuard, rawFetch } from "../services/guardedFetch";
import { maybeSleep } from "../utils/concurrency";
import { isCloudflareChallenge } from "../services/flaresolverr";
import {
  emptyImportedPageMetadata,
  extractPageMetadata,
  findDownloadUrl,
  getPath,
  type ImportedPageMetadata,
} from "../services/importResolvers";
import {
  makerworldHtmlHeaders,
  makerworldInstanceCover,
  makerworldInstanceTitles,
  makerworldMetaFromDesign,
  makerworldPageMetadata,
  resolveMakerworldCookie,
  resolveMakerworldDownloadUrl,
  type MakerworldProfileRef,
} from "../providers/makerworld/pageData";
import {
  extractMakerworldBearerToken,
  MAKERWORLD_AUTH_CODE,
  MakerworldAuthError,
  MakerworldCaptchaError,
  MAKERWORLD_CAPTCHA_CODE,
  MAKERWORLD_DOWNLOAD_LIMIT_CODE,
  MakerworldDownloadLimitError,
  parseMakerworldModelUrl,
  resolveMakerworldParametricSource,
  resolveMakerworldViaCloudApi,
  completeMakerworldAuthor,
} from "../providers/makerworld/api";
import { type NewPlateInput } from "../services/printCreation";

import type { ImportRequestBody } from "../services/importService";

function parseCharset(contentType: string | null): string {
  if (!contentType) return "utf-8";
  const match = contentType.match(/charset=([^;]+)/i);
  return match ? match[1].trim().replace(/["']/g, "") : "utf-8";
}

export type OpenImportResult = { response: Response; finalUrl: string; meta: ImportedPageMetadata };

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
  // What Grab resolved is one profile's 3MF, as the cloud API's download is, so the scripts the design is
  // generated from need fetching of their own. Without this an import through Grab brought no script at all,
  // while the same model pasted as a link did. Best-effort: no token, or a refusal, leaves the model's plates.
  //
  // The design Grab sent is trimmed to fit the request, and a Grab from before it kept the file list (1.8.1 and
  // older) sends none at all, which reads as a model with no script. So what it sent is taken at its word only
  // where it has a file list; otherwise the design is read from MakerWorld.
  const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));
  const sentFileList = Array.isArray(getPath(design, "designExtension", "model_files"));
  const parametricSource = bearerToken
    ? await resolveMakerworldParametricSource(
        parsed.designId,
        sentFileList ? meta.parametricSource : null,
        bearerToken,
        body.makerworldPaceMs,
      )
    : meta.parametricSource;
  return {
    ...meta,
    author,
    creator: author?.name ?? meta.creator,
    parametricSource,
    makerworldProfile: extensionProfile(url, body),
  };
}

/** The picked profile from the design the extension sent: its picture, limited to MakerWorld's CDN as it's
 *  client-supplied, and every profile's name. */
export function extensionProfile(url: string, body: ImportRequestBody): MakerworldProfileRef {
  const instanceId = body.resolved_instance_id ?? null;
  const design = body.makerworld_design;
  if (!design || String(design.id) !== parseMakerworldModelUrl(url)?.designId) return { instanceId };
  const cover = makerworldInstanceCover(design, instanceId);
  return {
    instanceId,
    coverUrl: isMakerworldCdnUrl(cover) ? cover : null,
    titles: makerworldInstanceTitles(design),
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
    if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message, MAKERWORLD_CAPTCHA_CODE);
    if (err instanceof MakerworldDownloadLimitError) {
      throw new HttpError(429, err.message, MAKERWORLD_DOWNLOAD_LIMIT_CODE);
    }
    // 400, not 401: the frontend treats any 401 as an expired Thingport session and logs out.
    if (err instanceof MakerworldAuthError) throw new HttpError(400, err.message, MAKERWORLD_AUTH_CODE);
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
  let validatedUrl = await validateRemoteUrl(url);

  let host = "";
  try {
    host = (new URL(validatedUrl).hostname || "").toLowerCase();
  } catch {
    host = "";
  }

  // MakerWorld redirects www to apex; choose that origin before attaching a cookie.
  if (depth === 0 && host === "www.makerworld.com" && parseMakerworldModelUrl(validatedUrl)) {
    const canonical = new URL(validatedUrl);
    canonical.hostname = "makerworld.com";
    validatedUrl = await validateRemoteUrl(canonical.href);
    host = canonical.hostname;
  }

  // Only at depth 0, so a resolved download URL isn't treated as a model page on recursion.
  if (depth === 0 && URLS.makerworld.isHost(host) && !body.resolved_download_url) {
    const cloudResolved = await tryMakerworldCloudApi(validatedUrl, body);
    if (cloudResolved) {
      return openImportResponse(cloudResolved.downloadUrl, body, validatedUrl, depth + 1, cloudResolved.meta);
    }
  }
  if (depth === 0 && URLS.makerworld.isHost(host) && body.resolved_download_url) {
    const fromExtension = await makerworldMetaFromExtension(validatedUrl, body);
    if (fromExtension) {
      return openImportResponse(body.resolved_download_url, body, validatedUrl, depth + 1, fromExtension);
    }
  }

  const headers: Record<string, string> = { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "*/*" };
  let makerworldCookie: string | null = null;
  if (URLS.makerworld.isHost(host)) {
    makerworldCookie = resolveMakerworldCookie(body);
    Object.assign(
      headers,
      makerworldHtmlHeaders(
        referer || validatedUrl,
        new URL(validatedUrl).protocol === "https:" ? makerworldCookie : null,
      ),
    );
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
    // A link of no provider's goes the way MakerWorld's do (LINK_PROVIDER), but only its pages carry a design.
    const extracted = URLS.makerworld.isHost(pageHost) ? makerworldPageMetadata(html) : extractPageMetadata(html);
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
      // Whether the creator withheld the script is read off the design, before anything downloads.
      parametricSource: extracted.parametricSource ?? inheritedMeta.parametricSource,
    };
    if (URLS.makerworld.isHost(pageHost) && extracted.author) {
      resolvedMeta.author = await completeMakerworldAuthor(extracted.author, body.makerworldPaceMs);
    }
    if (URLS.makerworld.isHost(pageHost)) {
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
          if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message, MAKERWORLD_CAPTCHA_CODE);
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
    // A MakerWorld page links no file its resolver didn't try, only its profiles' 3D previews.
    if (!downloadUrl && !URLS.makerworld.isHost(pageHost)) {
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

export async function streamToFileCapped(response: Response, destPath: string, maxBytes: number): Promise<number> {
  if (!response.body) {
    await fs.writeFile(destPath, Buffer.alloc(0));
    return 0;
  }
  const reader = response.body.getReader();
  const handle = await fs.open(destPath, "w");
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await readChunk(reader);
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
export async function saveImportResponseToTemp(
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

export type PlainDownloadResult = { input: NewPlateInput } | { rateLimited: true } | null;

/** A 429, or a 403 Cloudflare challenge (which FlareSolverr can't solve for a binary download). */
function isDownloadBlocked(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && isCloudflareChallenge(res.headers));
}

/** Best-effort: null on failure so one bad file doesn't fail the whole import, except a block,
 * which is retried once and then reported so the caller can say why. */
export async function downloadPlainFileToTemp(url: string, suggestedName: string): Promise<PlainDownloadResult> {
  let tempFilePath: string | null = null;
  try {
    const headers = { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "*/*" };
    let res = await rawFetch(url, headers);
    if (isDownloadBlocked(res)) {
      await res.body?.cancel().catch(() => undefined);
      await maybeSleep(IMPORT_DOWNLOAD_RETRY_DELAY_MS);
      res = await rawFetch(url, headers);
    }
    if (isDownloadBlocked(res)) {
      await res.body?.cancel().catch(() => undefined);
      return { rateLimited: true };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const filename = normalizeFileName(suggestedName);
    tempFilePath = path.join(
      os.tmpdir(),
      `thingport-thingiverse-${crypto.randomBytes(8).toString("hex")}${path.extname(filename)}`,
    );
    await streamToFileCapped(res, tempFilePath, IMPORT_MAX_BYTES);
    return { input: { filename, mime: guessMimeFromPath(filename), tempFilePath } };
  } catch {
    // A stream that broke off or ran over the cap leaves what it had written.
    if (tempFilePath) await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    return null;
  }
}
