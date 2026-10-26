import { PROVIDER_IDS, manifestOf } from "../providers/index.generated";
import { FLARESOLVERR_SESSION_TTL_MS, FLARESOLVERR_TIMEOUT_MS } from "../config";
import { getFlaresolverrUrl, normalizeFlaresolverrUrl } from "./settingsService";

const TEST_TIMEOUT_MS = 10000;

export async function isFlaresolverrEnabled(): Promise<boolean> {
  return Boolean(await getFlaresolverrUrl());
}

/** `sessions.list` is a cheap command that only FlareSolverr's /v1 endpoint answers with status "ok". Takes the
 * URL with or without /v1. */
export async function testFlaresolverr(
  url: string,
): Promise<{ ok: true; latencyMs: number; version: string | null } | { ok: false; error: string }> {
  const endpoint = normalizeFlaresolverrUrl(url);
  if (!endpoint) return { ok: false, error: "Enter the FlareSolverr URL first" };
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "sessions.list" }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `FlareSolverr answered HTTP ${res.status}` };
    const data = (await res.json().catch(() => null)) as { status?: string; version?: string } | null;
    if (data?.status !== "ok") return { ok: false, error: "That URL didn't answer like FlareSolverr" };
    return { ok: true, latencyMs: Date.now() - start, version: data.version ?? null };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: `No answer within ${TEST_TIMEOUT_MS / 1000}s` };
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach FlareSolverr" };
  } finally {
    clearTimeout(timeout);
  }
}

// Cloudflare still said no after FlareSolverr, or with none set up: nothing to do with the link.
export const CLOUDFLARE_BLOCKED_CODE = "CLOUDFLARE_BLOCKED";

/** Cloudflare challenged this request. Narrower than looksLikeCloudflareBlock: a site behind
 * Cloudflare sends `server: cloudflare` on its own 403s and 404s too. */
export function isCloudflareChallenge(headers: Headers): boolean {
  return headers.has("cf-mitigated");
}

/** A Cloudflare edge block rather than an application-level 403. */
export function looksLikeCloudflareBlock(headers: Headers): boolean {
  const server = (headers.get("server") || "").toLowerCase();
  if (server.includes("cloudflare")) return true;
  return isCloudflareChallenge(headers);
}

// Cloudflare's clearance is bound to the solving browser's fingerprint, so its cookies can't be
// replayed. Once a host blocks us, proxy every request to it for a TTL.
const proxyHosts = new Map<string, number>();

export function shouldProxyHost(hostname: string): boolean {
  const expiresAt = proxyHosts.get(hostname.toLowerCase());
  return typeof expiresAt === "number" && Date.now() > 0 && Date.now() < expiresAt;
}

function markHostNeedsProxy(hostname: string): void {
  proxyHosts.set(hostname.toLowerCase(), Date.now() + FLARESOLVERR_SESSION_TTL_MS);
}

export type FlaresolverrResult = {
  status: number;
  body: string;
};

// A browser can follow redirects and execute scripts outside our HTTP destination guard.
// Only known provider read endpoints may enter it; a forged Cloudflare response is not trust.
// Deployment must still isolate the solver from private networks: trusted pages can redirect
// or load third-party resources, and this allowlist cannot constrain browser subrequests.
const SOLVER_ROUTES = PROVIDER_IDS.flatMap((provider) => manifestOf(provider).solverRoutes ?? []);

function solverDestination(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password) return null;
  const rule = SOLVER_ROUTES.find((route) => route.host === parsed.hostname && route.path.test(parsed.pathname));
  if (!rule) return null;
  // Only UTF-8 bytes for non-ASCII slug characters may be percent-encoded.
  // Encoded ASCII delimiters and double-encoding could change the server-side route.
  if (/%(?![89a-f][0-9a-f])/i.test(parsed.pathname)) return null;
  try {
    decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  // Credential names come only from this route, never from caller-supplied bypass options.
  for (const [key, value] of Array.from(parsed.searchParams)) {
    if (rule.credentials?.query?.includes(key)) {
      if (
        parsed.searchParams.getAll(key).length !== 1 ||
        !value ||
        Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        return null;
      continue;
    }
    if (!rule.query.includes(key)) {
      if (/^(?:access_token|key|token|authorization)$/i.test(key)) return null;
      parsed.searchParams.delete(key);
      continue;
    }
    if (parsed.searchParams.getAll(key).length !== 1) return null;
    if (!/^[\w -]*$/.test(value)) return null;
  }
  // Fragments are unnecessary for these read endpoints and may drive client-side navigation.
  parsed.hash = "";
  return { parsed, rule };
}

/** GET only: FlareSolverr's POST submits a browser form, not a raw body. */
export async function fetchViaFlaresolverr(
  url: string,
  cookieHeader?: string | null,
): Promise<FlaresolverrResult | null> {
  const destination = solverDestination(url);
  if (!destination) return null;
  const { parsed, rule } = destination;
  if (cookieHeader && !rule.credentials?.cookies) return null;
  const endpoint = await getFlaresolverrUrl();
  if (!endpoint) return null;
  const hostname = parsed.hostname;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLARESOLVERR_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      cmd: "request.get",
      url: parsed.href,
      maxTimeout: FLARESOLVERR_TIMEOUT_MS,
    };
    if (cookieHeader) {
      // FlareSolverr seeds cookies after its first navigation. Pin their domain to the
      // original provider so a redirect cannot bind them to another site.
      const cookies = cookieHeader.split(";").flatMap((part) => {
        const equals = part.indexOf("=");
        if (equals < 1) return [];
        const name = part.slice(0, equals).trim();
        const value = part.slice(equals + 1).trim();
        return /^[!#$%&'*+.^_`|~\w-]+$/.test(name) &&
          !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
          ? [{ name, value, domain: parsed.hostname, path: "/", secure: true }]
          : [];
      });
      if (cookies.length) body.cookies = cookies;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      solution?: { status?: number; response?: string };
    };
    if (data.status !== "ok" || !data.solution) return null;

    markHostNeedsProxy(hostname);
    return { status: data.solution.status ?? 200, body: data.solution.response || "" };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** JSON comes back wrapped in Chrome's JSON-viewer HTML; unwrap and parse it. */
export function extractJsonFromBrowserBody(body: string): unknown | null {
  const trimmed = body.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const match = trimmed.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) return null;
  const unescaped = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(unescaped);
  } catch {
    return null;
  }
}
