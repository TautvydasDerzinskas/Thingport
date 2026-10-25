// Fetching a provider's page or file: through Chrome's handshake where Node's fetch is turned away, and through
// FlareSolverr where Cloudflare challenges the request.

import { IMPORT_TIMEOUT_SECONDS } from "../config";
import {
  assertCredentialDestination,
  browserCredentialRequest,
  credentialRequest,
} from "../providers/credentialRequest";
import { needsBrowserFetch } from "../utils/browserFetch";
import { HttpError } from "../utils/fileUtils";
import { remoteRequest } from "../utils/remoteRequest";
import {
  CLOUDFLARE_BLOCKED_CODE,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

export async function rawFetch(url: string, headers: Record<string, string>): Promise<Response> {
  if (headers.Cookie) assertCredentialDestination("makerworld-page", url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    const init: RequestInit = { headers, signal: controller.signal };
    return await (headers.Cookie
      ? needsBrowserFetch(url)
        ? browserCredentialRequest("makerworld-page", url, { headers, signal: controller.signal })
        : credentialRequest("makerworld-page", url, init)
      : remoteRequest(url, init, true));
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads `url` through FlareSolverr and wraps the rendered body as an HTML Response. */
async function proxiedResponse(url: string, cookieHeader?: string | null): Promise<Response | null> {
  if (cookieHeader) assertCredentialDestination("makerworld-page", url);
  const solved = await fetchViaFlaresolverr(url, cookieHeader);
  if (!solved) return null;
  return new Response(solved.body, {
    status: solved.status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** A page or file, or the HttpError that says why it couldn't be fetched. */
export async function fetchWithGuard(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {}

    let res: Response;
    if (shouldProxyHost(hostname)) {
      res = (await proxiedResponse(url, headers.Cookie)) || (await rawFetch(url, headers));
    } else {
      res = await rawFetch(url, headers);
      if (res.status === 403 && looksLikeCloudflareBlock(res.headers)) {
        const proxied = await proxiedResponse(url, headers.Cookie);
        if (proxied) res = proxied;
      }
    }

    if (res.status === 403 && looksLikeCloudflareBlock(res.headers)) {
      throw new HttpError(
        403,
        "Cloudflare blocked the request and FlareSolverr didn't get past it",
        CLOUDFLARE_BLOCKED_CODE,
      );
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
