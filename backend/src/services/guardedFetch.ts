// Fetching a provider's page or file: through Chrome's handshake where Node's fetch is turned away, and through
// FlareSolverr where Cloudflare challenges the request.

import { IMPORT_TIMEOUT_SECONDS } from "../config";
import { assertCredentialDestination } from "../providers/credentialRequest";
import { HttpError } from "../utils/fileUtils";
import { remoteRequest } from "../utils/remoteRequest";
import {
  CLOUDFLARE_BLOCKED_CODE,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

// Generic imports may carry a saved MakerWorld sign-in even for a public subdomain or download link.
// Keep loading those links anonymously; only the exact credential origins may receive the sign-in.
function guardedHeaders(url: string, headers: Record<string, string>): Headers {
  const safe = new Headers(headers);
  try {
    assertCredentialDestination("makerworld-page", url);
  } catch {
    for (const name of ["cookie", "authorization", "proxy-authorization"]) safe.delete(name);
  }
  return safe;
}

export async function rawFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  try {
    // remoteRequest validates every hop and permanently strips credentials on an origin change,
    // including a redirect back to MakerWorld. Same-origin hops keep the initial credential boundary.
    return await remoteRequest(url, { headers: guardedHeaders(url, headers), signal: controller.signal }, true);
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads `url` through FlareSolverr and wraps the rendered body as an HTML Response. */
async function proxiedResponse(url: string, headers: Record<string, string>): Promise<Response | null> {
  const cookieHeader = guardedHeaders(url, headers).get("cookie");
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
      res = (await proxiedResponse(url, headers)) || (await rawFetch(url, headers));
    } else {
      res = await rawFetch(url, headers);
      if (res.status === 403 && looksLikeCloudflareBlock(res.headers)) {
        const proxied = await proxiedResponse(url, headers);
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
