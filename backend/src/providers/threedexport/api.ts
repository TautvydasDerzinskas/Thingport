import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import { noteImportActivity } from "../../services/importActivity";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import { assertCredentialDestination } from "../credentialRequest";
import { providerName } from "../names";
import manifest from "./manifest.generated";
import { threedexportLicense } from "./license";
import {
  isThreedexportDefaultUrl,
  parseThreedexportCollectionUrl,
  parseThreedexportModelUrl,
  THREEDEXPORT_BOOKMARKS_URL,
  THREEDEXPORT_DEFAULT_KEY,
  THREEDEXPORT_DEFAULT_URL,
  threedexportCollectionUrl,
  threedexportModelUrl,
} from "./urls.generated";
export {
  isThreedexportDefaultUrl,
  parseThreedexportCollectionUrl,
  parseThreedexportModelUrl,
  THREEDEXPORT_DEFAULT_KEY,
  THREEDEXPORT_DEFAULT_URL,
  threedexportCollectionUrl,
  threedexportModelUrl,
};

// 3DExport is a PHP shop with no API of its own: its pages are rendered on the server, and its listings page on with a
// POST answering their next page's HTML inside JSON. So this reads the pages. A model's page, its listings and anyone's
// public collection are anyone's to read. Its files go only to a signed-in user: a free model's page then links each of
// its formats' downloads, which redirect to a signed S3 link to that format's zip. The sign-in is its remember-me pair
// (the user's number and a hash), from which any request starts a session; a hash it no longer takes is answered by
// clearing it (`nm_hash=deleted`). Every POST wants the session's id as a CSRF token. No bot check stands in the way.
const SITE_ORIGIN = manifest.site;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const JSON_ACCEPT = "application/json, text/javascript, */*; q=0.01";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
const { user: USER_COOKIE, hash: HASH_COOKIE } = manifest.sessionCookies;
const SESSION_COOKIE = "sessionid";

// What its collection pages show at once.
const PAGE_SIZE = 100;
const LISTING_MAX_ENTRIES = 600;
// The most of a collection read, against a listing that never ends: a bounded read stops here and says it's truncated,
// and a whole one (a sync's) with pages left past it throws, so it never passes for complete.
const MAX_PAGES = 200;
const CARD_THUMBNAILS = 4;

/** The site turned the sign-in down. `hash` names the one it turned down, so only that one is marked rejected. */
export class ThreedexportAuthError extends Error {
  readonly hash: string | null;
  constructor(session: ThreedexportSession | null = null) {
    super(
      "3DExport didn't accept your sign-in; signing out of 3dexport.com ends it. Visit 3dexport.com signed in with " +
        "Thingport Grab, or connect it again in Configuration > Providers.",
    );
    this.name = "ThreedexportAuthError";
    this.hash = session?.hash ?? null;
  }
}

export class ThreedexportRateLimitError extends Error {
  constructor() {
    super("3DExport rate-limited Thingport. Wait a while, then try again.");
    this.name = "ThreedexportRateLimitError";
  }
}

/** A sign-in as Thingport keeps it: the remember-me pair, the user's number on the site and its hash. */
export type ThreedexportSession = { userId: string; hash: string };

/** One run of requests as one visitor: the sign-in they're sent with, where there is one, and the session the site
 *  starts for the first of them, which the rest send back so it starts only one. The session is never kept. */
export type ThreedexportVisit = { session: ThreedexportSession | null; sid: string | null };

export function threedexportVisit(session: ThreedexportSession | null = null): ThreedexportVisit {
  return { session, sid: null };
}

type Answer = {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
  /** The site cleared the hash it was sent: the sign-in is over. */
  revoked: boolean;
};

type RequestInit = {
  accept: string;
  method?: "GET" | "POST";
  /** A form's fields, posted with the session's id beside them and as the CSRF header, as its own scripts do. */
  form?: Record<string, string>;
  /** Read the body only when it's a page: a download answered with its file itself isn't read here. */
  pagesOnly?: boolean;
};

function cookieOf(visit: ThreedexportVisit): string {
  const parts = ["nm_language=english"];
  if (visit.session) parts.push(`${USER_COOKIE}=${visit.session.userId}`, `${HASH_COOKIE}=${visit.session.hash}`);
  if (visit.sid) parts.push(`${SESSION_COOKIE}=${visit.sid}`);
  return parts.join("; ");
}

function setCookies(headers: Headers): string[] {
  return typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
}

/** A cookie the answer set, by name; null where it set none. */
function setCookie(headers: Headers, name: string): string | null {
  for (const cookie of setCookies(headers)) {
    const value = cookie.match(new RegExp(`^\\s*${name}=([^;]*)`))?.[1];
    if (value !== undefined) return value;
  }
  return null;
}

async function request(url: string, visit: ThreedexportVisit, init: RequestInit): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (visit.session) assertCredentialDestination("threedexport-session", url);
    const form = init.form && visit.sid ? { ...init.form, [SESSION_COOKIE]: visit.sid } : init.form;
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: init.accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        Cookie: cookieOf(visit),
        ...(form
          ? {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              Origin: SITE_ORIGIN,
              Referer: url,
              ...(visit.sid ? { "X-CSRF-Token": visit.sid } : {}),
            }
          : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      // Its redirects are its answers: to a model's own address, to a signed file, to the home page for a visitor.
      redirect: "manual",
      signal: controller.signal,
    });
    noteImportActivity();
    const sid = setCookie(res.headers, SESSION_COOKIE);
    if (sid && sid !== "deleted") visit.sid = sid;
    const revoked = Boolean(visit.session) && setCookie(res.headers, HASH_COOKIE) === "deleted";
    const contentType = res.headers.get("content-type") ?? "";
    const readBody = !init.pagesOnly || /text\/html|json/i.test(contentType);
    if (!readBody) await res.body?.cancel();
    return {
      status: res.status,
      location: res.headers.get("location"),
      contentType,
      body: readBody ? await res.text() : "",
      revoked,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Too many at once are waited out a couple of times, then refused. A sign-in the site cleared is refused at once. */
async function requestPaced(url: string, visit: ThreedexportVisit, init: RequestInit): Promise<Answer> {
  let res = await request(url, visit, init);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(url, visit, init);
  }
  if (res.revoked) throw new ThreedexportAuthError(visit.session);
  if (res.status === 429) throw new ThreedexportRateLimitError();
  return res;
}

function page(path: string, visit: ThreedexportVisit): Promise<Answer> {
  return requestPaced(path.startsWith("http") ? path : `${SITE_ORIGIN}${path}`, visit, { accept: HTML });
}

/** A session to post with: its scripts' POSTs carry its id, and a visit that hasn't asked anything has none yet. Its
 *  cart's state is the smallest answer that starts one. */
async function ensureSession(visit: ThreedexportVisit): Promise<void> {
  if (visit.sid) return;
  await requestPaced(`${SITE_ORIGIN}/cart-ajax?method=get`, visit, { accept: JSON_ACCEPT });
  if (!visit.sid) throw new Error("3DExport didn't start a session to read its listings with");
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on 3DExport (HTTP ${res.status})`);
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

/** A link of its pages made absolute, or null for one that isn't a web address. */
function absolute(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, `${SITE_ORIGIN}/`);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Whether a page is a signed-in user's: only theirs has the menu's link to their own profile. */
function signedInOn($: cheerio.CheerioAPI): boolean {
  return $("a.profile-link").length > 0;
}

/** A price as its pages give them, `"5.00"`, in dollars; 0 for free or none. */
function priceOf(value: unknown): number {
  const price = asCount(value);
  return price !== null && price > 0 ? price : 0;
}

export function threedexportPriceText(price: number): string {
  return `$${price.toFixed(2)}`;
}

// ---- Models ----

/** One of a model's formats, as a signed-in user's page links its download: its zip of that format's files. */
export type ThreedexportFile = {
  /** The download link, on the site: `download?link=…&id=…&nf=<file>&t=…`. */
  href: string;
  /** What the page calls it: `Stereolithography (.stl)`. */
  label: string;
  /** The format's extension, without its dot, where the label names one. */
  ext: string | null;
};

export type ThreedexportModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  itemId: string;
  price: number;
  /** Each format's download, as the page linked them: only for a signed-in user, and only for a model that's free or
   *  theirs. Empty otherwise. */
  files: ThreedexportFile[];
  /** Whether the page was a signed-in user's, so that `files` says something about the model. */
  signedIn: boolean;
};

// Every picture's name carries the same list of formats after the model's own, whatever it comes in:
// `elephanta001_3d_model_c4d_max_obj_fbx_ma_lwo_3ds_3dm_stl_6933325.webp`.
const NAME_FORMATS = /_3d_model(?:_(?:c4d|max|obj|fbx|ma|lwo|3ds|3dm|stl))+(?=_\d+\.)/i;

/** A picture's name, from its address: the last part of its path, without that list. */
function pictureName(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").replace(NAME_FORMATS, "") || fallback;
  } catch {
    return fallback;
  }
}

/** The pictures of its gallery, full size, in its order. */
export function threedexportGalleryFrom($: cheerio.CheerioAPI): { url: string; filename: string }[] {
  const urls = unique(
    $("#fGallery [data-src]")
      .toArray()
      .map((el) => absolute($(el).attr("data-src")))
      .filter((url): url is string => Boolean(url && /\.(?:webp|jpe?g|png|gif)(?:[?#]|$)/i.test(url))),
  );
  return urls.map((url, index) => ({ url, filename: pictureName(url, `image-${index}.webp`) }));
}

/** Its categories, as its breadcrumb links to them: the deepest first. A print model's are the path under
 *  `/3d-print-models/` (`characters/animals`); any other catalogue's keep its name in front (`3d-models/animals/cat`),
 *  so they never pass for a print category. */
export function threedexportCategoryPaths($: cheerio.CheerioAPI): string[] {
  const paths = $("ul.breadcrumb a[href]")
    .toArray()
    .flatMap((el) => {
      try {
        const url = new URL($(el).attr("href") ?? "", `${SITE_ORIGIN}/`);
        const m = url.pathname.match(/^\/((?:3d-print-models|3d-models|cg-textures)(?:\/[a-z0-9-]+){1,3})\/?$/i);
        if (!m) return [];
        const path = m[1].toLowerCase();
        return [path.startsWith("3d-print-models/") ? path.slice("3d-print-models/".length) : path];
      } catch {
        return [];
      }
    });
  return unique(paths.toReversed());
}

/** A row of its details panel, `<strong>Name:</strong> <value>`, as text; null where it hasn't got one. */
function detail($: cheerio.CheerioAPI, name: string): string | null {
  const row = $("ul.details-panel li")
    .toArray()
    .find((li) => clean($(li).find("strong").first().text()) === `${name}:`);
  if (!row) return null;
  const copy = $(row).clone();
  copy.find("strong").first().remove();
  return clean(copy.text());
}

/** The formats its panel lists, as it names them (`STEP (.step)`), without their sizes. */
function formatNames($: cheerio.CheerioAPI): string[] {
  return unique(
    $("ul.details-panel .keywords a[title]")
      .toArray()
      .map((el) => clean(($(el).attr("title") ?? "").split(/<br\s*\/?>/i)[0])),
  );
}

/** What matters for printing it, as a short markdown list: its formats, size and whether it's ready to print. */
function detailsMarkdown($: cheerio.CheerioAPI): string | null {
  const lines: string[] = [];
  const formats = formatNames($);
  if (formats.length) lines.push(`- **Formats:** ${formats.join(", ")}`);
  const size = ["Width", "Height", "Depth"].map((side) => detail($, `${side} in millimeters`));
  if (size.every(Boolean)) lines.push(`- **Size:** ${size.join(" × ")} mm`);
  const ready = detail($, "Print Ready");
  if (ready) lines.push(`- **Print ready:** ${ready}`);
  return lines.length ? lines.join("\n") : null;
}

/** Its description as its author wrote it: without its heading, the note on its print readiness the site adds below
 *  a CG model's, and the site's own usage information under every one. */
function descriptionHtml($: cheerio.CheerioAPI): string {
  const block = $('.description[itemprop="description"]').first().clone();
  block.children("h3").first().remove();
  block.find("h3").each((_, el) => {
    if (/usage information/i.test($(el).text())) $(el).closest("div.m-t").remove();
  });
  block.children("strong.block").each((_, el) => {
    if (/^\s*print ready:/i.test($(el).text())) $(el).remove();
  });
  return block.html() ?? "";
}

/** The format a download's label names, `Autodesk FBX (.fbx)`, by its extension; null where it names none. */
function extensionOf(label: string): string | null {
  return label.match(/\(\.([a-z0-9_]{1,12})\)/i)?.[1]?.toLowerCase() ?? null;
}

/** Whether a link is the site's own download endpoint, the only place its download links go. */
function isDownloadLink(href: string): boolean {
  const url = new URL(href);
  return url.origin === SITE_ORIGIN && url.pathname === "/download" && url.searchParams.has("link");
}

/** The downloads a signed-in user's page links, one per format. A model in more than one lists them by format; one in
 *  a single format has a plain "Download free" button instead, which names none, so its format is the one the page's
 *  panel lists. Links its author put in the description aren't the site's, whatever they look like. */
export function threedexportFilesFrom($: cheerio.CheerioAPI): ThreedexportFile[] {
  const files = $('a[href*="download?link="]')
    .not('[itemprop="description"] a')
    .toArray()
    .flatMap((el) => {
      const href = absolute($(el).attr("href"));
      if (!href || !isDownloadLink(href)) return [];
      const copy = $(el).clone();
      copy.find("b").remove();
      const label = clean(copy.text()) ?? "";
      return [{ href, label, ext: extensionOf(label) }];
    })
    .filter((file, index, all) => all.findIndex((other) => other.href === file.href) === index);
  const formats = formatNames($);
  const ext = formats.length === 1 ? extensionOf(formats[0]) : null;
  for (const file of files) {
    if (file.ext || !ext) continue;
    file.label = formats[0];
    file.ext = ext;
  }
  return files;
}

/** An author's own picture; null for the one the site gives anyone without (`/storage/avatars/default.png`). */
function avatarOf(src: string | undefined): string | null {
  const url = absolute(src);
  return url && !/\/avatars\/default\./i.test(url) ? url : null;
}

/** The model's title, without the kind the heading adds after it (`Free 3D Models`, `3D Print Model`). */
function titleOf($: cheerio.CheerioAPI): string | null {
  const heading = $("h1.item-title").first().clone();
  heading.children().remove();
  return clean(heading.text()) ?? clean($('meta[property="og:title"]').attr("content")?.split(" | ")[0]);
}

/** A model as Thingport keeps it, from its page; null when the page isn't one. Apart from the fetch, so it can be
 *  tested on its own. */
export function threedexportModelFrom(html: string): ThreedexportModelResolution | null {
  const $ = cheerio.load(html);
  const itemId = clean($('meta[property="og:product_id"]').attr("content"));
  if (!itemId || !/^\d{1,12}$/.test(itemId)) return null;
  const meta: Partial<ImportedPageMetadata> = {};

  const title = titleOf($);
  if (title) meta.title = title;

  const description = htmlToMarkdown(descriptionHtml($));
  const notes = [description, detailsMarkdown($)].filter(Boolean);
  if (notes.length) meta.description = notes.join("\n\n## Model details\n\n");

  const tags = unique(
    $("section.details-list .keywords li")
      .toArray()
      .map((li) => clean($(li).text())),
  );
  if (tags.length) meta.tags = tags;

  const galleryImages = threedexportGalleryFrom($);
  const cover = galleryImages[0]?.url ?? absolute($('meta[property="og:image"]').attr("content"));
  if (cover) meta.previewImageUrl = cover;

  const box = $('section[itemprop="brand"]').first();
  const name = clean(box.find('meta[itemprop="name"]').attr("content")) ?? clean(box.find(".author-box a").text());
  const profile = absolute(box.find('.author-box a[href^="https://3dexport.com/"]').first().attr("href"));
  const handle = profile ? (new URL(profile).pathname.match(/^\/([\w.-]{1,100})\/?$/)?.[1] ?? null) : null;
  if (name) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: (handle ?? name).toLowerCase(),
      name,
      handle,
      bio: null,
      bioTranslated: null,
      links: profile ? [profile] : [],
      avatarUrl: avatarOf(box.find("img.avatar").attr("src")),
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  const categories = threedexportCategoryPaths($);
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }

  const price = priceOf(
    $("#currentPrice").attr("data-price-amount") ?? $('meta[property="og:price:amount"]').attr("content"),
  );
  // Its "No AI Training" note, beside the price, only on a model whose author opted out.
  const noAi = $('a[data-target="#no_ai_license_popup"]').length > 0;
  meta.license = threedexportLicense(price, noAi);

  return { meta, galleryImages, itemId, price, files: threedexportFilesFrom($), signedIn: signedInOn($) };
}

/** A model by its number, from its page, read as `visit`'s user: only theirs lists the downloads. Null for one the
 *  site hasn't got. */
export async function resolveThreedexportModel(
  itemId: string,
  visit: ThreedexportVisit = threedexportVisit(),
): Promise<ThreedexportModelResolution | null> {
  let res = await page(threedexportModelUrl(itemId), visit);
  // Its address by any other name is a redirect to its own, which is where the model is.
  for (let hop = 0; hop < 2; hop++) {
    const to = redirectedTo(res);
    if (!to || !parseThreedexportModelUrl(to.href)) break;
    res = await page(to.href, visit);
  }
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure("this model", res);
  const model = threedexportModelFrom(res.body);
  if (!model) throw failure("this model", res);
  // Sent the sign-in and answered as a visitor: it's over.
  if (visit.session && !model.signedIn) throw new ThreedexportAuthError(visit.session);
  return model;
}

// Formats a plate takes: picked first. An OBJ or GLB is usually a CG model's mesh, often the largest of its formats,
// so it comes only when those brought nothing.
const PRINT_FORMATS = new Set(["stl", "3mf", "step", "stp", "lbrn", "lbrn2"]);
const FALLBACK_FORMATS = new Set(["obj", "glb"]);

/** Which of a model's formats to download: the ones a plate takes first, and its OBJ or GLB only when those bring
 *  nothing, with any download whose format the page doesn't say. A CG model comes in a dozen, its textures and scenes
 *  among them, which are never fetched. */
export function threedexportFilePicks(files: ThreedexportFile[]): {
  first: ThreedexportFile[];
  fallback: ThreedexportFile[];
} {
  return {
    first: files.filter((file) => file.ext && PRINT_FORMATS.has(file.ext)),
    fallback: files.filter((file) => !file.ext || FALLBACK_FORMATS.has(file.ext)),
  };
}

/** Where one format's download is, as its link tells a signed-in user: a signed S3 link to its zip. A visitor is sent
 *  to the home page instead. */
export async function resolveThreedexportDownload(file: ThreedexportFile, visit: ThreedexportVisit): Promise<string> {
  const res = await requestPaced(file.href, visit, { accept: HTML, pagesOnly: true });
  const to = redirectedTo(res);
  if (to && isThreedexportFileHost(to.hostname)) return to.href;
  if (to && to.hostname === new URL(SITE_ORIGIN).hostname && (to.pathname === "/" || to.pathname === "")) {
    throw new ThreedexportAuthError(visit.session);
  }
  throw new Error(`3DExport didn't hand over the ${file.label || "model's"} files (HTTP ${res.status})`);
}

/** Its files are on its S3 bucket, where a download link sends a signed-in user on with a link signed for a few
 *  minutes (`/<date>/<user>/<item>/3dexport_<name>_<n>.zip?X-Amz-…`) that needs no cookie. */
export function isThreedexportFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type ThreedexportModelSummary = {
  itemId: string;
  title: string;
  cover: string | null;
  price: number;
  author: string | null;
};

/** The models of one of its grids, in its order: each tile carries the model's number, name, price and author. */
export function threedexportTilesFrom(html: string): ThreedexportModelSummary[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  return $(".dribomos[data-id]")
    .toArray()
    .flatMap((el) => {
      const tile = $(el);
      const itemId = clean(tile.attr("data-id"));
      if (!itemId || !/^\d{1,12}$/.test(itemId) || seen.has(itemId)) return [];
      seen.add(itemId);
      // Its name ends in what kind of model it is ("… 3D Print Model"), which the tile says apart too.
      const variant = clean(tile.attr("data-variant"));
      const named = clean(tile.attr("data-name")) ?? "";
      const title = variant && named.endsWith(` ${variant}`) ? named.slice(0, -variant.length - 1) : named;
      return [
        {
          itemId,
          title: clean(title) ?? `3DExport ${itemId}`,
          cover: absolute(tile.find(`img#img-${itemId}`).attr("src") ?? tile.find("img").first().attr("src")),
          price: priceOf(tile.attr("data-price")),
          author: clean(tile.attr("data-brand")),
        },
      ];
    });
}

/** How many models a page's heading says its grid holds: `<span>104 item(s)</span>`. */
function totalOf($: cheerio.CheerioAPI): number | null {
  return asCount(
    $("h1 span")
      .first()
      .text()
      .match(/([\d,]+)\s*item/i)?.[1]
      ?.replace(/,/g, ""),
  );
}

/** Its Best Sales order of 3D print models, as its listing's own script pages it in. Public; no sign-in. */
export async function fetchThreedexportTrending(limit: number): Promise<TrendingModel[]> {
  const visit = threedexportVisit();
  await ensureSession(visit);
  const res = await requestPaced(`${SITE_ORIGIN}/3d-print-models?order_by=bestsales`, visit, {
    accept: JSON_ACCEPT,
    method: "POST",
    form: { ajaxPage: "1" },
  });
  const content = asText(asRecord(parseJson(res.body))?.content);
  if (res.status !== 200 || !content) throw failure("its best-selling models", res);
  return threedexportTilesFrom(content)
    .slice(0, limit)
    .map((model) => ({
      id: model.itemId,
      title: model.title,
      url: threedexportModelUrl(model.itemId),
      image: model.cover,
      likes: null,
      author: model.author,
      paid: model.price > 0,
    }));
}

export type ThreedexportListing = { entries: ThreedexportModelSummary[]; total: number; truncated: boolean };

/** A collection's page as one of its grids reads: its name and its models, page by page up to `maxItems`. */
export type ThreedexportCollection = ThreedexportListing & { title: string };

/** The name a collection's page gives it: the last step of its breadcrumb. */
function collectionTitleOf($: cheerio.CheerioAPI): string | null {
  return clean($("ul.breadcrumb li").last().find('[itemprop="name"]').text());
}

/** A collection read from `url`, a hundred to a page, up to `maxItems`. Null for one that isn't there, or can't be seen:
 *  a private one answers anyone but its owner with a 404, and a numbered one that's gone shows an empty "Default
 *  Collection" -- which the user's own Default Collection (`numbered` false) may well be. Read whole (`maxItems`
 *  infinite, as a sync reads it), one that still has pages past MAX_PAGES throws rather than pass for complete. */
async function readCollection(
  url: string,
  visit: ThreedexportVisit,
  maxItems: number,
  numbered: boolean,
): Promise<ThreedexportCollection | null> {
  const entries: ThreedexportModelSummary[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let title: string | null = null;
  let more = true;
  for (let at = 1; at <= MAX_PAGES && entries.length < maxItems; at++) {
    const res = await page(at === 1 ? url : `${url}?page=${at}`, visit);
    // Only the first page says it isn't there: a later 404 is it going mid-read, and no answer either way.
    if (res.status === 404 && at === 1) return null;
    if (res.status !== 200) throw failure("this collection", res);
    const $ = cheerio.load(res.body);
    if (at === 1) {
      total = totalOf($);
      title = collectionTitleOf($);
      if (numbered && total === 0 && title === "Default Collection") return null;
    }
    const found = threedexportTilesFrom(res.body).filter((entry) => !seen.has(entry.itemId));
    found.forEach((entry) => seen.add(entry.itemId));
    // A page with nothing new is the end, though the count said more: it counts models that are gone from the site.
    more = found.length > 0 && (total === null || entries.length + found.length < total);
    entries.push(...found);
    if (!more) break;
  }
  if (more && maxItems === Number.POSITIVE_INFINITY && entries.length < (total ?? Number.POSITIVE_INFINITY)) {
    throw new Error(
      `This 3DExport collection runs past the ${MAX_PAGES * PAGE_SIZE} models Thingport reads of one, so a sync ` +
        "can't tell what's new in it.",
    );
  }
  const all = Math.max(total ?? 0, entries.length);
  return {
    title: title ?? "3DExport collection",
    entries: entries.slice(0, maxItems),
    total: all,
    truncated: all > Math.min(entries.length, maxItems),
  };
}

/** What the user's Default Collection is named in Thingport. */
export function threedexportDefaultName(): string {
  return `${providerName(PROVIDER)} Default Collection`;
}

/** The signed-in user's Default Collection, always private, up to `maxItems` of it. */
export async function fetchThreedexportDefault(
  visit: ThreedexportVisit,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<ThreedexportCollection> {
  const found = await readCollection(THREEDEXPORT_DEFAULT_URL, visit, maxItems, false);
  // It's never gone: its page is a 404 only to a visitor, so the sign-in is what failed.
  if (!found) throw new ThreedexportAuthError(visit.session);
  return { ...found, title: threedexportDefaultName() };
}

/** A collection by its number, as `visit` sees it: anyone's public one, or a private one of the signed-in user's. Up
 *  to `maxItems` of it; null for one that isn't there, or that's someone else's private one. */
export function fetchThreedexportCollection(
  collectionId: string,
  visit: ThreedexportVisit,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<ThreedexportCollection | null> {
  return readCollection(threedexportCollectionUrl(collectionId), visit, maxItems, true);
}

/** One of the user's own collections, as their bookmarks page lists it. */
export type ThreedexportOwnCollection = { key: string; url: string; name: string; count: number; private: boolean };

/** The collections the user's bookmarks page lists: their Default Collection and the ones they made. Apart from the
 *  fetch, so it can be tested on its own. */
export function threedexportOwnCollectionsFrom(html: string): ThreedexportOwnCollection[] {
  const $ = cheerio.load(html);
  return $("#BookmarksBody tr")
    .toArray()
    .flatMap((row) => {
      const link = $(row).find("td.BookmarksTitle a[href]").first();
      const href = absolute(link.attr("href"));
      if (!href) return [];
      const name = clean(link.text()) ?? "Collection";
      const count = asCount($(row).find("td.BookmarksTitle .text-small").first().text().match(/\d+/)?.[0]) ?? 0;
      const access = clean($(row).find("td").last().text());
      if (isThreedexportDefaultUrl(href)) {
        return [{ key: THREEDEXPORT_DEFAULT_KEY, url: THREEDEXPORT_DEFAULT_URL, name, count, private: true }];
      }
      const collection = parseThreedexportCollectionUrl(href);
      if (!collection) return [];
      return [
        {
          key: collection.collectionId,
          url: threedexportCollectionUrl(collection.collectionId),
          name,
          count,
          private: access?.toLowerCase() === "private",
        },
      ];
    });
}

/** The user's own collections, by their sign-in. */
export async function fetchThreedexportOwnCollections(visit: ThreedexportVisit): Promise<ThreedexportOwnCollection[]> {
  const res = await page(THREEDEXPORT_BOOKMARKS_URL, visit);
  if (res.status !== 200) throw failure("your bookmarks", res);
  if (!signedInOn(cheerio.load(res.body))) throw new ThreedexportAuthError(visit.session);
  return threedexportOwnCollectionsFrom(res.body);
}

/** A collection as the sync dialog's Browse tab shows it. */
export function threedexportCard(
  key: string,
  url: string,
  collection: ThreedexportCollection,
  options: { private: boolean; owner: string | null; name?: string },
): ProviderCollectionCard {
  return {
    id: key,
    name: options.name ?? collection.title,
    url,
    modelCount: collection.total,
    thumbnails: collection.entries.flatMap((entry) => entry.cover ?? []).slice(0, CARD_THUMBNAILS),
    private: options.private,
    owner: options.owner,
  };
}

export const THREEDEXPORT_CARD_THUMBNAILS = CARD_THUMBNAILS;

// ---- Sign-in ----

export type ThreedexportAccount = { username: string };

/** Who a sign-in belongs to: the username their profile is at, as the menu of a page only they see links it. Or
 *  "rejected"/"unreachable". */
export async function checkThreedexportAuth(
  session: ThreedexportSession,
): Promise<ThreedexportAccount | "rejected" | "unreachable"> {
  try {
    const res = await page(THREEDEXPORT_BOOKMARKS_URL, threedexportVisit(session));
    if (res.status !== 200) return "unreachable";
    const $ = cheerio.load(res.body);
    if (!signedInOn($)) return "rejected";
    const profile = absolute($("a.profile-link").first().attr("href"));
    const username = profile ? new URL(profile).pathname.match(/^\/([\w.-]{1,100})\/?$/)?.[1] : null;
    return username ? { username } : "unreachable";
  } catch (err) {
    return err instanceof ThreedexportAuthError ? "rejected" : "unreachable";
  }
}
