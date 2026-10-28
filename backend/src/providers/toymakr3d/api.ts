import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { absoluteHttpUrl, htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import type { TrendingModel } from "../../services/trendingModel";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import {
  isToymakr3dLikesUrl,
  parseToymakr3dModelUrl,
  TOYMAKR3D_LIKES_KEY,
  TOYMAKR3D_LIKES_URL,
  toymakr3dModelUrl,
  urls,
} from "./urls.generated";
import manifest from "./manifest.generated";
export { isToymakr3dLikesUrl, parseToymakr3dModelUrl, TOYMAKR3D_LIKES_KEY, TOYMAKR3D_LIKES_URL, toymakr3dModelUrl };

// Toymakr3D is a Laravel shop with no API of its own: its pages are rendered on the server, and the few calls they
// make answer with HTML of their own. So this reads the pages. A model's page is anyone's to read; its files and the
// likes need the user's sign-in, whose cookies the download page takes to redirect to a signed CloudFront link.
// Its redirects are its answers: /login for a sign-in it hasn't got or won't take, the canonical product page for a
// link whose name is wrong or missing. Its Cloudflare lets Node's own fetch through.
const SITE_ORIGIN = manifest.site;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;

// Its listings take a page size, up to which they answer in one page; the biggest its own picker offers.
const PAGE_SIZE = 60;
const LISTING_MAX_ENTRIES = 600;
const PAGE_CONCURRENCY = 3;
// Past these there are surely no more: at 60 a page, 40 pages is far more than the site holds.
const MAX_LIST_PAGES = 40;
const CARD_THUMBNAILS = 4;
// How long the categories a model is in are kept before they're read again. They change about as often as the
// site adds a model, and reading them costs a page per category -- and a failed read is kept for a short while too,
// so a batch import doesn't try the whole set again for every model while the site is unwell.
const CATEGORY_INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const CATEGORY_INDEX_RETRY_MS = 5 * 60 * 1000;

export class Toymakr3dAuthError extends Error {
  constructor() {
    super(
      "Toymakr3D didn't accept your sign-in; it may have expired. Visit toymakr3d.com signed in with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "Toymakr3dAuthError";
  }
}

export class Toymakr3dRateLimitError extends Error {
  constructor() {
    super("Toymakr3D rate-limited Thingport. Wait a while, then try again.");
    this.name = "Toymakr3dRateLimitError";
  }
}

/** A bought model whose watermarked files the site is still building. It makes them per buyer, on demand, and shows
 *  a progress page meanwhile, so the only thing to do is come back. */
export class Toymakr3dPreparingError extends Error {
  constructor() {
    super("Toymakr3D is still watermarking this model's files for you. Wait a minute or two, then import it again.");
    this.name = "Toymakr3dPreparingError";
  }
}

type Answer = { status: number; location: string | null; body: string };

async function request(path: string, cookie: string | null, accept: string): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_ORIGIN}${path}`, {
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
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

/** One page. Too many at once are waited out a couple of times, then refused. */
async function get(path: string, cookie: string | null = null, accept = HTML): Promise<Answer> {
  let res = await request(path, cookie, accept);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path, cookie, accept);
  }
  if (res.status === 429) throw new Toymakr3dRateLimitError();
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

const isSitePage = (url: URL, path: RegExp) => urls.isHost(url.hostname) && path.test(url.pathname);
/** Where it sends anyone without a sign-in it takes, from a page that needs one. */
const toSignIn = (url: URL | null) => !!url && isSitePage(url, /^\/login/);

/** A page that redirects to its own canonical address, read there instead. One hop is all the site ever asks for. */
async function getFollowingSiteRedirect(path: string, cookie: string | null = null): Promise<Answer> {
  const res = await get(path, cookie);
  const to = redirectedTo(res);
  if (!to || !urls.isHost(to.hostname) || toSignIn(to)) return res;
  return get(`${to.pathname}${to.search}`, cookie);
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on Toymakr3D (HTTP ${res.status})`);
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

/** The model a link on its pages is of: its id, and the `<id>-<name>` its own addresses use. */
function productIn(href: string | undefined): { id: string; slug: string } | null {
  const m = sitePath(href)?.match(/^\/product\/(\d{1,12}-[^/?#]*)/);
  return m ? { id: String(Number(m[1].split("-")[0])), slug: m[1] } : null;
}

/** A picture its pages link, which they write on its CDN. */
const picture = (src: string | undefined) => absoluteHttpUrl(src ?? null);

/** Its pictures come in sizes named by the folder above them (`thumbnail/400_400/`); the name itself is the same. */
function pictureName(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

/** A selection of its pages' elements, as cheerio hands one back. */
type Selection = ReturnType<cheerio.CheerioAPI>;

/** What the price box says, or null when the model is free. On sale it shows the new price beside the old one. */
function priceIn(prices: Selection): string | null {
  const sale = clean(prices.find(".product-card__new-price").first().text());
  if (sale) return sale;
  const whole = prices.clone();
  whole.find(".product-card__bundling-info").remove();
  const text = clean(whole.text());
  return text && !/^free/i.test(text) ? text : null;
}

// ---- Models ----

export type Toymakr3dModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  /** `<id>-<name>`, as its own addresses write it: what the download page is asked for. */
  slug: string;
  /** What its page's price says when the model isn't free. */
  price: string | null;
  /** The files its page lists, for the record: the download is one zip of them all. */
  fileNames: string[];
};

/** The Setting tab's rows ("3d Print Setting", "Disclaimer", …), as markdown under their own headings. */
function settingsMarkdown($: cheerio.CheerioAPI): string | null {
  const rows = $("#tab-moreinfo .spec__row")
    .toArray()
    .flatMap((el) => {
      const row = $(el);
      const name = clean(row.find(".spec__name").first().text());
      const value = row.find(".spec__value").first().html();
      const markdown = value ? htmlToMarkdown(value) : null;
      return name && markdown ? [`**${name}**\n\n${markdown}`] : [];
    });
  return rows.length ? rows.join("\n\n") : null;
}

/** A model's page as Thingport keeps it; null when it isn't one. Apart from the fetch, so it can be tested on its
 *  own. `categoryIds` are the site's for the categories it's in, which its own page doesn't say (see below). */
export function toymakr3dModelFromPage(
  html: string,
  modelId: string,
  categoryIds: number[] = [],
): Toymakr3dModelResolution | null {
  const $ = cheerio.load(html);
  const main = $(".product--layout--standard").first();
  if (!main.length) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = clean(main.find(".product__info .product__name").first().text());
  if (title) meta.title = title;

  // Its description tab, without the Read More/Read Less links its page folds it behind, then the Setting tab's rows.
  const description = main.find("#tab-description .product-description").first().clone();
  description.find(".read-more, .read-less").remove();
  const notes = [htmlToMarkdown(description.html() ?? ""), settingsMarkdown($)].filter(Boolean);
  if (notes.length) meta.description = notes.join("\n\n## Printing details\n\n");

  const tags = unique(
    main
      .find('.product__tags a[href*="/by-tag"]')
      .toArray()
      .map((el) => clean($(el).text())),
  );
  if (tags.length) meta.tags = tags;

  // The gallery in the order its carousel has them, by the biggest size its page links. Its pictures only: a model's
  // carousel can hold a YouTube video too, which is no picture of it.
  const images = unique(
    main
      .find('#product-image .product-image__body[data-type="image"]')
      .toArray()
      .map((el) => picture($(el).attr("href") ?? $(el).find("img").attr("src"))),
  );
  if (images[0]) meta.previewImageUrl = images[0];

  // "By : <name>", linking to their page, which is their username.
  const by = main.find('.product__info .product__meta a[href]:not([href^="#"])').first();
  const name = clean(by.text());
  const username = sitePath(by.attr("href"))?.match(/^\/([^/?#]+)\/?$/)?.[1];
  if (name && username) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: username,
      name,
      handle: username,
      bio: null,
      bioTranslated: null,
      links: [`${SITE_ORIGIN}/${username}`],
      avatarUrl: null,
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }

  const canonical = sitePath($('link[rel="canonical"]').attr("href"))?.match(/^\/product\/(\d{1,12}-[^/?#]*)/)?.[1];
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: pictureName(url, `image-${index}.webp`) })),
    modelId,
    slug: canonical ?? `${modelId}-`,
    price: priceIn(main.find(".product__sidebar .product__prices").first()),
    // Its 3D-view modal lists them, each with its size after the name, under a header row that isn't one.
    fileNames: unique(
      $("#file_list tr:not(.header) td")
        .toArray()
        .map((el) => clean($(el).text())?.replace(/\s*\([^()]*\)$/, "")),
    ),
  };
}

/** A model by its id. Null for one the site hasn't got, or doesn't show. */
export async function resolveToymakr3dModel(modelId: string): Promise<Toymakr3dModelResolution | null> {
  // Its pages live at `/product/<id>-<name>`, and send a link with any other name to the right one.
  const res = await getFollowingSiteRedirect(`/product/${modelId}-`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure("this model", res);
  // Its own page doesn't say which categories it's in, so they come from its categories' listings.
  const categories = await categoriesOfModel(modelId);
  return toymakr3dModelFromPage(res.body, modelId, categories);
}

/** The signed CloudFront link its download page redirects a signed-in user to: one zip of the model's files, free
 *  for a free model and watermarked for a bought one. */
export async function resolveToymakr3dDownload(slug: string, cookie: string): Promise<string> {
  const res = await get(`/download/${slug}`, cookie, "*/*");
  const to = redirectedTo(res);
  if (to && isToymakr3dFileHost(to.hostname)) return to.href;
  if (toSignIn(to)) throw new Toymakr3dAuthError();
  // A bought model's zip is built per buyer: until it's ready its download page shows the progress instead.
  if (res.status === 200 && /watermarking-percentage-value|btn-refresh-page/.test(res.body)) {
    throw new Toymakr3dPreparingError();
  }
  throw new Error(`Toymakr3D didn't hand over the files (HTTP ${res.status})`);
}

/** Its files are on its own CDN, as links signed for a few minutes. */
export function isToymakr3dFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type Toymakr3dModelSummary = {
  modelId: string;
  slug: string;
  title: string;
  cover: string | null;
  author: string | null;
  price: string | null;
};

export type Toymakr3dListing = { entries: Toymakr3dModelSummary[]; total: number; truncated: boolean };

/** The model cards of a listing page, in its order. */
function cardsIn($: cheerio.CheerioAPI): Toymakr3dModelSummary[] {
  const seen = new Set<string>();
  return $(".products-list__item .product-card")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const product = productIn(card.find(".product-card__name a").first().attr("href"));
      if (!product || seen.has(product.id)) return [];
      seen.add(product.id);
      const features = card
        .find(".product-card__features-list li")
        .toArray()
        .map((li) => clean($(li).text()));
      return [
        {
          modelId: product.id,
          slug: product.slug,
          title: clean(card.find(".product-card__name a").first().text()) ?? `Model ${product.id}`,
          cover: picture(card.find("img").first().attr("data-src") ?? card.find("img").first().attr("src")),
          author:
            features
              .find((text) => text?.startsWith("Artist :"))
              ?.slice("Artist :".length)
              .trim() || null,
          price: priceIn(card.find(".product-card__prices").first()),
        },
      ];
    });
}

/** The rows of a liked-products table, in its order. They carry no price of their own worth keeping. */
function likeRowsIn($: cheerio.CheerioAPI): Toymakr3dModelSummary[] {
  const seen = new Set<string>();
  return $(".wishlist__body .wishlist__row")
    .toArray()
    .flatMap((el) => {
      const row = $(el);
      const product = productIn(row.find("a.wishlist__product-name").first().attr("href"));
      if (!product || seen.has(product.id)) return [];
      seen.add(product.id);
      const img = row.find("img").first();
      return [
        {
          modelId: product.id,
          slug: product.slug,
          title: clean(row.find("a.wishlist__product-name").first().text()) ?? `Model ${product.id}`,
          cover: picture(img.attr("data-src") ?? img.attr("src")),
          author: clean(row.find(".product-card__brand").first().text())?.replace(/^by\s+/i, "") ?? null,
          price: priceIn(row.find(".wishlist__column--price").first()),
        },
      ];
    });
}

/** How many pages a listing has, by the last one its pager links. */
function pageCount($: cheerio.CheerioAPI): number {
  const pages = $(".pagination a.page-link")
    .toArray()
    .map((el) => countIn(sitePath($(el).attr("href"))?.match(/[?&]page=(\d+)/)?.[1]) ?? 1);
  return Math.min(Math.max(1, ...pages), MAX_LIST_PAGES);
}

// ---- Likes ----

/** The user's liked products, their own to see. Up to `maxItems` of them, in the page's order. */
export async function fetchToymakr3dLikes(
  cookie: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<Toymakr3dListing> {
  const first = await likesPage(cookie, 1);
  const rest = await mapWithConcurrency(
    Array.from({ length: Math.max(first.pages - 1, 0) }, (_, i) => i + 2),
    PAGE_CONCURRENCY,
    async (page) => (await likesPage(cookie, page)).entries,
  );
  const seen = new Set<string>();
  const found = [first.entries, ...rest]
    .flat()
    .filter((entry) => !seen.has(entry.modelId) && Boolean(seen.add(entry.modelId)));
  // Every page of them is read, so `total` is all there are, however many are handed back.
  return { entries: found.slice(0, maxItems), total: found.length, truncated: found.length > maxItems };
}

/** A page of liked products: its rows, and how many pages of them there are. Apart from the fetch, so it can be
 *  tested on its own. */
export function toymakr3dLikesFromPage(html: string): { entries: Toymakr3dModelSummary[]; pages: number } {
  const $ = cheerio.load(html);
  return { entries: likeRowsIn($), pages: pageCount($) };
}

async function likesPage(cookie: string, page: number): Promise<{ entries: Toymakr3dModelSummary[]; pages: number }> {
  const res = await get(`/like-product${page > 1 ? `?page=${page}` : ""}`, cookie);
  if (toSignIn(redirectedTo(res))) throw new Toymakr3dAuthError();
  if (res.status !== 200) throw failure("your likes", res);
  return toymakr3dLikesFromPage(res.body);
}

/** The name the likes are kept under; the page names no user, so it's the site's own word for them. */
export const TOYMAKR3D_LIKES_NAME = "Toymakr3D liked products";

/** The user's likes, as the sync dialog's Browse tab shows them. */
export async function toymakr3dLikesCard(cookie: string): Promise<ProviderCollectionCard> {
  const likes = await fetchToymakr3dLikes(cookie, LISTING_MAX_ENTRIES);
  return {
    id: TOYMAKR3D_LIKES_KEY,
    name: TOYMAKR3D_LIKES_NAME,
    url: TOYMAKR3D_LIKES_URL,
    modelCount: likes.total,
    thumbnails: likes.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
    private: true,
    owner: null,
  };
}

// ---- Categories ----

export type Toymakr3dCategory = { id: number; slug: string; name: string };

// The categories its "By Category" menu lists that aren't subjects at all but buckets every model falls in by price:
// taking them would hang the same id on nearly every import.
const PRICE_BUCKETS = new Set(["all-products", "free-products", "premium"]);

/** `read` is false for the empty index a failed read leaves behind, which is kept only until the next retry. */
type CategoryIndex = { at: number; read: boolean; byModel: Map<string, number[]> };
let categoryIndex: CategoryIndex | null = null;
let categoryIndexInFlight: Promise<CategoryIndex> | null = null;

/** The categories its menu links, in its order, from any of its pages. */
export function toymakr3dCategoryLinksFrom(html: string): { slug: string; name: string }[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  return $('.departments__links a[href*="/by-category/"]')
    .toArray()
    .flatMap((el) => {
      const slug = sitePath($(el).attr("href"))?.match(/^\/by-category\/([^/?#]+)/)?.[1];
      const name = clean($(el).text());
      if (!slug || !name || PRICE_BUCKETS.has(slug) || seen.has(slug)) return [];
      seen.add(slug);
      return [{ slug, name }];
    });
}

/** A category listing page: the category it is (its page says so in the filter's own data), and the models on it. */
export function toymakr3dCategoryPageFrom(html: string): {
  category: Toymakr3dCategory | null;
  entries: Toymakr3dModelSummary[];
  pages: number;
} {
  const $ = cheerio.load(html);
  let category: Toymakr3dCategory | null = null;
  try {
    const raw = $(".btn-sidebar-filter").first().attr("data-current_category");
    const parsed = raw ? (JSON.parse(raw) as { id?: unknown; category_slug?: unknown; category_name?: unknown }) : null;
    if (typeof parsed?.id === "number" && typeof parsed.category_slug === "string") {
      category = {
        id: parsed.id,
        slug: parsed.category_slug,
        name: String(parsed.category_name ?? parsed.category_slug),
      };
    }
  } catch {
    category = null;
  }
  return { category, entries: cardsIn($), pages: pageCount($) };
}

async function categoryPage(slug: string, page: number) {
  const res = await get(`/by-category/${slug}?per_page=${PAGE_SIZE}${page > 1 ? `&page=${page}` : ""}`);
  if (res.status !== 200) throw failure("a category", res);
  return toymakr3dCategoryPageFrom(res.body);
}

/** Every category's models, as a model id to the ids of the categories it's in, in the menu's order. Toymakr3D's
 *  model pages don't say which of its categories a model is in -- only its category listings do -- so this reads
 *  them, and keeps what it found for a while. */
async function buildCategoryIndex(): Promise<CategoryIndex> {
  const home = await get("/");
  if (home.status !== 200) throw failure("its categories", home);
  const byModel = new Map<string, number[]>();
  for (const { slug } of toymakr3dCategoryLinksFrom(home.body)) {
    const first = await categoryPage(slug, 1);
    if (!first.category) continue;
    const rest = await mapWithConcurrency(
      Array.from({ length: Math.max(first.pages - 1, 0) }, (_, i) => i + 2),
      PAGE_CONCURRENCY,
      async (page) => (await categoryPage(slug, page)).entries,
    );
    for (const entry of [first.entries, ...rest].flat()) {
      const ids = byModel.get(entry.modelId) ?? [];
      if (!ids.includes(first.category.id)) ids.push(first.category.id);
      byModel.set(entry.modelId, ids);
    }
  }
  return { at: Date.now(), read: true, byModel };
}

const indexIsFresh = (index: CategoryIndex) =>
  Date.now() - index.at < (index.read ? CATEGORY_INDEX_TTL_MS : CATEGORY_INDEX_RETRY_MS);

/** The ids of the categories a model is in; empty when they can't be read, so an import still goes through with no
 *  category rather than failing over one. */
export async function categoriesOfModel(modelId: string): Promise<number[]> {
  if (!categoryIndex || !indexIsFresh(categoryIndex)) {
    // One build at a time: a batch import would otherwise start one per model.
    categoryIndexInFlight ??= buildCategoryIndex().finally(() => {
      categoryIndexInFlight = null;
    });
    try {
      categoryIndex = await categoryIndexInFlight;
    } catch {
      categoryIndex = { at: Date.now(), read: false, byModel: new Map() };
    }
  }
  return categoryIndex.byModel.get(modelId) ?? [];
}

/** Forgets what was read, so the next import reads it again. For the tests. */
export function forgetToymakr3dCategories(): void {
  categoryIndex = null;
  categoryIndexInFlight = null;
}

// ---- Trending ----

/** Its most popular models, the list its home page links. Public; no sign-in. */
export async function fetchToymakr3dPopular(limit: number): Promise<TrendingModel[]> {
  const res = await get("/by-category/most-popular");
  if (res.status !== 200) throw failure("its popular models", res);
  return cardsIn(cheerio.load(res.body))
    .slice(0, limit)
    .map((model) => ({
      id: model.modelId,
      title: model.title,
      url: `${SITE_ORIGIN}/product/${model.slug}`,
      image: model.cover,
      likes: null,
      author: model.author,
      paid: model.price !== null,
    }));
}

// ---- Sign-in ----

/** Who's signed in, from their account page: their username, as their own page's address writes it. */
export function toymakr3dSignedInUser(html: string): { username: string; name: string | null } | null {
  const $ = cheerio.load(html);
  const profile = $(".profile-card").first();
  const username = sitePath(profile.find(".profile-card__edit a[href]").first().attr("href"))?.match(
    /^\/([^/?#]+)\/?$/,
  )?.[1];
  if (!username) return null;
  return { username, name: clean($(".account-menu__user-name").first().text()) ?? username };
}

/** Who a sign-in belongs to, or "rejected"/"unreachable". Its account page sends anyone else to sign in. */
export async function checkToymakr3dAuth(
  cookie: string,
): Promise<{ username: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const res = await get("/my-account", cookie);
    const to = redirectedTo(res);
    if (to) return toSignIn(to) ? "rejected" : "unreachable";
    if (res.status !== 200) return "unreachable";
    return toymakr3dSignedInUser(res.body) ?? "rejected";
  } catch (err) {
    return err instanceof Toymakr3dAuthError ? "rejected" : "unreachable";
  }
}
