import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { absoluteHttpUrl, htmlToMarkdown } from "../../services/descriptionMarkdown";
import { isFlaresolverrEnabled } from "../../services/flaresolverr";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import {
  CGTRADER_LIKES_KEY,
  CGTRADER_LIKES_URL,
  CGTRADER_WISHLIST_KEY,
  CGTRADER_WISHLIST_URL,
  cgtraderModelUrl,
  isCgtraderModelId,
  parseCgtraderListUrl,
  parseCgtraderModelUrl,
  urls,
} from "./urls.generated";
import manifest from "./manifest.generated";
import { freshWafToken, isWafChallenge, markWafBlocked, wafTokenFor } from "./waf";
export {
  CGTRADER_LIKES_KEY,
  CGTRADER_LIKES_URL,
  CGTRADER_WISHLIST_KEY,
  CGTRADER_WISHLIST_URL,
  cgtraderModelUrl,
  isCgtraderModelId,
  parseCgtraderListUrl,
  parseCgtraderModelUrl,
};

// CGTrader is a Rails site with no public API, so this reads what its own pages do. Its listings answer JSON when a
// page's script asks for them; a model's details are the props its page hands its React components; and
// `/products/<slug>.js`, the script a model's page loads to learn who's looking, carries its number, its title, its
// designer and whether the user bought it. All of that is anyone's to read. The files need the user's sign-in -- the
// session cookie -- which `/items/<id>/free-downloads/<file>` redirects to a CloudFront link signed for a few minutes.
// AWS's bot check stands in front of some of it (waf.ts). A redirect to /not_found is its 404.
const SITE_ORIGIN = manifest.site;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
const SCRIPT = "text/javascript, application/javascript";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
const { session: SESSION_COOKIE, waf: WAF_COOKIE } = manifest.sessionCookies;

const LISTING_MAX_ENTRIES = 600;
const PAGE_CONCURRENCY = 3;
// Past this there are surely no more: its own lists page by 25 or so.
const MAX_LIST_PAGES = 40;
const CARD_THUMBNAILS = 4;

export class CgtraderAuthError extends Error {
  constructor() {
    super(
      "CGTrader didn't accept your sign-in; it may have expired. Visit cgtrader.com signed in with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "CgtraderAuthError";
  }
}

export class CgtraderRateLimitError extends Error {
  constructor() {
    super("CGTrader rate-limited Thingport. Wait a while, then try again.");
    this.name = "CgtraderRateLimitError";
  }
}

/** AWS's bot check turned Thingport away: there was no token to pass it with, or a fresh one didn't. */
export class CgtraderBlockedError extends Error {
  constructor(flaresolverr: boolean) {
    super(
      flaresolverr
        ? "CGTrader's bot check turned Thingport away, even with a fresh token from FlareSolverr. Wait a few minutes, " +
            "then try again."
        : "CGTrader's bot check wants a token Thingport hasn't got. Set up FlareSolverr in Administration > " +
            "Connections, or download something on cgtrader.com with Thingport Grab, which hands your browser's " +
            "token over, then try again.",
    );
    this.name = "CgtraderBlockedError";
  }
}

/** The account's free downloads are used up until `resetDate`, as CGTrader says. */
export class CgtraderDownloadLimitError extends Error {
  constructor(readonly resetDate: string | null) {
    super(
      `You've reached CGTrader's limit on free downloads${resetDate ? `; it resets on ${resetDate}` : ""}. ` +
        "Import it again after that.",
    );
    this.name = "CgtraderDownloadLimitError";
  }
}

/** A sign-in as Thingport keeps it: the session cookie, and the bot check's token the browser had beside it, with when
 *  Grab sent that (ms), so the fresher of it and FlareSolverr's is the one sent. */
export type CgtraderSession = { session: string; waf: string | null; wafAt: number | null };

type Answer = { status: number; location: string | null; body: string; challenged: boolean };

function cookieHeader(auth: CgtraderSession | null, waf: string | null): string | null {
  const parts = [auth && `${SESSION_COOKIE}=${auth.session}`, waf && `${WAF_COOKIE}=${waf}`].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

async function request(path: string, cookie: string | null, accept: string): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_ORIGIN}${path}`, {
      headers: {
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        // Its listings answer JSON, and its product script its data, only to a page's own scripts.
        ...(accept === JSON_ACCEPT || accept === SCRIPT ? { "X-Requested-With": "XMLHttpRequest" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      // Its redirects are its answers (see above), so they're read rather than followed.
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      status: res.status,
      location: res.headers.get("location"),
      body: await res.text(),
      challenged: isWafChallenge(res.headers),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Too many at once are waited out a couple of times, then refused. */
async function requestPaced(path: string, cookie: string | null, accept: string): Promise<Answer> {
  let res = await request(path, cookie, accept);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path, cookie, accept);
  }
  if (res.status === 429) throw new CgtraderRateLimitError();
  return res;
}

/** One request, as the user where `auth` is given, with the freshest bot-check token Thingport has; a challenge is
 *  answered once with a fresh one from FlareSolverr. */
async function get(path: string, auth: CgtraderSession | null = null, accept = HTML): Promise<Answer> {
  const res = await requestPaced(path, cookieHeader(auth, wafTokenFor(auth)), accept);
  if (!res.challenged) return res;
  const token = await freshWafToken();
  if (!token) throw new CgtraderBlockedError(await isFlaresolverrEnabled());
  const again = await requestPaced(path, cookieHeader(auth, token), accept);
  if (!again.challenged) return again;
  markWafBlocked();
  throw new CgtraderBlockedError(true);
}

function redirectedTo(res: Answer): URL | null {
  if (res.status < 300 || res.status >= 400 || !res.location) return null;
  try {
    return new URL(res.location, SITE_ORIGIN);
  } catch {
    return null;
  }
}

/** Where it sends a link to something it hasn't got, or won't show. */
const isNotFound = (url: URL | null) => !!url && urls.isHost(url.hostname) && /^\/not_found\/?$/.test(url.pathname);

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on CGTrader (HTTP ${res.status})`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function unique<T>(items: (T | null | undefined)[]): T[] {
  return [...new Set(items.filter((item): item is T => item != null))];
}

/** A link on its pages as a path on the site, or null for one elsewhere. */
function sitePath(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, SITE_ORIGIN);
    return urls.isHost(url.hostname) ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/** Its pictures are named for their model; the folders above say the size, so the name alone is the same in each. */
function pictureName(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

/** The props a page hands one of its React components, which carry what the component shows. */
function reactProps($: cheerio.CheerioAPI, component: string): Record<string, unknown> | null {
  const raw = $(`[data-react-class="${component}"]`).first().attr("data-react-props");
  return raw ? asRecord(parseJson(raw)) : null;
}

/** The object literal that starts at the first `{` from `from` on, read by its braces: a script's data, which is
 *  JSON, assigned among other statements. */
function objectAt(text: string, from: number): unknown {
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return parseJson(text.slice(start, i + 1));
  }
  return null;
}

// ---- Models ----

/** What a model's product script says: who it is on the site, and what the user has to do with it. */
export type CgtraderProduct = {
  id: number;
  slug: string;
  title: string | null;
  /** In dollars; 0 for a free model. */
  price: number;
  /** The designer's username, which their page is at. */
  designer: string | null;
  /** Whether the user bought it; false for anyone not signed in. */
  purchased: boolean;
  /** Whether the script was asked for by someone signed in: a signed-in user is told whether they liked it, anyone
   *  else nothing at all. */
  signedIn: boolean;
};

/** A model's product script, as Thingport keeps it; null when it isn't one. Apart from the fetch, so it can be tested
 *  on its own. */
export function cgtraderProductFromScript(script: string): CgtraderProduct | null {
  // `window.pageConfig = {...window.pageConfig, ...{<its data>} }`: the data is the object after the second spread.
  const marker = script.match(/window\.pageConfig\s*=\s*\{\s*\.\.\.window\.pageConfig\s*,\s*\.\.\./);
  if (marker?.index === undefined) return null;
  const product = asRecord(asRecord(objectAt(script, marker.index + marker[0].length))?.product);
  const id = asCount(product?.id);
  const slug = asText(product?.slug);
  if (!product || !id || !slug) return null;
  return {
    id,
    slug: slug.toLowerCase(),
    title: clean(asText(product.title)),
    price: asCount(product.price) ?? 0,
    designer: asText(product.authorUsername),
    purchased: product.isPurchased === true,
    signedIn: product.isLiked === true || product.isLiked === false,
  };
}

/** A model by its slug or its number, from its product script; null for one the site hasn't got. With the user's
 *  sign-in, it also says whether they bought it, and a sign-in the site doesn't take is turned down here. */
export async function fetchCgtraderProduct(
  slug: string,
  auth: CgtraderSession | null = null,
): Promise<CgtraderProduct | null> {
  const res = await get(`/products/${encodeURIComponent(slug)}.js`, auth, SCRIPT);
  if (res.status === 404 || isNotFound(redirectedTo(res))) return null;
  if (res.status !== 200) throw failure("this model", res);
  const product = cgtraderProductFromScript(res.body);
  if (product && auth && !product.signedIn) throw new CgtraderAuthError();
  return product;
}

export type CgtraderModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** The slug its own address names it by: what the import keeps. */
  slug: string;
  /** Its number, which its download pages are asked for by. */
  itemId: number;
  /** What it costs, as its page writes it; null for a free model. */
  price: string | null;
  /** Whether the user bought it, where it isn't free. */
  purchased: boolean;
};

/** The `<category>/<subcategory>` its address names, and the category alone: most specific first. */
export function cgtraderCategoryPaths(path: string): string[] {
  const m = path.match(/^\/(?:free-)?3d-(?:print-)?models\/([a-z0-9-]+)\/([a-z0-9-]+)\/[^/]+\/?$/i);
  return m ? [`${m[1]}/${m[2]}`.toLowerCase(), m[1].toLowerCase()] : [];
}

const LICENSES: Record<string, string> = {
  royalty_free: "Royalty free",
  royalty_free_no_ai: "Royalty free, not for AI training",
  editorial: "Editorial use only",
  custom: "Custom",
};

/** The details its page lists beside the model that matter for printing it, as a short markdown list. */
function detailsMarkdown(top: Record<string, unknown>): string | null {
  const details = asRecord(top.detailsArea) ?? {};
  const pricing = asRecord(top.pricingArea) ?? {};
  const formats = unique(
    [details.ungroupedFormats, details.nativeFormats, details.exchangeFormats]
      .flatMap(recordsOf)
      .map((format) => asText(format.title)),
  );
  const parts = asCount(asRecord(details.multiplePartsDetails)?.numberOfParts);
  const polygons = asCount(details.polygons);
  const license = asText(pricing.license);
  const rows = [
    details.readyFor3dPrinting === true && "**Ready for 3D printing**",
    details.readyFor3dPrinting === true && details.isPreSupported === true && "**Pre-supported**",
    details.isSplitIntoMultipleParts === true && parts && `**Parts:** ${parts}`,
    asText(details.units) && `**Units:** ${asText(details.units)}`,
    formats.length && `**Formats:** ${formats.join(", ")}`,
    polygons && `**Polygons:** ${polygons.toLocaleString("en-US")}`,
    license && `**License:** ${LICENSES[license] ?? license.replace(/_/g, " ")}`,
  ].filter((row): row is string => typeof row === "string");
  return rows.length ? rows.map((row) => `- ${row}`).join("\n") : null;
}

/** A model's page as Thingport keeps it, with what its product script said; null when it isn't one. `path` is the
 *  address the page is at, which names its category. Apart from the fetch, so it can be tested on its own. */
export function cgtraderModelFromPage(
  html: string,
  path: string,
  product: CgtraderProduct,
): CgtraderModelResolution | null {
  const $ = cheerio.load(html);
  const top = reactProps($, "ItemPage/TopSection/TopSection");
  if (!top) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const describe = asRecord(top.descriptionArea) ?? {};
  const seller = asRecord(top.sellerArea) ?? {};
  const pricing = asRecord(top.pricingArea) ?? {};

  // The script's title is the bare one; its page's carry "free 3D print model" and the like after it.
  const title = product.title ?? clean(asText(asRecord(top.galleryArea)?.title));
  if (title) meta.title = title;

  const notes = [htmlToMarkdown(asText(describe.description) ?? ""), detailsMarkdown(top)].filter(Boolean);
  if (notes.length) meta.description = notes.join("\n\n## Model details\n\n");

  const tags = unique(recordsOf(describe.relatedTags).map((tag) => clean(asText(tag.text))));
  if (tags.length) meta.tags = tags;

  // Its gallery, at the size its viewer opens; the site's own renders of the model come along with the designer's.
  const images = unique(
    recordsOf(asRecord(top.galleryArea)?.medias)
      .filter((media) => media.visualType === "ItemImage" && media.adult !== true)
      .map((media) => webImage(absoluteHttpUrl(asText(media.imageName)))),
  );
  if (images[0]) meta.previewImageUrl = images[0];

  const name = clean(asText(seller.designerName));
  const username = product.designer;
  if (name && username) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: username,
      name,
      handle: username,
      bio: null,
      bioTranslated: null,
      links: [`${SITE_ORIGIN}/designers/${username}`],
      avatarUrl: webImage(asText(seller.avatarUrl)),
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  const categories = cgtraderCategoryPaths(path);
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }

  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: pictureName(url, `image-${index}.webp`) })),
    slug: product.slug,
    itemId: product.id,
    price: product.price > 0 ? (asText(pricing.price) ?? `$${product.price.toFixed(2)}`) : null,
    purchased: product.purchased,
  };
}

/** The page a model's product link redirects to, and its address: the site sends it on to the catalogue it's in,
 *  sometimes by way of another. Null for a model it hasn't got. */
async function modelPage(slug: string, auth: CgtraderSession | null): Promise<{ html: string; path: string } | null> {
  let path = `/products/${encodeURIComponent(slug)}`;
  for (let hop = 0; hop < 3; hop++) {
    const res = await get(path, auth);
    if (res.status === 200) return { html: res.body, path };
    const to = redirectedTo(res);
    if (res.status === 404 || isNotFound(to)) return null;
    if (!to || !urls.isHost(to.hostname)) throw failure("this model", res);
    path = to.pathname;
  }
  throw new Error("CGTrader kept redirecting this model's page");
}

/** A model by its slug (or number). Null for one the site hasn't got, or doesn't show. Read as the user where `auth`
 *  is given, which also says whether they bought it. */
export async function resolveCgtraderModel(
  slug: string,
  auth: CgtraderSession | null = null,
): Promise<CgtraderModelResolution | null> {
  const product = await fetchCgtraderProduct(slug, auth);
  if (!product) return null;
  const page = await modelPage(product.slug, auth);
  return page && cgtraderModelFromPage(page.html, page.path, product);
}

// ---- Files ----

export type CgtraderFile = { name: string; size: string | null; path: string };

/** The files a model's download page lists, each with the link that downloads it; null when it isn't one. Apart
 *  from the fetch, so it can be tested on its own. */
export function cgtraderFilesFromPage(html: string): CgtraderFile[] | null {
  const page = reactProps(cheerio.load(html), "NewDownloadItemPage/NewDownloadItemPage");
  const top = asRecord(page?.topSection);
  if (!top) return null;
  return recordsOf(top.itemFiles).flatMap((file) => {
    const name = asText(file.name);
    const path = sitePath(asText(file.url));
    return name && path?.startsWith("/items/") ? [{ name, size: asText(file.fileSize), path }] : [];
  });
}

/** A model's files, as the user: null when its download page isn't theirs to see -- a model they haven't bought. */
export async function fetchCgtraderFiles(itemId: number, auth: CgtraderSession): Promise<CgtraderFile[] | null> {
  const res = await get(`/items/${itemId}/download-page`, auth);
  if (isNotFound(redirectedTo(res))) return null;
  if (res.status !== 200) throw failure("this model's files", res);
  return cgtraderFilesFromPage(res.body) ?? [];
}

/** Whether the account may download now, as the site asks before each download: its free downloads are limited. */
export async function checkCgtraderDownloadLimit(itemId: number, auth: CgtraderSession): Promise<void> {
  const res = await get(`/items/${itemId}/can-download-item-files`, auth, JSON_ACCEPT);
  if (res.status === 401) throw new CgtraderAuthError();
  if (res.status === 403) {
    const answer = asRecord(parseJson(res.body));
    throw new CgtraderDownloadLimitError(asText(answer?.reset_date));
  }
}

/** The signed link a file's download redirects a signed-in user to. Anyone else is answered 401. */
export async function resolveCgtraderFileUrl(path: string, auth: CgtraderSession): Promise<string> {
  const res = await get(path, auth, "*/*");
  const to = redirectedTo(res);
  if (to && isCgtraderFileHost(to.hostname)) return to.href;
  if (res.status === 401) throw new CgtraderAuthError();
  throw new Error(`CGTrader didn't hand over the file (HTTP ${res.status})`);
}

/** Its files are on their own host, as links signed for a few minutes. */
export function isCgtraderFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type CgtraderModelSummary = { slug: string; title: string; cover: string | null; price: number | null };

export type CgtraderListing = { entries: CgtraderModelSummary[]; total: number; truncated: boolean };

/** The models of one of its JSON listings, in its order. */
export function cgtraderListingFrom(data: unknown): CgtraderModelSummary[] {
  const seen = new Set<string>();
  return recordsOf(asRecord(data)?.data).flatMap((item) => {
    const attrs = asRecord(item.attributes) ?? {};
    const slug = parseCgtraderModelUrl(asText(attrs.url) ?? "")?.slug;
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const image = asRecord(attrs.primaryImage);
    return [
      {
        slug,
        title: clean(asText(attrs.title)) ?? slug,
        cover: webImage(asText(image?.gridUrl)) ?? webImage(asText(image?.gridFallbackUrl)),
        price: asCount(attrs.price),
      },
    ];
  });
}

// ---- Trending ----

/** Its trending 3D print models, the list its print catalogue sorts by "Trending". Public; no sign-in. */
export async function fetchCgtraderTrending(limit: number): Promise<TrendingModel[]> {
  const res = await get("/3d-print-models?sort_by=trending", null, JSON_ACCEPT);
  if (res.status !== 200) throw failure("its trending models", res);
  return cgtraderListingFrom(parseJson(res.body))
    .slice(0, limit)
    .map((model) => ({
      id: model.slug,
      title: model.title,
      url: cgtraderModelUrl(model.slug),
      image: model.cover,
      likes: null,
      author: null,
      paid: (model.price ?? 0) > 0,
    }));
}

// ---- Likes and the wishlist ----

/** How many pages one of the user's lists has, by the last one its pager links. */
function pageCount($: cheerio.CheerioAPI, list: RegExp): number {
  const pages = $("a[href]")
    .toArray()
    .flatMap((el) => {
      const path = sitePath($(el).attr("href"));
      return path && list.test(path) ? [asCount(path.match(/[?&]page=(\d+)/)?.[1])] : [];
    })
    .filter((page): page is number => page !== null);
  return Math.min(Math.max(1, ...pages), MAX_LIST_PAGES);
}

type ListPage = { entries: CgtraderModelSummary[]; pages: number };

/** Every page of a list, the first already read: up to `maxItems` of its models, in its order. Every page is read, so
 *  `total` is all there are, however many are handed back. */
async function allPages(
  first: ListPage,
  page: (n: number) => Promise<ListPage>,
  maxItems: number,
): Promise<CgtraderListing> {
  const rest = await mapWithConcurrency(
    Array.from({ length: Math.max(first.pages - 1, 0) }, (_, i) => i + 2),
    PAGE_CONCURRENCY,
    async (n) => (await page(n)).entries,
  );
  const seen = new Set<string>();
  const found = [first.entries, ...rest]
    .flat()
    .filter((entry) => !seen.has(entry.slug) && Boolean(seen.add(entry.slug)));
  return { entries: found.slice(0, maxItems), total: found.length, truncated: found.length > maxItems };
}

/** A page of the user's liked models, a table the server renders: its rows, in its order, and how many pages of them
 *  there are. Apart from the fetch, so it can be tested on its own. */
export function cgtraderLikesFromPage(html: string): ListPage {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const entries = $("tr.listed-product")
    .toArray()
    .flatMap((el) => {
      const row = $(el);
      const link = row.find("a.listed-product__title").first();
      const path = sitePath(link.attr("href"));
      const slug = path ? parseCgtraderModelUrl(`${SITE_ORIGIN}${path}`)?.slug : null;
      if (!slug || seen.has(slug)) return [];
      seen.add(slug);
      const img = row.find(".listed-product__image img").first();
      const price = clean(row.find(".listed-product__price").first().text());
      return [
        {
          slug,
          title: clean(link.text()) ?? slug,
          cover: webImage(absoluteHttpUrl(img.attr("data-src") ?? img.attr("src") ?? null)),
          price: !price || /free/i.test(price) ? 0 : asCount(price.replace(/[^\d.]/g, "")),
        },
      ];
    });
  return { entries, pages: pageCount($, /^\/profile\/liked_models\b/) };
}

async function likesPage(auth: CgtraderSession, page: number): Promise<ListPage> {
  const res = await get(`/profile/liked_models${page > 1 ? `?page=${page}` : ""}`, auth);
  // Its profile pages answer anyone not signed in with a 401.
  if (res.status === 401 || redirectedTo(res)) throw new CgtraderAuthError();
  if (res.status !== 200) throw failure("your liked models", res);
  return cgtraderLikesFromPage(res.body);
}

/** The user's liked models, their own to see. Up to `maxItems` of them, in the page's order. */
export async function fetchCgtraderLikes(
  auth: CgtraderSession,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<CgtraderListing> {
  return allPages(await likesPage(auth, 1), (page) => likesPage(auth, page), maxItems);
}

/** A page of the user's wishlist: the models its page hands its listing, in its order, and how many pages of them
 *  there are. (Its API lists the paid ones alone, for the cart.) Apart from the fetch, so it can be tested on its
 *  own. */
export function cgtraderWishlistFromPage(html: string): ListPage {
  const $ = cheerio.load(html);
  return {
    entries: cgtraderListingFrom(reactProps($, "ItemsListing/ItemsListingWrapper")),
    pages: pageCount($, /^\/profile\/wish-lists\b/),
  };
}

const WISHLIST_PATH = /^\/profile\/wish-lists\/\d{1,12}\/?$/;

/** A page of the user's wishlist, at `path`; the first is asked for at `/profile/wish-lists`, which redirects to
 *  their own, `/profile/wish-lists/<id>`, where the rest are. */
async function wishlistPage(auth: CgtraderSession, path: string, page: number): Promise<ListPage & { path: string }> {
  let res = await get(`${path}${page > 1 ? `?page=${page}` : ""}`, auth);
  const to = redirectedTo(res);
  if (page === 1 && to && urls.isHost(to.hostname) && WISHLIST_PATH.test(to.pathname)) {
    path = to.pathname;
    res = await get(path, auth);
  }
  if (res.status === 401 || redirectedTo(res)) throw new CgtraderAuthError();
  if (res.status !== 200) throw failure("your wishlist", res);
  return { ...cgtraderWishlistFromPage(res.body), path };
}

/** The user's wishlist, their own to see. Up to `maxItems` of it, in its order. */
export async function fetchCgtraderWishlist(
  auth: CgtraderSession,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<CgtraderListing> {
  const first = await wishlistPage(auth, "/profile/wish-lists", 1);
  return allPages(first, (page) => wishlistPage(auth, first.path, page), maxItems);
}

/** The names the user's lists are kept under; their pages name no user, so they're the site's own words for them. */
export const CGTRADER_LIKES_NAME = "CGTrader liked models";
export const CGTRADER_WISHLIST_NAME = "CGTrader wishlist";

export type CgtraderList = "likes" | "wishlist";

export const CGTRADER_LISTS: Record<CgtraderList, { key: string; name: string; url: string }> = {
  likes: { key: CGTRADER_LIKES_KEY, name: CGTRADER_LIKES_NAME, url: CGTRADER_LIKES_URL },
  wishlist: { key: CGTRADER_WISHLIST_KEY, name: CGTRADER_WISHLIST_NAME, url: CGTRADER_WISHLIST_URL },
};

/** One of the user's lists, read with their sign-in. */
export function fetchCgtraderList(
  list: CgtraderList,
  auth: CgtraderSession,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<CgtraderListing> {
  return list === "likes" ? fetchCgtraderLikes(auth, maxItems) : fetchCgtraderWishlist(auth, maxItems);
}

/** One of the user's lists, as the sync dialog's Browse tab shows it. */
export async function cgtraderListCard(list: CgtraderList, auth: CgtraderSession): Promise<ProviderCollectionCard> {
  const listing = await fetchCgtraderList(list, auth);
  const { key, name, url } = CGTRADER_LISTS[list];
  return {
    id: key,
    name,
    url,
    modelCount: listing.total,
    thumbnails: listing.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
    private: true,
    owner: null,
  };
}

// ---- Sign-in ----

/** Who a sign-in belongs to: their username, which their page is at. Or "rejected"/"unreachable". */
export async function checkCgtraderAuth(
  auth: CgtraderSession,
): Promise<{ username: string } | "rejected" | "unreachable"> {
  try {
    const res = await get("/api/internal/users/me", auth, JSON_ACCEPT);
    if (res.status === 401 || res.status === 403) return "rejected";
    if (res.status !== 200) return "unreachable";
    const user = asRecord(asRecord(asRecord(parseJson(res.body))?.data)?.attributes);
    const username = asText(user?.username);
    return username ? { username } : "unreachable";
  } catch {
    return "unreachable";
  }
}
