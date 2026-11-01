// Dashboard widgets made by users, or shared through the community repository: metadata, an ES module and optional
// HTML. Their scripts run in the user's dashboard page with the user's access, so a community widget is kept exactly
// as installed (its files and their hash) until the user chooses to take an update, and an admin can turn custom
// widgets off for the instance.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import nodePath from "node:path";
import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { readCapped } from "../utils/readCapped";
import { TtlCache } from "../utils/ttlCache";
import {
  LOCALE_MAX_BYTES,
  LOCALES_MAX_BYTES,
  SCREENSHOT_EXTS,
  SCREENSHOT_MAX_BYTES,
  SLUG,
  localeFile,
  localesSchema,
  manifestSchema,
  parseManifest,
  validateCode,
  type Locales,
  type WidgetManifest,
} from "./customWidgetFormat";
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

export {
  SLUG,
  manifestSchema,
  parseManifest,
  validateManifest,
  localesSchema,
  type Locales,
  type WidgetManifest,
} from "./customWidgetFormat";

// The labels are part of it: a widget whose words changed has changed, and the panel runs it again.
const shaOf = (manifest: WidgetManifest, script: string, html: string | null, locales: Locales = {}) =>
  createHash("sha256")
    .update(JSON.stringify(manifest))
    .update("\0")
    .update(script)
    .update("\0")
    .update(html ?? "")
    .update("\0")
    .update(
      JSON.stringify(
        Object.keys(locales)
          .toSorted()
          .map((code) => [code, locales[code]]),
      ),
    )
    .digest("hex");

export type CustomWidgetOut = {
  id: string;
  source: "own" | "community";
  slug: string;
  manifest: WidgetManifest;
  script: string;
  html: string | null;
  /** Its labels by language; `{}` for a widget that ships none. */
  locales: Locales;
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
  locales?: unknown;
  sha: string;
  updatedAt: Date;
};

/** The stored labels, ignoring anything that no longer fits the shape rather than refusing the whole widget. */
function localesOf(row: Pick<Row, "locales">): Locales {
  if (!row.locales) return {};
  const parsed = localesSchema.safeParse(row.locales);
  return parsed.success ? parsed.data : {};
}

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
    locales: localesOf(row),
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
  input: {
    slug: string;
    manifest: WidgetManifest;
    script: string;
    html?: string | null;
    locales?: Locales;
  },
): Promise<CustomWidgetOut> {
  if (!SLUG.test(input.slug))
    throw new HttpError(400, "The slug is 2-40 lowercase letters, digits and dashes, starting with a letter or digit");
  if (input.manifest.screenshots.length)
    throw new HttpError(400, "Only a widget shared through the repository has screenshots: it carries the files");
  const html = input.html?.trim() ? input.html : null;
  validateCode(input.script, html);
  // Credited when downloaded to share, so it goes out with a name on it.
  const author =
    input.manifest.author ?? (await prisma.user.findUnique({ where: { id: userId } }))?.displayName.slice(0, 60);
  const locales = ownLocales(input.locales);
  // What the widget actually has, rather than what its metadata claims: the languages come from the labels given.
  const manifest = { ...input.manifest, author, locales: Object.keys(locales) };
  const data = {
    manifest,
    script: input.script,
    html,
    locales: locales as Prisma.InputJsonValue,
    sha: shaOf(manifest, input.script, html, locales),
  };
  const row = await prisma.customWidget.upsert({
    where: { userId_source_slug: { userId, source: "own", slug: input.slug } },
    create: { userId, source: "own", slug: input.slug, ...data },
    update: data,
  });
  return out(row)!;
}

/** A user's own labels, checked the way a shared widget's files are, and held to the same total size. */
function ownLocales(raw: Locales | undefined): Locales {
  if (!raw) return {};
  const parsed = localesSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Those labels aren't right");
  if (JSON.stringify(parsed.data).length > LOCALES_MAX_BYTES)
    throw new HttpError(400, `The labels are larger than ${Math.round(LOCALES_MAX_BYTES / 1024)} KB`);
  for (const [code, words] of Object.entries(parsed.data)) {
    if (JSON.stringify(words).length > LOCALE_MAX_BYTES)
      throw new HttpError(400, `The ${code} labels are larger than ${Math.round(LOCALE_MAX_BYTES / 1024)} KB`);
  }
  return parsed.data;
}

export async function deleteCustomWidget(userId: string, id: string): Promise<void> {
  const { count } = await prisma.customWidget.deleteMany({ where: { id, userId } });
  if (!count) throw new HttpError(404, "No such widget");
}

// --- The community repository ---------------------------------------------------------------------------------------

// Where community widgets come from, as with tools. A Thingport run from a checkout of the repository (npm run dev, or
// the local docker-compose.yml, which mounts it as COMMUNITY_WIDGETS_DIR) reads the checkout's own folder, so a widget
// being worked on is what's offered. A published image has none and reads the repository's as GitHub serves it, on
// develop for the :dev image; COMMUNITY_WIDGETS_URL points it at a fork's, and COMMUNITY_WIDGETS_DIR at any folder.
const COMMUNITY_BASE =
  process.env.COMMUNITY_WIDGETS_URL?.replace(/\/+$/, "") ??
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${releaseBranch()}/community-widgets`;
// backend/src/services here, backend/dist/services built: the checkout's root is three up either way.
const CHECKOUT_WIDGETS = nodePath.resolve(__dirname, "../../../community-widgets");

function defaultCommunityDir(): string | null {
  if (process.env.COMMUNITY_WIDGETS_DIR) return nodePath.resolve(process.env.COMMUNITY_WIDGETS_DIR);
  if (process.env.COMMUNITY_WIDGETS_URL) return null;
  return fsSync.existsSync(nodePath.join(CHECKOUT_WIDGETS, "index.json")) ? CHECKOUT_WIDGETS : null;
}

let communityDir: string | null = defaultCommunityDir();

/** Where the community widgets offered come from, for the admin page to say. */
export function communityWidgetsSource(): { kind: "folder" | "repository"; location: string } {
  return communityDir ? { kind: "folder", location: communityDir } : { kind: "repository", location: COMMUNITY_BASE };
}
const COMMUNITY_TTL_MS = 60 * 60 * 1000;
const FILE_MAX_BYTES = 1024 * 1024;

type CommunityFiles = {
  manifest: WidgetManifest;
  script: string;
  html: string | null;
  locales: Locales;
  sha: string;
};
const communityCache = new TtlCache<CommunityFiles[] | (CommunityFiles & { slug: string })>(COMMUNITY_TTL_MS);
const screenshotCache = new TtlCache<{ body: Buffer; type: string }>(COMMUNITY_TTL_MS);

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Lets tests answer for GitHub and for the hosts widgets reach. */
export function setCustomWidgetsFetchForTest(impl?: typeof fetch): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
  communityDir = impl ? null : defaultCommunityDir();
  communityCache.clear();
  screenshotCache.clear();
}

/** Lets tests stand a folder on disk in for the repository. */
export function setCommunityWidgetsDirForTest(dir: string): void {
  communityDir = dir;
  communityCache.clear();
  screenshotCache.clear();
}

/** A file of the repository's community-widgets folder; null when it has none. */
async function fetchFile(path: string, maxBytes = FILE_MAX_BYTES): Promise<Buffer | null> {
  if (communityDir) {
    // Through any links, so one in the folder can't serve a file from outside it.
    const [root, full] = await Promise.all([
      fs.realpath(communityDir),
      fs.realpath(nodePath.resolve(communityDir, path)),
    ]).catch(() => [null, null]);
    if (!root || !full?.startsWith(nodePath.join(root, nodePath.sep))) return null;
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) return null;
    if (stat.size > maxBytes) throw new HttpError(502, `${path} is larger than ${Math.round(maxBytes / 1048576)} MB`);
    return fs.readFile(full);
  }
  const url = `${COMMUNITY_BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `The community repository answered HTTP ${res.status}`);
  const { buffer, truncated } = await readCapped(res, maxBytes);
  if (truncated) throw new HttpError(502, `${path} is larger than ${Math.round(maxBytes / 1048576)} MB`);
  return buffer;
}

async function fetchText(path: string): Promise<string | null> {
  return (await fetchFile(path))?.toString("utf8") ?? null;
}

/** A shared widget's labels: the file for each language its metadata names, as far as each of them reads. */
async function fetchCommunityLocales(slug: string, manifest: WidgetManifest): Promise<Locales> {
  const locales: Locales = {};
  let total = 0;
  for (const code of manifest.locales) {
    const buffer = await fetchFile(`${slug}/${localeFile(code)}`, LOCALE_MAX_BYTES).catch(() => null);
    if (!buffer) continue;
    total += buffer.byteLength;
    if (total > LOCALES_MAX_BYTES)
      throw new HttpError(502, `${slug}'s labels are larger than ${Math.round(LOCALES_MAX_BYTES / 1024)} KB`);
    const parsed = localesSchema.safeParse({ [code]: JSON.parse(buffer.toString("utf8")) as unknown });
    // A language that won't read is simply one the widget doesn't have.
    if (parsed.success) Object.assign(locales, parsed.data);
  }
  return locales;
}

async function fetchCommunityWidget(slug: string): Promise<CommunityFiles & { slug: string }> {
  // A folder on disk is read afresh each time, so a widget being worked on shows its changes at once.
  const cached = communityDir ? undefined : communityCache.get(`widget:${slug}`);
  if (cached && !Array.isArray(cached)) return cached;
  const metadata = (await fetchText(`${slug}/widget.json`)) ?? (await fetchText(`${slug}/widget.yml`));
  const script = await fetchText(`${slug}/widget.js`);
  if (!metadata || !script) throw new HttpError(404, `The community repository has no widget "${slug}"`);
  const html = await fetchText(`${slug}/widget.html`);
  const manifest = parseManifest(metadata);
  validateCode(script, html);
  const locales = await fetchCommunityLocales(slug, manifest);
  const files = { slug, manifest, script, html, locales, sha: shaOf(manifest, script, html, locales) };
  communityCache.set(`widget:${slug}`, files);
  return files;
}

/**
 * One of a shared widget's screenshots, by its place in its metadata: what someone looks at before installing it.
 *
 * Only a widget in the repository has these, because only it brings files of its own; a widget someone wrote here
 * has none to serve.
 */
export async function communityWidgetScreenshot(slug: string, index: number): Promise<{ body: Buffer; type: string }> {
  if (!SLUG.test(slug)) throw new HttpError(400, "Not a widget name");
  const widget = await fetchCommunityWidget(slug);
  const shot = widget.manifest.screenshots[index];
  if (!shot) throw new HttpError(404, "No such screenshot");
  const key = `${slug}/${widget.sha}/${shot.file}`;
  const cached = communityDir ? undefined : screenshotCache.get(key);
  if (cached) return cached;
  const body = await fetchFile(`${slug}/${shot.file}`, SCREENSHOT_MAX_BYTES);
  if (!body) throw new HttpError(404, "The community repository has no such screenshot");
  const image = { body, type: SCREENSHOT_EXTS.get(nodePath.extname(shot.file).toLowerCase())! };
  screenshotCache.set(key, image);
  return image;
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
  const { manifest, script, html, locales, sha } = await fetchCommunityWidget(slug);
  const data = { manifest, script, html, locales: locales as Prisma.InputJsonValue, sha };
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
