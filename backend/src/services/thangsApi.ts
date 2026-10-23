import { IMPORT_DOWNLOAD_RETRY_DELAY_MS, IMPORT_TIMEOUT_SECONDS } from "../config";
import { browserFetch } from "../utils/browserFetch";
import { sleep } from "../utils/concurrency";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "./importResolvers";
import type { ProviderCollectionCard } from "./providerCollectionCard";
import { extractJsonFromBrowserBody, fetchViaFlaresolverr, isCloudflareChallenge } from "./flaresolverr";
import { getFlaresolverrUrl } from "./settingsService";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "./trendingModel";

// Thangs has no public API, so this is the one its own pages call. Details, the likes of any user and public
// collections need no sign-in; downloads, private collections and purchases need the user's access token, a 7-day JWT
// sent as a Bearer token, which the refresh token renews. Free accounts have a daily download cap. Like Thingiverse,
// it's behind a Cloudflare that checks the TLS handshake, hence browserFetch.
const SITE_ORIGIN = "https://thangs.com";
const API_BASE = `${SITE_ORIGIN}/api`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = "thangs";
const CHALLENGE_RETRIES = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Thangs' ids come as numbers or numeric strings, depending on the endpoint. */
function id(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export class ThangsAuthError extends Error {
  constructor() {
    super(
      "Thangs didn't accept your sign-in; it may have expired. Visit thangs.com signed in with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "ThangsAuthError";
  }
}

export class ThangsBlockedError extends Error {
  constructor(flaresolverr?: "missing" | "failed") {
    super(
      "Thangs blocked this request (rate limit or Cloudflare challenge). This usually clears after a while -- wait, " +
        "then try again." +
        (flaresolverr === "missing"
          ? " Setting up FlareSolverr in Administration > Connections gets past it."
          : flaresolverr === "failed"
            ? " FlareSolverr couldn't get past it either: check it in Administration > Connections."
            : ""),
    );
    this.name = "ThangsBlockedError";
  }
}

/** Free Thangs accounts download a limited number of models a day. */
export class ThangsDownloadLimitError extends Error {
  constructor() {
    super("Thangs' daily download limit for your account was reached. It resets tomorrow -- import it again then.");
    this.name = "ThangsDownloadLimitError";
  }
}

/** Someone's private collection, which only its owner's sign-in reads. */
export class ThangsPrivateCollectionError extends Error {
  constructor() {
    super("That Thangs collection is private: only its owner can import it, with their Thangs account connected.");
    this.name = "ThangsPrivateCollectionError";
  }
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return /^(www\.)?thangs\.com$/i.test(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

// `/designer/<user>/3d-model/<name>-<id>`, also under `/prints` (print-only models) and with a subpage after it
// (`/3d-print/<sku>`, `/image/<id>`, ...); the name may be left out. `/m/<id>` is the site's own short link.
const MODEL_PATH = /^\/(?:prints\/)?designer\/[^/]+\/3d-model\/(?:[^/]*-)?(\d+)(?:\/.*)?$/i;
const SHORT_MODEL_PATH = /^\/m\/(\d+)\/?$/i;
const COLLECTION_PATH = /^(\/designer\/[^/]+\/collection\/(?:[^/]*-)?(\d+))(?:\/.*)?$/i;
const OWN_COLLECTION_PATH = /^(\/(?:mythangs\/collections|c)\/(\d+))\/?$/i;

export const THANGS_LIKES_KEY = "likes";
export const THANGS_LIKES_URL = `${SITE_ORIGIN}/mythangs/liked-models`;
export const THANGS_LIKES_NAME = "Thangs likes";

export function parseThangsModelUrl(url: string): { modelId: string } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH) ?? parsed?.pathname.match(SHORT_MODEL_PATH);
  return m ? { modelId: m[1] } : null;
}

/** Thangs redirects its short link to the model's page, whatever its name and designer. */
export function thangsModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/m/${modelId}`;
}

/** A collection: `/designer/<user>/collection/<name>-<id>`, or the owner's own `/mythangs/collections/<id>`. `url` is
 *  the same page without a sort, scope or query. */
export function parseThangsCollectionUrl(url: string): { collectionId: string; url: string } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(COLLECTION_PATH) ?? parsed?.pathname.match(OWN_COLLECTION_PATH);
  return m ? { collectionId: m[2], url: `${SITE_ORIGIN}${m[1]}` } : null;
}

/** The page the site itself links a collection at: its owner's, named after it. */
export function thangsCollectionUrl(collectionId: string, owner: string | null, name: string | null): string {
  if (!owner) return `${SITE_ORIGIN}/mythangs/collections/${collectionId}`;
  const slug = name ? `${encodeURIComponent(name)}-` : "";
  return `${SITE_ORIGIN}/designer/${encodeURIComponent(owner)}/collection/${slug}${collectionId}`;
}

/** The user's own liked models; the page names no user, as it's always the signed-in one's. */
export function isThangsLikesUrl(url: string): boolean {
  return /^\/mythangs\/liked-models\/?$/i.test(parseUrl(url)?.pathname ?? "");
}

type ApiResult = { status: number; data: unknown };

async function fetchApi(
  path: string,
  { token = null, method = "GET", body }: { token?: string | null; method?: "GET" | "POST"; body?: unknown } = {},
): Promise<ApiResult> {
  const url = `${API_BASE}${path}`;
  const send = () =>
    browserFetch(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeoutMs: API_TIMEOUT_MS,
    });
  let res = await send();
  // Cloudflare challenges single calls of a quick run now and then, and lets the same one through a moment later.
  for (let retry = 1; retry <= CHALLENGE_RETRIES && isCloudflareChallenge(res.headers); retry++) {
    await res.body?.cancel().catch(() => undefined);
    await sleep(IMPORT_DOWNLOAD_RETRY_DELAY_MS * retry);
    res = await send();
  }
  let viaBrowser = false;
  // FlareSolverr can't send a token, so only what reads without one goes through it. Only a challenge: Thangs' own
  // refusals ("Forbidden" for a hidden model) come through Cloudflare too.
  if (!token && method === "GET" && (res.status === 429 || isCloudflareChallenge(res.headers))) {
    const solved = await fetchViaFlaresolverr(url);
    if (solved) {
      viaBrowser = true;
      res = new Response(solved.body, { status: solved.status });
    }
  }
  if (!viaBrowser && (res.status === 429 || isCloudflareChallenge(res.headers))) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThangsBlockedError(token ? undefined : (await getFlaresolverrUrl()) ? "failed" : "missing");
  }
  if (res.status === 401 && token) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThangsAuthError();
  }
  const text = await res.text();
  let data: unknown = null;
  if (text.trim()) {
    try {
      data = viaBrowser ? extractJsonFromBrowserBody(text) : JSON.parse(text);
    } catch {
      // Refusals come as plain text ("Forbidden"); the status says it all.
    }
  }
  return { status: res.status, data };
}

function failure(what: string, status: number, data: unknown): Error {
  const message = isRecord(data) ? str(data.message) : null;
  return new Error(`Couldn't read ${what} on Thangs${message ? `: ${message}` : ` (HTTP ${status})`}`);
}

export type ThangsJwt = { userId: string; username: string | null; expiresAt: Date | null; refresh: boolean };

/** What a Thangs token says about itself: whose it is, until when, and whether it's a refresh token. Read without
 *  checking its signature, which only Thangs can; null for anything that isn't one. */
export function decodeThangsJwt(token: string): ThangsJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  const issuer = str(payload.iss) ?? "";
  const userId = id(payload.sub);
  if (!userId || !/(^|\.)thangs\.com/i.test(issuer)) return null;
  const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  return { userId, username: str(payload.username), expiresAt: exp, refresh: /refresh-tokens/i.test(issuer) };
}

/** A new access token from a refresh token, which Thangs keeps as it is. Throws ThangsAuthError when it's turned
 *  down. */
export async function refreshThangsToken(refreshToken: string): Promise<{ token: string; expiresAt: Date | null }> {
  const res = await browserFetch(`${API_BASE}/auth/v2/refresh-tokens`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Cookie: `refreshToken=${refreshToken}` },
    timeoutMs: API_TIMEOUT_MS,
  });
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => undefined);
    if (isCloudflareChallenge(res.headers)) throw new ThangsBlockedError();
    throw new ThangsAuthError();
  }
  if (res.status === 429 || isCloudflareChallenge(res.headers)) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThangsBlockedError();
  }
  const data: unknown = await res.json().catch(() => null);
  const token = isRecord(data) && isRecord(data.token) ? str(data.token.TOKEN) : null;
  if (!res.ok || !token) throw failure("a new sign-in", res.status, data);
  return { token, expiresAt: decodeThangsJwt(token)?.expiresAt ?? null };
}

/** Who the token belongs to, or "rejected"/"unreachable". */
export async function checkThangsAuth(
  token: string,
): Promise<{ userId: string; username: string | null } | "rejected" | "unreachable"> {
  try {
    const { status, data } = await fetchApi("/users/current?likes=false", { token });
    if (status !== 200 || !isRecord(data) || !id(data.id)) return "unreachable";
    return { userId: id(data.id)!, username: str(data.username) };
  } catch (err) {
    return err instanceof ThangsAuthError ? "rejected" : "unreachable";
  }
}

/** Who may download a model: anyone signed in ("free"), its buyers or a designer membership's members ("paid"),
 *  a membership's members only ("membership"), or no one, as it's sold printed ("printOnly"). */
export type ThangsAccess = "free" | "paid" | "membership" | "printOnly";

function accessOf(model: Record<string, unknown>): ThangsAccess {
  const visibility = str(model.visibility)?.toLowerCase();
  if (visibility === "print-only") return "printOnly";
  if (visibility === "paid") return "membership";
  if (visibility === "market-paid" || isRecord(model.marketplaceInfo) || model.isPaid === true) return "paid";
  return "free";
}

export type ThangsModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  access: ThangsAccess;
  /** In US dollars, when it's for sale. */
  price: number | null;
};

function authorOf(owner: unknown): ImportedAuthorInfo | null {
  if (!isRecord(owner)) return null;
  const userId = id(owner.id);
  const username = str(owner.username);
  if (!userId || !username) return null;
  const profile = isRecord(owner.profile) ? owner.profile : {};
  return {
    provider: PROVIDER,
    externalId: userId,
    // The site shows designers by their username.
    name: username,
    handle: username,
    bio: str(profile.description),
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/designer/${encodeURIComponent(username)}`],
    avatarUrl: str(profile.avatarUrl) ?? str(owner.avatarUrl),
    backgroundUrl: null,
  };
}

function imageName(url: string, index: number): string {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {}
  return name || `image-${index}.jpg`;
}

/** The pictures the designer put up; the parts' renders only when there are none. */
function imagesOf(model: Record<string, unknown>): string[] {
  const photos = records(model.attachments).flatMap((a) =>
    (a.attachmentType ?? "image") === "image" && a.isApproved !== false && a.isNsfwFlagged !== true
      ? (str(a.imageUrl) ?? [])
      : [],
  );
  const renders = records(model.parts).flatMap((part) => str(part.thumbnailUrl) ?? []);
  return [...new Set(photos.length ? photos : renders)];
}

/** Its category paths, most specific first: its own, its other ones, then their parents, so a subcategory beats its
 *  parent and the model's own beats the rest. */
export function thangsCategoryPaths(model: Record<string, unknown>): string[] {
  const paths = [
    str(model.category),
    ...(Array.isArray(model.v3Categories) ? model.v3Categories.map(str) : []),
    str(model.secondaryCategory),
  ].filter((path): path is string => !!path);
  const parents = paths.flatMap((path) => (path.includes("/") ? [path.slice(0, path.indexOf("/"))] : []));
  return [...new Set([...paths, ...parents])];
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function thangsMetaFromModel(model: Record<string, unknown>): ThangsModelResolution | null {
  const modelId = id(model.id) ?? id(model.modelId);
  if (!modelId) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(model.name);
  if (title) meta.title = title;
  // Already Markdown, as the site writes and shows it.
  const description = str(model.description);
  if (description) meta.description = description;
  const tags = [...new Set((Array.isArray(model.tags) ? model.tags : []).flatMap((t) => str(t) ?? []))];
  if (tags.length) meta.tags = tags;
  const images = imagesOf(model);
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(model.owner);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  const categories = thangsCategoryPaths(model);
  if (categories.length) {
    meta.siteCategoryIds = categories;
    meta.categorySite = PROVIDER;
  }
  const marketplace = isRecord(model.marketplaceInfo) ? model.marketplaceInfo : null;
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    modelId,
    access: accessOf(model),
    price: marketplace && typeof marketplace.priceInUSD === "number" ? marketplace.priceInUSD : null,
  };
}

/** By its id. Null for a model that doesn't exist or isn't public: Thangs answers both with a 403. */
export async function resolveThangsModel(modelId: string): Promise<ThangsModelResolution | null> {
  const { status, data } = await fetchApi(`/models/v2/${encodeURIComponent(modelId)}?likes=false`);
  if (status === 403 || status === 404) return null;
  if (status !== 200 || !isRecord(data)) throw failure("this model", status, data);
  return thangsMetaFromModel(data);
}

export type ThangsFile = { name: string; url: string };

/** The extension a signed link's file has, when its name lacks one: Thangs names the file after the model. */
function withExtension(name: string, url: string): string {
  let ext = "";
  try {
    ext = decodeURIComponent(new URL(url).pathname).match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
  } catch {}
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name;
}

/** The model's files as the signed-in user may have them: one model file, or a zip of all of them. Null when Thangs
 *  doesn't let them (a paid model they haven't bought, a print-only one). Each call counts towards their daily
 *  downloads; past those it throws ThangsDownloadLimitError. */
export async function fetchThangsDownload(modelId: string, token: string): Promise<ThangsFile | null> {
  const { status, data } = await fetchApi(`/v2/models/${encodeURIComponent(modelId)}/download-url`, { token });
  if (status === 403 || status === 404) return null;
  if (isRecord(data) && isRecord(data.userDownloadData) && data.userDownloadData.downloadLimitReached === true) {
    throw new ThangsDownloadLimitError();
  }
  const url = isRecord(data) ? str(data.signedUrl) : null;
  if (status !== 200 || !url || (isRecord(data) && data.fileName === "Error")) {
    throw failure("this model's files", status, data);
  }
  const name =
    (isRecord(data) ? str(data.fileName) : null)?.replace(/[\\/:*?"<>|]+/g, " ").trim() || `thangs-${modelId}`;
  return { name: withExtension(name, url), url };
}

/** Thangs' signed file links, and its prebuilt zips, are on Google Cloud Storage. */
export function isThangsFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === "storage.googleapis.com";
}

/** The paid models the user bought, alone or in a bundle, which download like free ones. */
export async function fetchThangsPurchases(token: string): Promise<Set<string>> {
  const { status, data } = await fetchApi("/users/current/purchases?pageSize=1000", { token });
  if (status !== 200 || !isRecord(data)) throw failure("your purchases", status, data);
  const ids = [
    ...(Array.isArray(data.models) ? data.models : []),
    ...(Array.isArray(data.bundleModels) ? data.bundleModels : []),
  ].flatMap((value) => id(isRecord(value) ? value.id : value) ?? []);
  return new Set(ids);
}

export type ThangsModelSummary = { modelId: string; title: string; cover: string | null };
export type ThangsListing = { entries: ThangsModelSummary[]; total: number; truncated: boolean };

const PAGE_SIZE = 50;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** What a listing shows of a model. Print-only ones never download, and paid ones only once bought (`owned`), so
 *  they're left out: a sync would otherwise fail them on every round. */
function summaryOf(model: Record<string, unknown>, owned: Set<string>): ThangsModelSummary | null {
  const modelId = id(model.id) ?? id(model.modelId);
  if (!modelId) return null;
  const access = accessOf(model);
  if (access === "printOnly" || (access !== "free" && !owned.has(modelId))) return null;
  const cover = imagesOf(model)[0] ?? (Array.isArray(model.thumbnails) ? str(model.thumbnails[0]) : null);
  return { modelId, title: str(model.name) ?? `Model ${modelId}`, cover: cover ?? str(model.image) };
}

function listingOf(models: Record<string, unknown>[], owned: Set<string>, maxItems: number): ThangsListing {
  const seen = new Set<string>();
  const entries: ThangsModelSummary[] = [];
  for (const model of models) {
    const entry = summaryOf(model, owned);
    if (!entry || seen.has(entry.modelId)) continue;
    seen.add(entry.modelId);
    entries.push(entry);
  }
  return { entries: entries.slice(0, maxItems), total: entries.length, truncated: entries.length > maxItems };
}

/** A user's liked models, which Thangs shows anyone, all in one answer. */
export async function fetchThangsLikes(
  userId: string,
  owned: Set<string>,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<ThangsListing> {
  const { status, data } = await fetchApi(`/users/v4/${encodeURIComponent(userId)}/likes`);
  if (status !== 200 || !isRecord(data)) throw failure("your likes", status, data);
  return listingOf(records(data.models), owned, maxItems);
}

export type ThangsCollectionInfo = {
  id: string;
  name: string;
  owner: string | null;
  private: boolean;
  modelCount: number;
};

/** A collection's models, as the site orders them. Private ones need their owner's `token`; someone else's throws
 *  ThangsPrivateCollectionError. Null for one that doesn't exist. */
export async function fetchThangsCollection(
  collectionId: string,
  token: string | null,
  owned: Set<string>,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<(ThangsListing & { info: ThangsCollectionInfo }) | null> {
  const models: Record<string, unknown>[] = [];
  let info: ThangsCollectionInfo | null = null;
  for (let page = 0; models.length < maxItems; page++) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: "date",
      costType: "collection",
      showContent: "all",
      ...(token ? { isLoggedIn: "true" } : {}),
    });
    const { status, data } = await fetchApi(`/collections/${encodeURIComponent(collectionId)}?${query}`, { token });
    if (status === 404) return null;
    if (status === 403) throw new ThangsPrivateCollectionError();
    if (status !== 200 || !isRecord(data)) throw failure("this collection", status, data);
    const owner = isRecord(data.owner) ? str(data.owner.username) : null;
    info ??= {
      id: collectionId,
      name: str(data.name) ?? "Thangs collection",
      owner,
      private: data.private === true,
      modelCount: count(data.totalCount),
    };
    const items = records(data.items);
    models.push(...items);
    // A total only stops it when the answer gives one; a short page always does.
    if (items.length < PAGE_SIZE || (info.modelCount > 0 && models.length >= info.modelCount)) break;
  }
  if (!info) return null;
  return { ...listingOf(models, owned, maxItems), info };
}

/** The user's likes, then their own collections, as the sync dialog's Browse tab shows them. */
export async function listThangsCollections(
  userId: string,
  token: string,
  owned: Set<string>,
): Promise<ProviderCollectionCard[]> {
  const likes = await fetchThangsLikes(userId, owned);
  const cards: ProviderCollectionCard[] = [
    {
      id: THANGS_LIKES_KEY,
      name: THANGS_LIKES_NAME,
      url: THANGS_LIKES_URL,
      modelCount: likes.total,
      thumbnails: likes.entries.slice(0, CARD_THUMBNAILS).flatMap((entry) => entry.cover ?? []),
      private: true,
      owner: null,
    },
  ];
  for (let page = 0; ; page++) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: "date",
      costType: "collection",
      showContent: "all",
      isLoggedIn: "true",
    });
    const { status, data } = await fetchApi(`/collections?${query}`, { token });
    if (status !== 200 || !isRecord(data)) throw failure("your collections", status, data);
    const items = records(data.items);
    for (const item of items) {
      const collectionId = id(item.id);
      if (!collectionId) continue;
      const owner = isRecord(item.owner) ? str(item.owner.username) : null;
      const name = str(item.name) ?? "Thangs collection";
      cards.push({
        id: collectionId,
        name,
        url: thangsCollectionUrl(collectionId, owner, name),
        modelCount: Array.isArray(item.modelIds) ? item.modelIds.length : 0,
        // The list has one picture per collection, its newest model's.
        thumbnails: str(item.image) ? [str(item.image)!] : [],
        private: item.private === true,
        owner,
      });
    }
    if (items.length < PAGE_SIZE) break;
  }
  return cards;
}

/** Thangs' trending models today, as its "Trending" page lists them. Public; no sign-in. Some are for sale. */
export async function fetchThangsTrending(limit: number): Promise<TrendingModel[]> {
  const { status, data } = await fetchApi(
    `/landing/models/v8/root?page=0&pageSize=${limit}&category=&tags=&sortBy=trending&range=today&sortDir=desc&costType=all`,
  );
  if (status !== 200) throw new Error(`Thangs returned HTTP ${status}`);
  return recordsOf(asRecord(data)?.items).flatMap((item) => {
    const modelId = asText(item.id);
    if (!modelId) return [];
    return [
      {
        id: modelId,
        title: asText(item.name) ?? modelId,
        url: thangsModelUrl(modelId),
        image: webImage(item.image),
        likes: asCount(item.likesCount),
        author: asText(asRecord(item.owner)?.username),
        paid: item.isPaid === true,
      },
    ];
  });
}
