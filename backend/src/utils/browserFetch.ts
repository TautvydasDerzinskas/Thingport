import { Impit } from "impit";
import { hostIs, MANIFESTS, PROVIDER_IDS, type ProviderManifest } from "../providers/_generated";

// Some providers' Cloudflare challenges clients by their TLS handshake, whatever the headers or cookies, and Node's
// fetch is on its list. impit sends Chrome's handshake and headers.
const following = new Impit({ browser: "chrome", timeout: null });
const manual = new Impit({ browser: "chrome", timeout: null, followRedirects: false });

const BROWSER_FETCH_HOSTS = PROVIDER_IDS.flatMap((id) => {
  const manifest: ProviderManifest = MANIFESTS[id];
  return manifest.browserFetch ? manifest.hosts : [];
});

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** Hosts that challenge Node's own fetch, so every request to them goes through browserFetch. */
export function needsBrowserFetch(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return BROWSER_FETCH_HOSTS.some((domain) => hostIs(host, domain));
  } catch {
    return false;
  }
}

/** fetch with Chrome's TLS fingerprint. `timeoutMs` covers waiting for the response, not reading
 * the body. The caller's User-Agent is dropped: one that doesn't match the handshake is itself a
 * bot signal. */
export async function browserFetch(
  url: string,
  {
    method = "GET",
    body,
    headers = {},
    timeoutMs,
    signal,
    redirect = "follow",
  }: {
    method?: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    redirect?: "follow" | "manual";
  },
): Promise<Response> {
  const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "user-agent"));
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timeout = timeoutMs ? setTimeout(onAbort, timeoutMs) : undefined;
  try {
    const client = redirect === "follow" ? following : manual;
    const res = await client.fetch(url, { method, body, headers: sent, signal: controller.signal });
    // A standard Response, so callers and helpers typed for fetch's take it as is.
    const resBody = NULL_BODY_STATUSES.has(res.status) ? null : res.body;
    const out = new Response(resBody, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(out, "url", { value: res.url || url });
    return out;
  } finally {
    // The caller's signal stays wired: like fetch's, it also cuts off reading the body.
    clearTimeout(timeout);
  }
}
