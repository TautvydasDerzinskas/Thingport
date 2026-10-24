import { IMPORT_TIMEOUT_SECONDS } from "../config";
import { browserFetch } from "../utils/browserFetch";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "./importResolvers";
import { htmlToMarkdown } from "./descriptionMarkdown";
import type { ProviderCollectionCard } from "./providerCollectionCard";
import {
  extractJsonFromBrowserBody,
  fetchViaFlaresolverr,
  isCloudflareChallenge,
  looksLikeCloudflareBlock,
} from "./flaresolverr";
import { getFlaresolverrUrl } from "./settingsService";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "./trendingModel";
import {
  myminifactoryCollectionKey,
  myminifactoryCollectionUrl,
  parseMyminifactoryCollectionUrl,
  parseMyminifactoryObjectUrl,
  urls,
} from "../providers/_generated/myminifactory/urls";
export {
  myminifactoryCollectionKey,
  myminifactoryCollectionUrl,
  parseMyminifactoryCollectionUrl,
  parseMyminifactoryObjectUrl,
};

// The official API takes an API key as `?key=`. Its file download links are for OAuth users only,
// so files come from the site's own /download/{id} instead, which free objects allow anonymously.
// Like Thingiverse, it's behind a Cloudflare that checks the TLS handshake, hence browserFetch.
const MYMINIFACTORY_ORIGIN = "https://www.myminifactory.com";
const API_BASE = `${MYMINIFACTORY_ORIGIN}/api/v2`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = "myminifactory";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class MyminifactoryAuthError extends Error {
  constructor() {
    super(
      "The MyMiniFactory API key configured for this instance was rejected. Ask an admin to update it in " +
        "Administration > Providers (a key can be created in your MyMiniFactory account settings).",
    );
    this.name = "MyminifactoryAuthError";
  }
}

export class MyminifactoryRateLimitError extends Error {
  constructor(flaresolverr?: "missing" | "failed") {
    super(
      "MyMiniFactory blocked this request (rate limit or Cloudflare challenge). This usually clears after a " +
        "while -- wait, then try again." +
        (flaresolverr === "missing"
          ? " Setting up FlareSolverr in Administration > Connections gets past it."
          : flaresolverr === "failed"
            ? " FlareSolverr couldn't get past it either: check it in Administration > Connections."
            : ""),
    );
    this.name = "MyminifactoryRateLimitError";
  }
}

export function myminifactoryObjectUrl(objectId: string): string {
  return `${MYMINIFACTORY_ORIGIN}/object/3d-print-${objectId}`;
}

async function fetchApi(path: string, apiKey: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
  let res = await browserFetch(url, { headers: { Accept: "application/json" }, timeoutMs: API_TIMEOUT_MS });
  let viaBrowser = false;
  if ((res.status === 429 || res.status === 403) && looksLikeCloudflareBlock(res.headers)) {
    const solved = await fetchViaFlaresolverr(url);
    if (solved) {
      viaBrowser = true;
      res = new Response(solved.body, { status: solved.status });
    }
  }
  const text = await res.text();
  let data: unknown = null;
  if (text.trim()) {
    try {
      data = viaBrowser ? extractJsonFromBrowserBody(text) : JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!viaBrowser && (res.status === 429 || isCloudflareChallenge(res.headers))) {
    throw new MyminifactoryRateLimitError((await getFlaresolverrUrl()) ? "failed" : "missing");
  }
  if (res.status === 429) throw new MyminifactoryRateLimitError();
  if (res.status === 401) throw new MyminifactoryAuthError();
  return { ok: res.ok, status: res.status, data };
}

/** Tells a rejected key from Cloudflare's block and an unreachable API. */
export async function checkMyminifactoryApiKey(apiKey: string): Promise<"ok" | "rejected" | "blocked" | "unreachable"> {
  try {
    const { ok, data } = await fetchApi("/search?q=benchy&per_page=1", apiKey);
    return ok && isRecord(data) ? "ok" : "unreachable";
  } catch (err) {
    if (err instanceof MyminifactoryAuthError) return "rejected";
    if (err instanceof MyminifactoryRateLimitError) return "blocked";
    return "unreachable";
  }
}

type ApiImage = { url: string; primary: boolean };

function objectImages(object: Record<string, unknown>): ApiImage[] {
  if (!Array.isArray(object.images)) return [];
  return object.images.flatMap((image) => {
    if (!isRecord(image)) return [];
    const pick = (key: string) => (isRecord(image[key]) ? str((image[key] as Record<string, unknown>).url) : null);
    const url = pick("original") ?? pick("standard") ?? pick("thumbnail");
    return url ? [{ url, primary: image.is_primary === true }] : [];
  });
}

/** The image a listing shows for an object: its primary one's thumbnail. */
function objectThumbnail(object: Record<string, unknown>): string | null {
  if (!Array.isArray(object.images)) return null;
  const images = object.images.filter(isRecord);
  const image = images.find((i) => i.is_primary === true) ?? images[0];
  if (!image) return null;
  for (const key of ["thumbnail", "standard", "original"]) {
    const url = isRecord(image[key]) ? str((image[key] as Record<string, unknown>).url) : null;
    if (url) return url;
  }
  return null;
}

/** Every category the object sits in, with their parents, so a category configured for a parent matches. */
function objectCategoryIds(object: Record<string, unknown>): number[] {
  // A `{ total_count, items }` page, though the spec says a plain list.
  const categories = isRecord(object.categories) ? object.categories.items : object.categories;
  if (!Array.isArray(categories)) return [];
  const ids: number[] = [];
  const add = (value: unknown) => {
    const id =
      typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (Number.isInteger(id) && !ids.includes(id)) ids.push(id);
  };
  for (const category of categories) {
    if (!isRecord(category)) continue;
    add(category.id);
    if (isRecord(category.parent)) add(category.parent.id);
  }
  return ids;
}

function designerAuthor(designer: Record<string, unknown>): ImportedAuthorInfo | null {
  // Keyed by the numeric id, which stays put when the designer renames their account.
  const username = str(designer.username);
  const id = designer.id != null ? String(designer.id) : null;
  if (!username || !id) return null;
  const profileUrl = str(designer.profile_url) ?? `${MYMINIFACTORY_ORIGIN}/users/${encodeURIComponent(username)}`;
  return {
    provider: PROVIDER,
    externalId: id,
    name: str(designer.name) ?? username,
    handle: username,
    bio: str(designer.bio),
    bioTranslated: null,
    links: [profileUrl, ...(str(designer.website) ? [str(designer.website)!] : [])],
    avatarUrl: str(designer.avatar_url),
    backgroundUrl: str(designer.cover_url),
  };
}

/** The object's description, with the designer's printing details (when given) appended. */
function objectDescription(object: Record<string, unknown>): string | null {
  const description = str(object.description_html)
    ? htmlToMarkdown(object.description_html as string)
    : str(object.description);
  const details = str(object.printing_details_html)
    ? htmlToMarkdown(object.printing_details_html as string)
    : str(object.printing_details);
  if (!details) return description;
  return [description, `## Printing details\n\n${details}`].filter(Boolean).join("\n\n");
}

export type MyminifactoryObjectResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** On sale in the store: downloading it needs a login and a purchase, so it can't be imported. */
  paid: boolean;
  /** Its files are archives the designer uploaded, which only download with a login, free or not. */
  archives: boolean;
};

/** Store objects carry a price; free ones have none. */
function isPaid(object: Record<string, unknown>): boolean {
  return isRecord(object.price) && Number(object.price.value) > 0;
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function myminifactoryMetaFromObject(object: Record<string, unknown>): MyminifactoryObjectResolution {
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(object.name);
  if (title) meta.title = title;
  const description = objectDescription(object);
  if (description) meta.description = description;
  if (Array.isArray(object.tags)) {
    const tags = object.tags.flatMap((tag) => {
      const name = typeof tag === "string" ? tag.trim() : isRecord(tag) ? str(tag.name) : null;
      return name ? [name] : [];
    });
    if (tags.length) meta.tags = tags;
  }
  const images = objectImages(object);
  const cover = images.find((image) => image.primary) ?? images[0];
  if (cover) meta.previewImageUrl = cover.url;
  if (isRecord(object.designer)) {
    const author = designerAuthor(object.designer);
    if (author) {
      meta.author = author;
      meta.creator = author.name;
    }
  }
  const categoryIds = objectCategoryIds(object);
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  const galleryImages = images.map((image, index) => ({
    url: image.url,
    filename: image.url.split("/").pop()?.split("?")[0] || `image-${index}.jpg`,
  }));
  return { meta, galleryImages, paid: isPaid(object), archives: object.file_mode === 1 };
}

/** Null for an object that doesn't exist or isn't public; throws MyminifactoryAuthError for a rejected key. */
export async function resolveMyminifactoryObject(
  objectId: string,
  apiKey: string,
): Promise<MyminifactoryObjectResolution | null> {
  const { ok, data } = await fetchApi(`/objects/${encodeURIComponent(objectId)}`, apiKey);
  if (!ok || !isRecord(data)) return null;
  return myminifactoryMetaFromObject(data);
}

export type MyminifactoryDownload = { kind: "file"; url: string } | { kind: "login" } | { kind: "missing" };

/** Where /download/{id} sends an anonymous visitor: a signed link to the file (or a zip of all of
 *  them), or the login page for a paid or members-only object. */
export async function resolveMyminifactoryDownload(objectId: string): Promise<MyminifactoryDownload> {
  const res = await browserFetch(`${MYMINIFACTORY_ORIGIN}/download/${encodeURIComponent(objectId)}`, {
    redirect: "manual",
    timeoutMs: API_TIMEOUT_MS,
  });
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 429 || isCloudflareChallenge(res.headers)) throw new MyminifactoryRateLimitError();
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location) {
    const target = new URL(location, MYMINIFACTORY_ORIGIN);
    if (isMyminifactoryFileHost(target.hostname)) return { kind: "file", url: target.toString() };
    // The login page, or, for a free model whose files need a login, its own page.
    if (/\/(login|object)\b/i.test(target.pathname)) return { kind: "login" };
  }
  return { kind: "missing" };
}

export class MyminifactorySessionExpiredError extends Error {
  constructor() {
    super(
      "MyMiniFactory didn't accept your saved sign-in; it may have expired. Visit myminifactory.com with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "MyminifactorySessionExpiredError";
  }
}

/** A request the site's own pages make with the user's session. A redirect to the login page means it's no longer
 *  accepted. */
async function sessionFetch(path: string, cookie: string): Promise<Response> {
  const res = await browserFetch(`${MYMINIFACTORY_ORIGIN}${path}`, {
    headers: { Cookie: cookie, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    redirect: "manual",
    timeoutMs: API_TIMEOUT_MS,
  });
  if (res.status === 429 || isCloudflareChallenge(res.headers)) {
    await res.body?.cancel().catch(() => undefined);
    throw new MyminifactoryRateLimitError();
  }
  const location = res.headers.get("location");
  if (location && /\/login\b/i.test(new URL(location, MYMINIFACTORY_ORIGIN).pathname)) {
    await res.body?.cancel().catch(() => undefined);
    throw new MyminifactorySessionExpiredError();
  }
  return res;
}

/** Whether MyMiniFactory accepts a session: its library answers only to a signed-in user. */
export async function checkMyminifactorySession(cookie: string): Promise<"ok" | "rejected" | "unreachable"> {
  try {
    const res = await sessionFetch("/api/data-library/collections", cookie);
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? "ok" : "unreachable";
  } catch (err) {
    return err instanceof MyminifactorySessionExpiredError ? "rejected" : "unreachable";
  }
}

/** A file in the user's library, and where its download starts. */
export type MyminifactoryLibraryFile = { name: string; path: string };

/** What's in an archive's MyMiniFactory unpacked, or the archive itself when it wasn't. */
type LibraryArchive = { id: string | null; name: string; files: { id: string; path: string }[] };

function libraryArchive(value: unknown): LibraryArchive | null {
  if (!isRecord(value) || !str(value.name)) return null;
  const files = Array.isArray(value.extractedFiles)
    ? value.extractedFiles.flatMap((file) =>
        isRecord(file) && file.id != null && str(file.path) ? [{ id: String(file.id), path: str(file.path)! }] : [],
      )
    : [];
  return { id: value.id != null ? String(value.id) : null, name: str(value.name)!, files };
}

/** The model files of an object the user can download (bought, or free with a login), as their library lists them:
 *  its single files, else the files MyMiniFactory unpacked from its archives, else the archives themselves. `null`
 *  when the library won't give them (not bought). Throws MyminifactorySessionExpiredError for a session it no longer
 *  takes. `isModelFile` decides what's worth downloading. */
export async function listMyminifactoryLibraryFiles(
  objectId: string,
  cookie: string,
  isModelFile: (name: string) => boolean,
): Promise<MyminifactoryLibraryFile[] | null> {
  const res = await sessionFetch(
    `/api/data-library/myObjects/object-${encodeURIComponent(objectId)}/downloadables`,
    cookie,
  );
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.ok) throw new Error(`Couldn't read this model from your MyMiniFactory library (HTTP ${res.status})`);
  const data: unknown = await res.json().catch(() => null);
  if (!isRecord(data)) throw new Error("Couldn't read this model from your MyMiniFactory library");
  const id = encodeURIComponent(objectId);
  const parts = Array.isArray(data.parts)
    ? data.parts.flatMap((part) => {
        const name = isRecord(part) ? str(part.name) : null;
        return name && isModelFile(name)
          ? [{ name, path: `/download/${id}?downloadfile=${encodeURIComponent(name)}` }]
          : [];
      })
    : [];
  if (parts.length) return parts;
  const archives = Array.isArray(data.archives) ? data.archives.flatMap((a) => libraryArchive(a) ?? []) : [];
  const unpacked = archives.flatMap((archive) =>
    archive.files.flatMap((file) => {
      const name = file.path.split("/").pop()!;
      return isModelFile(name)
        ? [{ name, path: `/api/data-library/archive-file-contents/${encodeURIComponent(file.id)}/download` }]
        : [];
    }),
  );
  if (unpacked.length) return unpacked;
  // Not unpacked by MyMiniFactory: the archive itself, for the caller to open if it can.
  return archives.flatMap((archive) =>
    archive.id ? [{ name: archive.name, path: `/download/${id}?archive_id=${encodeURIComponent(archive.id)}` }] : [],
  );
}

/** The signed link a library download redirects to. */
export async function resolveMyminifactoryLibraryDownload(path: string, cookie: string): Promise<string | null> {
  const res = await sessionFetch(path, cookie);
  await res.body?.cancel().catch(() => undefined);
  const location = res.headers.get("location");
  if (!location) return null;
  const target = new URL(location, MYMINIFACTORY_ORIGIN);
  return isMyminifactoryFileHost(target.hostname) ? target.toString() : null;
}

/** The signed file hosts /download redirects to (dl4.myminifactory.com and its siblings). */
export function isMyminifactoryFileHost(hostname: string): boolean {
  return /^dl\d*\.myminifactory\.com$/i.test(hostname);
}

export type MyminifactoryObjectSummary = { objectId: string; title: string; cover: string | null };

/** Paid objects are left out of listings: they can't be imported, and a sync would fail on them every round. */

const PAGE_SIZE = 30;
const LISTING_MAX_ENTRIES = 600;

function objectSummary(item: unknown): MyminifactoryObjectSummary | null {
  if (!isRecord(item) || item.id == null || isPaid(item)) return null;
  const objectId = String(item.id);
  return { objectId, title: str(item.name) ?? `Object ${objectId}`, cover: objectThumbnail(item) };
}

/** Null when there's no such collection. Throws on any other failure, so an outage is never taken
 *  for a deleted collection. */
async function fetchCollectionPage(
  username: string,
  slug: string,
  apiKey: string,
  page: number,
  perPage: number,
): Promise<Record<string, unknown> | null> {
  const { ok, status, data } = await fetchApi(
    `/users/${encodeURIComponent(username)}/collections/${encodeURIComponent(slug)}?page=${page}&per_page=${perPage}`,
    apiKey,
  );
  if (status === 404) return null;
  if (!ok || !isRecord(data)) throw new Error(`Couldn't read the MyMiniFactory collection (HTTP ${status})`);
  return data;
}

function collectionObjects(collection: Record<string, unknown>): { items: unknown[]; total: number | null } {
  const objects = isRecord(collection.objects) ? collection.objects : null;
  const items = Array.isArray(objects?.items) ? objects.items : [];
  const total = typeof objects?.total_count === "number" ? objects.total_count : null;
  return { items, total };
}

export async function fetchMyminifactoryCollectionObjects(
  username: string,
  slug: string,
  apiKey: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<{ title: string | null; entries: MyminifactoryObjectSummary[]; truncated: boolean; paid: number } | null> {
  const entries: MyminifactoryObjectSummary[] = [];
  const seen = new Set<string>();
  let title: string | null = null;
  let paid = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const collection = await fetchCollectionPage(username, slug, apiKey, page, PAGE_SIZE);
    if (!collection) return page === 1 ? null : { title, entries, truncated: false, paid };
    title ??= str(collection.name);
    const { items, total } = collectionObjects(collection);
    for (const item of items) {
      if (isRecord(item) && isPaid(item)) paid++;
      const summary = objectSummary(item);
      if (!summary || seen.has(summary.objectId)) continue;
      seen.add(summary.objectId);
      entries.push(summary);
      if (entries.length >= maxItems) break;
    }
    if (items.length < PAGE_SIZE || (total !== null && page * PAGE_SIZE >= total)) break;
  }
  return { title, entries, truncated: entries.length >= maxItems, paid };
}

/** For a sync: null when MyMiniFactory answers 404 for the collection. */
export async function checkMyminifactoryCollection(
  username: string,
  slug: string,
  apiKey: string,
): Promise<{ title: string | null } | null> {
  const collection = await fetchCollectionPage(username, slug, apiKey, 1, 1);
  return collection ? { title: str(collection.name) } : null;
}

const CARD_THUMBNAILS = 4;

/** From a collection as either the listing or the collection itself gives it: both carry `obj_img`, a few of its
 *  models' images, and `total_objects`. */
function collectionCard(collection: Record<string, unknown>, fallbackOwner: string): ProviderCollectionCard | null {
  const slug = str(collection.slug);
  if (!slug) return null;
  const owner = (isRecord(collection.owner) && str(collection.owner.username)) || fallbackOwner;
  const { items, total } = collectionObjects(collection);
  const images = Array.isArray(collection.obj_img)
    ? collection.obj_img.flatMap((url) => (str(url) ? [str(url)!] : []))
    : [];
  const thumbnails = items.flatMap((item) => {
    const url = isRecord(item) ? objectThumbnail(item) : null;
    return url ? [url] : [];
  });
  const count = typeof collection.total_objects === "number" ? collection.total_objects : total;
  return {
    id: myminifactoryCollectionKey(owner, slug),
    name: str(collection.name) ?? slug,
    url: myminifactoryCollectionUrl(owner, slug),
    modelCount: count ?? items.length,
    thumbnails: [...new Set([...images, ...thumbnails])].slice(0, CARD_THUMBNAILS),
    private: collection.public === false || collection.is_public === false,
    owner,
  };
}

export async function fetchMyminifactoryCollectionCard(
  username: string,
  slug: string,
  apiKey: string,
): Promise<ProviderCollectionCard | null> {
  const collection = await fetchCollectionPage(username, slug, apiKey, 1, CARD_THUMBNAILS);
  return collection ? collectionCard(collection, username) : null;
}

const COLLECTION_LIST_MAX_PAGES = 10;

/** The user's public collections. */
export async function listMyminifactoryUserCollections(
  username: string,
  apiKey: string,
): Promise<ProviderCollectionCard[]> {
  const cards: ProviderCollectionCard[] = [];
  for (let page = 1; page <= COLLECTION_LIST_MAX_PAGES; page++) {
    const { ok, status, data } = await fetchApi(
      `/users/${encodeURIComponent(username)}/collections?page=${page}&per_page=${PAGE_SIZE}`,
      apiKey,
    );
    if (!ok || !isRecord(data)) throw new Error(`Couldn't load the MyMiniFactory collections (HTTP ${status})`);
    const items = Array.isArray(data.items) ? data.items.filter(isRecord) : [];
    for (const item of items) {
      const card = collectionCard(item, username);
      if (card) cards.push(card);
    }
    if (items.length < PAGE_SIZE) break;
  }
  return cards;
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return urls.isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

/** Null for malformed percent-encoding (`%zz`), which decodeURIComponent throws on. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** A profile link or a username. Null when MyMiniFactory knows no such user. */
export async function resolveMyminifactoryUser(input: string, apiKey: string): Promise<{ username: string } | null> {
  let value = input.trim();
  const parsed = parseUrl(value);
  if (parsed) value = parsed.pathname.match(/^\/(?:[a-z]{2}\/)?users\/([^/]+)/i)?.[1] ?? "";
  else if (/^https?:\/\//i.test(value)) return null;
  // Usernames can have spaces ("Scan The World").
  value = (safeDecode(value) ?? "").replace(/^@/, "").trim();
  if (!value || !/^[\w. -]+$/.test(value)) return null;
  const { ok, status, data } = await fetchApi(`/users/${encodeURIComponent(value)}`, apiKey);
  if (status === 404) return null;
  if (!ok || !isRecord(data)) throw new Error(`Couldn't read the MyMiniFactory user (HTTP ${status})`);
  return { username: str(data.username) ?? value };
}

/** MyMiniFactory's most popular objects. Needs the instance's API key, as every MyMiniFactory API call does. */
export async function fetchMyminifactoryPopular(limit: number, apiKey: string): Promise<TrendingModel[]> {
  const { ok, status, data } = await fetchApi(`/search?q=&sort=popularity&per_page=${limit}`, apiKey);
  if (!ok) throw new Error(`MyMiniFactory returned HTTP ${status}`);
  return recordsOf(asRecord(data)?.items).flatMap((item) => {
    const id = asText(item.id);
    if (!id) return [];
    const images = recordsOf(item.images);
    const cover = images.find((image) => image.is_primary === true) ?? images[0];
    return [
      {
        id,
        title: asText(item.name) ?? id,
        url: asText(item.url) ?? myminifactoryObjectUrl(id),
        image: webImage(asRecord(cover?.thumbnail)?.url),
        likes: asCount(item.likes),
        author: asText(asRecord(item.designer)?.username) ?? asText(asRecord(item.designer)?.name),
        paid: Boolean(asCount(item.price)),
      },
    ];
  });
}
