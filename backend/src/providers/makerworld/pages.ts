// MakerWorld's model pages, read for what its cloud API gives a signed-in user: the design, and its author.

import { IMPORT_BROWSER_USER_AGENT, IMPORT_HTML_MAX_BYTES } from "../../config";
import { maybeSleep } from "../../utils/concurrency";
import { HttpError, isHtmlContentType } from "../../utils/fileUtils";
import { readCapped } from "../../utils/readCapped";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
import { fetchWithGuard } from "../../services/guardedFetch";
import { extractNextDataJson, type ImportedAuthorInfo } from "../../services/importResolvers";
import { makerworldHtmlHeaders } from "./pageData";
import { makerworldPageMetadata } from "./pageData";
import { makerworldModelUrl } from "./urls.generated";
import {
  completeMakerworldAuthor,
  extractMakerworldBearerToken,
  fetchMakerworldDesign,
  makerworldCaptchaCooloffActive,
  MakerworldCaptchaError,
} from "./api";

/** Fallback for fetchMakerworldDesign when there's no MakerWorld login. */
async function fetchMakerworldPageDesign(
  designId: string,
  cookie: string | null,
  paceMs?: number,
): Promise<Record<string, unknown> | null> {
  if (makerworldCaptchaCooloffActive()) throw new MakerworldCaptchaError();
  const url = makerworldModelUrl(designId);
  await maybeSleep(paceMs);
  let res: Response;
  try {
    res = await fetchWithGuard(url, {
      "User-Agent": IMPORT_BROWSER_USER_AGENT,
      Accept: "*/*",
      ...makerworldHtmlHeaders(url, cookie),
    });
  } catch (err) {
    // Kept apart from "couldn't read the model", so a sync hands the model back for later.
    if (err instanceof HttpError && err.code === CLOUDFLARE_BLOCKED_CODE) throw err;
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
  const url = makerworldModelUrl(designId);
  await maybeSleep(paceMs);
  let res: Response;
  try {
    res = await fetchWithGuard(url, {
      "User-Agent": IMPORT_BROWSER_USER_AGENT,
      Accept: "*/*",
      ...makerworldHtmlHeaders(url, cookie),
    });
  } catch {
    return null;
  }
  if (!isHtmlContentType(res.headers.get("content-type") || "")) return null;
  const { buffer } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
  return completeMakerworldAuthor(makerworldPageMetadata(buffer.toString("utf-8")).author, paceMs);
}
