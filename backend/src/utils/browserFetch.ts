import { Impit } from "impit";
import { manifestOf, PROVIDER_IDS } from "../providers/index.generated";
import { withIdleLimit } from "./readCapped";

// Some providers' Cloudflare challenges clients by their TLS handshake, whatever the headers or cookies, and Node's
// fetch is on its list. impit sends Chrome's handshake and headers.
const following = new Impit({ browser: "chrome", timeout: null });
const manual = new Impit({ browser: "chrome", timeout: null, followRedirects: false });

const BROWSER_FETCH_ORIGINS = new Set<string>(
  PROVIDER_IDS.flatMap((id) => {
    const manifest = manifestOf(id);
    return ("browserFetchOrigins" in manifest ? manifest.browserFetchOrigins : undefined) ?? [];
  }),
);

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** Exact provider origins that challenge Node's own fetch. */
export function needsBrowserFetch(url: string): boolean {
  try {
    return BROWSER_FETCH_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/** fetch with Chrome's TLS fingerprint. `timeoutMs` covers waiting for the response, not reading
 * the body, which only fails on silence (readCapped.ts). The caller's User-Agent is dropped: one that doesn't match the handshake is itself a
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
    // Unlike Node's fetch, this has no limit of its own on a body that goes silent.
    const resBody = NULL_BODY_STATUSES.has(res.status) ? null : res.body && withIdleLimit(res.body);
    const out = new Response(resBody, { status: res.status, statusText: res.statusText, headers: res.headers });
    Object.defineProperty(out, "url", { value: res.url || url });
    return out;
  } finally {
    // The caller's signal stays wired: like fetch's, it also cuts off reading the body.
    clearTimeout(timeout);
  }
}
