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

function parseCookieHeader(raw: string | null | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (raw || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    jar[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return jar;
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

/** GET only: FlareSolverr's POST submits a browser form, not a raw body. */
export async function fetchViaFlaresolverr(
  url: string,
  cookieHeader?: string | null,
): Promise<FlaresolverrResult | null> {
  const endpoint = await getFlaresolverrUrl();
  if (!endpoint) return null;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLARESOLVERR_TIMEOUT_MS);
  try {
    const seedCookies = parseCookieHeader(cookieHeader);
    const cookieList = Object.entries(seedCookies).map(([name, value]) => ({ name, value, domain: hostname }));
    const body: Record<string, unknown> = {
      cmd: "request.get",
      url,
      maxTimeout: FLARESOLVERR_TIMEOUT_MS,
    };
    if (cookieList.length) body.cookies = cookieList;

    const res = await fetch(endpoint, {
      method: "POST",
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

/** The cookies FlareSolverr's browser holds after running a page for `waitSeconds`, by name: for a bot check that
 *  hands out a token of its own rather than Cloudflare's clearance (AWS's WAF), which FlareSolverr doesn't recognise
 *  and so wouldn't wait for. Such a token, unlike a clearance, may be replayed from Node. Null when FlareSolverr isn't
 *  set up or didn't answer. */
export async function cookiesViaFlaresolverr(url: string, waitSeconds: number): Promise<Record<string, string> | null> {
  const endpoint = await getFlaresolverrUrl();
  if (!endpoint) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLARESOLVERR_TIMEOUT_MS + waitSeconds * 1000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url,
        maxTimeout: FLARESOLVERR_TIMEOUT_MS,
        waitInSeconds: waitSeconds,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      solution?: { cookies?: { name?: unknown; value?: unknown }[] };
    };
    if (data.status !== "ok" || !data.solution) return null;
    return Object.fromEntries(
      (data.solution.cookies ?? []).flatMap((cookie) =>
        typeof cookie.name === "string" && typeof cookie.value === "string" ? [[cookie.name, cookie.value]] : [],
      ),
    );
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
