// Dashboard widgets made by users, or shared through the community repository: metadata, an ES module and optional
// HTML. Their scripts run in the user's dashboard page with the user's access, so a community widget is kept exactly
// as installed (its files and their hash) until the user chooses to take an update, and an admin can turn custom
// widgets off for the instance.

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { readCapped } from "../utils/readCapped";
import { TtlCache } from "../utils/ttlCache";
import { SLUG, manifestSchema, parseManifest, validateCode, type WidgetManifest } from "./customWidgetFormat";
import { getWidgetSources, WIDGET_SOURCES, type WidgetSource } from "./settingsService";
import { GITHUB_REPO, releaseBranch } from "./versionService";

export async function assertWidgetSourceEnabled(source: WidgetSource): Promise<void> {
  if ((await getWidgetSources())[source]) return;
  if (source === "own")
    throw new HttpError(403, "Users' own widgets are turned off on this Thingport", "USER_WIDGETS_OFF");
  throw new HttpError(403, "Community widgets are turned off on this Thingport", "COMMUNITY_WIDGETS_OFF");
}

/** The sources an admin hasn't turned off. */
export async function enabledWidgetSources(): Promise<WidgetSource[]> {
  const sources = await getWidgetSources();
  return WIDGET_SOURCES.filter((source) => sources[source]);
}

export { SLUG, manifestSchema, parseManifest, validateManifest, type WidgetManifest } from "./customWidgetFormat";

const shaOf = (manifest: WidgetManifest, script: string, html: string | null) =>
  createHash("sha256")
    .update(JSON.stringify(manifest))
    .update("\0")
    .update(script)
    .update("\0")
    .update(html ?? "")
    .digest("hex");

export type CustomWidgetOut = {
  id: string;
  source: "own" | "community";
  slug: string;
  manifest: WidgetManifest;
  script: string;
  html: string | null;
  sha: string;
  updatedAt: string;
};

type Row = {
  id: string;
  source: string;
  slug: string;
  manifest: unknown;
  script: string;
  html: string | null;
  sha: string;
  updatedAt: Date;
};

function out(row: Row): CustomWidgetOut | null {
  const manifest = manifestSchema.safeParse(row.manifest);
  if (!manifest.success) return null;
  return {
    id: row.id,
    source: row.source === "community" ? "community" : "own",
    slug: row.slug,
    manifest: manifest.data,
    script: row.script,
    html: row.html,
    sha: row.sha,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- The user's widgets ---------------------------------------------------------------------------------------------

/** The user's widgets from the given sources, by default all of them. */
export async function listCustomWidgets(
  userId: string,
  sources: readonly WidgetSource[] = WIDGET_SOURCES,
): Promise<CustomWidgetOut[]> {
  const rows = await prisma.customWidget.findMany({
    where: { userId, source: { in: [...sources] } },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => out(row) ?? []);
}

export async function getCustomWidget(userId: string, id: string): Promise<CustomWidgetOut> {
  const row = await prisma.customWidget.findFirst({ where: { id, userId } });
  const widget = row && out(row);
  if (!widget) throw new HttpError(404, "No such widget");
  return widget;
}

/** Creates or replaces one of the user's own widgets, by its slug. */
export async function saveOwnWidget(
  userId: string,
  input: { slug: string; manifest: WidgetManifest; script: string; html?: string | null },
): Promise<CustomWidgetOut> {
  if (!SLUG.test(input.slug))
    throw new HttpError(400, "The slug is 2-40 lowercase letters, digits and dashes, starting with a letter or digit");
  const html = input.html?.trim() ? input.html : null;
  validateCode(input.script, html);
  // Credited when downloaded to share, so it goes out with a name on it.
  const manifest = input.manifest.author
    ? input.manifest
    : {
        ...input.manifest,
        author: (await prisma.user.findUnique({ where: { id: userId } }))?.displayName.slice(0, 60),
      };
  const sha = shaOf(manifest, input.script, html);
  const data = { manifest, script: input.script, html, sha };
  const row = await prisma.customWidget.upsert({
    where: { userId_source_slug: { userId, source: "own", slug: input.slug } },
    create: { userId, source: "own", slug: input.slug, ...data },
    update: data,
  });
  return out(row)!;
}

export async function deleteCustomWidget(userId: string, id: string): Promise<void> {
  const { count } = await prisma.customWidget.deleteMany({ where: { id, userId } });
  if (!count) throw new HttpError(404, "No such widget");
}

// --- The community repository ---------------------------------------------------------------------------------------

// The repository's community-widgets folder, as GitHub serves its files, on develop for the :dev image. A fork can
// point its instances at its own.
const COMMUNITY_BASE =
  process.env.COMMUNITY_WIDGETS_URL?.replace(/\/+$/, "") ??
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${releaseBranch()}/community-widgets`;
const COMMUNITY_TTL_MS = 60 * 60 * 1000;
const FILE_MAX_BYTES = 1024 * 1024;

type CommunityFiles = { manifest: WidgetManifest; script: string; html: string | null; sha: string };
const communityCache = new TtlCache<CommunityFiles[] | (CommunityFiles & { slug: string })>(COMMUNITY_TTL_MS);

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Lets tests answer for GitHub and for the hosts widgets reach. */
export function setCustomWidgetsFetchForTest(impl?: typeof fetch): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
  communityCache.clear();
}

async function fetchText(path: string): Promise<string | null> {
  const res = await fetchImpl(`${COMMUNITY_BASE}/${path}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `The community repository answered HTTP ${res.status}`);
  return (await readCapped(res, FILE_MAX_BYTES)).buffer.toString("utf8");
}

async function fetchCommunityWidget(slug: string): Promise<CommunityFiles & { slug: string }> {
  const cached = communityCache.get(`widget:${slug}`);
  if (cached && !Array.isArray(cached)) return cached;
  const metadata = (await fetchText(`${slug}/widget.json`)) ?? (await fetchText(`${slug}/widget.yml`));
  const script = await fetchText(`${slug}/widget.js`);
  if (!metadata || !script) throw new HttpError(404, `The community repository has no widget "${slug}"`);
  const html = await fetchText(`${slug}/widget.html`);
  const manifest = parseManifest(metadata);
  validateCode(script, html);
  const files = { slug, manifest, script, html, sha: shaOf(manifest, script, html) };
  communityCache.set(`widget:${slug}`, files);
  return files;
}

export type CommunityWidget = {
  slug: string;
  manifest: WidgetManifest;
  sha: string;
  /** This user's installed copy, if any, and whether the repository's has changed since. */
  installed: { id: string; updateAvailable: boolean } | null;
};

/** The repository's widgets, from its `index.json`. */
async function communityCatalog(): Promise<{ slug: string; manifest: WidgetManifest; sha: string }[]> {
  const indexText = await fetchText("index.json");
  if (!indexText) return [];
  let slugs: string[] = [];
  try {
    const index = JSON.parse(indexText) as { widgets?: unknown };
    slugs = Array.isArray(index.widgets)
      ? index.widgets.filter((s): s is string => typeof s === "string" && SLUG.test(s))
      : [];
  } catch {
    throw new HttpError(502, "The community repository's index.json isn't valid JSON");
  }
  const results = await Promise.allSettled(slugs.map(fetchCommunityWidget));
  // One broken widget in the repository doesn't hide the rest.
  return results.flatMap((result) =>
    result.status === "fulfilled"
      ? [{ slug: result.value.slug, manifest: result.value.manifest, sha: result.value.sha }]
      : [],
  );
}

/** The repository's widgets, each with whether the user has it and whether it has changed. */
export async function listCommunityWidgets(userId: string): Promise<CommunityWidget[]> {
  const [catalog, installed] = await Promise.all([
    communityCatalog(),
    prisma.customWidget.findMany({
      where: { userId, source: "community" },
      select: { id: true, slug: true, sha: true },
    }),
  ]);
  return catalog.map(({ slug, manifest, sha }) => {
    const mine = installed.find((row) => row.slug === slug);
    return { slug, manifest, sha, installed: mine ? { id: mine.id, updateAvailable: mine.sha !== sha } : null };
  });
}

/** Installs a community widget, or takes its update: a copy of the repository's files as they are now. */
export async function installCommunityWidget(userId: string, slug: string): Promise<CustomWidgetOut> {
  if (!SLUG.test(slug)) throw new HttpError(400, "Not a widget name");
  const { manifest, script, html, sha } = await fetchCommunityWidget(slug);
  const data = { manifest, script, html, sha };
  const row = await prisma.customWidget.upsert({
    where: { userId_source_slug: { userId, source: "community", slug } },
    create: { userId, source: "community", slug, ...data },
    update: data,
  });
  return out(row)!;
}

// --- Across the instance, for admins ------------------------------------------------------------------------------

export type WidgetUser = { id: string; displayName: string; email: string; placed: boolean };
export type WidgetInUse = {
  /** The widget's id for an own one; the slug for a community one, which all its installs share. */
  key: string;
  source: WidgetSource;
  slug: string;
  manifest: WidgetManifest;
  users: WidgetUser[];
};

/** Every custom widget someone has: a community widget once, with everyone who installed it; an own widget once
 *  per owner. `placed` when it's on one of the user's dashboards rather than only installed. */
export async function widgetsInUse(): Promise<WidgetInUse[]> {
  const rows = await prisma.customWidget.findMany({
    select: {
      id: true,
      source: true,
      slug: true,
      manifest: true,
      user: { select: { id: true, displayName: true, email: true, dashboardTemplates: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const byKey = new Map<string, WidgetInUse>();
  for (const row of rows) {
    const manifest = manifestSchema.safeParse(row.manifest);
    if (!manifest.success) continue;
    const source: WidgetSource = row.source === "community" ? "community" : "own";
    const key = source === "community" ? row.slug : row.id;
    // Panels name the widget "custom-<id>", with ":<copy>" after a copy's.
    const placed = JSON.stringify(row.user.dashboardTemplates ?? null).includes(`"custom-${row.id}`);
    const user = { id: row.user.id, displayName: row.user.displayName, email: row.user.email, placed };
    const entry = byKey.get(key);
    if (entry) entry.users.push(user);
    // The most recently updated copy's metadata stands for the widget.
    else byKey.set(key, { key, source, slug: row.slug, manifest: manifest.data, users: [user] });
  }
  return [...byKey.values()].toSorted((a, b) => b.users.length - a.users.length);
}

export type CommunityWidgetUsage = {
  slug: string;
  manifest: WidgetManifest;
  installs: number;
  /** Installs still on an earlier version of the repository's files. */
  outdated: number;
};

/** The repository's widgets with how many users installed each. */
export async function communityWidgetUsage(): Promise<CommunityWidgetUsage[]> {
  const [catalog, installed] = await Promise.all([
    communityCatalog(),
    prisma.customWidget.findMany({ where: { source: "community" }, select: { slug: true, sha: true } }),
  ]);
  return catalog.map(({ slug, manifest, sha }) => {
    const copies = installed.filter((row) => row.slug === slug);
    return { slug, manifest, installs: copies.length, outdated: copies.filter((row) => row.sha !== sha).length };
  });
}

// --- Reaching declared hosts ----------------------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const widgetFetchSchema = z.object({
  url: z.string().url().max(4096),
  method: z.enum(METHODS).default("GET"),
  headers: z.record(z.string().max(100), z.string().max(4096)).default({}),
  body: z.string().max(FETCH_MAX_BYTES).optional(),
});

/** Whether a host the widget asked for is one its metadata declared ("*.example.com" covers its subdomains). */
export function hostAllowed(url: URL, hosts: string[]): boolean {
  const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
  return hosts.some((declared) => {
    if (!declared.startsWith("*.")) return declared === host || declared === url.hostname;
    const [pattern, port] = declared.split(":");
    if (port && port !== url.port) return false;
    const suffix = pattern.slice(1);
    return url.hostname.endsWith(suffix) && url.hostname.length > suffix.length;
  });
}

// Link-local addresses, where clouds serve instance metadata and credentials (169.254.169.254, fd00:ec2::254). The LAN
// stays reachable; these never hold a printer or a NAS a widget would want.
const BLOCKED_ADDRESSES = new BlockList();
BLOCKED_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED_ADDRESSES.addSubnet("fe80::", 10, "ipv6");
BLOCKED_ADDRESSES.addAddress("fd00:ec2::254", "ipv6");

function blockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED_ADDRESSES.check(mapped, "ipv4");
  const family = isIP(address);
  return family !== 0 && BLOCKED_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Whether the host is a metadata address written out, or the name one goes by. Names resolving to one are refused
 *  when connecting, by `blockingLookup`. */
export function metadataHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "");
  return isIP(bare) ? blockedAddress(bare) : bare.toLowerCase() === "metadata.google.internal";
}

const BLOCKED = "WIDGET_HOST_BLOCKED";

/** A DNS lookup that fails on a metadata address. Used for the connection itself, so the address checked is the one
 *  connected to, and a host can't resolve to something harmless for a check and to a metadata address after it. */
export function blockingLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return (hostname, options, callback) =>
    resolve(hostname, options, (err, address, family) => {
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      if (!err && addresses.some(blockedAddress))
        err = Object.assign(new Error(`${hostname} resolves to a cloud metadata address`), { code: BLOCKED });
      callback(err, address as string, family as number);
    });
}

const widgetDispatcher = new Agent({ connect: { lookup: blockingLookup() } });

const blockedByLookup = (err: unknown): boolean =>
  err instanceof Error && ((err as { code?: unknown }).code === BLOCKED || blockedByLookup(err.cause));

// Headers the server sets or that would leak the browser's own session; a widget can't send them.
const DROPPED_HEADERS = new Set(["host", "cookie", "content-length", "connection", "transfer-encoding"]);

/** A widget's request to one of its declared hosts, made by the server so CORS and the LAN aren't in the way. */
export async function widgetFetch(
  userId: string,
  widgetId: string,
  request: z.infer<typeof widgetFetchSchema>,
): Promise<{ status: number; contentType: string | null; body: string }> {
  const widget = await getCustomWidget(userId, widgetId);
  await assertWidgetSourceEnabled(widget.source);
  return declaredHostFetch(widget.manifest.hosts, request, "widget");
}

/** A request to one of the hosts a widget's or tool's metadata declares. Like the RSS panel, it may reach the local
 *  network; what's limited is the scheme, the hosts (never a cloud metadata address), the time and the size. */
export async function declaredHostFetch(
  hosts: string[],
  request: z.infer<typeof widgetFetchSchema>,
  what: "widget" | "tool",
): Promise<{ status: number; contentType: string | null; body: string }> {
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http and https addresses");
  if (!hostAllowed(url, hosts))
    throw new HttpError(403, `"${url.host}" isn't among the hosts this ${what} declares`, "WIDGET_HOST_NOT_DECLARED");
  if (metadataHost(url.hostname)) throw new HttpError(403, `"${url.host}" is a cloud metadata address`, BLOCKED);
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => !DROPPED_HEADERS.has(name.toLowerCase())),
  );
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      dispatcher: widgetDispatcher,
    } as RequestInit);
  } catch (err) {
    if (blockedByLookup(err)) throw new HttpError(403, `"${url.host}" is a cloud metadata address`, BLOCKED);
    throw new HttpError(502, `${url.host} didn't answer`, "WIDGET_HOST_UNREACHABLE");
  }
  const { buffer } = await readCapped(res, FETCH_MAX_BYTES);
  return { status: res.status, contentType: res.headers.get("content-type"), body: buffer.toString("utf8") };
}
