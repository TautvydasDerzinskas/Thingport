import { assertCredentialDestination } from "../credentialRequest";
import * as cheerio from "cheerio";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { absoluteHttpUrl, htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import { likesCollectionName } from "../names";
import {
  grabcadLikesKey,
  grabcadLikesUrl,
  grabcadModelUrl,
  parseGrabcadLikesUrl,
  parseGrabcadModelUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
export { grabcadLikesKey, grabcadLikesUrl, grabcadModelUrl, parseGrabcadLikesUrl, parseGrabcadModelUrl };

// GrabCAD's library is an Angular app over a JSON API of its own, `/community/api/v1`, which answers anyone: a model's
// details, its gallery and its files, folder by folder, each with the API link that downloads it. That link is the one
// thing that needs a sign-in -- Rails' session cookie -- and answers with where the file is, on the site's own host.
// A member's likes are a page the server renders, and anyone's to read. Its CloudFront turns away a request without a
// browser's User-Agent, the files and pictures included.
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

// A member's likes page shows 24.
const LIKES_PAGE_SIZE = 24;
const LISTING_MAX_ENTRIES = 600;
const PAGE_CONCURRENCY = 3;
// Past these there are surely no more, and a sync reads every page: members who like a lot run to 150 pages and more.
const MAX_LIKES_PAGES = 2000;
// Folders a model's files are looked for in; an assembly's parts can be spread over a few levels of them.
const MAX_FOLDERS = 40;
const CARD_THUMBNAILS = 4;
const TRENDING_PAGE_SIZE = 24;

export class GrabcadAuthError extends Error {
  constructor() {
    super(
      "GrabCAD didn't accept your sign-in; it may have expired. Visit grabcad.com signed in with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "GrabcadAuthError";
  }
}

export class GrabcadRateLimitError extends Error {
  constructor() {
    super("GrabCAD rate-limited Thingport. Wait a while, then try again.");
    this.name = "GrabcadRateLimitError";
  }
}

/** A sign-in as Thingport keeps it: the session cookie's value. */
export type GrabcadSession = { session: string };

type Answer = { status: number; body: string };

async function request(
  url: string,
  init: { accept: string; session?: GrabcadSession | null; json?: unknown },
): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (init.session) assertCredentialDestination("grabcad-session", url);
    const res = await fetch(url, {
      method: init.json === undefined ? "GET" : "POST",
      headers: {
        Accept: init.accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(init.json === undefined ? {} : { "Content-Type": "application/json" }),
        ...(init.session ? { Cookie: `${SESSION_COOKIE}=${init.session.session}` } : {}),
      },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      // Nothing it answers is a redirect worth following: one would be somewhere else entirely.
      redirect: "manual",
      signal: controller.signal,
    });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(timeout);
  }
}

/** Too many at once are waited out a couple of times, then refused. */
async function requestPaced(
  url: string,
  init: { accept: string; session?: GrabcadSession | null; json?: unknown },
): Promise<Answer> {
  let res = await request(url, init);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(url, init);
  }
  if (res.status === 429) throw new GrabcadRateLimitError();
  return res;
}

/** One of its API's answers, as the user where `session` is given. */
async function api(
  path: string,
  session: GrabcadSession | null = null,
  json?: unknown,
): Promise<Answer & { data: unknown }> {
  const res = await requestPaced(`${API}${path}`, { accept: JSON_ACCEPT, session, json });
  return { ...res, data: parseJson(res.body) };
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on GrabCAD (HTTP ${res.status})`);
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

/** A link on its pages, made absolute; null for one that isn't a link at all. */
function siteHref(href: string | undefined): string | null {
  try {
    return href ? new URL(href, SITE_ORIGIN).href : null;
  } catch {
    return null;
  }
}

/** A picture of its own, not the stand-in it gives a member or model without one (`…/missing_feed.png`). */
function ownPicture(value: unknown): string | null {
  const url = webImage(value);
  return url && !/\/missing_[a-z]+\.(png|jpe?g)$/i.test(url) ? url : null;
}

// ---- Models ----

export type GrabcadModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** Its slug, which everything about it is asked for by. */
  slug: string;
};

// Categories so broad they say little of what a model is: the ones its other categories name come first. It lists a
// model's in alphabetical order, so nothing else says which is its main one. "Educational" is mostly students' own
// coursework, whatever it's of.
const BROAD_CATEGORIES = new Set(["3d-printing", "educational", "miscellaneous", "just-for-fun", "speedrun"]);

/** Its categories' slugs, the telling ones first. */
export function grabcadCategoryIds(categories: unknown): string[] {
  const slugs = unique(recordsOf(categories).map((category) => asText(category.cached_slug)?.toLowerCase()));
  return [
    ...slugs.filter((slug) => !BROAD_CATEGORIES.has(slug)),
    ...slugs.filter((slug) => BROAD_CATEGORIES.has(slug)),
  ];
}

/** The formats it says it comes in, as a short markdown list: what matters for printing it. */
function detailsMarkdown(model: Record<string, unknown>): string | null {
  // "Rendering" is its pictures, not a format.
  const formats = unique(recordsOf(model.softwares).map((software) => asText(software.name))).filter(
    (name) => name !== "Rendering",
  );
  return formats.length ? `- **Formats:** ${formats.join(", ")}` : null;
}

// Pictures a browser shows; its gallery keeps a BMP or a TIFF as it was uploaded, at every size but the card's.
const WEB_PICTURE = /\.(jpe?g|png|gif|webp)$/i;

/** The pictures its gallery shows, at the size its viewer opens; null when it isn't one. Apart from the fetch, so it
 *  can be tested on its own. */
export function grabcadGalleryFrom(data: unknown): { url: string; filename: string }[] | null {
  const gallery = asRecord(data);
  if (!gallery || !Array.isArray(gallery.gallery_files)) return null;
  const seen = new Set<string>();
  return recordsOf(gallery.gallery_files).flatMap((file, index) => {
    const sizes = asRecord(file.rendering_urls) ?? {};
    const url = [sizes.large, sizes.card].map(webImage).find((size) => size && WEB_PICTURE.test(size));
    if (!url || seen.has(url)) return [];
    seen.add(url);
    // Named as it was uploaded, with the extension of the size fetched.
    const base = (asText(file.name) ?? `image-${index}`).replace(/\.[^.]*$/, "");
    return [{ url, filename: `${base}${url.match(WEB_PICTURE)?.[0].toLowerCase() ?? ".jpg"}` }];
  });
}

/** A model's details as Thingport keeps it, with its gallery; null when it isn't one. Apart from the fetch, so it can
 *  be tested on its own. */
export function grabcadModelFrom(data: unknown, gallery: unknown): GrabcadModelResolution | null {
  const model = asRecord(data);
  const slug = asText(model?.cached_slug)?.toLowerCase();
  if (!model || !slug) return null;
  const meta: Partial<ImportedPageMetadata> = {};

  const title = clean(asText(model.name));
  if (title) meta.title = title;

  const notes = [htmlToMarkdown(asText(model.description) ?? ""), detailsMarkdown(model)].filter(Boolean);
  if (notes.length) meta.description = notes.join("\n\n## Model details\n\n");

  const tags = unique(
    (Array.isArray(model.tags) ? model.tags : []).map((tag) => clean(typeof tag === "string" ? tag : null)),
  );
  if (tags.length) meta.tags = tags;

  const images = grabcadGalleryFrom(gallery) ?? [];
  const cover = images[0]?.url ?? ownPicture(model.preview_image);
  if (cover) meta.previewImageUrl = cover;

  const designer = asRecord(model.author);
  const name = clean(asText(designer?.name));
  const member = asText(designer?.cached_slug)?.toLowerCase();
  if (name && member) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: member,
      name,
      handle: member,
      bio: null,
      bioTranslated: null,
      links: [`${SITE_ORIGIN}/${member}`],
      avatarUrl: ownPicture(designer?.avatar),
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = name;
  }

  const categories = grabcadCategoryIds(model.categories);
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }

  return { meta, galleryImages: images, slug };
}

/** A model by its slug, from its API: its details and its gallery. Null for one the site hasn't got, or doesn't show.
 *  Public; no sign-in. */
export async function resolveGrabcadModel(slug: string): Promise<GrabcadModelResolution | null> {
  const path = `/models/${encodeURIComponent(slug)}`;
  const res = await api(`${path}?extended=true`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure("this model", res);
  // A gallery it can't read only leaves the pictures out; the cover still comes from the details.
  const gallery = await api(`${path}/gallery?all`).catch(() => null);
  return grabcadModelFrom(res.data, gallery?.status === 200 ? gallery.data : null);
}

// ---- Files ----

export type GrabcadFile = {
  name: string;
  /** What it says the file is for: its CAD system, "STEP / IGES", "STL", "Rendering" for a picture. */
  system: string | null;
  /** Its API link, which answers a signed-in user with where the file is. */
  downloadUrl: string;
};

type Folder = { files: GrabcadFile[]; folders: number[] };

/** One folder of a model's files, and the folders in it; null when it isn't one. Apart from the fetch, so it can be
 *  tested on its own. */
export function grabcadFolderFrom(data: unknown): Folder | null {
  const folder = asRecord(data);
  if (!folder || !Array.isArray(folder.files)) return null;
  return {
    files: recordsOf(folder.files).flatMap((file) => {
      const name = clean(asText(file.name));
      const downloadUrl = asText(file.download_url);
      return name && downloadUrl && isGrabcadDownloadLink(downloadUrl)
        ? [{ name, system: asText(file.system), downloadUrl }]
        : [];
    }),
    folders: recordsOf(folder.folders).flatMap((sub) => asCount(sub.id) ?? []),
  };
}

/** Its API's own download links: only those are asked for, with the user's sign-in. */
function isGrabcadDownloadLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.origin === new URL(API).origin && url.pathname.startsWith(`${new URL(API).pathname}/models/`);
  } catch {
    return false;
  }
}

/** A model's files, in every folder of it; null for a model the site hasn't got. Public; no sign-in. */
export async function fetchGrabcadFiles(slug: string): Promise<GrabcadFile[] | null> {
  const files: GrabcadFile[] = [];
  const queue: (number | null)[] = [null];
  const seen = new Set<number>();
  for (let read = 0; queue.length && read < MAX_FOLDERS; read++) {
    const folderId = queue.shift()!;
    const res = await api(
      `/models/${encodeURIComponent(slug)}/files${folderId === null ? "" : `?folder_id=${folderId}`}`,
    );
    if (res.status === 404 && folderId === null) return null;
    if (res.status !== 200) throw failure("this model's files", res);
    const folder = grabcadFolderFrom(res.data);
    if (!folder) throw failure("this model's files", res);
    files.push(...folder.files);
    for (const id of folder.folders) {
      if (!seen.has(id)) queue.push(id);
      seen.add(id);
    }
  }
  return files;
}

/** Where a file is, as its download link tells a signed-in user. Anyone else is answered 401. */
export async function resolveGrabcadFileUrl(file: GrabcadFile, session: GrabcadSession): Promise<string> {
  const res = await requestPaced(file.downloadUrl, { accept: JSON_ACCEPT, session });
  if (res.status === 401 || res.status === 403) throw new GrabcadAuthError();
  const url = asText(asRecord(parseJson(res.body))?.url);
  if (res.status !== 200 || !url) throw new Error(`GrabCAD didn't hand over the file (HTTP ${res.status})`);
  return url;
}

/** Its files are on the site's own host, at `/cads/files/…`. */
export function isGrabcadFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(SITE_ORIGIN).hostname;
}

// ---- Trending ----

/** Its most popular models of the 3D printing category with STL files, as its library's "Popular" sort has them.
 *  Public; no sign-in. */
export async function fetchGrabcadPopular(limit: number): Promise<TrendingModel[]> {
  const res = await api("/models", null, {
    sort: "popular",
    time: "all_time",
    page: 1,
    per_page: TRENDING_PAGE_SIZE,
    categories: ["3d-printing"],
    softwares: ["stl"],
  });
  if (res.status !== 200) throw failure("its popular models", res);
  return grabcadListingFrom(res.data)
    .slice(0, limit)
    .map((model) => ({
      id: model.slug,
      title: model.title,
      url: grabcadModelUrl(model.slug),
      image: model.cover,
      likes: model.likes,
      author: model.author,
      paid: false,
    }));
}

export type GrabcadModelSummary = {
  slug: string;
  title: string;
  cover: string | null;
  likes: number | null;
  author: string | null;
};

/** The models of one of its API's listings, in its order. */
export function grabcadListingFrom(data: unknown): GrabcadModelSummary[] {
  const seen = new Set<string>();
  return recordsOf(asRecord(data)?.models).flatMap((model) => {
    const slug = asText(model.cached_slug)?.toLowerCase();
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [
      {
        slug,
        title: clean(asText(model.name)) ?? slug,
        cover: ownPicture(model.preview_image),
        likes: asCount(model.likes_count),
        author: clean(asText(asRecord(model.author)?.name)),
      },
    ];
  });
}

// ---- Likes ----

export type GrabcadListing = { entries: GrabcadModelSummary[]; total: number; truncated: boolean };

export type GrabcadLikes = GrabcadListing & { member: string; owner: string };

type LikesPage = { entries: GrabcadModelSummary[]; pages: number; total: number | null; owner: string | null };

/** A page of a member's likes, as their profile renders it: its tiles, in its order, how many pages there are, how
 *  many likes the tab counts and whose they are. Apart from the fetch, so it can be tested on its own. */
export function grabcadLikesFromPage(html: string, member: string): LikesPage {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const entries = $(".profile-tile__wrapper")
    .toArray()
    .flatMap((el) => {
      const tile = $(el);
      const link = tile.find("a.profile-tile__link").first();
      const href = siteHref(link.attr("href"));
      const slug = href ? parseGrabcadModelUrl(href)?.slug : null;
      if (!slug || seen.has(slug)) return [];
      seen.add(slug);
      const background = tile.find(".profile-tile").first().attr("style") ?? "";
      const stat = clean(tile.find(".profile-tile__stat").first().text());
      return [
        {
          slug,
          title: clean(tile.find(".profile-tile__title").first().text()) ?? slug,
          cover: ownPicture(absoluteHttpUrl(background.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1] ?? null)),
          likes: asCount(stat?.replace(/[^\d]/g, "")),
          author: null,
        },
      ];
    });
  const pages = $(".pagination a[href]")
    .toArray()
    .flatMap((el) => {
      const href = siteHref($(el).attr("href"));
      return href && parseGrabcadLikesUrl(href)?.member === member
        ? [asCount(new URL(href).searchParams.get("page"))]
        : [];
    })
    .filter((page): page is number => page !== null);
  const badge = $(`.responsive-tabs__tab a[href$="/${member}/likes"] .responsive-tabs__tab--badge`).first().text();
  return {
    entries,
    pages: Math.min(Math.max(1, ...pages), MAX_LIKES_PAGES),
    total: asCount(clean(badge)),
    owner: clean($("h1.hero__title").first().text()),
  };
}

async function likesPage(member: string, page: number): Promise<LikesPage | null> {
  const res = await requestPaced(`${grabcadLikesUrl(member)}${page > 1 ? `?page=${page}` : ""}`, { accept: HTML });
  // Only the first page says there's no such member: one past the last is answered empty, so a later 404 is the
  // member gone mid-read, and no answer either way.
  if (res.status === 404 && page === 1) return null;
  if (res.status !== 200) throw failure("these likes", res);
  return grabcadLikesFromPage(res.body, member);
}

/** A member's likes, anyone's to read, by their slug: up to `maxItems` of them, in their page's order, with only the
 *  pages those take read. Null for no such member. */
export async function fetchGrabcadLikes(
  member: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<GrabcadLikes | null> {
  const first = await likesPage(member, 1);
  if (!first) return null;
  const wanted = Math.min(first.pages, Math.max(1, Math.ceil(maxItems / LIKES_PAGE_SIZE)));
  const rest = await mapWithConcurrency(
    Array.from({ length: wanted - 1 }, (_, i) => i + 2),
    PAGE_CONCURRENCY,
    async (n) => (await likesPage(member, n))?.entries ?? [],
  );
  const seen = new Set<string>();
  const found = [first.entries, ...rest]
    .flat()
    .filter((entry) => !seen.has(entry.slug) && Boolean(seen.add(entry.slug)));
  const total = Math.max(first.total ?? 0, found.length);
  return {
    entries: found.slice(0, maxItems),
    total,
    truncated: total > Math.min(found.length, maxItems),
    member,
    owner: first.owner ?? member,
  };
}

/** What a member's likes are named in Thingport: by their slug, as a sync of their link names them. */
export function grabcadLikesName(member: string): string {
  return likesCollectionName(member, PROVIDER);
}

/** A member's likes, as the sync dialog's Browse tab shows them; null for no such member. */
export async function grabcadLikesCard(member: string): Promise<ProviderCollectionCard | null> {
  const likes = await fetchGrabcadLikes(member, LIKES_PAGE_SIZE);
  return (
    likes && {
      id: grabcadLikesKey(member),
      name: grabcadLikesName(member),
      url: grabcadLikesUrl(member),
      modelCount: likes.total,
      thumbnails: likes.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: false,
      owner: likes.owner,
    }
  );
}

// ---- Sign-in ----

export type GrabcadMember = { member: string; name: string | null };

/** Who a sign-in belongs to: their member slug, which their page is at, and their name. Or "rejected"/"unreachable".
 *  Its API answers a visitor's `/members/me` with nothing at all. */
export async function checkGrabcadAuth(session: GrabcadSession): Promise<GrabcadMember | "rejected" | "unreachable"> {
  try {
    const res = await api("/members/me", session);
    if (res.status === 204 || res.status === 401 || res.status === 403) return "rejected";
    if (res.status !== 200) return "unreachable";
    const me = asRecord(asRecord(res.data)?.member);
    const member = asText(me?.cached_slug)?.toLowerCase();
    // Only a slug its likes page could be at: it's what the user's own lists are read by.
    if (!member || !parseGrabcadLikesUrl(grabcadLikesUrl(member))) return "unreachable";
    return { member, name: clean(asText(me?.name)) };
  } catch {
    return "unreachable";
  }
}
