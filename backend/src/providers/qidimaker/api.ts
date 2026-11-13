import { randomBytes, randomUUID } from "node:crypto";
import { credentialRequest } from "../credentialRequest";
import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import {
  QIDIMAKER_LIKES_KEY,
  QIDIMAKER_LIKES_URL,
  isQidimakerLikesUrl,
  parseQidimakerCollectionUrl,
  parseQidimakerModelUrl,
  qidimakerCollectionUrl,
  qidimakerModelUrl,
  qidimakerUserUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
import { qidimakerLicenseFrom } from "./license";
export {
  QIDIMAKER_LIKES_KEY,
  QIDIMAKER_LIKES_URL,
  isQidimakerLikesUrl,
  parseQidimakerCollectionUrl,
  parseQidimakerModelUrl,
  qidimakerCollectionUrl,
  qidimakerModelUrl,
};

// QIDI Maker has no public API, so this is the one its own pages call, on the site's own host: every call is a JSON
// POST answered with `{code, message, data, timestamp}`, code 200 when it went well. Nothing is signed, but every
// call must carry a set of headers its pages send: a timestamp within about a minute of its own clock, a nonce it
// hasn't seen before, and a few that say what's calling. A browser's User-Agent gets it past Cloudflare.
//
// Models, their print profiles, listings and public collections need no sign-in. The user's own collections and likes
// need the `token` cookie, with the pair the site's CSRF check compares: an XSRF-TOKEN cookie and the same value in a
// header, which the site doesn't issue itself, so any matching pair does. Files are on a public CDN: the site's own
// Download first asks a signed-in call to count it, and Thingport doesn't, to keep a sync's downloads out of the
// user's download history there.
const SITE_ORIGIN = manifest.site;
const API_BASE = `${SITE_ORIGIN}/community/v1`;
const FILES_HOST = new URL(manifest.endpoints.files).hostname;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
// What the site's pages send: the browser's name and version, and a device id that's the same for every visitor.
const DEVICE_TYPE = `chrome ${IMPORT_BROWSER_USER_AGENT.match(/Chrome\/([\d.]+)/)?.[1] ?? "121.0.0.0"}`;
const DEVICE_ID = "a3f8c2e91b4d7f6e5c0a8b2d4e6f1a9";

const CODE_OK = 200;
// A sign-in it doesn't take, has stopped taking, or a call that needed one without it.
const AUTH_CODES = new Set([2001, 2002, 2003, 2099]);
// A timestamp too far from its clock.
const CODE_STALE = 2012;
// What it answers for a model id it doesn't have, as for any failure of its own.
const CODE_BUSY = -1;
// A model it shows nobody, or not this user.
const NO_PERMISSION = new Set([40095, 40040]);
// A collection it doesn't have, or that's private to someone else.
const CODE_NO_FAVORITE = 40102;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 1500;

// A model taken down, which its page shows nobody; a profile taken down, or whose model was.
const MODEL_OFF_SHELF = 4;
const PROFILE_OFF_SHELF = 4;
const PROFILE_MODEL_GONE = -1;
// Its lists of a kind of its own (`favoriteType`): browse history 0, likes 1, download history 2, the default
// collection 3, and the ones the user made 4.
const LIKES_TYPE = 1;
const OWN_LIST_TYPES = new Set([3, 4]);
// A list's visibility: 1 is private.
const PRIVATE = 1;

/** The offset from this machine's clock to QIDI Maker's, learnt the first time it turns a timestamp down. */
let clockOffsetMs = 0;

export class QidimakerAuthError extends Error {
  constructor() {
    super(
      "QIDI Maker didn't accept your sign-in; it may have expired. Visit www.qidimaker.com signed in with Thingport " +
        "Grab, or connect it again in Configuration > Providers.",
    );
    this.name = "QidimakerAuthError";
  }
}

type Answer = { status: number; code: number | null; message: string | null; data: unknown; timestamp: number | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Its ids are numbers of up to 20 digits, which JSON gives as text, or as a number only where it fits one. */
export function qidimakerId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : str(value);
  return text && /^\d{1,20}$/.test(text) ? text : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => str(item) ?? []) : [];
}

async function post(path: string, body: unknown, token: string | null): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const xsrf = token ? randomBytes(24).toString("base64url") : null;
  try {
    const res = await credentialRequest("qidimaker-api", `${API_BASE}/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Origin: SITE_ORIGIN,
        Referer: `${SITE_ORIGIN}/en/`,
        // In English, with its times in UTC.
        "Accept-Language": "en_US",
        language: "en",
        "X-Timezone": "+00:00",
        "X-DeviceType": DEVICE_TYPE,
        "X-DeviceId": DEVICE_ID,
        "X-Version": "1.0.0",
        "X-Platform": "Web",
        "X-Region": "NA",
        "X-Timestamp": String(Date.now() + clockOffsetMs),
        "X-Nonce": randomUUID(),
        ...(token && xsrf ? { Cookie: `token=${token}; XSRF-TOKEN=${xsrf}`, "X-XSRF-TOKEN": xsrf } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    const record = isRecord(json) ? json : null;
    return {
      status: res.status,
      code: typeof record?.code === "number" ? record.code : null,
      message: str(record?.message),
      data: record?.data,
      timestamp: typeof record?.timestamp === "number" ? record.timestamp : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One call's answer. A burst past its limit is waited out a few times, then a 429; a timestamp it turns down is sent
 *  again by its own clock, which every answer gives. */
async function fetchApi(path: string, body: unknown, token: string | null): Promise<Answer> {
  let res = await post(path, body, token);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await post(path, body, token);
  }
  if (res.status === 429) throw new HttpError(429, "QIDI Maker rate-limited this request. Wait a bit and try again.");
  if (res.code === CODE_STALE && res.timestamp !== null) {
    clockOffsetMs = res.timestamp - Date.now();
    res = await post(path, body, token);
  }
  if (token && res.code !== null && AUTH_CODES.has(res.code)) throw new QidimakerAuthError();
  return res;
}

function failure(what: string, res: Answer): Error {
  return new Error(`Couldn't read ${what} on QIDI Maker${res.message ? `: ${res.message}` : ` (code ${res.code})`}`);
}

/** Who the sign-in belongs to, or "rejected"/"unreachable". */
export async function checkQidimakerAuth(
  token: string,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const res = await fetchApi("user/info", {}, token);
    // Only a refusal says the sign-in is bad; any other error code is QIDI Maker's own trouble.
    if (res.code !== CODE_OK) return "unreachable";
    const user = isRecord(res.data) ? res.data : null;
    const userId = qidimakerId(user?.id);
    if (!userId) return "rejected";
    return { userId, name: str(user?.nickname) ?? str(user?.uuidName) };
  } catch (err) {
    return err instanceof QidimakerAuthError ? "rejected" : "unreachable";
  }
}

/** Whether QIDI Maker answers at all: it answers a model it doesn't have as it answers its own failures, so this tells
 *  the two apart, by a call that never fails for any other reason. */
async function answers(): Promise<boolean> {
  try {
    return (await fetchApi("sliceClassify/getList", {}, null)).code === CODE_OK;
  } catch {
    return false;
  }
}

export type QidimakerFile = { name: string; url: string };

/** One of a model's print profiles, a QIDI Studio project, by the site's id; `designer` where the model's designer
 *  made it rather than someone else. */
export type QidimakerProfile = QidimakerFile & {
  id: string;
  title: string;
  coverUrl: string | null;
  designer: boolean;
  creator: string | null;
};

export type QidimakerModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  /** The zip of the model's own files, which only a model without print profiles needs. */
  filesZip: QidimakerFile | null;
  /** Its print profiles, in the site's order. */
  profiles: QidimakerProfile[];
};

/** QIDI Maker's files are on its own CDN. */
export function isQidimakerFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === FILES_HOST;
}

function fileLink(value: unknown): string | null {
  const url = webImage(value);
  if (!url) return null;
  try {
    return isQidimakerFileHost(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

/** The name at the end of a link's path. */
function nameFromUrl(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

function authorOf(user: unknown): ImportedAuthorInfo | null {
  if (!isRecord(user)) return null;
  const userId = qidimakerId(user.userId);
  const handle = str(user.uuidName);
  const name = str(user.nickname) ?? handle;
  if (!userId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: userId,
    name,
    handle,
    bio: null,
    bioTranslated: null,
    links: [qidimakerUserUrl(userId)],
    avatarUrl: webImage(user.avatar),
    backgroundUrl: null,
  };
}

/** The model's print profiles, from its list of them: grouped by who made them, the model's designer or anyone else.
 *  A profile taken down, or private, is left out, as its page leaves it. */
export function qidimakerProfilesFrom(
  groups: unknown,
  designerId: string | null,
  fileName: string,
): QidimakerProfile[] {
  return recordsOf(groups).flatMap((group) => {
    const makerId = qidimakerId(group.userId);
    const creator = str(group.nickname) ?? str(group.uuidName);
    return recordsOf(group.sliceModelConfigurationVOS).flatMap((config) => {
      const id = qidimakerId(config.id);
      const url = fileLink(config.modelConfigurationUrl);
      if (!id || !url) return [];
      if (config.status === PROFILE_OFF_SHELF || config.modelStatus === PROFILE_MODEL_GONE) return [];
      if (config.visibility === PRIVATE) return [];
      const title = str(config.translatedModelConfigurationName) ?? str(config.modelConfigurationName) ?? id;
      const pictures = recordsOf(config.modelConfigurationPictures).flatMap((p) => webImage(p.modelPictureUrl) ?? []);
      const plates = strings(config.plateDetails).flatMap((plate) => webImage(plate) ?? []);
      return [
        {
          id,
          title,
          name: fileName,
          url,
          coverUrl: pictures[0] ?? plates[0] ?? null,
          designer: !!makerId && makerId === designerId,
          creator,
        },
      ];
    });
  });
}

/** The metadata mapping, apart from the fetches so it can be tested on its own: the model's details and its list of
 *  print profiles. Null for a model its page shows nobody. */
export function qidimakerMetaFromDetail(
  detail: Record<string, unknown>,
  groups: unknown = [],
): QidimakerModelResolution | null {
  const modelId = qidimakerId(detail.id);
  if (!modelId || detail.status === MODEL_OFF_SHELF) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  // Its pages show a model in the reader's language where it was translated, so it's read as they show it in English.
  const title = str(detail.translatedModelName) ?? str(detail.modelName);
  if (title) meta.title = title;
  const description = str(detail.translatedModelDescription) ?? str(detail.modelDescription);
  if (description) meta.description = description;
  const translated = strings(detail.translatedTags);
  const tags = [...new Set(translated.length ? translated : strings(detail.tags))];
  if (tags.length) meta.tags = tags;
  const cover = webImage(detail.modelPictureWeb);
  const images = [
    ...new Set([cover, ...recordsOf(detail.sliceModelPictureUrlVO).map((p) => webImage(p.modelPictureUrl))]),
  ].filter((url): url is string => !!url);
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(detail.sliceModelUserVO);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // Its subcategory, then the category it's in.
  const parent = asRecord(detail.sliceClassifyListVO);
  const categoryIds = [...new Set([qidimakerId(detail.classifyId), qidimakerId(parent?.id)])].filter(
    (id): id is string => !!id,
  );
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  meta.license = qidimakerLicenseFrom(detail);
  const designerId = qidimakerId(detail.userId) ?? author?.externalId ?? null;
  // A profile's file has no name of its own (its link names it by when it was uploaded): it's the model's.
  const fileName = `${title ?? modelId}.3mf`;
  const filesZipUrl = fileLink(detail.modelUrl);
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: nameFromUrl(url, `image-${index}.jpg`) })),
    modelId,
    filesZip: filesZipUrl ? { name: `${title ?? modelId}.zip`, url: filesZipUrl } : null,
    profiles: qidimakerProfilesFrom(groups, designerId, fileName),
  };
}

export type QidimakerProfileScope = "url" | "designer" | "all";

/** The profiles a scope picks: the one the link names, else the designer's first, for one; the designer's, or all. */
export function selectQidimakerProfiles(
  resolution: Pick<QidimakerModelResolution, "profiles">,
  scope: QidimakerProfileScope,
  requestedProfileId: string | null,
): string[] {
  const { profiles } = resolution;
  const designers = profiles.filter((profile) => profile.designer);
  if (scope === "all") return profiles.map((profile) => profile.id);
  if (scope === "designer") return (designers.length ? designers : profiles.slice(0, 1)).map((profile) => profile.id);
  const requested = requestedProfileId && profiles.find((profile) => profile.id === requestedProfileId);
  const pick = requested || designers[0] || profiles[0];
  return pick ? [pick.id] : [];
}

/** The model's details as the site answers them, by its id. Null for a model it doesn't have or shows nobody; throws
 *  when it doesn't answer. */
export async function fetchQidimakerDetail(modelId: string): Promise<Record<string, unknown> | null> {
  const res = await fetchApi("sliceModel/getModelDetail", { id: modelId }, null);
  if (res.code !== null && NO_PERMISSION.has(res.code)) return null;
  if (res.code === CODE_BUSY && (await answers())) return null;
  if (res.code !== CODE_OK) throw failure("this model", res);
  return isRecord(res.data) ? res.data : null;
}

/** The model's print profiles as the site lists them, grouped by who made them. */
export async function fetchQidimakerProfileGroups(modelId: string): Promise<Record<string, unknown>[]> {
  const res = await fetchApi("sliceModelConfiguration/getListByModelId", { id: modelId }, null);
  if (res.code !== CODE_OK) throw failure("this model's print profiles", res);
  return recordsOf(res.data);
}

/** By its id. Null for a model it doesn't have or shows nobody. */
export async function resolveQidimakerModel(modelId: string): Promise<QidimakerModelResolution | null> {
  const detail = await fetchQidimakerDetail(modelId);
  if (!detail) return null;
  return qidimakerMetaFromDetail(detail, await fetchQidimakerProfileGroups(modelId));
}

// ---- Lists ----------------------------------------------------------------------------------------------------------

export const QIDIMAKER_LIKES_NAME = "QIDI Maker likes";

export type QidimakerModelSummary = { modelId: string; title: string; cover: string | null };
export type QidimakerListing = { entries: QidimakerModelSummary[]; total: number; truncated: boolean };
export type QidimakerCollectionInfo = { name: string; modelCount: number; private: boolean };

const PAGE_SIZE = 100;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

function summaryOf(model: Record<string, unknown>): QidimakerModelSummary | null {
  const modelId = qidimakerId(model.id);
  if (!modelId) return null;
  return {
    modelId,
    title: str(model.translatedModelName) ?? str(model.modelName) ?? `Model ${modelId}`,
    cover: webImage(model.modelPictureWeb),
  };
}

/** A list's models in the site's order, by `query` (a collection's `id`, or the likes' `favoriteType`). Null where
 *  the site has no such collection, or keeps it from this reader. */
async function fetchListModels(
  query: Record<string, unknown>,
  token: string | null,
  maxItems: number,
): Promise<QidimakerListing | null> {
  const entries: QidimakerModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const pageSize = Math.min(PAGE_SIZE, maxItems);
    const res = await fetchApi(
      "sliceModelFavorite/getModelListByFavoriteId",
      { ...query, pageNum: page, pageSize },
      token,
    );
    if (res.code === CODE_NO_FAVORITE) return null;
    const data = isRecord(res.data) ? res.data : null;
    if (res.code !== CODE_OK || !data) throw failure("this list", res);
    total = asCount(data.total) ?? total;
    const models = recordsOf(data.records);
    const before = entries.length;
    for (const model of models) {
      const summary = summaryOf(model);
      if (!summary || seen.has(summary.modelId)) continue;
      seen.add(summary.modelId);
      entries.push(summary);
      if (entries.length >= maxItems) break;
    }
    // A page with nothing new would repeat forever if the API ignored the page number.
    if (models.length < pageSize || entries.length === before) break;
  }
  return { entries, total: Math.max(total, entries.length), truncated: entries.length >= maxItems && total > maxItems };
}

function collectionInfoOf(favorite: Record<string, unknown>): QidimakerCollectionInfo {
  return {
    name: str(favorite.translatedFavoriteName) ?? str(favorite.favoriteName) ?? "QIDI Maker collection",
    modelCount: asCount(favorite.modelNumber) ?? 0,
    private: favorite.visibility === PRIVATE,
  };
}

/** A collection and its models, by its id: anyone's public one, or a private one of the signed-in user's. Null where
 *  the site has no such collection, or keeps it from this reader. */
export async function fetchQidimakerCollection(
  collectionId: string,
  token: string | null,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<(QidimakerListing & { info: QidimakerCollectionInfo }) | null> {
  const res = await fetchApi("sliceModelFavorite/getById", { id: collectionId }, token);
  if (res.code === CODE_NO_FAVORITE) return null;
  if (res.code !== CODE_OK || !isRecord(res.data)) throw failure("this collection", res);
  const info = collectionInfoOf(res.data);
  const listing = await fetchListModels({ id: collectionId }, token, maxItems);
  if (!listing) return null;
  return { ...listing, info: { ...info, modelCount: Math.max(info.modelCount, listing.total) } };
}

/** The user's likes, the latest first. */
export async function fetchQidimakerLikes(
  token: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<QidimakerListing> {
  const listing = await fetchListModels({ favoriteType: LIKES_TYPE }, token, maxItems);
  if (!listing) throw new Error("Couldn't read your likes on QIDI Maker");
  return listing;
}

function card(favorite: Record<string, unknown>): ProviderCollectionCard | null {
  const id = qidimakerId(favorite.id);
  if (!id) return null;
  const info = collectionInfoOf(favorite);
  const likes = favorite.favoriteType === LIKES_TYPE;
  return {
    id: likes ? QIDIMAKER_LIKES_KEY : id,
    name: likes ? QIDIMAKER_LIKES_NAME : info.name,
    url: likes ? QIDIMAKER_LIKES_URL : qidimakerCollectionUrl(id),
    modelCount: info.modelCount,
    thumbnails: strings(favorite.modelPictureUrls)
      .flatMap((url) => webImage(url) ?? [])
      .slice(0, CARD_THUMBNAILS),
    private: likes || info.private,
    owner: null,
  };
}

/** The user's likes and their own collections, the default one among them, as the sync dialog's Browse tab shows
 *  them. Their browse and download histories aren't lists to sync. */
export async function listQidimakerCollections(token: string): Promise<ProviderCollectionCard[]> {
  const res = await fetchApi("sliceModelFavorite/getList", {}, token);
  if (res.code !== CODE_OK) throw failure("your collections", res);
  const favorites = recordsOf(res.data);
  const likes = favorites.filter((favorite) => favorite.favoriteType === LIKES_TYPE);
  const own = favorites.filter((favorite) => OWN_LIST_TYPES.has(favorite.favoriteType as number));
  return [...likes, ...own].flatMap((favorite) => card(favorite) ?? []);
}

// ---- Trending -------------------------------------------------------------------------------------------------------

// Its listings give at most this many models a page.
const LISTING_PAGE_SIZE = 20;

/** Its Trending list, as its All Models page opens on. Public; no sign-in. */
export async function fetchQidimakerTrending(limit: number): Promise<TrendingModel[]> {
  const res = await fetchApi(
    "sliceModel/getModelPagePublic",
    { pageNum: 1, pageSize: Math.min(limit, LISTING_PAGE_SIZE), modelCollect: true },
    null,
  );
  if (res.code !== CODE_OK) throw failure("its trending models", res);
  return recordsOf(asRecord(res.data)?.records).flatMap((model) => {
    const modelId = qidimakerId(model.id);
    if (!modelId) return [];
    return [
      {
        id: modelId,
        title: asText(model.translatedModelName) ?? asText(model.modelName) ?? modelId,
        url: qidimakerModelUrl(modelId),
        image: webImage(model.modelPictureWeb),
        likes: asCount(model.modelUpvote),
        author: asText(asRecord(model.sliceModelUserVO)?.nickname),
        paid: false,
      },
    ];
  });
}

/** Whether a link is to the user's likes or to a collection, for the list import. */
export function qidimakerListOf(url: string): { likes: true } | { collectionId: string } | null {
  if (isQidimakerLikesUrl(url)) return { likes: true };
  const collectionId = parseQidimakerCollectionUrl(url);
  return collectionId ? { collectionId } : null;
}
