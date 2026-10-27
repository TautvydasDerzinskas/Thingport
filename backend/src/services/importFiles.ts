import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { URLS } from "../providers/index.generated";
import {
  IMPORT_ALLOWED_EXTS,
  IMPORT_BROWSER_USER_AGENT,
  IMPORT_DOWNLOAD_RETRY_DELAY_MS,
  IMPORT_HTML_MAX_BYTES,
  IMPORT_MAX_BYTES,
  IMPORT_TIMEOUT_SECONDS,
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
import { fetchWithGuard, rawFetch } from "./guardedFetch";
import { maybeSleep } from "../utils/concurrency";
import { isCloudflareChallenge } from "./flaresolverr";
import {
  emptyImportedPageMetadata,
  extractPageMetadata,
  findDownloadUrl,
  type ImportedPageMetadata,
} from "./importResolvers";
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
  MAKERWORLD_DOWNLOAD_LIMIT_CODE,
  MakerworldDownloadLimitError,
  parseMakerworldModelUrl,
  resolveMakerworldViaCloudApi,
  completeMakerworldAuthor,
} from "../providers/makerworld/api";
import { listZipEntries, readZipEntry } from "../utils/zipReader";
import type { NewPlateInput } from "./printCreation";
import { plainWriteMode } from "./fileReuse";
import { downloadResponseToTemp } from "./importDownload";
import type { ImportRequestBody } from "./importService";

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
  return {
    ...meta,
    author,
    creator: author?.name ?? meta.creator,
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
    if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
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
  const validatedUrl = await validateRemoteUrl(url);

  let host = "";
  try {
    host = (new URL(validatedUrl).hostname || "").toLowerCase();
  } catch {
    host = "";
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
    const { buffer, truncated } = await readCapped(res, IMPORT_HTML_MAX_BYTES, IMPORT_TIMEOUT_SECONDS * 1000);
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
  const filename = buildImportFilename(finalUrl, response.headers, body.filename ?? meta.filename);
  const mime = mimeFromContentType(response.headers.get("content-type"), filename);
  const tempPath = await downloadResponseToTemp(response, filename, IMPORT_MAX_BYTES, IMPORT_TIMEOUT_SECONDS * 1000);
  return { tempPath, filename, mime, meta };
}

export const MULTI_FILE_PLATE_EXTS = new Set([...IMPORT_ALLOWED_EXTS].filter((ext) => ext !== ".zip"));

export type PlainDownloadResult = { input: NewPlateInput } | { rateLimited: true } | null;

/** A 429, or a 403 Cloudflare challenge (which FlareSolverr can't solve for a binary download). */
function isDownloadBlocked(res: Response): boolean {
  return res.status === 429 || (res.status === 403 && isCloudflareChallenge(res.headers));
}

/** Best-effort: null on failure so one bad file doesn't fail the whole import, except a block,
 * which is retried once and then reported so the caller can say why. */
export async function downloadPlainFileToTemp(url: string, suggestedName: string): Promise<PlainDownloadResult> {
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
    const filename = sanitizeFilename(suggestedName);
    const tempFilePath = await downloadResponseToTemp(res, filename, IMPORT_MAX_BYTES, IMPORT_TIMEOUT_SECONDS * 1000);
    return { input: { filename, mime: guessMimeFromPath(filename), tempFilePath, storageMode: plainWriteMode() } };
  } catch {
    return null;
  }
}

/** The model files in a downloaded zip, each as its own plate; the zip itself is left for the caller. Plates have no
 *  folders, so files named alike in different folders are named after their folder too: "2x2 - Top.stl". */
export async function modelFilesFromZip(zipPath: string): Promise<NewPlateInput[]> {
  const inputs: NewPlateInput[] = [];
  try {
    const entries = (await listZipEntries(zipPath))
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({ entry, parts: entry.name.replace(/\\/g, "/").split("/").filter(Boolean) }))
      .filter(({ parts }) => parts.length && MULTI_FILE_PLATE_EXTS.has(path.extname(parts.at(-1)!).toLowerCase()));
    const sameName = new Map<string, number>();
    for (const { parts } of entries) sameName.set(parts.at(-1)!, (sameName.get(parts.at(-1)!) ?? 0) + 1);
    for (const { entry, parts } of entries) {
      const name = parts.at(-1)!;
      const folder = parts.at(-2);
      const filename = sanitizeFilename(sameName.get(name)! > 1 && folder ? `${folder} - ${name}` : name);
      const buffer = await readZipEntry(zipPath, entry.name, IMPORT_MAX_BYTES);
      if (!buffer) continue;
      const tempFilePath = path.join(
        os.tmpdir(),
        `thingport-zip-${crypto.randomBytes(8).toString("hex")}${path.extname(filename)}`,
      );
      await fs.writeFile(tempFilePath, buffer);
      inputs.push({ filename, mime: guessMimeFromPath(filename), tempFilePath });
    }
  } catch (err) {
    await Promise.all(inputs.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
    throw err;
  }
  return inputs;
}

/** A provider's signed file link, on one of its own hosts; a zip is unpacked into its model files. Null when it
 *  didn't download. */
export async function downloadSignedFile(
  file: { url: string; name: string },
  isFileHost: (hostname: string) => boolean,
  blockedMessage: string,
): Promise<NewPlateInput[] | null> {
  let hostname: string;
  try {
    hostname = new URL(file.url).hostname;
  } catch {
    return null;
  }
  if (!isFileHost(hostname)) return null;
  const result = await downloadPlainFileToTemp(file.url, file.name);
  if (result && "rateLimited" in result) throw new HttpError(429, blockedMessage);
  if (!result) return null;
  const ext = path.extname(result.input.filename).toLowerCase();
  if (ext === ".zip") {
    try {
      return await modelFilesFromZip(result.input.tempFilePath!);
    } finally {
      await fs.rm(result.input.tempFilePath!, { force: true }).catch(() => undefined);
    }
  }
  if (MULTI_FILE_PLATE_EXTS.has(ext)) return [result.input];
  await fs.rm(result.input.tempFilePath!, { force: true }).catch(() => undefined);
  return [];
}
