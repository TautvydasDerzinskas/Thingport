import { assertCredentialDestination } from "../credentialRequest";
import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { absoluteHttpUrl, htmlToMarkdown } from "../../services/descriptionMarkdown";
import { isCloudflareChallenge } from "../../services/flaresolverr";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import type { TrendingModel } from "../../services/trendingModel";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import { likesCollectionName } from "../names";
import {
  parsePinshapeCollectionUrl,
  parsePinshapeLikesUrl,
  parsePinshapeModelUrl,
  pinshapeCollectionUrl,
  pinshapeLikesKey,
  pinshapeLikesUrl,
  pinshapeModelUrl,
  urls,
} from "./urls.generated";
import manifest from "./manifest.generated";
export {
  parsePinshapeCollectionUrl,
  parsePinshapeLikesUrl,
  parsePinshapeModelUrl,
  pinshapeCollectionUrl,
  pinshapeLikesKey,
  pinshapeLikesUrl,
  pinshapeModelUrl,
};

// Pinshape (MatterHackers' relaunch of it) has no API of its own: its pages are rendered on the server, and the few
// calls they make answer with more of the same HTML ({success, html, pagination}). So this reads the pages. Models,
// collections and likes are anyone's to read; only the files need a sign-in, whose cookies (Flask-Login's
// remember_token, or the session) a download link takes to redirect to a signed S3 link. Its redirects say what
// happened: to /index for a model or user it hasn't got, to /auth/login for a sign-in it turned down. Its Cloudflare
// lets Node's own fetch through.
const SITE_ORIGIN = manifest.site;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_TYPE = "application/json";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;

// Every list of its shows 12 models a page, whatever's asked.
const PAGE_SIZE = 12;
const LISTING_MAX_ENTRIES = 300;
const PAGE_CONCURRENCY = 3;
const CARD_THUMBNAILS = 4;
// Its own lists of a user's collections, past which there are surely no more.
const MAX_COLLECTION_PAGES = 20;

export class PinshapeAuthError extends Error {
  constructor() {
    super(
      "Pinshape didn't accept your sign-in; it may have expired. Visit pinshape.com signed in with Thingport Grab, or " +
        "connect it again in Configuration > Providers.",
    );
    this.name = "PinshapeAuthError";
  }
}

export class PinshapeRateLimitError extends Error {
  constructor() {
    super("Pinshape rate-limited Thingport. Wait a while, then try again.");
    this.name = "PinshapeRateLimitError";
  }
}

export class PinshapeBlockedError extends Error {
  constructor() {
    super("Pinshape's Cloudflare turned Thingport away. Wait a while, then try again.");
    this.name = "PinshapeBlockedError";
  }
}

type Answer = { status: number; location: string | null; body: string };

async function request(path: string, cookie: string | null, accept: string): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${SITE_ORIGIN}${path}`;
    if (cookie) assertCredentialDestination("pinshape-session", url);
    const res = await fetch(url, {
      headers: {
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      // Its redirects are its answers (see above), so they're read rather than followed.
      redirect: "manual",
      signal: controller.signal,
    });
    if (isCloudflareChallenge(res.headers)) throw new PinshapeBlockedError();
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

/** One page or call. Too many at once are waited out a couple of times, then refused. */
async function get(path: string, cookie: string | null = null, accept = HTML): Promise<Answer> {
  let res = await request(path, cookie, accept);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path, cookie, accept);
  }
  if (res.status === 429) throw new PinshapeRateLimitError();
  return res;
}

function redirectedTo(res: Answer): URL | null {
  if (res.status < 300 || res.status >= 400 || !res.location) return null;
  try {
    return new URL(res.location, SITE_ORIGIN);
  } catch {
    return null;
  }
}

// By its host: it writes its own links with http:// as well.
const isSitePage = (url: URL, path: RegExp) => urls.isHost(url.hostname) && path.test(url.pathname);
/** Where it sends a visitor, or a sign-in it doesn't take, from a page that needs one. */
const toSignIn = (url: URL | null) => !!url && isSitePage(url, /^\/auth\/login/);
/** Where it sends a link to a model or user it hasn't got. */
const toHome = (url: URL | null) => !!url && isSitePage(url, /^\/(index)?$/);

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on Pinshape (HTTP ${res.status})`);
}

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function countIn(value: string | null | undefined): number | null {
  const digits = (value ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function unique<T>(items: (T | null | undefined)[]): T[] {
  return [...new Set(items.filter((item): item is T => item != null))];
}

/** A link on its pages as the path it is on the site, or null for one elsewhere. */
function sitePath(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, SITE_ORIGIN);
    return urls.isHost(url.hostname) ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/** A user's profile link, `/users/<id>-<name>`: their id, and `key`, the address part (`<id>-<name>`). */
function userIn(href: string | undefined): { id: string; name: string | null; key: string } | null {
  const m = sitePath(href)?.match(/^\/users\/(\d+)(?:-([^/?#]+))?\/?(?:[?#]|$)/);
  return m ? { id: m[1], name: m[2] ?? null, key: m[2] ? `${m[1]}-${m[2]}` : m[1] } : null;
}

/** "by mykola.lop", as its cards and pages name the designer. */
const designerName = (value: string | null | undefined) => clean(value)?.replace(/^by\s+/i, "") || null;

/** A picture, unless it's the letter avatar a third-party service draws for someone without one. */
function picture(src: string | undefined): string | null {
  const url = absoluteHttpUrl(src ?? null);
  return url && !/^https:\/\/ui-avatars\.com\//i.test(url) ? url : null;
}

/** Its pictures come in sizes named in front of the file's own name: large_, container_, medium_, small_. */
function pictureName(url: string, fallback: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return name.replace(/^(large|container|medium|small|thumb)_/, "") || fallback;
  } catch {
    return fallback;
  }
}

// ---- Models ----

export type PinshapeFile = { name: string; path: string };

export type PinshapeModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  /** Its files, each by the download link that redirects a signed-in user to it. */
  files: PinshapeFile[];
  /** The link to a zip of them all, where there is one. */
  zipPath: string | null;
  /** What its price badge says when it isn't free; none of the site's models are, so far. */
  price: string | null;
  /** How many tags it has, of which its page shows the first few. */
  tagCount: number;
};

/** A model's page as Thingport keeps it; null when it isn't one. The metadata mapping, apart from the fetch so it can
 *  be tested on its own. */
export function pinshapeModelFromPage(html: string, modelId: string): PinshapeModelResolution | null {
  const $ = cheerio.load(html);
  const main = $(".main-item-container").first();
  if (!main.length) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = clean(main.find("h1").first().text());
  if (title) meta.title = title;
  const description = main.find(".description-content").first().html();
  const markdown = description ? htmlToMarkdown(description) : null;
  if (markdown) meta.description = markdown;
  const tags = unique(
    main
      .find(".tags-container .tag-button")
      .toArray()
      .map((el) => clean($(el).text())),
  );
  if (tags.length) meta.tags = tags;

  // The picture it shows first, then the rest in the order its carousel has them.
  const shown = picture(main.find("img.item-detail-image").first().attr("src"));
  const carousel = main
    .find(".thumbnail-carousel img")
    .toArray()
    .map((el) => picture($(el).attr("data-large-src") ?? $(el).attr("src")));
  const images = unique([shown, ...carousel]);
  if (images[0]) meta.previewImageUrl = images[0];

  const designer = main.find(".designer-detail-section a.designer-link").first();
  const user = userIn(designer.attr("href"));
  const name = designerName(designer.find(".designer-name").text()) ?? clean(designer.find("img").attr("alt"));
  if (user && name) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: user.id,
      name,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [`${SITE_ORIGIN}/users/${user.key}`],
      avatarUrl: picture(designer.find("img").attr("src")),
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  const files = main
    .find(".file-list")
    .children()
    .toArray()
    .flatMap((el) => {
      const row = $(el);
      const path = sitePath(row.find("a.download-file-btn").attr("href"));
      const fileName = clean(row.find(".fw-medium").first().text());
      return path && fileName && /\/download\/file\/\d+$/.test(path) ? [{ name: fileName, path }] : [];
    });
  const zipPath = sitePath(main.find('a.download-btn[href^="/download/"]').first().attr("href"));
  const badge = clean(main.find(".item-overlay-high-z .badge").first().text());

  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: pictureName(url, `image-${index}.jpg`) })),
    modelId,
    files,
    zipPath,
    price: badge && !/^free$/i.test(badge) ? badge : null,
    tagCount: countIn(main.find(".tags-container").attr("data-total-tags")) ?? tags.length,
  };
}

/** The tags past the ones its page shows, which its page loads when asked. Any it can't give are left out. */
async function moreTags(modelId: string, shown: number): Promise<string[]> {
  try {
    const res = await get(`/items/${modelId}/tags?offset=${shown}`, null, JSON_TYPE);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body) as { tags?: unknown };
    return Array.isArray(data.tags)
      ? unique(data.tags.map((tag) => (typeof tag === "string" ? clean(tag) : null)))
      : [];
  } catch {
    return [];
  }
}

/** By its id. Null for a model that doesn't exist, or that it doesn't show. */
export async function resolvePinshapeModel(modelId: string): Promise<PinshapeModelResolution | null> {
  const res = await get(`/items/${modelId}`);
  if (toHome(redirectedTo(res)) || res.status === 404) return null;
  if (res.status !== 200) throw failure("this model", res);
  const model = pinshapeModelFromPage(res.body, modelId);
  const shown = model?.meta.tags ?? [];
  if (model && model.tagCount > shown.length) {
    const tags = unique([...shown, ...(await moreTags(modelId, shown.length))]);
    if (tags.length) model.meta.tags = tags;
  }
  return model;
}

/** The signed link a file's download link redirects a signed-in user to. */
export async function resolvePinshapeDownload(path: string, cookie: string): Promise<string> {
  const res = await get(path, cookie, "*/*");
  const to = redirectedTo(res);
  if (to && isPinshapeFileHost(to.hostname)) return to.href;
  if (toSignIn(to)) throw new PinshapeAuthError();
  throw new Error(`Pinshape didn't hand over the file (HTTP ${res.status})`);
}

/** Its files are in its own S3 buckets, as links signed for a while. */
export function isPinshapeFileHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === new URL(manifest.endpoints.files).hostname ||
    /^mh-pinshape-[a-z0-9-]+\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com$/.test(host)
  );
}

// ---- Lists ----

export type PinshapeModelSummary = {
  modelId: string;
  title: string;
  cover: string | null;
  likes: number | null;
  author: string | null;
  price: string | null;
};

export type PinshapeListing = { entries: PinshapeModelSummary[]; total: number; truncated: boolean };

/** The model cards under `scope`, in its order. */
function cardsIn($: cheerio.CheerioAPI, scope: string): PinshapeModelSummary[] {
  const seen = new Set<string>();
  return $(scope)
    .find(".card-item")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const modelId = sitePath(card.find('a[href^="/items/"]').first().attr("href"))?.match(/^\/items\/(\d+)/)?.[1];
      // The card that offers its owner an upload has no model.
      if (!modelId || seen.has(modelId)) return [];
      seen.add(modelId);
      const price = clean(card.find(".price-badge").first().text());
      return [
        {
          modelId,
          title:
            clean(card.find(".card-title").first().text()) ?? clean(card.find("img").attr("alt")) ?? `Model ${modelId}`,
          cover: picture(card.find("img.item-image").first().attr("src")),
          likes: countIn(card.find(".likes-count").first().text()),
          author: designerName(card.find(".designer-name").first().text()),
          price: price && !/^free$/i.test(price) ? price : null,
        },
      ];
    });
}

/** The name a user's likes are kept under, by the name their profile's address has. */
export function pinshapeLikesName(owner: string): string {
  return likesCollectionName(owner, PROVIDER);
}

export type PinshapeLikes = PinshapeListing & { owner: string; url: string };

/** A user's likes, anyone's to read. Its profile shows only 12 of them, and has no way to page through the rest, so
 *  that's all there is to read; `total` is how many there are. `name` is the one in the profile's address, which the
 *  page itself doesn't give. Null for no such user. */
export async function fetchPinshapeLikes(userId: string, name: string | null = null): Promise<PinshapeLikes | null> {
  const res = await get(`/users/${userId}?tab=likes`);
  if (toHome(redirectedTo(res)) || res.status === 404) return null;
  if (res.status !== 200) throw failure("these likes", res);
  return pinshapeLikesFromPage(res.body, userId, name);
}

/** A profile page's likes tab; null when it isn't one. They're named as a sync of their link names them: by the name
 *  in its address, or the page's where it has none. */
export function pinshapeLikesFromPage(html: string, userId: string, name: string | null = null): PinshapeLikes | null {
  const $ = cheerio.load(html);
  if (!$("#likes").length) return null;
  const entries = cardsIn($, "#likes");
  const total = Math.max(countIn($("#profileTabs").attr("data-likes-count")) ?? 0, entries.length);
  const owner = (name && decodeName(name)) ?? clean($("main h1").first().text()) ?? userId;
  return { entries, total, truncated: entries.length < total, owner, url: pinshapeLikesUrl(userId, name) };
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export type PinshapeCollectionInfo = {
  collectionId: string;
  name: string;
  owner: { id: string; name: string } | null;
};

type CollectionPage = { info: PinshapeCollectionInfo; total: number; pages: number; entries: PinshapeModelSummary[] };

/** A collection's page; null when it isn't one, as when the collection is gone and it shows the browse page instead. */
export function pinshapeCollectionFromPage(html: string, collectionId: string): CollectionPage | null {
  const $ = cheerio.load(html);
  // Its heading: the owner's name, and the collection's under it, both linking to the owner's collections.
  const heading = $('main a[href^="/users/"] h2').first();
  const name = clean(heading.text());
  if (!name) return null;
  const ownerLink = $('main a[href^="/users/"]:has(h1)').first();
  const ownerUser = userIn(ownerLink.attr("href"));
  const ownerName = clean(ownerLink.find("h1").text());
  const entries = cardsIn($, "#items-grid");
  const paging = $("#moderationDataContainer");
  // "Showing 1 - 12 of 889 items": the ones it shows, which can be fewer than the "982 items in this collection" over
  // them, its count of what was ever put in.
  const showing = $("main p")
    .toArray()
    .map(
      (el) =>
        $(el)
          .text()
          .match(/\bof\s+([\d,]+)\s+items\b/i)?.[1],
    )
    .find(Boolean);
  const shown = countIn(showing);
  return {
    info: { collectionId, name, owner: ownerUser && ownerName ? { id: ownerUser.id, name: ownerName } : null },
    total: Math.max(shown ?? 0, entries.length),
    pages: Math.max(countIn(paging.attr("data-pagination-total")) ?? 1, 1),
    entries,
  };
}

async function collectionPage(collectionId: string, page: number): Promise<CollectionPage | null> {
  const res = await get(`/items?collection_id=${collectionId}${page > 1 ? `&page=${page}` : ""}`);
  if (res.status !== 200) throw failure("this collection", res);
  return pinshapeCollectionFromPage(res.body, collectionId);
}

export type PinshapeCollection = PinshapeListing & { info: PinshapeCollectionInfo };

/** A collection's models in its order, up to `maxItems`, anyone's to read; null when there's no such collection. */
export async function fetchPinshapeCollection(
  collectionId: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<PinshapeCollection | null> {
  const first = await collectionPage(collectionId, 1);
  if (!first) return null;
  const pages = Math.min(first.pages, Math.ceil(maxItems / PAGE_SIZE));
  const rest = await mapWithConcurrency(
    Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => i + 2),
    PAGE_CONCURRENCY,
    async (page) => {
      const found = await collectionPage(collectionId, page);
      // Gone between its pages: no clear answer, rather than a shorter collection.
      if (!found) throw new Error("This Pinshape collection changed while it was being read. Try again.");
      return found.entries;
    },
  );
  const seen = new Set<string>();
  const entries = [first.entries, ...rest]
    .flat()
    .filter((entry) => !seen.has(entry.modelId) && Boolean(seen.add(entry.modelId)))
    .slice(0, maxItems);
  const total = Math.max(first.total, entries.length);
  return { info: first.info, entries, total, truncated: entries.length < total };
}

/** A collection, as the sync dialog's Browse tab shows it. */
export async function pinshapeCollectionCard(collectionId: string): Promise<ProviderCollectionCard | null> {
  const first = await collectionPage(collectionId, 1);
  return (
    first && {
      id: collectionId,
      name: first.info.name,
      url: pinshapeCollectionUrl(collectionId),
      modelCount: first.total,
      thumbnails: first.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: first.info.owner?.name ?? null,
    }
  );
}

/** Someone's likes, as the sync dialog's Browse tab shows them; null for no such user. */
export async function pinshapeLikesCard(
  userId: string,
  name: string | null = null,
): Promise<ProviderCollectionCard | null> {
  const likes = await fetchPinshapeLikes(userId, name);
  return (
    likes && {
      id: pinshapeLikesKey(userId),
      name: pinshapeLikesName(likes.owner),
      url: likes.url,
      modelCount: likes.total,
      thumbnails: likes.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: likes.owner,
    }
  );
}

/** The collection cards in one page of a user's collections or subscriptions, as its profile loads them. */
export function pinshapeCollectionCardsFrom(html: string): ProviderCollectionCard[] {
  const $ = cheerio.load(html);
  return $(".collection-card")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const link = sitePath(card.find('a[href*="collection_id="]').first().attr("href"));
      const collectionId = link ? parsePinshapeCollectionUrl(`${SITE_ORIGIN}${link}`)?.collectionId : null;
      const name = clean(card.find(".card-title").first().text());
      if (!collectionId || !name) return [];
      // "46 items" in its stats, or the "Items 46" badge over its pictures.
      const stats = card
        .find(".stat-item")
        .toArray()
        .map((stat) => clean($(stat).text()))
        .find((text) => /\bitems?\b/i.test(text ?? ""));
      const count = countIn(stats) ?? countIn(card.find(".collection-count-badge").text()) ?? 0;
      return [
        {
          id: collectionId,
          name,
          url: pinshapeCollectionUrl(collectionId),
          modelCount: count,
          thumbnails: unique(
            card
              .find(".collection-grid-item img")
              .toArray()
              .map((img) => picture($(img).attr("src"))),
          ).slice(0, CARD_THUMBNAILS),
          private: false,
          owner: clean(card.find('.card-text a[href^="/users/"]').first().text()),
        },
      ];
    });
}

/** A user's own collections, or the ones they subscribed to, every page of them. */
export async function fetchPinshapeCollectionCards(
  userId: string,
  which: "collections" | "subscriptions",
  cookie: string | null,
): Promise<ProviderCollectionCard[]> {
  const cards: ProviderCollectionCard[] = [];
  for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
    const res = await get(`/api/users/${userId}/${which}?page=${page}`, cookie, JSON_TYPE);
    if (res.status !== 200) throw failure(`these ${which}`, res);
    const data = JSON.parse(res.body) as { success?: unknown; html?: unknown; pagination?: { pages?: unknown } };
    if (data.success !== true || typeof data.html !== "string") throw failure(`these ${which}`, res);
    cards.push(...pinshapeCollectionCardsFrom(data.html));
    const pages = typeof data.pagination?.pages === "number" ? data.pagination.pages : 1;
    if (page >= pages) break;
  }
  return cards;
}

// ---- Trending ----

/** Its most popular models, as its browse page sorts them. Public; no sign-in. */
export async function fetchPinshapePopular(limit: number): Promise<TrendingModel[]> {
  const models: PinshapeModelSummary[] = [];
  for (let page = 1; models.length < limit && page <= Math.ceil(limit / PAGE_SIZE); page++) {
    const res = await get(`/items?sort=popular${page > 1 ? `&page=${page}` : ""}`);
    if (res.status !== 200) throw failure("its popular models", res);
    const cards = cardsIn(cheerio.load(res.body), "#items-grid");
    if (!cards.length) break;
    models.push(...cards);
  }
  return models.slice(0, limit).map((model) => ({
    id: model.modelId,
    title: model.title,
    url: pinshapeModelUrl(model.modelId),
    image: model.cover,
    likes: model.likes,
    author: model.author,
    paid: model.price !== null,
  }));
}

// ---- Sign-in ----

/** Who's signed in, from the menu every page has for them: their profile link, and the name beside it. */
export function pinshapeSignedInUser(html: string): { userId: string; key: string; name: string | null } | null {
  const $ = cheerio.load(html);
  const user = $("nav a.dropdown-item")
    .toArray()
    .map((el) => userIn($(el).attr("href")))
    .find(Boolean);
  if (!user) return null;
  return { userId: user.id, key: user.key, name: clean($("#navbarDropdown").text()) };
}

/** Who a sign-in belongs to, or "rejected"/"unreachable". Its settings page sends a visitor to sign in. */
export async function checkPinshapeAuth(
  cookie: string,
): Promise<{ userId: string; key: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const res = await get("/settings", cookie);
    const to = redirectedTo(res);
    if (to) return toSignIn(to) ? "rejected" : "unreachable";
    if (res.status !== 200) return "unreachable";
    return pinshapeSignedInUser(res.body) ?? "rejected";
  } catch (err) {
    return err instanceof PinshapeAuthError ? "rejected" : "unreachable";
  }
}
