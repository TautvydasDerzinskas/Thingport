// Fetching a provider's page or file: through Chrome's handshake where Node's fetch is turned away, and through
// FlareSolverr where Cloudflare challenges the request.

import { IMPORT_TIMEOUT_SECONDS } from "../config";
import { browserFetch, needsBrowserFetch } from "../utils/browserFetch";
import { HttpError } from "../utils/fileUtils";
import { validateRemoteUrl } from "../utils/urlUtils";
import {
  CLOUDFLARE_BLOCKED_CODE,
  fetchViaFlaresolverr,
  looksLikeCloudflareBlock,
  shouldProxyHost,
} from "./flaresolverr";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Match fetch's automatic redirect limit.
const MAX_REDIRECTS = 20;
const CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "cookie2", "host"]);

export async function rawFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_SECONDS * 1000);
  let current = url;
  let sent = headers;
  try {
    for (let hop = 0; ; hop++) {
      // Automatic redirects bypass the caller's URL validation, including in the browser transport.
      await validateRemoteUrl(current);
      controller.signal.throwIfAborted();
      const options = { headers: sent, redirect: "manual" as const, signal: controller.signal };
      const res = needsBrowserFetch(current) ? await browserFetch(current, options) : await fetch(current, options);
      const location = res.headers.get("location");
      if (!REDIRECT_STATUSES.has(res.status) || location === null) {
        if (hop > 0) {
          Object.defineProperty(res, "url", { value: res.url || current });
          Object.defineProperty(res, "redirected", { value: true });
        }
        return res;
      }
      await res.body?.cancel().catch(() => undefined);
      if (hop === MAX_REDIRECTS) throw new HttpError(400, "Too many redirects");
      const next = new URL(location, current).toString();
      if (new URL(next).origin !== new URL(current).origin) {
        sent = Object.fromEntries(Object.entries(sent).filter(([name]) => !CREDENTIAL_HEADERS.has(name.toLowerCase())));
      }
      current = next;
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Loads `url` through FlareSolverr and wraps the rendered body as an HTML Response. */
async function proxiedResponse(url: string, cookieHeader?: string | null): Promise<Response | null> {
  // FlareSolverr follows redirects inside its external browser; its network needs its own egress policy.
  await validateRemoteUrl(url);
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
