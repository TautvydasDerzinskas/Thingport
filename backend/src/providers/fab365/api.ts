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
import { fab365License } from "./license";
import {
  FAB365_LIKES_KEY,
  FAB365_LIKES_URL,
  fab365ModelUrl,
  isFab365LikesUrl,
  parseFab365ModelUrl,
} from "./urls.generated";
export { FAB365_LIKES_KEY, FAB365_LIKES_URL, fab365ModelUrl, isFab365LikesUrl, parseFab365ModelUrl };

// Fab365 is a React site whose pages call a JSON API of its own under `/api`. A model (an "item"), its gallery and its
// listings answer anyone; its files go only to a signed-in member who owns it -- a free one included, with no order to
// place, unlike the paid and ticket ones. The sign-in is a short-lived JWT (`accessToken`) with a refresh token beside
// it, which the site keeps in page storage, not a cookie. Every answer is wrapped in a `returnCode` of its own, so
// that's checked, not the HTTP status. No bot check stands in the way: Node's own fetch gets everything.
const SITE_ORIGIN = manifest.site;
const API = manifest.endpoints.api;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const JSON_ACCEPT = "application/json, text/plain, */*";
// The envelope's "all is well"; the download call's "you don't own this".
const OK = "C00000";
const NOT_OWNED_CODE = "E00108";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
// What a listing hands its pages at once.
const PAGE_SIZE = 24;

export class Fab365AuthError extends Error {
  constructor() {
    super(
      "Fab365 didn't accept your sign-in; it may have expired. Visit fab365.net signed in with Thingport Grab, or " +
        "connect it again in Configuration > Providers.",
    );
    this.name = "Fab365AuthError";
  }
}

export class Fab365RateLimitError extends Error {
  constructor() {
    super("Fab365 rate-limited Thingport. Wait a while, then try again.");
    this.name = "Fab365RateLimitError";
  }
}

/** A model the user neither owns nor can take for free: a paid one they haven't bought, or a ticket one they haven't
 *  redeemed. Fab365 answers its download with `cannot_downloadable`. */
export class Fab365UnownedError extends Error {
  constructor(public readonly ticket: boolean) {
    super(
      ticket
        ? "This is a Fab365 ticket model you haven't redeemed: Thingport imports the ones you own. Redeem a Fab365 " +
            "ticket for it on fab365.net first."
        : "This is a paid Fab365 model you haven't bought: Thingport imports the ones you own. Buy it on fab365.net first.",
    );
    this.name = "Fab365UnownedError";
  }
}

/** A sign-in as Thingport keeps it: the access token, and the refresh token that renews it (null for a pasted access
 *  token with none beside it). */
export type Fab365Secret = { accessToken: string; refreshToken: string | null };

/** The access token to call Fab365 with, and whose account it is. */
export type Fab365Auth = { token: string; accountId: string };

export type Fab365Member = { userId: string; name: string | null };

type Answer = { status: number; data: unknown };

type RequestInit = {
  accept: string;
  method?: "GET" | "POST";
  token?: string;
  /** A JSON body, posted. */
  json?: unknown;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(url: string, init: RequestInit): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (init.token) assertCredentialDestination("fab365-token", url);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: init.accept,
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        Referer: `${SITE_ORIGIN}/`,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(init.json !== undefined ? { "Content-Type": "application/json", Origin: SITE_ORIGIN } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      // Fab365 answers with its own status codes (a 501 for a token that's still valid), so the body is read either way.
      redirect: "manual",
      signal: controller.signal,
    });
    noteImportActivity();
    return { status: res.status, data: parseJson(await res.text()) };
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
  if (res.status === 429) throw new Fab365RateLimitError();
  return res;
}

/** One of its API's answers, as the user where `token` is given. */
function api(path: string, init: Omit<RequestInit, "accept"> = {}): Promise<Answer> {
  return requestPaced(`${API}${path}`, { accept: JSON_ACCEPT, ...init });
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on Fab365 (HTTP ${res.status})`);
}

/** The payload of a `returnCode` envelope, where it says all is well; null otherwise. The detail call keeps it in
 *  `item`, the rest in `data`. */
function envelope(res: Answer, key: "data" | "item"): unknown {
  const record = asRecord(res.data);
  return asText(record?.returnCode) === OK ? record?.[key] : null;
}

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** A price as it gives them, `"5.99"`, in dollars; 0 for free or unpriced. */
function priceOf(value: unknown): number {
  const price = asCount(value);
  return price !== null && price > 0 ? price : 0;
}

// ---- Sign-in ----

/** The claims of an access token Thingport reads: whose it is (its `loginId`) and when it runs out. Null for anything
 *  else. */
export function decodeFab365Token(token: string): { userId: string; expiresAt: Date | null } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const userId = claims && asText(claims.loginId);
    if (!userId) return null;
    const exp = asCount(claims!.exp);
    return { userId, expiresAt: exp ? new Date(exp * 1000) : null };
  } catch {
    return null;
  }
}

export type Fab365Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

/** The access token still valid, as Fab365 says when asked to refresh one it hasn't let run out yet: `valid_Token`, as a
 *  whole word, so "invalid_token" is a refusal. Its code says nothing: `E00002` also comes with "Login is required". */
function stillValid(data: Record<string, unknown> | null): boolean {
  return /\bvalid_token\b/i.test(asText(data?.message) ?? "");
}

/** Fab365's own renewal, as the site's pages make it on a 401: the old access token as the Bearer, the refresh token in
 *  the body. It hands back a new pair, which the caller must keep; the refresh token renews only once the access token
 *  has (nearly) run out, and answers `valid_Token` while it's comfortably valid. Throws Fab365AuthError when the refresh
 *  token is turned down.
 *
 *  Tested live 2026-11-09: the refresh token is *reusable* (renewing with the same one twice both succeeded), so the
 *  backend and the browser coexist -- a backend renewal doesn't sign the web session out. Its refusals don't follow the
 *  HTTP status: a forged or malformed refresh token gets a 200 with `C00008`, an expired or missing one a 501 with
 *  `E00002` and "Login is required". So any answer of Fab365's own that is neither a new pair nor `valid_Token` is a
 *  refusal, whatever its status; one that isn't its JSON envelope, and a network error, throw as themselves, so an
 *  outage isn't one. */
export async function refreshFab365Session(secret: Fab365Secret): Promise<Fab365Tokens> {
  if (!secret.refreshToken) throw new Fab365AuthError();
  const res = await api("/v3_1/refresh", {
    method: "POST",
    token: secret.accessToken,
    json: { refresh_token: secret.refreshToken, from: "W" },
  });
  const data = asRecord(res.data);
  const inner = asRecord(envelope(res, "data"));
  const accessToken = asText(inner?.access_token);
  if (accessToken) {
    return {
      accessToken,
      refreshToken: asText(inner?.refresh_token) ?? secret.refreshToken,
      expiresAt: decodeFab365Token(accessToken)?.expiresAt ?? null,
    };
  }
  if (stillValid(data)) {
    return {
      accessToken: secret.accessToken,
      refreshToken: secret.refreshToken,
      expiresAt: decodeFab365Token(secret.accessToken)?.expiresAt ?? null,
    };
  }
  // Only Fab365's own answer says anything about the token: one that isn't its JSON envelope -- an outage, a proxy's
  // error page -- is no refusal, or it would sign the user out.
  if (!asText(data?.returnCode)) throw failure("a renewed sign-in", res);
  throw new Fab365AuthError();
}

/** Who a sign-in belongs to: their user id and the handle their account carries. Or "rejected"/"unreachable". */
export async function checkFab365Auth(token: string): Promise<Fab365Member | "rejected" | "unreachable"> {
  try {
    const res = await api("/my/profile", { token });
    if (res.status === 401 || res.status === 403) return "rejected";
    const data = asRecord(envelope(res, "data"));
    if (!data) return "unreachable";
    const user = asRecord(data.user);
    const userId = asText(user?.id_user) ?? asText(data.id);
    if (!userId) return "unreachable";
    return { userId, name: clean(asText(user?.userid)) ?? clean(asText(user?.name)) };
  } catch {
    return "unreachable";
  }
}

// ---- Models ----

export type Fab365ModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  itemId: string;
  /** Its name, for a print the model doesn't title itself. */
  name: string;
  /** Free to download without owning it. */
  free: boolean;
  /** The user already owns it -- bought, or redeemed with a ticket. */
  owned: boolean;
  /** A ticket model, which a ticket redeems rather than money buys. */
  ticket: boolean;
};

/** The designer behind a model, as its studio's page gives them; null when it can't be read. */
export type Fab365Designer = { id: string; name: string; logo: string | null };

function isOwned(item: Record<string, unknown>): boolean {
  return (
    item.isOwn === true || item.own === true || asText(item.buy_status) === "y" || asText(item.download_status) === "y"
  );
}

/** A model as Thingport keeps it, from its detail, its gallery and its designer. Apart from the fetches, so it can be
 *  tested on its own. */
export function fab365ModelFrom(
  item: Record<string, unknown>,
  galleryImages: { url: string; filename: string }[],
  designer: Fab365Designer | null,
): Fab365ModelResolution {
  const itemId = asText(item.id) ?? "";
  const meta: Partial<ImportedPageMetadata> = {};

  const title = clean(asText(item.name));
  if (title) meta.title = title;

  // Its description is HTML on newer models (an embedded video, paragraphs) and plain text with line breaks on older
  // ones.
  const desc = asText(item.desc);
  const description = desc ? (/<[a-z!/]/i.test(desc) ? htmlToMarkdown(desc) : desc.trim()) : null;
  if (description) meta.description = description;

  const cover = galleryImages[0]?.url ?? webImage(item.listImg);
  if (cover) meta.previewImageUrl = cover;

  const idCategory = asCount(item.id_category);
  if (idCategory !== null && idCategory > 0) {
    meta.siteCategoryIds = [idCategory];
    meta.categorySite = PROVIDER;
  }

  if (designer) {
    const author: ImportedAuthorInfo = {
      provider: PROVIDER,
      externalId: designer.id,
      name: designer.name,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [`${SITE_ORIGIN}/designers/${encodeURIComponent(designer.name)}`],
      avatarUrl: designer.logo,
      backgroundUrl: null,
    };
    meta.author = author;
    meta.creator = designer.name;
  }

  meta.license = fab365License();

  return {
    meta,
    galleryImages,
    itemId,
    name: title ?? `Fab365 ${itemId}`,
    free: asText(item.free) === "y",
    owned: isOwned(item),
    ticket: asText(item.price_option) === "reward" && !(asText(item.free) === "y"),
  };
}

/** A file name from an image's address: its last path segment, which Fab365 makes unique with a hash. */
function imageName(url: string): string {
  const last = new URL(url).pathname.split("/").pop() ?? "";
  return decodeURIComponent(last) || "picture.jpg";
}

/** A model's gallery pictures, in its order, each by its own address; the video entries left out. Newer models tag
 *  each entry `img` or `video`, older ones tag none, so only an explicit video is skipped. */
export function fab365GalleryFrom(data: unknown): { url: string; filename: string }[] {
  const item = asRecord(asRecord(data)?.item);
  const seen = new Set<string>();
  return recordsOf(item?.imgs).flatMap((img) => {
    if (asText(img.type) === "video") return [];
    const url = webImage(img.img);
    if (!url || !URL.canParse(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ url, filename: imageName(url) }];
  });
}

async function fetchGallery(itemId: string): Promise<{ url: string; filename: string }[]> {
  const res = await api(`/item/data/${encodeURIComponent(itemId)}`);
  return res.status === 200 ? fab365GalleryFrom(res.data) : [];
}

/** The studio behind a model, by its id; null when the site doesn't name it. */
export async function fetchFab365Designer(studioId: string): Promise<Fab365Designer | null> {
  const res = await api(`/v2/designer/${encodeURIComponent(studioId)}/info`);
  const data = asRecord(envelope(res, "data"));
  const name = clean(asText(data?.name));
  return name ? { id: studioId, name, logo: webImage(data?.logo) } : null;
}

/** A model by its number: its detail, its gallery and its designer, read as the user where `token` is given -- which
 *  only its ownership flags need. Null for one the site hasn't got or doesn't show. */
export async function resolveFab365Model(itemId: string, token?: string): Promise<Fab365ModelResolution | null> {
  const res = await api(`/v2/item/detail/${encodeURIComponent(itemId)}`, token ? { token } : {});
  if (res.status === 404) return null;
  if (token && (res.status === 401 || res.status === 403)) throw new Fab365AuthError();
  if (res.status !== 200) throw failure("this model", res);
  const item = asRecord(envelope(res, "item"));
  // A missing or hidden model answers with a non-OK code rather than a 404.
  if (!item || !asText(item.id)) return null;
  const studioId = asText(item.studio_id);
  const [gallery, designer] = await Promise.all([
    fetchGallery(itemId).catch(() => []),
    studioId ? fetchFab365Designer(studioId).catch(() => null) : Promise.resolve(null),
  ]);
  return fab365ModelFrom(item, gallery, designer);
}

// ---- The files ----

/** Where a model the user owns is, as its download link tells them: a signed link to a zip of all its files on the
 *  site's S3 bucket. One they don't own answers `cannot_downloadable`, a visitor a 401. */
export async function resolveFab365Download(itemId: string, auth: Fab365Auth, ticket: boolean): Promise<string> {
  const res = await api(`/my/downloads/${encodeURIComponent(itemId)}`, { token: auth.token });
  if (res.status === 401 || res.status === 403) throw new Fab365AuthError();
  const data = asRecord(res.data);
  const code = asText(data?.returnCode);
  if (code === OK) {
    const url = asText(asRecord(data?.data)?.url);
    if (url && URL.canParse(url)) return url;
  }
  if (code === NOT_OWNED_CODE) throw new Fab365UnownedError(ticket);
  throw failure("this model's files", res);
}

/** Its files are on an S3 bucket (`fab-model-v2`), whose region the signed link names, so either host form passes. */
export function isFab365FileHost(hostname: string): boolean {
  return /^fab-model(?:-v2)?\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/i.test(hostname);
}

// ---- Listings ----

export type Fab365ModelSummary = { itemId: string; title: string; cover: string | null };
export type Fab365Listing = { entries: Fab365ModelSummary[]; total: number; truncated: boolean };

/** The models of the user's favourites, from `/my/likes`; an empty list answers with one row of nothing. */
export function fab365LikesFrom(data: unknown): Fab365ModelSummary[] {
  const seen = new Set<string>();
  return recordsOf(asRecord(data)?.data).flatMap((row) => {
    const item = asRecord(row.item);
    const itemId = asText(item?.id_item) ?? asText(row.product_id);
    if (!item || !itemId || !/^\d+$/.test(itemId) || seen.has(itemId)) return [];
    seen.add(itemId);
    const title = clean(asText(item.name_en)) ?? clean(asText(item.name_ko)) ?? `Fab365 ${itemId}`;
    return [{ itemId, title, cover: webImage(item.list_img) ?? webImage(item.listImg) }];
  });
}

/** The user's favourites, Fab365's only list and their own to see. */
export async function fetchFab365Likes(auth: Fab365Auth): Promise<Fab365Listing> {
  const res = await api("/my/likes", { token: auth.token });
  if (res.status === 401 || res.status === 403) throw new Fab365AuthError();
  if (res.status !== 200 || asText(asRecord(res.data)?.returnCode) !== OK) throw failure("your favourites", res);
  const entries = fab365LikesFrom(res.data);
  return { entries, total: entries.length, truncated: false };
}

/** What the user's favourites are named in Thingport. */
export const FAB365_LIKES_NAME = `${providerName(PROVIDER)} favourites`;

/** The user's favourites, as the sync dialog's Browse tab shows them. */
export async function fab365LikesCard(auth: Fab365Auth): Promise<ProviderCollectionCard> {
  const likes = await fetchFab365Likes(auth);
  return {
    id: FAB365_LIKES_KEY,
    name: FAB365_LIKES_NAME,
    url: FAB365_LIKES_URL,
    modelCount: likes.total,
    thumbnails: likes.entries.slice(0, 4).flatMap((entry) => entry.cover ?? []),
    private: true,
    owner: null,
  };
}

/** Its models ranked by likes, as the offer listing's `popular` sort gives them. Public; no sign-in. */
export async function fetchFab365Popular(limit: number): Promise<TrendingModel[]> {
  const query = new URLSearchParams({
    sort: "popular",
    idCategory: "",
    offset: "0",
    size: String(Math.min(Math.max(limit, 1), PAGE_SIZE)),
    type: "Fab365",
  });
  const res = await api(`/v2/item/offer?${query}`, { method: "POST" });
  const data = asRecord(envelope(res, "data"));
  if (!data) throw failure("its popular models", res);
  return recordsOf(data.results)
    .flatMap((model) => {
      const id = asText(model.product_id);
      return id && /^\d+$/.test(id) ? [{ model, id }] : [];
    })
    .slice(0, limit)
    .map(({ model, id }) => ({
      id,
      title: clean(asText(model.product_name)) ?? `Fab365 ${id}`,
      url: fab365ModelUrl(id),
      image: webImage(model.product_listImg),
      likes: asCount(model.product_like_count),
      author: clean(asText(model.studio_name)),
      paid: priceOf(model.finalPrice) > 0,
    }));
}
