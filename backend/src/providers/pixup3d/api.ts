import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import { noteImportActivity } from "../../services/importActivity";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import { assertCredentialDestination } from "../credentialRequest";
import { providerName } from "../names";
import manifest from "./manifest.generated";
import { pixup3dLicense } from "./license";
import {
  parsePixup3dCollectionUrl,
  parsePixup3dModelUrl,
  parsePixup3dWishlistUrl,
  pixup3dCollectionKey,
  pixup3dCollectionUrl,
  pixup3dModelUrl,
  pixup3dProfileUrl,
  pixup3dWishlistKey,
  pixup3dWishlistUrl,
} from "./urls.generated";
export {
  parsePixup3dCollectionUrl,
  parsePixup3dModelUrl,
  parsePixup3dWishlistUrl,
  pixup3dCollectionKey,
  pixup3dCollectionUrl,
  pixup3dModelUrl,
  pixup3dWishlistKey,
  pixup3dWishlistUrl,
};

// PIXUP is Phrozen's Rails site, whose Vue pages call a JSON API of its own under `/api/v1`. A model (a "post"), any
// member's wishlist and collections, and its listings answer anyone. A model's description and pictures are only on
// its page. Its files go only to a signed-in member who owns the model -- free ones too, which take a $0 order through
// the cart -- from `/posts/<id>/download`, one zip per file group of one of its variants ("STL from Designer",
// "Ready-to-Print File", …). The sign-in is Rails' cookie-stored session, which it issues anew with every answer.
// No bot check stands in the way: Node's own fetch gets everything.
const SITE_ORIGIN = manifest.site;
const API = manifest.endpoints.api;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/plain, */*";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
const { session: SESSION_COOKIE } = manifest.sessionCookies;

// What its own pages ask for at once.
const PAGE_SIZE = 24;
const LISTING_MAX_ENTRIES = 600;
// Past these there are surely no more.
const MAX_PAGES = 500;
const CARD_THUMBNAILS = 4;

export class Pixup3dAuthError extends Error {
  constructor() {
    super(
      "PIXUP didn't accept your sign-in; it may have expired. Visit pixup3d.com signed in with Thingport Grab, or " +
        "connect it again in Configuration > Providers.",
    );
    this.name = "Pixup3dAuthError";
  }
}

export class Pixup3dRateLimitError extends Error {
  constructor() {
    super("PIXUP rate-limited Thingport. Wait a while, then try again.");
    this.name = "Pixup3dRateLimitError";
  }
}

/** A zip the site is still making: it packs a file group when it's first asked for, and says so meanwhile. */
export class Pixup3dPreparingError extends Error {
  constructor() {
    super("PIXUP is still packaging this model's files. Wait a few minutes, then import it again.");
    this.name = "Pixup3dPreparingError";
  }
}

/** A free model's $0 order would take whatever else is in the cart along with it, so it isn't placed. */
export class Pixup3dCartError extends Error {
  constructor() {
    super(
      "Your PIXUP cart has paid models in it, and checking out the free one would buy them too. Check out or empty " +
        "your cart on pixup3d.com, then import this model again.",
    );
    this.name = "Pixup3dCartError";
  }
}

/** A sign-in as Thingport keeps it: the session cookie's value. The site answers every request with a new one, which
 *  `request` puts in its place, so a run of requests carries what the last answer gave -- its CSRF token among it. */
export type Pixup3dSession = { session: string };

type Answer = { status: number; location: string | null; contentType: string; body: string };

type RequestInit = {
  accept: string;
  session?: Pixup3dSession | null;
  method?: "GET" | "POST" | "DELETE";
  /** A form's fields, posted. */
  form?: Record<string, string>;
  /** The session's CSRF token, which its pages' own scripts send with what they change. */
  csrf?: string;
  /** Read the body only when it's a page: a download answered with its file itself isn't read here. */
  pagesOnly?: boolean;
};

/** The session cookie the site set, where it set one: its value, or null. One it clears is no session at all. */
export function renewedSession(headers: Headers): string | null {
  const cookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  for (const cookie of cookies) {
    const value = cookie.match(new RegExp(`(?:^|[;,]\\s*)${SESSION_COOKIE}=([^;]*)`))?.[1];
    if (value) return value;
  }
  return null;
}

async function request(url: string, init: RequestInit): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (init.session) assertCredentialDestination("pixup3d-session", url);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: init.accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(init.session ? { Cookie: `${SESSION_COOKIE}=${init.session.session}` } : {}),
        ...(init.csrf
          ? {
              "X-CSRF-Token": init.csrf,
              "X-Requested-With": "XMLHttpRequest",
              Origin: SITE_ORIGIN,
              Referer: SITE_ORIGIN,
            }
          : {}),
        ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: init.form ? new URLSearchParams(init.form).toString() : undefined,
      // Its redirects are its answers: to the sign-in page, to a file, to a creator's page for a model not owned.
      redirect: "manual",
      signal: controller.signal,
    });
    noteImportActivity();
    if (init.session) {
      const renewed = renewedSession(res.headers);
      if (renewed) init.session.session = renewed;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const readBody = !init.pagesOnly || /text\/html|json/i.test(contentType);
    if (!readBody) await res.body?.cancel();
    return {
      status: res.status,
      location: res.headers.get("location"),
      contentType,
      body: readBody ? await res.text() : "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Too many at once are waited out a couple of times, then refused. */
async function requestPaced(url: string, init: RequestInit): Promise<Answer> {
  let res = await request(url, init);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(url, init);
  }
  if (res.status === 429) throw new Pixup3dRateLimitError();
  return res;
}

/** One of its API's answers, as the user where `session` is given. */
async function api(path: string, init: Omit<RequestInit, "accept"> = {}): Promise<Answer & { data: unknown }> {
  const res = await requestPaced(`${API}${path}`, { accept: JSON_ACCEPT, ...init });
  return { ...res, data: parseJson(res.body) };
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on PIXUP (HTTP ${res.status})`);
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

/** Where a redirect goes, made absolute; null for none. */
function redirectedTo(res: Answer): URL | null {
  if (res.status < 300 || res.status >= 400 || !res.location) return null;
  try {
    return new URL(res.location, SITE_ORIGIN);
  } catch {
    return null;
  }
}

function isSitePage(url: URL): boolean {
  return url.origin === SITE_ORIGIN || url.hostname === `www.${new URL(SITE_ORIGIN).hostname}`;
}

function toSignIn(url: URL | null): boolean {
  return Boolean(url && isSitePage(url) && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/sign_in\/?$/i.test(url.pathname));
}

/** A price as it gives them, `"25.0"`, in dollars. */
function priceOf(value: unknown): number {
  const price = asCount(value);
  return price !== null && price > 0 ? price : 0;
}

export function pixup3dPriceText(price: number): string {
  return `$${price.toFixed(2)}`;
}

/** The structured data blocks of one of its pages, parsed; the ones that aren't JSON left out. */
function structuredData($: cheerio.CheerioAPI): Record<string, unknown>[] {
  return $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((el): unknown[] => [parseJson($(el).text())].flat())
    .flatMap((item): Record<string, unknown>[] => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
}

// ---- Models ----

/** One of a model's variants: what it sells or gives as one -- a designer's STLs, a printer's sliced files -- in file
 *  groups downloaded one by one. */
export type Pixup3dVariant = {
  id: string;
  name: string;
  price: number;
  /** Sliced files for some printers, and nothing else: no model files to import. */
  slicedOnly: boolean;
  fileGroups: { id: string; name: string }[];
};

export type Pixup3dModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  postId: string;
  /** Its listed price: the lowest of its variants'. */
  price: number;
  variants: Pixup3dVariant[];
};

/** A variant as its API gives it; null when it isn't one. */
function variantFrom(record: Record<string, unknown>): Pixup3dVariant | null {
  const id = asText(record.id);
  if (!id || !/^\d+$/.test(id)) return null;
  const sliced = record.include_sliced === true;
  const models = record.include_pre_supported === true || record.include_non_supported === true;
  return {
    id,
    name: clean(asText(record.name)) ?? `Variant ${id}`,
    price: priceOf(record.price),
    slicedOnly: sliced && !models,
    fileGroups: recordsOf(record.file_groups).flatMap((group) => {
      const groupId = asText(group.id);
      return groupId && /^\d+$/.test(groupId) ? [{ id: groupId, name: clean(asText(group.name)) ?? groupId }] : [];
    }),
  };
}

// A picture's address names a size before its uploaded name: `x4_<name>.jpg` the largest JPEG, `webp_x1_` a card's.
const SIZE_PREFIX = /^(?:webp_)?x\d+_/;
const SIZE_LABEL = /^(?:XS|S|M|L|XL|XXL):\s/i;

/** The pictures its page's structured data lists, the cover first, each named as it was uploaded. Apart from the
 *  fetch, so it can be tested on its own. */
export function pixup3dGalleryFrom(product: Record<string, unknown> | null): { url: string; filename: string }[] {
  const urls = unique([product?.image].flat().map(webImage)).filter((url) => URL.canParse(url));
  const names = urls.map((url) => {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    return decoded(last).replace(SIZE_PREFIX, "") || "picture.jpg";
  });
  return urls.map((url, index) => {
    // Pictures are uploaded one by one, so two can share a name (`2.jpg`): the upload's number tells them apart.
    const upload = new URL(url).pathname.match(/\/file\/(\d+)\//)?.[1];
    const shared = names.filter((name) => name === names[index]).length > 1;
    return { url, filename: shared && upload ? `${upload}-${names[index]}` : names[index] };
  });
}

/** A path segment as its name reads, or as written where its percent-encoding is malformed (`100%.jpg`). */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Its categories, as its breadcrumb links to them (`/posts?c=<id>`): the deepest first. */
export function pixup3dCategoryIds(breadcrumb: Record<string, unknown> | null): number[] {
  const ids = recordsOf(breadcrumb?.itemListElement).flatMap((item) => {
    try {
      const link = asText(item.item);
      const id = link ? asCount(new URL(link).searchParams.get("c")) : null;
      return id !== null && Number.isInteger(id) && id > 0 ? [id] : [];
    } catch {
      return [];
    }
  });
  return unique(ids.toReversed());
}

/** What matters for printing it, as a short markdown list: its formats and files, and the variants it comes in. */
function detailsMarkdown(product: Record<string, unknown> | null, variants: Pixup3dVariant[]): string | null {
  const facts = new Map(
    recordsOf(product?.additionalProperty).flatMap((fact) => {
      const name = asText(fact.name);
      const value = asText(fact.value);
      return name && value ? [[name, value] as const] : [];
    }),
  );
  const lines: string[] = [];
  const formats = facts.get("File Format");
  if (formats) lines.push(`- **Formats:** ${formats}`);
  const files = facts.get("Number of Files");
  const size = facts.get("Total File Size");
  if (files || size) lines.push(`- **Files:** ${[files, size && `(${size})`].filter(Boolean).join(" ")}`);
  if (variants.length) {
    const options = variants.map((v) => `${v.name} (${v.price ? pixup3dPriceText(v.price) : "free"})`);
    lines.push(`- **Options:** ${options.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : null;
}

/** A model as Thingport keeps it, from its API's answer and its page; null when the answer isn't one. The page may
 *  be missing (null): then it has no description and only its cover. Apart from the fetch, so it can be tested. */
export function pixup3dModelFrom(data: unknown, page: string | null): Pixup3dModelResolution | null {
  const post = asRecord(asRecord(data)?.data);
  const postId = asText(post?.id);
  if (!post || !postId || !/^\d+$/.test(postId)) return null;
  const $ = page ? cheerio.load(page) : null;
  const blocks = $ ? structuredData($) : [];
  const product = blocks.find((block) => block["@type"] === "Product") ?? null;
  const breadcrumb = blocks.find((block) => block["@type"] === "BreadcrumbList") ?? null;
  const variants = recordsOf(post.variants).flatMap((record) => variantFrom(record) ?? []);
  const meta: Partial<ImportedPageMetadata> = {};

  const title = clean(asText(post.title));
  if (title) meta.title = title;

  const description = $ ? htmlToMarkdown($("section.content .prose").first().html() ?? "") : null;
  const notes = [description, detailsMarkdown(product, variants)].filter(Boolean);
  if (notes.length) meta.description = notes.join("\n\n## Model details\n\n");

  // Its size labels (`S: <7 cm`) come as tags too, though they're no subject anyone looks a model up by.
  const tags = unique((Array.isArray(post.tag_list) ? post.tag_list : []).map((tag) => clean(asText(tag)))).filter(
    (tag) => !SIZE_LABEL.test(tag),
  );
  if (tags.length) meta.tags = tags;

  const galleryImages = pixup3dGalleryFrom(product);
  const cover = galleryImages[0]?.url ?? webImage(post.cover_image_src);
  if (cover) meta.previewImageUrl = cover;

  const creator = asRecord(post.creator);
  const username = asText(creator?.username);
  const name = clean(asText(creator?.brand_name)) ?? clean(asText(creator?.display_name)) ?? username;
  if (username && name) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: username,
      name,
      handle: username,
      bio: null,
      bioTranslated: null,
      links: [pixup3dProfileUrl(username)],
      // A member without a picture of their own gets one of the site's, by a path on it.
      avatarUrl: webImage(creator?.avatar_url),
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  const categories = pixup3dCategoryIds(breadcrumb);
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }

  meta.license = pixup3dLicense();

  return { meta, galleryImages, postId, price: priceOf(post.price), variants };
}

/** A model by its number: its API's details and its page. Null for one the site hasn't got or doesn't show. Public;
 *  no sign-in. */
export async function resolvePixup3dModel(postId: string): Promise<Pixup3dModelResolution | null> {
  const res = await api(`/posts/${encodeURIComponent(postId)}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure("this model", res);
  // A page it can't read only leaves the description and the pictures out; a missing one redirects to the home page.
  const page = await requestPaced(pixup3dModelUrl(postId), { accept: HTML }).catch(() => null);
  return pixup3dModelFrom(res.data, page?.status === 200 ? page.body : null);
}

// ---- Ownership, the cart and the files ----

/** Whether the user owns a variant, and whether it's in their cart. A visitor is answered as owning nothing. */
export async function fetchPixup3dVariantState(
  variantId: string,
  session: Pixup3dSession,
): Promise<{ purchased: boolean; inCart: boolean }> {
  const res = await api(`/post_variants/${encodeURIComponent(variantId)}`, { session });
  if (res.status === 401) throw new Pixup3dAuthError();
  if (res.status !== 200) throw failure("this model's variant", res);
  const variant = asRecord(asRecord(res.data)?.data);
  return { purchased: variant?.purchased === true, inCart: variant?.in_cart === true };
}

type CartItem = { id: string; price: number };
type Cart = { variants: CartItem[]; finalPrice: number };

/** A price the cart states, `"0.0"` among them; null for one left out, blank or not a price. */
function statedPrice(value: unknown): number | null {
  if (typeof value === "string" && !value.trim()) return null;
  const price = asCount(value);
  return price !== null && price >= 0 ? price : null;
}

function cartItemOf(value: unknown): CartItem | null {
  const item = asRecord(value);
  const id = asText(item?.id);
  const price = statedPrice(item?.price);
  return id && price !== null ? { id, price } : null;
}

async function fetchCart(session: Pixup3dSession): Promise<Cart> {
  const res = await api("/cart/current_post_cart", { session });
  if (res.status === 401) throw new Pixup3dAuthError();
  if (res.status !== 200) throw failure("your cart", res);
  const data = asRecord(res.data);
  const items = asRecord(data?.cart)?.variants;
  const variants = Array.isArray(items) ? items.flatMap((item) => cartItemOf(item) ?? []) : [];
  // An empty cart has no order to price: PIXUP answers `order: null` for it.
  const empty = Array.isArray(items) && !items.length && data?.order === null;
  const finalPrice = empty ? 0 : statedPrice(asRecord(data?.order)?.final_price);
  // Only a cart it states the contents, each one's price and the total of: anything else can't be shown to be free,
  // so isn't checked out.
  if (!Array.isArray(items) || variants.length < items.length || finalPrice === null) throw failure("your cart", res);
  return { variants, finalPrice };
}

/** Whether checking the cart out would cost anything: its total, or any one thing in it. */
function costsMoney(cart: Cart): boolean {
  return cart.finalPrice > 0 || cart.variants.some((variant) => variant.price > 0);
}

/** The CSRF token its cart page gives the session, which its scripts send with whatever they change. */
async function cartToken(session: Pixup3dSession): Promise<string> {
  const res = await requestPaced(`${SITE_ORIGIN}/cart`, { accept: HTML, session });
  if (toSignIn(redirectedTo(res))) throw new Pixup3dAuthError();
  const token = res.status === 200 ? cheerio.load(res.body)('meta[name="csrf-token"]').attr("content") : undefined;
  if (!token) throw failure("your cart", res);
  return token;
}

// A checkout's redirects followed, at most.
const CHECKOUT_HOPS = 3;

/** Its own pages a checkout sends the member to, opened as a browser does: a $0 one goes to its success page
 *  (`/order/checkout_succeeded?…`), and opening that is what finishes the order. Where they end: the last of them, or
 *  the first that's off the site or the sign-in, which isn't opened. */
async function followSitePages(to: URL | null, session: Pixup3dSession): Promise<URL | null> {
  for (let hop = 0; to && hop < CHECKOUT_HOPS && isSitePage(to) && !toSignIn(to); hop++) {
    const next = redirectedTo(await requestPaced(to.href, { accept: HTML, session }));
    if (!next) break;
    to = next;
  }
  return to;
}

/** Free variants the user doesn't own yet, put in their library as the site's own Download button does it: into the
 *  cart and through a $0 checkout. The checkout takes the whole cart, so it isn't placed while anything in the cart
 *  costs money (Pixup3dCartError), or while the cart can't be read. Throws unless all of them are owned after it, and
 *  what was put in for it comes out again then; what was there before is left as it was. */
export async function placePixup3dFreeOrder(variantIds: string[], session: Pixup3dSession): Promise<void> {
  const before = await fetchCart(session);
  if (costsMoney(before)) throw new Pixup3dCartError();
  const token = await cartToken(session);
  const added: string[] = [];
  try {
    for (const id of variantIds) {
      if (before.variants.some((variant) => variant.id === id)) continue;
      // Counted before its answer is: one that fails may have gone in all the same.
      added.push(id);
      const res = await api(`/cart/variants/${encodeURIComponent(id)}`, { session, method: "POST", csrf: token });
      if (res.status === 401) throw new Pixup3dAuthError();
      // Put in, it answers 201.
      const took = res.status === 200 || res.status === 201;
      if (!took || asText(asRecord(res.data)?.status) !== "ok") throw failure("its cart", res);
    }
    // Asked again, as what was put in is priced by the cart, not by the model's page.
    const cart = await fetchCart(session);
    if (costsMoney(cart)) throw new Pixup3dCartError();
    if (!variantIds.every((id) => cart.variants.some((variant) => variant.id === id))) {
      throw new Error("PIXUP's cart didn't list this model once it was put in, so it wasn't checked out. Try again.");
    }
    const checkout = await requestPaced(`${SITE_ORIGIN}/cart/checkout`, {
      accept: HTML,
      session,
      method: "POST",
      form: { authenticity_token: token },
    });
    const after = await followSitePages(redirectedTo(checkout), session);
    if (toSignIn(after)) throw new Pixup3dAuthError();
    // A $0 cart stays on its pages, from the success page to the library; one sent anywhere else, its payment page
    // among them, wasn't checked out, and has nothing for the check below to find.
    if (after && !isSitePage(after)) {
      throw new Error(`PIXUP asked for payment instead of taking the free order (sent to ${after.hostname})`);
    }
    if (checkout.status >= 400) throw new Error(`PIXUP didn't take the free order (HTTP ${checkout.status})`);
    // Checked in here too: a checkout sent back to one of its own pages may not have been taken. One that was took
    // the cart with it, which leaves nothing for taking out again to touch.
    for (const id of variantIds) {
      if (!(await fetchPixup3dVariantState(id, session)).purchased) {
        throw new Error(
          "PIXUP was sent the free order, but the model isn't in your library yet. Try again in a minute.",
        );
      }
    }
  } catch (err) {
    for (const id of added) {
      await api(`/cart/variants/${encodeURIComponent(id)}`, { session, method: "DELETE", csrf: token }).catch(
        () => undefined,
      );
    }
    throw err;
  }
}

// What its page says while a file group's zip is being made.
const PACKAGING = /still being packaged/i;

/** Where one file group of a variant the user owns is, as its download link tells them: a signed link to a zip on its
 *  file host. One they don't own is sent to its creator's page instead, and a visitor to the sign-in. */
export async function resolvePixup3dDownload(
  postId: string,
  variantId: string,
  groupId: string,
  session: Pixup3dSession,
): Promise<string> {
  const query = new URLSearchParams({ post_variant_id: variantId, file_group_id: groupId });
  const res = await requestPaced(`${SITE_ORIGIN}/posts/${encodeURIComponent(postId)}/download?${query}`, {
    accept: HTML,
    session,
    pagesOnly: true,
  });
  const to = redirectedTo(res);
  if (to && isPixup3dFileHost(to.hostname)) return to.href;
  if (toSignIn(to)) throw new Pixup3dAuthError();
  let page = res.status === 200 && /text\/html/i.test(res.contentType) ? res.body : null;
  // Back to a page of its own, which says why; the model's page, for one still being packaged.
  if (to && isSitePage(to)) {
    const next = await requestPaced(to.href, { accept: HTML, session });
    page = next.status === 200 ? next.body : null;
  }
  if (page && PACKAGING.test(page)) throw new Pixup3dPreparingError();
  throw new Error(`PIXUP didn't hand over the files (HTTP ${res.status}${to ? `, to ${to.pathname}` : ""})`);
}

// Its zips name each file after the number it was uploaded as: `182652_01_Keychain.3mf`. Five digits at least, which
// its oldest models' already have, so a designer's own `2024_bracket.stl` keeps its year.
const UPLOAD_NUMBER = /^\d{5,}_(?=.)/;

/** A file group's files under the names their designer gave them: without the upload numbers its zip puts in front,
 *  where every one of them has one. */
export function withoutUploadNumbers<T extends { filename: string }>(files: T[]): T[] {
  if (!files.length || !files.every((file) => UPLOAD_NUMBER.test(file.filename))) return files;
  return files.map((file) => ({ ...file, filename: file.filename.replace(UPLOAD_NUMBER, "") }));
}

/** Its files and pictures are on its own file host, where a download link sends an owner on with a signed CloudFront
 *  link to the group's zip (`/uploads/post_file_package/file/<id>/package.zip?…&Signature=…`) that needs no cookie. */
export function isPixup3dFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type Pixup3dModelSummary = {
  postId: string;
  title: string;
  cover: string | null;
  price: number;
  likes: number | null;
  author: string | null;
};

/** The models of one of its API's listings, in its order. */
export function pixup3dListingFrom(data: unknown): Pixup3dModelSummary[] {
  const seen = new Set<string>();
  return recordsOf(asRecord(data)?.data).flatMap((post) => {
    const postId = asText(post.id);
    if (!postId || !/^\d+$/.test(postId) || seen.has(postId)) return [];
    seen.add(postId);
    const creator = asRecord(post.creator);
    return [
      {
        postId,
        title: clean(asText(post.title)) ?? `PIXUP ${postId}`,
        cover: webImage(post.cover_image_src),
        price: priceOf(post.price),
        likes: asCount(post.likes_count),
        author: clean(asText(creator?.brand_name)) ?? clean(asText(creator?.display_name)) ?? asText(creator?.username),
      },
    ];
  });
}

function pagesOf(data: unknown): { pages: number; total: number | null } {
  const pagination = asRecord(asRecord(data)?.pagination);
  return {
    pages: Math.min(Math.max(1, asCount(pagination?.total_pages) ?? 1), MAX_PAGES),
    total: asCount(pagination?.total_count),
  };
}

/** Its most viewed models of the week, as its home page's Trending link lists them. Public; no sign-in. */
export async function fetchPixup3dTrending(limit: number): Promise<TrendingModel[]> {
  const res = await api(`/posts?${new URLSearchParams({ o: "most_views_w", per_page: String(PAGE_SIZE), page: "1" })}`);
  if (res.status !== 200) throw failure("its trending models", res);
  return pixup3dListingFrom(res.data)
    .slice(0, limit)
    .map((model) => ({
      id: model.postId,
      title: model.title,
      url: pixup3dModelUrl(model.postId),
      image: model.cover,
      likes: model.likes,
      author: model.author,
      paid: model.price > 0,
    }));
}

export type Pixup3dListing = { entries: Pixup3dModelSummary[]; total: number; truncated: boolean };

/** A paged list of its API's, read page by page up to `maxItems`; null when its first page says it isn't there. */
async function pagedListing(
  path: (page: number) => string,
  what: string,
  maxItems: number,
  session: Pixup3dSession | null = null,
): Promise<Pixup3dListing | null> {
  const entries: Pixup3dModelSummary[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  for (let page = 1, pages = 1; page <= pages && entries.length < maxItems; page++) {
    const res = await api(path(page), { session });
    // Only the first page says it isn't there: a later 404 is it going mid-read, and no answer either way.
    if (res.status === 404 && page === 1) return null;
    if (res.status !== 200) throw failure(what, res);
    const paging = pagesOf(res.data);
    pages = paging.pages;
    total = paging.total ?? total;
    const found = pixup3dListingFrom(res.data).filter((entry) => !seen.has(entry.postId));
    found.forEach((entry) => seen.add(entry.postId));
    if (!found.length) break;
    entries.push(...found);
  }
  const all = Math.max(total ?? 0, entries.length);
  return { entries: entries.slice(0, maxItems), total: all, truncated: all > Math.min(entries.length, maxItems) };
}

/** A member's wishlist, anyone's to read, by their username: up to `maxItems` of it, in its order. Null for no such
 *  member. */
export function fetchPixup3dWishlist(
  username: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<Pixup3dListing | null> {
  const user = encodeURIComponent(username);
  return pagedListing(
    (page) => `/profiles/${user}/get_saved_posts?page=${page}&per_page=${PAGE_SIZE}`,
    "this wishlist",
    maxItems,
  );
}

/** What a member's wishlist is named in Thingport. */
export function pixup3dWishlistName(username: string): string {
  return `${providerName(PROVIDER)} wishlist (@${username})`;
}

export type Pixup3dCollectionInfo = { title: string; postIds: string[]; isPublic: boolean };

/** The collection its page hands its script, `collection: {…}`; null where there's none. Apart from the fetch, so it
 *  can be tested on its own. */
export function pixup3dCollectionFromPage(html: string): Pixup3dCollectionInfo | null {
  const start = html.search(/\bcollection:\s*\{/);
  if (start < 0) return null;
  const open = html.indexOf("{", start);
  // Its JSON holds no braces of its own in strings that matter here, but a title may: count only outside strings.
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = open; i < html.length && end < 0; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) end = i;
  }
  const collection = end > 0 ? asRecord(parseJson(html.slice(open, end + 1))) : null;
  if (!collection) return null;
  return {
    title: clean(asText(collection.title)) ?? "PIXUP collection",
    postIds: unique((Array.isArray(collection.post_ids) ? collection.post_ids : []).map(asText)).filter((id) =>
      /^\d+$/.test(id),
    ),
    isPublic: collection.is_public !== false,
  };
}

/** One of a member's collections: its name and up to `maxItems` of its models, in its order. Its page names them,
 *  and the API's `get_posts_by_ids` gives their titles and pictures. Null for one that isn't there, or that only its
 *  owner sees and `session` isn't theirs. */
export async function fetchPixup3dCollection(
  username: string,
  collectionId: string,
  maxItems: number = LISTING_MAX_ENTRIES,
  session: Pixup3dSession | null = null,
): Promise<(Pixup3dListing & { info: Pixup3dCollectionInfo }) | null> {
  const page = await requestPaced(pixup3dCollectionUrl(username, collectionId), { accept: HTML, session });
  // A collection that isn't there is a 404; a member who isn't, a redirect to the home page.
  if (page.status === 404 || (redirectedTo(page) && !toSignIn(redirectedTo(page)))) return null;
  if (page.status !== 200) throw failure("this collection", page);
  const info = pixup3dCollectionFromPage(page.body);
  if (!info) throw failure("this collection", page);
  const wanted = info.postIds.slice(0, maxItems);
  const found = new Map<string, Pixup3dModelSummary>();
  const user = encodeURIComponent(username);
  for (let at = 0; at < wanted.length; at += PAGE_SIZE) {
    const query = new URLSearchParams(wanted.slice(at, at + PAGE_SIZE).map((id): [string, string] => ["ids[]", id]));
    query.set("page", "1");
    query.set("per_page", String(PAGE_SIZE));
    const res = await api(`/profiles/${user}/get_posts_by_ids?${query}`, { session });
    if (res.status !== 200) throw failure("this collection's models", res);
    for (const entry of pixup3dListingFrom(res.data)) found.set(entry.postId, entry);
  }
  // In the collection's own order, which the API doesn't keep; a model it no longer shows is left out.
  const entries = wanted.flatMap((id) => found.get(id) ?? []);
  return {
    info,
    entries,
    total: info.postIds.length,
    truncated: info.postIds.length > entries.length,
  };
}

/** A member's collections, as the sync dialog's Browse tab shows them: the private ones too where `session` is
 *  theirs. */
export async function fetchPixup3dCollectionCards(
  username: string,
  session: Pixup3dSession | null = null,
): Promise<ProviderCollectionCard[]> {
  const user = encodeURIComponent(username);
  const cards: ProviderCollectionCard[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const res = await api(`/profiles/${user}/get_designer_collections?mode=page&page=${page}&per_page=${PAGE_SIZE}`, {
      session,
    });
    if (res.status === 404) return [];
    if (res.status !== 200) throw failure("these collections", res);
    pages = pagesOf(res.data).pages;
    for (const collection of recordsOf(asRecord(res.data)?.data)) {
      const id = asText(collection.id);
      if (!id || !/^\d+$/.test(id)) continue;
      cards.push({
        id: pixup3dCollectionKey(username, id),
        name: clean(asText(collection.title)) ?? `Collection ${id}`,
        url: pixup3dCollectionUrl(username, id),
        modelCount: asCount(collection.total_posts) ?? 0,
        thumbnails: recordsOf(collection.preview_posts)
          .flatMap((post) => webImage(post.cover_image_src) ?? [])
          .slice(0, CARD_THUMBNAILS),
        private: collection.is_public === false,
        owner: username,
      });
    }
  }
  return cards;
}

/** A collection, as the sync dialog's Browse tab shows it; null when it isn't there. */
export async function pixup3dCollectionCard(
  username: string,
  collectionId: string,
  session: Pixup3dSession | null = null,
): Promise<ProviderCollectionCard | null> {
  const collection = await fetchPixup3dCollection(username, collectionId, CARD_THUMBNAILS, session);
  return (
    collection && {
      id: pixup3dCollectionKey(username, collectionId),
      name: collection.info.title,
      url: pixup3dCollectionUrl(username, collectionId),
      modelCount: collection.total,
      thumbnails: collection.entries.flatMap((entry) => entry.cover ?? []),
      private: !collection.info.isPublic,
      owner: username,
    }
  );
}

/** A member's wishlist, as the sync dialog's Browse tab shows it; null for no such member. */
export async function pixup3dWishlistCard(username: string): Promise<ProviderCollectionCard | null> {
  const wishlist = await fetchPixup3dWishlist(username, PAGE_SIZE);
  return (
    wishlist && {
      id: pixup3dWishlistKey(username),
      name: pixup3dWishlistName(username),
      url: pixup3dWishlistUrl(username),
      modelCount: wishlist.total,
      thumbnails: wishlist.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: username,
    }
  );
}

/** The models the user owns some variant of, by number, from their library: what tells a paid model they bought from
 *  one they haven't, in a list. */
export async function fetchPixup3dOwnedPosts(session: Pixup3dSession): Promise<Set<string>> {
  const owned = new Set<string>();
  for (let page = 1, pages = 1; page <= pages; page++) {
    const query = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE), kw: "", filter: "all" });
    const res = await api(`/profile/purchased_variants?${query}`, { session });
    if (res.status === 401) throw new Pixup3dAuthError();
    if (res.status !== 200) throw failure("your library", res);
    pages = pagesOf(res.data).pages;
    for (const item of recordsOf(asRecord(res.data)?.data)) {
      const postId = asText(asRecord(item.post)?.id) ?? asText(item.post_id);
      if (postId) owned.add(postId);
    }
  }
  return owned;
}

// ---- Sign-in ----

export type Pixup3dMember = { username: string; name: string | null };

/** Who a sign-in belongs to: their username, which their page is at, and their name. Or "rejected"/"unreachable". */
export async function checkPixup3dAuth(session: Pixup3dSession): Promise<Pixup3dMember | "rejected" | "unreachable"> {
  try {
    const res = await api("/profile/current_user", { session });
    if (res.status === 401 || res.status === 403) return "rejected";
    if (res.status !== 200) return "unreachable";
    const me = asRecord(res.data);
    const username = asText(me?.username);
    // Only a username its pages could be at: it's what the user's own lists are read by.
    if (!username || !parsePixup3dWishlistUrl(pixup3dWishlistUrl(username))) return "unreachable";
    return { username, name: clean(asText(me?.display_name)) ?? clean(asText(me?.brand_name)) };
  } catch {
    return "unreachable";
  }
}
