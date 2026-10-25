import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import { isCloudflareChallenge } from "../../services/flaresolverr";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import {
  CREATOR_ID_PREFIX,
  parsePrintSocialCollectionUrl,
  parsePrintSocialCreatorUrl,
  parsePrintSocialModelUrl,
  printSocialCollectionUrl,
  printSocialCreatorKey,
  printSocialCreatorUrl,
  printSocialModelUrl,
  urls,
} from "./urls.generated";
import manifest from "./manifest.generated";
export {
  CREATOR_ID_PREFIX,
  parsePrintSocialCollectionUrl,
  parsePrintSocialCreatorUrl,
  parsePrintSocialModelUrl,
  printSocialCollectionUrl,
  printSocialCreatorKey,
  printSocialCreatorUrl,
  printSocialModelUrl,
};

// 3DPrint.social is a Manyfold server (github.com/manyfold3d/manyfold), and these read its pages, which Rails renders
// on the server. Its JSON API answers only with an OAuth token from an app registered there, but anything public is
// anyone's to see, files included: each file's download link (`/models/<id>/raw/<filename>?download=true`) sends the
// file itself, or redirects to where its storage keeps it. A model, collection or creator it hasn't got is a 404; one
// that isn't public redirects a visitor to its sign-in page. Its lists show 12 models a page to a visitor. Names here
// are "PrintSocial", the id ("threedprintsocial") being no word to read.
const SITE_ORIGIN = manifest.site;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;

const LISTING_MAX_ENTRIES = 300;
const PAGE_CONCURRENCY = 3;
const CARD_THUMBNAILS = 4;
// A creator's collections, past which there are surely no more.
const MAX_COLLECTION_PAGES = 20;

export class PrintSocialRateLimitError extends Error {
  constructor() {
    super("3DPrint.social rate-limited Thingport. Wait a while, then try again.");
    this.name = "PrintSocialRateLimitError";
  }
}

export class PrintSocialBlockedError extends Error {
  constructor() {
    super("3DPrint.social's Cloudflare turned Thingport away. Wait a while, then try again.");
    this.name = "PrintSocialBlockedError";
  }
}

type Answer = { status: number; location: string | null; body: string };

async function request(path: string): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_ORIGIN}${path}`, {
      // English, so the counts it writes out ("12 models") read the same whatever the server's default.
      headers: { Accept: HTML, "Accept-Language": "en-US,en;q=0.9", "User-Agent": USER_AGENT },
      // A redirect to its sign-in page is its answer for what isn't public, so it's read rather than followed.
      redirect: "manual",
      signal: controller.signal,
    });
    if (isCloudflareChallenge(res.headers)) throw new PrintSocialBlockedError();
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

/** One page. Too many at once are waited out a couple of times, then refused. */
async function get(path: string): Promise<Answer> {
  let res = await request(path);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path);
  }
  if (res.status === 429) throw new PrintSocialRateLimitError();
  return res;
}

/** Whether it said it hasn't got what was asked for, or won't show it to a visitor: a 404, or a redirect to its
 *  sign-in page. */
function notThere(res: Answer): boolean {
  if (res.status === 404) return true;
  if (res.status < 300 || res.status >= 400 || !res.location) return false;
  try {
    const to = new URL(res.location, SITE_ORIGIN);
    return urls.isHost(to.hostname) && /^\/users\/sign_in\/?$/.test(to.pathname);
  } catch {
    return false;
  }
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on 3DPrint.social (HTTP ${res.status})`);
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

/** A link on its pages as an absolute one on the site, or null for one elsewhere (a model federated from another
 *  server links to its home there). */
function siteUrl(href: string | undefined): URL | null {
  if (!href) return null;
  try {
    const url = new URL(href, SITE_ORIGIN);
    return urls.isHost(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/** One of its pictures, at full size: its pages ask for smaller ones by a `derivative` parameter. */
function picture(src: string | undefined): string | null {
  const url = siteUrl(src);
  if (!url) return null;
  url.searchParams.delete("derivative");
  return url.href;
}

/** Its pictures are files of the model, served as `/models/<id>/model_files/<file id>.<ext>`: named by the name the
 *  page gives them, with the file's own extension. */
function pictureName(url: string, name: string | null, fallback: string): string {
  const ext = new URL(url).pathname.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "";
  const base = (name ?? "").replace(/[\\/:*?"<>|]+/g, "-").trim();
  if (!base) return fallback;
  return ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? `${base}${ext}` : base;
}

/** The page's own title, the last of its breadcrumbs: the model's, collection's or creator's name. */
function breadcrumbTitle($: cheerio.CheerioAPI): string | null {
  return clean($('nav[aria-label="breadcrumb"] .breadcrumb-item.active').last().text());
}

// ---- Models ----

export type PrintSocialFile = { name: string; url: string };

export type PrintSocialModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  /** Its files other than its pictures, each by its download link. */
  files: PrintSocialFile[];
};

/** A tag's name, from its link: the models page filtered by it, `?tag[]=<name>`, the last of them. Its text counts
 *  the models with it as well ("bracket (12)"), which only the site wide tag cloud means. */
function tagName(el: ReturnType<cheerio.CheerioAPI>): string | null {
  const link = el.is("a") ? el : el.find("a").first();
  const href = link.attr("href");
  if (href) {
    try {
      const fromLink = new URL(href, SITE_ORIGIN).searchParams.getAll("tag[]").at(-1);
      if (fromLink && clean(fromLink)) return clean(fromLink);
    } catch {
      // Its text, then.
    }
  }
  return clean(el.text().replace(/\s*\(\d+\)\s*$/, ""));
}

/** A model's page as Thingport keeps it; null when it isn't one. The metadata mapping, apart from the fetch so it can
 *  be tested on its own. */
export function printSocialModelFromPage(html: string, modelId: string): PrintSocialModelResolution | null {
  const $ = cheerio.load(html);
  const main = $('[itemtype="https://schema.org/3DModel"]').first();
  if (!main.length) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = breadcrumbTitle($) ?? clean(main.find("h1").first().text());
  if (title) meta.title = title;
  // Its description is markdown rendered into paragraphs inside a paragraph, which HTML can't nest: the outer one
  // closes empty, and the text follows it in the card it's in.
  const described = main.find('[itemprop="description"]').first();
  const description = clean(described.text()) ? described.html() : described.parent().html();
  const markdown = description ? htmlToMarkdown(description) : null;
  if (markdown) meta.description = markdown;
  const tags = unique(
    main
      .find('#sidebar [itemprop="keywords"]')
      .toArray()
      .map((el) => tagName($(el))),
  );
  if (tags.length) meta.tags = tags;

  // The model's preview picture at full size, where it's a picture, then the rest in the order its carousel has them.
  const preview = picture($('meta[property="og:image"]').attr("content"));
  const carousel = main
    .find("#imageCarousel img")
    .toArray()
    .map((el) => ({ url: picture($(el).attr("src")), name: clean($(el).attr("alt")) }));
  const seen = new Set<string>();
  const images = [
    ...(preview ? [{ url: preview, name: carousel.find((image) => image.url === preview)?.name ?? null }] : []),
    ...carousel,
  ].filter(
    (image): image is { url: string; name: string | null } =>
      !!image.url && !seen.has(image.url) && !!seen.add(image.url),
  );
  if (images[0]) meta.previewImageUrl = images[0].url;

  const creator = main.find('a[itemprop="author"]').first();
  const slug = parsePrintSocialCreatorUrl(siteUrl(creator.attr("href"))?.href ?? "")?.slug;
  const name = clean(creator.text());
  if (slug && name) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: slug,
      name,
      handle: slug,
      bio: null,
      bioTranslated: null,
      links: [printSocialCreatorUrl(slug)],
      avatarUrl: null,
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  // Each file's card, under "Files" and the groups after it. Its pictures are left out of them, being in the carousel.
  const files = main
    .find("#item_list .preview-card")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const link = siteUrl(card.find(".card-body a[download]").first().attr("href"));
      const raw = link?.pathname.match(/^\/models\/[a-z0-9]+\/raw\/(.+)$/)?.[1];
      if (!link || !raw) return [];
      let fromLink: string;
      try {
        fromLink = decodeURIComponent(raw);
      } catch {
        fromLink = raw;
      }
      const filename = clean(card.find(".card-text code").first().text()) ?? fromLink;
      return [{ name: filename.split("/").pop() || filename, url: link.href }];
    });

  return {
    meta,
    galleryImages: images.map((image, index) => ({
      url: image.url,
      filename: pictureName(
        image.url,
        image.name,
        `image-${index}${new URL(image.url).pathname.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".jpg"}`,
      ),
    })),
    modelId,
    files,
  };
}

/** By its public id. Null for a model that doesn't exist, or that it doesn't show. */
export async function resolvePrintSocialModel(modelId: string): Promise<PrintSocialModelResolution | null> {
  const res = await get(`/models/${encodeURIComponent(modelId)}`);
  if (notThere(res)) return null;
  if (res.status !== 200) throw failure("this model", res);
  return printSocialModelFromPage(res.body, modelId);
}

/** Its files are on the site itself; their links may redirect on to wherever its storage keeps them, which the
 *  download follows. */
export function isPrintSocialFileHost(hostname: string): boolean {
  return urls.isHost(hostname);
}

// ---- Lists ----

export type PrintSocialModelSummary = { modelId: string; title: string; cover: string | null };

export type PrintSocialListing = { entries: PrintSocialModelSummary[]; total: number; truncated: boolean };

/** The model cards of a list page, in its order. Models federated from other servers link there, and are left out:
 *  only its own import. */
export function printSocialModelCards($: cheerio.CheerioAPI): PrintSocialModelSummary[] {
  const seen = new Set<string>();
  return $("#item_list .preview-card")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const link = siteUrl(card.find(".card-footer a.btn-primary").first().attr("href"));
      const modelId = link ? parsePrintSocialModelUrl(link.href)?.modelId : null;
      if (!modelId || seen.has(modelId)) return [];
      seen.add(modelId);
      return [
        {
          modelId,
          title:
            clean(card.find(".card-title > span").first().text()) ??
            clean(card.find("img.image-preview").attr("alt")) ??
            `Model ${modelId}`,
          cover: picture(card.find("img.image-preview").first().attr("src")),
        },
      ];
    });
}

/** The last page its pagination links to, or 1 where it has none. */
function pageCount($: cheerio.CheerioAPI): number {
  const pages = $("#item_list .pagination a")
    .toArray()
    .map((el) => {
      try {
        return Number(new URL($(el).attr("href") ?? "", SITE_ORIGIN).searchParams.get("page")) || 0;
      } catch {
        return 0;
      }
    });
  return Math.max(1, ...pages);
}

/** Which list: a collection by its public id, or a creator's models by their slug. */
export type PrintSocialList = { kind: "collection"; collectionId: string } | { kind: "creator"; slug: string };

/** A list by what a sync keeps it under: a collection's public id, or `creator:<slug>`. */
export function printSocialListOf(externalId: string): PrintSocialList {
  return externalId.startsWith(CREATOR_ID_PREFIX)
    ? { kind: "creator", slug: externalId.slice(CREATOR_ID_PREFIX.length) }
    : { kind: "collection", collectionId: externalId };
}

/** A list's page, by its link: a collection's, or a creator's. */
export function printSocialListFromUrl(url: string): PrintSocialList | null {
  const collection = parsePrintSocialCollectionUrl(url);
  if (collection) return { kind: "collection", ...collection };
  const creator = parsePrintSocialCreatorUrl(url);
  return creator && { kind: "creator", ...creator };
}

const listPath = (list: PrintSocialList) =>
  list.kind === "collection"
    ? `/collections/${encodeURIComponent(list.collectionId)}`
    : `/creators/${encodeURIComponent(list.slug)}`;

export const printSocialListUrl = (list: PrintSocialList) =>
  list.kind === "collection" ? printSocialCollectionUrl(list.collectionId) : printSocialCreatorUrl(list.slug);

export const printSocialListKey = (list: PrintSocialList) =>
  list.kind === "collection" ? list.collectionId : printSocialCreatorKey(list.slug);

export type PrintSocialListInfo = { name: string; owner: string | null };

type ListPage = {
  info: PrintSocialListInfo;
  total: number | null;
  pages: number;
  /** How many cards it shows a page, its other servers' models included, by the first page's. */
  perPage: number;
  entries: PrintSocialModelSummary[];
};

/** A collection's or creator's page: its name, the count it gives ("12 models"), and one page of its models. Null
 *  when it isn't one. */
export function printSocialListFromPage(html: string, list: PrintSocialList): ListPage | null {
  const $ = cheerio.load(html);
  const header = $("#item_list > .card").first();
  const name = clean(header.find("h2").first().text()) ?? breadcrumbTitle($);
  if (!name) return null;
  const total = header
    .find("p")
    .toArray()
    .map((el) => clean($(el).text())?.match(/^([\d,.\s]+)\s+models?$/i)?.[1])
    .find(Boolean);
  // A collection's creator, as it attributes it; a creator's list is their own.
  const owner =
    list.kind === "creator" ? name : clean(header.find('a[href*="creator="], a[href^="/creators/"]').first().text());
  return {
    info: { name, owner },
    total: countIn(total),
    pages: pageCount($),
    perPage: $("#item_list .preview-card").length,
    entries: printSocialModelCards($),
  };
}

async function listPage(list: PrintSocialList, page: number): Promise<ListPage | null> {
  const res = await get(`${listPath(list)}${page > 1 ? `?page=${page}` : ""}`);
  if (notThere(res)) return null;
  if (res.status !== 200) throw failure(list.kind === "collection" ? "this collection" : "this creator", res);
  return printSocialListFromPage(res.body, list);
}

export type PrintSocialFetchedList = PrintSocialListing & { info: PrintSocialListInfo };

/** A list's models in its order, up to `maxItems`; null when there's no such collection or creator, or it isn't
 *  public. */
export async function fetchPrintSocialList(
  list: PrintSocialList,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<PrintSocialFetchedList | null> {
  const first = await listPage(list, 1);
  if (!first) return null;
  const perPage = Math.max(first.perPage, 1);
  // Its pagination's last page, or as many as its count of models takes where that says more: a list never stops at
  // its first page for want of the links. A page past the last is an empty one.
  const pages = Math.min(Math.max(first.pages, Math.ceil((first.total ?? 0) / perPage)), Math.ceil(maxItems / perPage));
  const rest = await mapWithConcurrency(
    Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => i + 2),
    PAGE_CONCURRENCY,
    async (page) => {
      const found = await listPage(list, page);
      // Gone between its pages: no clear answer, rather than a shorter list.
      if (!found) throw new Error("This 3DPrint.social list changed while it was being read. Try again.");
      return found.entries;
    },
  );
  const seen = new Set<string>();
  const entries = [first.entries, ...rest]
    .flat()
    .filter((entry) => !seen.has(entry.modelId) && Boolean(seen.add(entry.modelId)))
    .slice(0, maxItems);
  const total = Math.max(first.total ?? 0, entries.length);
  return { info: first.info, entries, total, truncated: entries.length < total };
}

/** The name a creator's models are synced under. */
export function printSocialCreatorListName(creator: string): string {
  return `${creator} on 3DPrint.social`;
}

/** A collection, or a creator's models, as the sync dialog's Browse tab shows it; null when there's no such one. */
export async function printSocialListCard(list: PrintSocialList): Promise<ProviderCollectionCard | null> {
  const first = await listPage(list, 1);
  return (
    first && {
      id: printSocialListKey(list),
      name: list.kind === "creator" ? printSocialCreatorListName(first.info.name) : first.info.name,
      url: printSocialListUrl(list),
      modelCount: first.total ?? first.entries.length,
      thumbnails: first.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: first.info.owner,
    }
  );
}

/** The collection cards of a page of its collections. */
export function printSocialCollectionCardsFrom(html: string): ProviderCollectionCard[] {
  const $ = cheerio.load(html);
  return $("#item_list .preview-card")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      // Its button to the collection's models, labelled with how many there are ("12 models").
      const go = card
        .find(".card-footer a")
        .toArray()
        .map((a) => ({ url: siteUrl($(a).attr("href")), label: clean($(a).text()) }))
        .find((a) => a.url && parsePrintSocialCollectionUrl(a.url.href));
      const collectionId = go?.url ? parsePrintSocialCollectionUrl(go.url.href)?.collectionId : null;
      const name = clean(card.find(".card-title").first().text());
      if (!collectionId || !name) return [];
      return [
        {
          id: collectionId,
          name,
          url: printSocialCollectionUrl(collectionId),
          modelCount: countIn(go?.label) ?? 0,
          thumbnails: unique([picture(card.find("img.image-preview").first().attr("src"))]),
          private: false,
          owner: clean(card.find('.card-body a[href*="creator="], .card-body a[href^="/creators/"]').first().text()),
        },
      ];
    });
}

/** A creator's collections, every page of them. */
export async function fetchPrintSocialCollectionCards(slug: string): Promise<ProviderCollectionCard[]> {
  const cards: ProviderCollectionCard[] = [];
  for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
    const res = await get(`/collections?creator=${encodeURIComponent(slug)}${page > 1 ? `&page=${page}` : ""}`);
    if (res.status !== 200) throw failure("these collections", res);
    cards.push(...printSocialCollectionCardsFrom(res.body));
    if (page >= pageCount(cheerio.load(res.body))) break;
  }
  return cards;
}

// ---- Creators ----

/** A creator by the slug, handle or link the user gave: `dansup`, `@dansup`, `@dansup@3dprint.social`, or their page.
 *  Null when it isn't one. */
export function printSocialSlugFrom(value: string): string | null {
  const text = value.trim();
  const fromUrl = /^https?:\/\//i.test(text) ? parsePrintSocialCreatorUrl(text)?.slug : undefined;
  if (fromUrl !== undefined) return fromUrl;
  const handle = text.match(/^@?([A-Za-z0-9_-]{1,64})(?:@(?:www\.)?3dprint\.social)?$/i)?.[1];
  return handle ?? null;
}

/** Who a creator is, by their slug: their name and their slug as the site writes it. Null for no such creator. */
export async function resolvePrintSocialCreator(slug: string): Promise<{ slug: string; name: string } | null> {
  const res = await get(`/creators/${encodeURIComponent(slug)}`);
  if (notThere(res)) return null;
  if (res.status !== 200) throw failure("this creator", res);
  const page = printSocialListFromPage(res.body, { kind: "creator", slug });
  return page && { slug, name: page.info.name };
}
