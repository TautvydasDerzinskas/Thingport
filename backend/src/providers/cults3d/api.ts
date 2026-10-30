import { credentialRequest, assertCredentialDestination } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { sleep } from "../../utils/concurrency";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { isCloudflareChallenge } from "../../services/flaresolverr";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import {
  cults3dLikesKey,
  cults3dLikesUrl,
  cults3dModelUrl,
  cults3dPrintlistUrl,
  parseCults3dLikesUrl,
  parseCults3dModelUrl,
  parseCults3dPrintlistUrl,
  urls,
} from "./urls.generated";
import manifest from "./manifest.generated";
export {
  cults3dLikesKey,
  cults3dLikesUrl,
  cults3dModelUrl,
  cults3dPrintlistUrl,
  parseCults3dLikesUrl,
  parseCults3dModelUrl,
  parseCults3dPrintlistUrl,
};

// Cults3D has two doors. Its GraphQL API, with the user's nickname and an API key they make on the site, reads models,
// likes, their own printlists and their orders, and isn't behind Cloudflare. It never hands out files, though: those
// are on the site's own pages, behind a Cloudflare challenge that no client Thingport has gets past. What does is the
// browser's own cf_clearance cookie, sent with the User-Agent it was issued to, from the browser's IP address; Thingport
// Grab sends it along with the _session_id sign-in. With them, a free model is "ordered" for nothing, as its Download
// button does, and an order line's download page redirects to a signed CloudFront link that needs nothing at all.
const SITE_ORIGIN = manifest.site;
const DOWNLOAD_HOST = new URL(manifest.endpoints.downloads).hostname;
const GRAPHQL_URL = `${SITE_ORIGIN}/graphql`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
// The API allows 1 to 100 per page.
const PAGE_SIZE = 100;
// The API's rate limit is per minute; a wait past that means something else is wrong.
const MAX_RATE_LIMIT_WAIT_MS = 65_000;
const RATE_LIMIT_RETRIES = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The user's API access: their Cults3D nickname and an API key made on the site. */
export type Cults3dCredentials = { nick: string; apiKey: string };

/** The browser's sign-in and Cloudflare clearance, as Thingport Grab sends them. */
export type Cults3dBrowser = { session: string; clearance: string | null; userAgent: string | null };

export class Cults3dAuthError extends Error {
  constructor() {
    super(
      "Cults3D didn't accept your nickname and API key. Check them, or make a new key on cults3d.com, in " +
        "Configuration > Providers.",
    );
    this.name = "Cults3dAuthError";
  }
}

/** The API's rate limit, still in place after waiting it out. */
export class Cults3dRateLimitError extends Error {
  constructor() {
    super("Cults3D's API rate limit was reached. It clears within a minute or so -- wait, then try again.");
    this.name = "Cults3dRateLimitError";
  }
}

/** The site's sign-in page instead of the user's: the session ended, or Grab never sent one. */
export class Cults3dSessionError extends Error {
  constructor() {
    super(
      "Cults3D's site didn't accept your sign-in; it may have expired. Visit cults3d.com signed in with Thingport " +
        "Grab, then try again.",
    );
    this.name = "Cults3dSessionError";
  }
}

/** The site's Cloudflare challenged Thingport: the clearance ran out, or Thingport isn't online from the browser's IP
 *  address, which the clearance is tied to. */
export class Cults3dBlockedError extends Error {
  constructor() {
    super(
      "Cults3D's Cloudflare turned Thingport away from its download pages. Visit cults3d.com with Thingport Grab to " +
        "renew its clearance, then try again. It only works when Thingport reaches the internet from the same " +
        "address as that browser.",
    );
    this.name = "Cults3dBlockedError";
  }
}

/** A model page without the free Download form, so Thingport can't order it as the button would. */
export class Cults3dNoFreeDownloadError extends Error {
  constructor() {
    super(
      "Cults3D's page for this model has no free Download button, so Thingport can't order it. Download it once on " +
        "cults3d.com, then import it again.",
    );
    this.name = "Cults3dNoFreeDownloadError";
  }
}

/** The API key and the browser's sign-in are two different Cults3D accounts. A download link comes from the key's own
 *  orders, and the site hands over an order's files only to the account that placed it, so the two have to match.
 *  `nicks` names them where Thingport knows both. */
export class Cults3dWrongAccountError extends Error {
  constructor(nicks?: { api: string; site: string }) {
    super(
      nicks
        ? `Thingport's Cults3D API key is ${nicks.api}'s, but the cults3d.com sign-in it has is signed in as ` +
            `${nicks.site}, and Cults3D gives a download only to the account that ordered it. Sign in to cults3d.com ` +
            `as ${nicks.api} and visit it with Thingport Grab, or enter ${nicks.site}'s nickname and API key in ` +
            "Configuration > Providers."
        : "Cults3D wouldn't hand over this download, which it does when the cults3d.com sign-in Thingport has isn't " +
            "the account that ordered the model. Make sure the sign-in and the API key in Configuration > Providers " +
            "are the same Cults3D account.",
    );
    this.name = "Cults3dWrongAccountError";
  }
}

/** As likesCollectionName names Thingiverse's. */
export function cults3dLikesName(nick: string): string {
  return `Cults3D likes (@${nick})`;
}

// ---- Links ----

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return urls.isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

// Its own bucket on Scaleway's object storage, where older models' files are: the host is Scaleway's, shared with
// everyone else's buckets, so a link there counts only in this one.
const SCALEWAY_HOST = "s3.fr-par.scw.cloud";
const SCALEWAY_BUCKET = "/cults-stl-prod/";

/** The hosts of the signed links the site's download pages redirect to: its CloudFront one, and Scaleway's. */
export function isCults3dFileHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === DOWNLOAD_HOST || host === SCALEWAY_HOST;
}

/** A signed link to the model's files: on CloudFront, or in Cults3D's own bucket on Scaleway. */
export function isCults3dFileUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === DOWNLOAD_HOST) return true;
  return host === SCALEWAY_HOST && url.pathname.startsWith(SCALEWAY_BUCKET);
}

// ---- The API ----

async function postGraphql(
  credentials: Cults3dCredentials,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  const auth = Buffer.from(`${credentials.nick}:${credentials.apiKey}`).toString("base64");
  return credentialRequest("cults3d-api", GRAPHQL_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

/** How long until the rate limit resets, from its header; null when it doesn't say. */
function rateLimitWait(headers: Headers): number | null {
  const reset = Date.parse(headers.get("x-ratelimit-reset") ?? "");
  if (!Number.isFinite(reset)) return null;
  return Math.max(0, reset - Date.now()) + 1000;
}

/** One query's `data`. Throws Cults3dAuthError for credentials it turns down, Cults3dRateLimitError when its rate limit
 *  outlasts a wait, and a plain Error for anything else, its message the API's own. */
async function graphql(
  credentials: Cults3dCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  let res = await postGraphql(credentials, query, variables);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await res.body?.cancel().catch(() => undefined);
    const wait = rateLimitWait(res.headers) ?? 15_000 * retry;
    if (wait > MAX_RATE_LIMIT_WAIT_MS) break;
    await sleep(wait);
    res = await postGraphql(credentials, query, variables);
  }
  if (res.status === 401) {
    await res.body?.cancel().catch(() => undefined);
    throw new Cults3dAuthError();
  }
  if (res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    throw new Cults3dRateLimitError();
  }
  const body: unknown = await res.json().catch(() => null);
  const errors = isRecord(body) ? records(body.errors) : [];
  // Partial data beside errors is a failure too: a field that errored reads as null, which would pass for a user or
  // printlist that doesn't exist, and a sync unsyncs what's missing.
  if (!res.ok || !isRecord(body) || !isRecord(body.data) || errors.length) {
    const message = errors.map((e) => str(e.message)).find(Boolean);
    throw new Error(`Cults3D's API failed${message ? `: ${message}` : ` (HTTP ${res.status})`}`);
  }
  return body.data;
}

/** Whose the credentials are, or "rejected"/"unreachable". */
export async function checkCults3dCredentials(
  credentials: Cults3dCredentials,
): Promise<{ nick: string } | "rejected" | "unreachable"> {
  try {
    const data = await graphql(credentials, "{ myself { user { nick } } }");
    const nick = isRecord(data.myself) && isRecord(data.myself.user) ? str(data.myself.user.nick) : null;
    return nick ? { nick } : "unreachable";
  } catch (err) {
    return err instanceof Cults3dAuthError ? "rejected" : "unreachable";
  }
}

// ---- Models ----

const CREATION_FIELDS = `
  slug
  name
  description
  details
  tags
  url
  price(currency: EUR) { cents formatted }
  category { id }
  subCategories { id }
  illustrations { imageUrl }
  blueprints { fileName }
  creator { nick imageUrl bio url }
`;

/** The site's GraphQL ids are base64 of "Type/<number>": "Q2F0ZWdvcnkvMjM" is Category 23. */
export function cults3dNumericId(identifier: unknown): number | null {
  const value = str(identifier);
  if (!value) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
  const m = decoded.match(/^[A-Za-z]+\/(\d+)$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The original upload, which needs nothing to download, rather than the API's 516-pixel copy of it. */
export function cults3dOriginalImage(url: string): string {
  const original = url.match(/\/(https:\/\/fbi\.cults3d\.com\/[^?#]+)$/i)?.[1];
  return original ?? url;
}

/** Designers put up videos among their pictures; an image can't be made of those. */
function isPicture(url: string): boolean {
  return !/\.(mp4|webm|mov|m4v)$/i.test(url.split(/[?#]/)[0]);
}

function imageName(url: string, index: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {}
  return name || `image-${index}.jpg`;
}

function authorOf(creator: unknown): ImportedAuthorInfo | null {
  if (!isRecord(creator)) return null;
  const nick = str(creator.nick);
  if (!nick) return null;
  return {
    provider: PROVIDER,
    // Nicknames are what the site knows its users by, in links and its API alike.
    externalId: nick,
    name: nick,
    handle: nick,
    bio: str(creator.bio)?.replace(/\r\n?/g, "\n") ?? null,
    bioTranslated: null,
    links: [str(creator.url) ?? `${SITE_ORIGIN}/en/users/${encodeURIComponent(nick)}`],
    avatarUrl: str(creator.imageUrl),
    backgroundUrl: null,
  };
}

export type Cults3dModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  slug: string;
  /** In cents, 0 when free. */
  priceCents: number;
  /** As the site shows it, e.g. "€2.99"; null when free. */
  priceText: string | null;
};

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function cults3dMetaFromCreation(creation: Record<string, unknown>): Cults3dModelResolution | null {
  const slug = str(creation.slug);
  if (!slug) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(creation.name);
  if (title) meta.title = title;
  // Plain text, as the site shows it; its print settings come after the description, under their own heading.
  const description = str(creation.description)?.replace(/\r\n?/g, "\n");
  const details = str(creation.details)?.replace(/\r\n?/g, "\n");
  const text = [description, details ? `### 3D printing settings\n\n${details}` : null].filter(Boolean).join("\n\n");
  if (text) meta.description = text;
  const tags = [...new Set((Array.isArray(creation.tags) ? creation.tags : []).flatMap((t) => str(t) ?? []))];
  if (tags.length) meta.tags = tags;
  const images = [
    ...new Set(
      records(creation.illustrations)
        .flatMap((i) => (str(i.imageUrl) ? [cults3dOriginalImage(str(i.imageUrl)!)] : []))
        .filter(isPicture),
    ),
  ];
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(creation.creator);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // Most specific first: a subcategory beats the category it's in.
  const categories = [
    ...new Set(
      [...records(creation.subCategories), isRecord(creation.category) ? creation.category : null].flatMap((c) =>
        c ? (cults3dNumericId(c.id) ?? []) : [],
      ),
    ),
  ];
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }
  const price = isRecord(creation.price) ? creation.price : null;
  const priceCents = count(price?.cents);
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    slug,
    priceCents,
    priceText: priceCents > 0 ? (str(price?.formatted) ?? `€${(priceCents / 100).toFixed(2)}`) : null,
  };
}

/** By its slug. Null for one that doesn't exist, or isn't public. */
export async function resolveCults3dModel(
  slug: string,
  credentials: Cults3dCredentials,
): Promise<Cults3dModelResolution | null> {
  const data = await graphql(credentials, `query ($slug: String!) { creation(slug: $slug) { ${CREATION_FIELDS} } }`, {
    slug,
  });
  return isRecord(data.creation) ? cults3dMetaFromCreation(data.creation) : null;
}

// ---- Orders: what the user can download ----

/** Every model the user ordered, free ones included, by slug: the page each one's files are on. Cults3D's orders are
 *  its library: a bought or downloaded model is in one for good. */
export async function fetchCults3dOrders(credentials: Cults3dCredentials): Promise<Map<string, string>> {
  const lines = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const data = await graphql(
      credentials,
      `
        query ($limit: Int!, $offset: Int!) {
          myself {
            ordersBatch(limit: $limit, offset: $offset) {
              total
              results {
                lines {
                  downloadUrl
                  creation {
                    slug
                  }
                }
              }
            }
          }
        }
      `,
      { limit: PAGE_SIZE, offset },
    );
    const batch = isRecord(data.myself) && isRecord(data.myself.ordersBatch) ? data.myself.ordersBatch : null;
    const orders = records(batch?.results);
    for (const order of orders) {
      for (const line of records(order.lines)) {
        const slug = isRecord(line.creation) ? str(line.creation.slug) : null;
        const url = str(line.downloadUrl);
        if (slug && url && !lines.has(slug)) lines.set(slug, url);
      }
    }
    if (orders.length < PAGE_SIZE || offset + PAGE_SIZE >= count(batch?.total)) break;
  }
  return lines;
}

// ---- The site: free orders and downloads, with the browser's sign-in ----

const SITE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** One request to the site as the browser: its cookies and the User-Agent its clearance was issued to. Plain fetch on
 *  purpose: the clearance is what gets past Cloudflare, and it only holds for that User-Agent. Redirects are the
 *  caller's. */
async function fetchSite(
  url: string,
  browser: Cults3dBrowser,
  { method = "GET", body, referer }: { method?: "GET" | "POST"; body?: string; referer?: string } = {},
): Promise<Response> {
  const { session, clearance } = manifest.sessionCookies;
  const cookie = [`${session}=${browser.session}`, browser.clearance ? `${clearance}=${browser.clearance}` : null]
    .filter(Boolean)
    .join("; ");
  assertCredentialDestination("cults3d-session", url);
  const res = await fetch(url, {
    method,
    body,
    redirect: "manual",
    headers: {
      Accept: SITE_ACCEPT,
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookie,
      ...(browser.userAgent ? { "User-Agent": browser.userAgent } : {}),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE_ORIGIN } : {}),
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (isCloudflareChallenge(res.headers)) {
    await res.body?.cancel().catch(() => undefined);
    throw new Cults3dBlockedError();
  }
  return res;
}

function locationOf(res: Response, base: string): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

/** The site's sign-in pages, where it sends a request without a session it accepts. */
function isSignInUrl(url: string): boolean {
  try {
    return /\/(log-in|users\/sign[_-]in)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** A page of the site, its redirects followed while they stay on it; throws Cults3dSessionError when they lead to its
 *  sign-in. */
async function fetchSitePage(
  url: string,
  browser: Cults3dBrowser,
  what = "the model's page",
): Promise<{ url: string; html: string }> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetchSite(current, browser);
    const next = locationOf(res, current);
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel().catch(() => undefined);
      if (isSignInUrl(next)) throw new Cults3dSessionError();
      if (!parseUrl(next)) throw new Error(`Cults3D sent its page elsewhere (${new URL(next).hostname})`);
      current = next;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`Couldn't open ${what} on Cults3D (HTTP ${res.status})`);
    }
    return { url: current, html: await res.text() };
  }
  throw new Error(`Cults3D redirected ${what} too many times`);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The nickname a sign-in belongs to, from the avatar in the header's own menu, which every signed-in page carries once
 *  and names the user in. Null on a page showing no one signed in. */
export function cults3dSignedInNick(html: string): string | null {
  const avatar = html.match(/<img\b[^>]*\bclass="[^"]*\bdrop-toggle-avatar\b[^"]*"[^>]*>/i)?.[0];
  const nick = avatar?.match(/\balt="([^"]*)"/i)?.[1];
  return nick ? decodeEntities(nick).trim() || null : null;
}

/** Who the browser's sign-in is, as the site itself shows it: read from the user's orders, the very pages a download
 *  comes from. Throws Cults3dSessionError when the site shows no one signed in. */
export async function fetchCults3dSignedInNick(browser: Cults3dBrowser): Promise<string> {
  const page = await fetchSitePage(`${SITE_ORIGIN}/en/orders`, browser, "your Cults3D downloads");
  const nick = cults3dSignedInNick(page.html);
  if (!nick) throw new Cults3dSessionError();
  return nick;
}

/** The free model's Download form: where it posts and its CSRF token. Null on a page without one -- a paid model, or
 *  one the user signed out of. */
export function cults3dFreeOrderForm(html: string): { action: string; token: string } | null {
  const form = html.match(/<form\b[^>]*\baction="(\/[a-z]{2}\/free_orders\?[^"]+)"[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const token = form[2].match(/name="authenticity_token"\s+value="([^"]+)"/i)?.[1];
  return token ? { action: decodeEntities(form[1]), token: decodeEntities(token) } : null;
}

/** Orders a free model for the user, as its Download button does, so its files are theirs to download. Throws
 *  Cults3dSessionError when the page shows the user signed out. */
export async function placeCults3dFreeOrder(slug: string, browser: Cults3dBrowser): Promise<void> {
  const page = await fetchSitePage(cults3dModelUrl(slug), browser);
  const form = cults3dFreeOrderForm(page.html);
  if (!form) throw new Cults3dNoFreeDownloadError();
  const res = await fetchSite(`${SITE_ORIGIN}${form.action}`, browser, {
    method: "POST",
    body: new URLSearchParams({ authenticity_token: form.token }).toString(),
    referer: page.url,
  });
  await res.body?.cancel().catch(() => undefined);
  const next = locationOf(res, SITE_ORIGIN);
  if (next && isSignInUrl(next)) throw new Cults3dSessionError();
  if (res.status === 422) throw new Cults3dSessionError();
  if (res.status >= 400) throw new Error(`Cults3D didn't take the free order (HTTP ${res.status})`);
}

export type Cults3dFile = { name: string; url: string };

/** An order line's download page: the signed link to the model's files, a zip, it redirects to. */
export async function resolveCults3dDownload(downloadUrl: string, browser: Cults3dBrowser): Promise<Cults3dFile> {
  if (!parseUrl(downloadUrl)) throw new Error("Not a Cults3D download link");
  const res = await fetchSite(downloadUrl, browser);
  await res.body?.cancel().catch(() => undefined);
  const next = locationOf(res, downloadUrl);
  if (!next || res.status < 300 || res.status >= 400) {
    throw new Error(`Cults3D didn't hand over the model's files (HTTP ${res.status})`);
  }
  if (isSignInUrl(next)) throw new Cults3dSessionError();
  let parsed: URL;
  try {
    parsed = new URL(next);
  } catch {
    throw new Error("Cults3D sent the download somewhere unexpected");
  }
  // Kept on the site instead of sent to the files: the site bounces the download page back where it came from when the
  // sign-in may not have the order, which is what a sign-in on another account than the API key's means.
  if (urls.isHost(parsed.hostname)) throw new Cults3dWrongAccountError();
  if (!isCults3dFileUrl(parsed)) {
    throw new Error(`Cults3D sent the download somewhere unexpected (${parsed.hostname})`);
  }
  const name = decodeURIComponent(parsed.pathname.split("/").pop() ?? "") || "cults3d.zip";
  return { name, url: next };
}

// ---- Listings ----

export type Cults3dModelSummary = { slug: string; title: string; cover: string | null };
export type Cults3dListing = { entries: Cults3dModelSummary[]; total: number; truncated: boolean };

const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;
const SUMMARY_FIELDS = "slug name illustrationImageUrl price(currency: EUR) { cents }";

/** What a listing shows of a model. Paid ones download only once bought (`owned`), so the rest are left out: a sync
 *  would otherwise fail them on every round. */
function summaryOf(creation: Record<string, unknown>, owned: Set<string>): Cults3dModelSummary | null {
  const slug = str(creation.slug);
  if (!slug) return null;
  const price = isRecord(creation.price) ? count(creation.price.cents) : 0;
  if (price > 0 && !owned.has(slug)) return null;
  const cover = str(creation.illustrationImageUrl);
  return { slug, title: str(creation.name) ?? slug, cover: cover && isPicture(cover) ? cover : null };
}

function listingOf(creations: Record<string, unknown>[], owned: Set<string>, maxItems: number): Cults3dListing {
  const seen = new Set<string>();
  const entries: Cults3dModelSummary[] = [];
  for (const creation of creations) {
    const entry = summaryOf(creation, owned);
    if (!entry || seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    entries.push(entry);
  }
  return { entries: entries.slice(0, maxItems), total: entries.length, truncated: entries.length > maxItems };
}

/** A user's liked models, which Cults3D shows anyone. Null for a user that doesn't exist. */
export async function fetchCults3dLikes(
  credentials: Cults3dCredentials,
  nick: string,
  owned: Set<string>,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<Cults3dListing | null> {
  const creations: Record<string, unknown>[] = [];
  // The likes come without a total: a short page is the last.
  for (let offset = 0; creations.length < maxItems; offset += PAGE_SIZE) {
    const data = await graphql(
      credentials,
      `query ($nick: String!, $limit: Int!, $offset: Int!) {
        user(nick: $nick) { likedCreations(limit: $limit, offset: $offset) { ${SUMMARY_FIELDS} } }
      }`,
      { nick, limit: PAGE_SIZE, offset },
    );
    if (!isRecord(data.user)) return null;
    const page = records(data.user.likedCreations);
    creations.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return listingOf(creations, owned, maxItems);
}

export type Cults3dPrintlistInfo = {
  id: string;
  name: string;
  nick: string;
  slug: string;
  url: string;
  public: boolean;
  modelCount: number;
  /** Its first few models' pictures. */
  thumbnails: string[];
};

/** The user's own printlists. Cults3D's API shows no one else's. */
export async function fetchOwnCults3dPrintlists(credentials: Cults3dCredentials): Promise<Cults3dPrintlistInfo[]> {
  const out: Cults3dPrintlistInfo[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const data = await graphql(
      credentials,
      `query ($limit: Int!, $offset: Int!) {
        myself { printlistsBatch(limit: $limit, offset: $offset) { total results {
          id name url public creationsCount creationsBatch(limit: ${CARD_THUMBNAILS}) { results { illustrationImageUrl } }
        } } }
      }`,
      { limit: PAGE_SIZE, offset },
    );
    const batch = isRecord(data.myself) && isRecord(data.myself.printlistsBatch) ? data.myself.printlistsBatch : null;
    const results = records(batch?.results);
    for (const printlist of results) {
      const id = str(printlist.id);
      const parsed = parseCults3dPrintlistUrl(str(printlist.url) ?? "");
      if (!id || !parsed) continue;
      out.push({
        id,
        name: str(printlist.name) ?? parsed.slug,
        nick: parsed.nick,
        slug: parsed.slug,
        url: parsed.url,
        public: printlist.public === true,
        modelCount: count(printlist.creationsCount),
        thumbnails: records(isRecord(printlist.creationsBatch) ? printlist.creationsBatch.results : null)
          .flatMap((creation) => str(creation.illustrationImageUrl) ?? [])
          .filter(isPicture),
      });
    }
    if (results.length < PAGE_SIZE || offset + PAGE_SIZE >= count(batch?.total)) break;
  }
  return out;
}

/** One of the user's own printlists, by its "<nick>/<slug>" key, and its models. Null for one they don't have. */
export async function fetchCults3dPrintlist(
  credentials: Cults3dCredentials,
  key: string,
  owned: Set<string>,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<(Cults3dListing & { info: Cults3dPrintlistInfo }) | null> {
  const info = (await fetchOwnCults3dPrintlists(credentials)).find(
    (printlist) => `${printlist.nick}/${printlist.slug}`.toLowerCase() === key.toLowerCase(),
  );
  if (!info) return null;
  const creations: Record<string, unknown>[] = [];
  for (let offset = 0; creations.length < maxItems; offset += PAGE_SIZE) {
    const data = await graphql(
      credentials,
      `query ($limit: Int!, $offset: Int!) {
        myself { printlistsBatch(limit: 100) { results { id creationsBatch(limit: $limit, offset: $offset) { total results { ${SUMMARY_FIELDS} } } } } }
      }`,
      { limit: PAGE_SIZE, offset },
    );
    const printlist = records(
      isRecord(data.myself) && isRecord(data.myself.printlistsBatch) ? data.myself.printlistsBatch.results : null,
    ).find((p) => str(p.id) === info.id);
    const batch = printlist && isRecord(printlist.creationsBatch) ? printlist.creationsBatch : null;
    const page = records(batch?.results);
    creations.push(...page);
    if (page.length < PAGE_SIZE || offset + PAGE_SIZE >= count(batch?.total)) break;
  }
  return { ...listingOf(creations, owned, maxItems), info };
}

/** The user's likes, then their own printlists, as the sync dialog's Browse tab shows them. */
export async function listCults3dCollections(
  credentials: Cults3dCredentials,
  owned: Set<string>,
): Promise<ProviderCollectionCard[]> {
  const likes = await fetchCults3dLikes(credentials, credentials.nick, owned);
  const cards: ProviderCollectionCard[] = [
    {
      id: cults3dLikesKey(credentials.nick),
      name: cults3dLikesName(credentials.nick),
      url: cults3dLikesUrl(credentials.nick),
      modelCount: likes?.total ?? 0,
      thumbnails: (likes?.entries ?? []).slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: credentials.nick,
    },
  ];
  for (const printlist of await fetchOwnCults3dPrintlists(credentials)) {
    cards.push({
      id: `${printlist.nick}/${printlist.slug}`.toLowerCase(),
      name: printlist.name,
      url: printlist.url,
      modelCount: printlist.modelCount,
      thumbnails: printlist.thumbnails,
      private: !printlist.public,
      owner: printlist.nick,
    });
  }
  return cards;
}

/** Cults3D's most downloaded models of late. Its API needs the user's own nickname and API key. */
export async function fetchCults3dPopular(limit: number, credentials: Cults3dCredentials): Promise<TrendingModel[]> {
  const data = await graphql(
    credentials,
    `
      query ($limit: Int!) {
        creationsBatch(limit: $limit, sort: BY_DOWNLOADS, direction: DESC) {
          results {
            slug
            name
            illustrationImageUrl
            likesCount
            creator {
              nick
            }
            price(currency: EUR) {
              cents
            }
          }
        }
      }
    `,
    { limit },
  );
  return recordsOf(asRecord(data.creationsBatch)?.results).flatMap((creation) => {
    const slug = asText(creation.slug);
    if (!slug) return [];
    return [
      {
        id: slug,
        title: asText(creation.name) ?? slug,
        url: cults3dModelUrl(slug),
        image: webImage(creation.illustrationImageUrl),
        likes: asCount(creation.likesCount),
        author: asText(asRecord(creation.creator)?.nick),
        paid: Boolean(asCount(asRecord(creation.price)?.cents)),
      },
    ];
  });
}
