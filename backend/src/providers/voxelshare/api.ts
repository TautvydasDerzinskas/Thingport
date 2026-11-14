import { randomUUID } from "node:crypto";
import { credentialRequest } from "../credentialRequest";
import { IMPORT_BROWSER_USER_AGENT, IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import { MANIFESTS, providerOfHost, regionalId, splitRegionalId, type RegionId } from "../index.generated";
import {
  isVoxelshareLikesUrl,
  parseVoxelshareCollectionUrl,
  parseVoxelshareModelUrl,
  voxelshareCollectionUrl,
  voxelshareLikesKey,
  voxelshareLikesRegion,
  voxelshareLikesUrl,
  voxelshareModelUrl,
  voxelshareUserUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
import { voxelshareLicenseFrom } from "./license";
export {
  isVoxelshareLikesUrl,
  parseVoxelshareCollectionUrl,
  parseVoxelshareModelUrl,
  voxelshareCollectionUrl,
  voxelshareLikesKey,
  voxelshareLikesUrl,
  voxelshareModelUrl,
};

/** Which of its sites: its main one (null), or its China one. */
export type VoxelshareRegion = RegionId | null;

// VoxelShare has no public API, so this is the one its own pages call, on api.voxelshare.com: JSON answered with
// `{code, msg, data}`, code 0 when it went well, and mostly HTTP 200 whatever the code. Nothing is signed and no header
// is required; the ones sent are those its pages send. Its China site's pages call the same API on api.voxelshare.cn,
// which has its uploads, its trending list and its accounts; models and collections share their ids between the two.
//
// Models, their print profiles and files, listings and public collections need no sign-in. The user's own
// collections and likes need the `token` cookie, sent as a Bearer token. Files are signed links on its image host that
// anyone may download: the site's own Download then reports the download to count it, and Thingport doesn't, to keep
// a sync's downloads out of the user's download history there.
const CHINA = manifest.regions[0];
/** Each site's API, the origin its pages call it from, and the language they're in. */
const SITES: Readonly<Record<"main" | RegionId, { api: string; origin: string; lang: string }>> = {
  main: { api: manifest.endpoints.api, origin: manifest.site, lang: "en" },
  cn: { api: CHINA.endpoints.api, origin: CHINA.site, lang: "zh" },
};
const siteOf = (region: VoxelshareRegion) => SITES[region ?? "main"];

/** A site's pages' host, as messages name it: www.voxelshare.com, or www.voxelshare.cn. */
export function voxelshareSiteHost(region: VoxelshareRegion): string {
  return new URL(siteOf(region).origin).hostname;
}

const FILES_HOST = new URL(manifest.endpoints.files).hostname;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
// What its pages send to tell their logs apart from anyone else's: the same for every visitor.
const LOG_TOKEN = "ASD93kslaS8L3sldkf92Kdl20S9dkleP";
// Its pages send a device id they make up once; this process does the same.
const DEVICE_ID = randomUUID();

const CODE_OK = 0;
// A call that needed a sign-in without one, or with one it doesn't take.
const CODE_AUTH = 110001;
// A sign-in another region of the site took over, which its pages treat as signed out.
const CODE_REGION = 110101;
// A model or collection it doesn't have.
const CODE_NOT_FOUND = 110003;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 1500;
// A model it shows; anything else is taken down or not yet passed review.
const MODEL_SHOWN = 1;

export class VoxelshareAuthError extends Error {
  constructor(readonly region: VoxelshareRegion = null) {
    super(
      `VoxelShare didn't accept your sign-in; it may have expired. Visit ${voxelshareSiteHost(region)} signed in ` +
        "with Thingport Grab, or connect it again in Configuration > Providers.",
    );
    this.name = "VoxelshareAuthError";
  }
}

type Answer = { status: number; code: number | null; message: string | null; data: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Its ids are numbers of up to 17 digits, which JSON gives as text, or as a number only where it fits one. */
export function voxelshareId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : str(value);
  return text && /^\d{1,20}$/.test(text) ? text : null;
}

async function call(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  token: string | null,
  region: VoxelshareRegion,
): Promise<Answer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const site = siteOf(region);
  const url = new URL(`${site.api}/${path}`);
  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  }
  try {
    const res = await credentialRequest("voxelshare-api", url, {
      method,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Origin: site.origin,
        Referer: `${site.origin}/`,
        // In the site's own language, English or Chinese, translated where the designer wrote in another, as its
        // pages show it.
        "Accept-Language": site.lang,
        "Translate-Language": site.lang,
        did: DEVICE_ID,
        "X-Log-Token": LOG_TOKEN,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    const record = isRecord(json) ? json : null;
    return {
      status: res.status,
      code: typeof record?.code === "number" ? record.code : null,
      message: str(record?.msg),
      data: record?.data,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One call's answer from a site, a burst past its limit waited out a few times, then a 429. A sign-in it turns down
 *  throws. */
async function fetchApi(
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
  token: string | null,
  region: VoxelshareRegion = null,
): Promise<Answer> {
  let res = await call(method, path, params, token, region);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await call(method, path, params, token, region);
  }
  if (res.status === 429) throw new HttpError(429, "VoxelShare rate-limited this request. Wait a bit and try again.");
  if (token && (res.status === 401 || res.code === CODE_AUTH || res.code === CODE_REGION))
    throw new VoxelshareAuthError(region);
  return res;
}

function failure(what: string, res: Answer): Error {
  return new Error(
    `Couldn't read ${what} on VoxelShare${res.message ? `: ${res.message}` : ` (HTTP ${res.status}, code ${res.code})`}`,
  );
}

/** Who a site's sign-in belongs to, or "rejected"/"unreachable". */
export async function checkVoxelshareAuth(
  token: string,
  region: VoxelshareRegion = null,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const res = await fetchApi("GET", "v3/creator/self/profile", {}, token, region);
    // Only a refusal says the sign-in is bad; any other answer is VoxelShare's own trouble.
    if (res.code !== CODE_OK) return "unreachable";
    const user = isRecord(res.data) ? res.data : null;
    const userId = str(user?.userId);
    if (!userId) return "rejected";
    return { userId, name: str(user?.nickname) ?? str(user?.customUid) };
  } catch (err) {
    return err instanceof VoxelshareAuthError ? "rejected" : "unreachable";
  }
}

export type VoxelshareFile = { name: string; url: string };

/** One of a model's print profiles, a Flashforge slicer's project, by the site's id; `designer` where the model's
 *  designer made it rather than someone else. */
export type VoxelshareProfile = VoxelshareFile & {
  id: string;
  title: string;
  coverUrl: string | null;
  designer: boolean;
  creator: string | null;
};

/** One of the model's own files, in the folder the designer put it in, if any. */
export type VoxelshareModelFile = VoxelshareFile & { folder: string | null };

export type VoxelshareModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** The id it's kept under, which names the site it's on (`cn-123` the China one's). */
  modelId: string;
  /** Its print profiles, in the site's order. */
  profiles: VoxelshareProfile[];
  /** The model's own files, which only a model without print profiles is imported from. */
  files: VoxelshareModelFile[];
};

/** VoxelShare's files are signed links on its image host. */
export function isVoxelshareFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === FILES_HOST;
}

function fileLink(value: unknown): string | null {
  const url = webImage(value);
  if (!url) return null;
  try {
    return isVoxelshareFileHost(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

/** A picture's signed link as the original, without the resizing its pages ask for after the signature: the image
 *  host serves either. */
export function originalImage(value: unknown): string | null {
  const url = webImage(isRecord(value) ? value.url : value);
  if (!url) return null;
  const cut = url.search(/[?&]imageMogr2/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** The name at the end of a link's path. */
function nameFromUrl(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

function authorOf(user: unknown, region: VoxelshareRegion): ImportedAuthorInfo | null {
  if (!isRecord(user)) return null;
  const userId = str(user.id) ?? str(user.userId);
  const name = str(user.nickname);
  if (!userId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: userId,
    name,
    handle: str(user.customUid),
    bio: null,
    bioTranslated: null,
    links: [voxelshareUserUrl(userId, region)],
    avatarUrl: originalImage(user.avatar),
    backgroundUrl: null,
  };
}

// The sites it copies models from, by host, where Thingport has no provider for them.
const ORIGIN_NAMES: Record<string, string> = { "makeronline.cn": "MakerOnline", "makerworld.com.cn": "MakerWorld" };

/** Where a model VoxelShare copied from another site was first published: that site's name and the model's page there.
 *  Null for a model first published on VoxelShare. */
export function voxelshareOriginOf(detail: Record<string, unknown>): { site: string; url: string } | null {
  const url = webImage(asRecord(detail.sourceInfo)?.url);
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  const provider = providerOfHost(host);
  if (provider === PROVIDER) return null;
  return { site: provider ? MANIFESTS[provider].name : (ORIGIN_NAMES[host] ?? host), url };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** The model's description, with where it was first published after it when VoxelShare copied it from elsewhere. */
function descriptionOf(detail: Record<string, unknown>): string | null {
  const description = str(detail.content) ?? str(detail.originalContent);
  const origin = voxelshareOriginOf(detail);
  if (!origin) return description;
  const credit =
    `<p>Originally published on ${escapeHtml(origin.site)}: ` +
    `<a href="${escapeHtml(origin.url)}">${escapeHtml(origin.url)}</a></p>`;
  return description ? `${description}\n${credit}` : credit;
}

/** The model's print profiles from its list of them, in the site's order. One that's private, or not shown, is left
 *  out, as its page leaves it. */
export function voxelshareProfilesFrom(items: unknown, fileName: string): VoxelshareProfile[] {
  return recordsOf(items).flatMap((config) => {
    const id = voxelshareId(config.id);
    const url = fileLink(config.tmfDownloadUrl);
    if (!id || !url) return [];
    if (config.privateFlag === true || (config.status !== undefined && config.status !== MODEL_SHOWN)) return [];
    const plates = recordsOf(config.plateInfos).flatMap((plate) => originalImage(plate.image) ?? []);
    return [
      {
        id,
        title: str(config.name) ?? id,
        name: fileName,
        url,
        coverUrl: originalImage(config.mainImage) ?? plates[0] ?? null,
        designer: config.modelCreator === true,
        creator: str(asRecord(config.creator)?.nickname),
      },
    ];
  });
}

/** The model's own files, from its list of them: a file (type 2) on its own, or the files of a folder (type 1). Many
 *  are kept zipped one by one, which the link's name says, so the download is named as a zip and unpacked. */
export function voxelshareFilesFrom(items: unknown): VoxelshareModelFile[] {
  const fileOf = (item: Record<string, unknown>, folder: string | null): VoxelshareModelFile[] => {
    const url = fileLink(asRecord(item.fileInfo)?.url);
    const shown = str(item.name);
    if (!url || !shown) return [];
    const zipped = /\.zip$/i.test(nameFromUrl(url, "")) && !/\.zip$/i.test(shown);
    return [{ name: zipped ? `${shown}.zip` : shown, url, folder }];
  };
  return recordsOf(items).flatMap((item) =>
    item.type === 1 ? recordsOf(item.children).flatMap((child) => fileOf(child, str(item.name))) : fileOf(item, null),
  );
}

/** The metadata mapping, apart from the fetches so it can be tested on its own: the model's details, its list of
 *  print profiles and its own files, from one of its sites. Null for a model its page shows nobody. */
export function voxelshareMetaFromDetail(
  detail: Record<string, unknown>,
  profileItems: unknown = [],
  fileItems: unknown = [],
  region: VoxelshareRegion = null,
): VoxelshareModelResolution | null {
  const siteId = voxelshareId(detail.modelId);
  if (!siteId || (detail.status !== undefined && detail.status !== MODEL_SHOWN)) return null;
  const modelId = regionalId(region, siteId);
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(detail.modelName) ?? str(detail.originalName);
  if (title) meta.title = title;
  const description = descriptionOf(detail);
  if (description) meta.description = description;
  const tags = [
    ...new Set(
      (Array.isArray(detail.tags) ? detail.tags : []).flatMap((tag) => str(tag) ?? str(asRecord(tag)?.name) ?? []),
    ),
  ];
  if (tags.length) meta.tags = tags;
  const images = [
    ...new Set([
      originalImage(detail.mainImage),
      ...(Array.isArray(detail.images) ? detail.images : []).map(originalImage),
    ]),
  ].filter((url): url is string => !!url);
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(detail.creator, region);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // Its subcategory, then the category it's in: the site lists them the other way round.
  const categoryIds = [...new Set(recordsOf(detail.category).flatMap((c) => asCount(c.id) ?? []))].toReversed();
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  meta.license = voxelshareLicenseFrom(detail.license);
  // A profile's file has no name of its own (its link names it by when it was uploaded): it's the model's.
  const fileName = `${title ?? siteId}.3mf`;
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: nameFromUrl(url, `image-${index}.jpg`) })),
    modelId,
    profiles: voxelshareProfilesFrom(profileItems, fileName),
    files: voxelshareFilesFrom(fileItems),
  };
}

export type VoxelshareProfileScope = "url" | "designer" | "all";

/** The profiles a scope picks: the one the link names, else the designer's first, for one; the designer's, or all. */
export function selectVoxelshareProfiles(
  resolution: Pick<VoxelshareModelResolution, "profiles">,
  scope: VoxelshareProfileScope,
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

/** The model's details as a site answers them, by its id there. Null for a model it doesn't have; throws when it
 *  doesn't answer. */
export async function fetchVoxelshareDetail(
  modelId: string,
  region: VoxelshareRegion = null,
): Promise<Record<string, unknown> | null> {
  const res = await fetchApi("GET", "v3/model/detail/info", { modelId }, null, region);
  if (res.code === CODE_NOT_FOUND) return null;
  if (res.code !== CODE_OK) throw failure("this model", res);
  return isRecord(res.data) ? res.data : null;
}

/** The model's print profiles as a site lists them; none for a model it doesn't have. */
export async function fetchVoxelshareProfiles(
  modelId: string,
  region: VoxelshareRegion = null,
): Promise<Record<string, unknown>[]> {
  const res = await fetchApi("GET", "v3/model/detail/print_configs", { modelId }, null, region);
  if (res.code !== CODE_OK) throw failure("this model's print profiles", res);
  return recordsOf(asRecord(res.data)?.items);
}

/** The model's own files as a site lists them, folders holding theirs. */
export async function fetchVoxelshareFiles(
  modelId: string,
  region: VoxelshareRegion = null,
): Promise<Record<string, unknown>[]> {
  const res = await fetchApi("GET", "v3/model/detail/source_files", { modelId }, null, region);
  if (res.code !== CODE_OK) throw failure("this model's files", res);
  return recordsOf(asRecord(res.data)?.items);
}

/** A kept id's site, and the model's id there: `cn-123` is 123 on the China site. */
export function voxelshareSiteIdOf(externalId: string): { region: VoxelshareRegion; id: string } {
  return splitRegionalId(externalId, manifest.regions);
}

/** The site whose likes a kept id is, `likes` the main one's and `cn-likes` the China one's; undefined for a
 *  collection's. */
export function voxelshareLikesSiteOf(externalId: string): VoxelshareRegion | undefined {
  const { region, id } = voxelshareSiteIdOf(externalId);
  return id === "likes" ? region : undefined;
}

/** Its sites, the main one first. */
export const VOXELSHARE_SITES: readonly VoxelshareRegion[] = [null, ...manifest.regions.map((region) => region.id)];

/** By the id it's kept under, from the site that names. Null for a model it doesn't have or shows nobody. Its own
 *  files are only read where it has no print profile to import, none listed or none shown, as only then are they
 *  imported. */
export async function resolveVoxelshareModel(externalId: string): Promise<VoxelshareModelResolution | null> {
  const { region, id } = voxelshareSiteIdOf(externalId);
  const detail = await fetchVoxelshareDetail(id, region);
  if (!detail) return null;
  const resolution = voxelshareMetaFromDetail(detail, await fetchVoxelshareProfiles(id, region), [], region);
  if (resolution && !resolution.profiles.length) {
    resolution.files = voxelshareFilesFrom(await fetchVoxelshareFiles(id, region));
  }
  return resolution;
}

// ---- Lists ----------------------------------------------------------------------------------------------------------

/** A site's likes, as Thingport names them: "VoxelShare likes", or "VoxelShare China likes". */
export function voxelshareLikesName(region: VoxelshareRegion): string {
  return region ? `${manifest.name} ${CHINA.name} likes` : `${manifest.name} likes`;
}

export type VoxelshareModelSummary = { modelId: string; title: string; cover: string | null };
export type VoxelshareListing = { entries: VoxelshareModelSummary[]; total: number; truncated: boolean };
export type VoxelshareCollectionInfo = { name: string; modelCount: number; private: boolean };

const PAGE_SIZE = 50;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** A list's model by the id it's kept under, for the site the list is on. */
function summaryOf(model: Record<string, unknown>, region: VoxelshareRegion): VoxelshareModelSummary | null {
  const siteId = voxelshareId(model.modelId);
  if (!siteId) return null;
  return {
    modelId: regionalId(region, siteId),
    title: str(model.modelName) ?? `Model ${siteId}`,
    cover: webImage(asRecord(model.mainImage)?.url),
  };
}

/** A list's models in the site's order, a page at a time from `page(number, size)`. */
async function readPages(
  what: string,
  page: (pageNumber: number, pageSize: number) => Promise<Answer>,
  maxItems: number,
  region: VoxelshareRegion,
): Promise<VoxelshareListing> {
  const entries: VoxelshareModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let number = 1; entries.length < maxItems; number++) {
    const pageSize = Math.min(PAGE_SIZE, maxItems);
    const res = await page(number, pageSize);
    const data = isRecord(res.data) ? res.data : null;
    if (res.code !== CODE_OK || !data) throw failure(what, res);
    total = asCount(data.total) ?? total;
    const models = recordsOf(data.items);
    const before = entries.length;
    for (const model of models) {
      const summary = summaryOf(model, region);
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

function collectionInfoOf(collection: Record<string, unknown>): VoxelshareCollectionInfo {
  return {
    name: str(collection.name) ?? "VoxelShare collection",
    modelCount: asCount(collection.itemCount) ?? 0,
    private: collection.privateFlag === true,
  };
}

/** A collection's details, by its id: anyone's public one, or a private one of the signed-in user's. Null where the
 *  site has no such collection. */
async function fetchCollectionInfo(
  collectionId: string,
  token: string | null,
  region: VoxelshareRegion,
): Promise<VoxelshareCollectionInfo | null> {
  const res = await fetchApi("GET", "v3/model/collection/detail", { id: collectionId }, token, region);
  if (res.code === CODE_NOT_FOUND) return null;
  if (res.code !== CODE_OK || !isRecord(res.data)) throw failure("this collection", res);
  return collectionInfoOf(res.data);
}

/** A collection and its models, by its id on a site. Null where the site has no such collection. Read without a
 *  sign-in, a private one answers "private": the site may show a stranger its details without all its models. */
export async function fetchVoxelshareCollection(
  collectionId: string,
  token: string | null,
  maxItems: number = LISTING_MAX_ENTRIES,
  region: VoxelshareRegion = null,
): Promise<(VoxelshareListing & { info: VoxelshareCollectionInfo }) | null | "private"> {
  const info = await fetchCollectionInfo(collectionId, token, region);
  if (!info) return null;
  if (info.private && !token) return "private";
  const listing = await readPages(
    "this collection",
    (pageNumber, pageSize) =>
      fetchApi(
        "POST",
        "v3/model/collection/model/list",
        { did: DEVICE_ID, requestId: randomUUID(), userId: "", collectionId, pageNumber, pageSize, keyword: "" },
        token,
        region,
      ),
    maxItems,
    region,
  );
  return { ...listing, info: { ...info, modelCount: Math.max(info.modelCount, listing.total) } };
}

/** The user's likes on a site, the latest first. */
export async function fetchVoxelshareLikes(
  token: string,
  maxItems: number = LISTING_MAX_ENTRIES,
  region: VoxelshareRegion = null,
): Promise<VoxelshareListing> {
  return readPages(
    "your likes",
    (pageNumber, pageSize) => fetchApi("GET", "v3/model/creator/like_list", { pageNumber, pageSize }, token, region),
    maxItems,
    region,
  );
}

function card(collection: Record<string, unknown>, region: VoxelshareRegion): ProviderCollectionCard | null {
  const siteId = voxelshareId(collection.id);
  if (!siteId) return null;
  const id = regionalId(region, siteId);
  const info = collectionInfoOf(collection);
  return {
    id,
    name: info.name,
    url: voxelshareCollectionUrl(id),
    modelCount: info.modelCount,
    thumbnails: recordsOf(collection.coverUrls)
      .flatMap((cover) => webImage(cover.url) ?? [])
      .slice(0, CARD_THUMBNAILS),
    private: info.private,
    owner: null,
  };
}

const OWN_COLLECTIONS_MAX = 200;

/** The user's likes and their own collections on a site, the default one among them, as the sync dialog's Browse tab
 *  shows them. Collections they follow are someone else's, and are left to their links. */
export async function listVoxelshareCollections(
  token: string,
  region: VoxelshareRegion = null,
): Promise<ProviderCollectionCard[]> {
  const self = await fetchApi("GET", "v3/creator/self/profile", {}, token, region);
  const userId = str(asRecord(self.data)?.userId);
  if (self.code !== CODE_OK || !userId) throw failure("your account", self);
  const own: Record<string, unknown>[] = [];
  for (let pageNumber = 1; own.length < OWN_COLLECTIONS_MAX; pageNumber++) {
    const res = await fetchApi(
      "POST",
      "v3/model/collection/list",
      { userId, pageNumber, pageSize: PAGE_SIZE },
      token,
      region,
    );
    const data = asRecord(res.data);
    if (res.code !== CODE_OK || !data) throw failure("your collections", res);
    const items = recordsOf(data.items);
    own.push(...items);
    if (items.length < PAGE_SIZE || own.length >= (asCount(data.total) ?? 0)) break;
  }
  const likes = await fetchApi(
    "GET",
    "v3/model/creator/like_list",
    { pageNumber: 1, pageSize: CARD_THUMBNAILS },
    token,
    region,
  );
  const liked = asRecord(likes.data);
  if (likes.code !== CODE_OK || !liked) throw failure("your likes", likes);
  const likesCard: ProviderCollectionCard = {
    id: voxelshareLikesKey(region),
    name: voxelshareLikesName(region),
    url: voxelshareLikesUrl(region),
    modelCount: asCount(liked.total) ?? 0,
    thumbnails: recordsOf(liked.items).flatMap((model) => webImage(asRecord(model.mainImage)?.url) ?? []),
    private: true,
    owner: null,
  };
  return [likesCard, ...own.flatMap((collection) => card(collection, region) ?? [])];
}

// ---- Trending -------------------------------------------------------------------------------------------------------

const TRENDING_MAX = 30;

/** A site's home page Trending feed. Public; no sign-in. */
export async function fetchVoxelshareTrending(
  limit: number,
  region: VoxelshareRegion = null,
): Promise<TrendingModel[]> {
  const res = await fetchApi(
    "POST",
    "v3/model/recommend",
    {
      requestId: randomUUID(),
      did: DEVICE_ID,
      pageNumber: 1,
      pageSize: Math.min(limit, TRENDING_MAX),
      type: "hot",
      categoryId: "",
      pageId: "home-page",
    },
    null,
    region,
  );
  if (res.code !== CODE_OK) throw failure("its trending models", res);
  return recordsOf(asRecord(res.data)?.items).flatMap((item) => {
    const model = asRecord(item.itemData);
    const siteId = voxelshareId(model?.modelId);
    if (!model || !siteId) return [];
    const modelId = regionalId(region, siteId);
    return [
      {
        id: modelId,
        title: asText(model.modelName) ?? siteId,
        url: voxelshareModelUrl(modelId),
        image: webImage(asRecord(model.mainImage)?.url),
        likes: asCount(model.likeCount),
        author: asText(asRecord(model.creator)?.nickname),
        paid: model.free === false,
      },
    ];
  });
}

/** Whether a link is to the user's likes or to a collection, on which site, for the list import. */
export function voxelshareListOf(
  url: string,
): { likes: true; region: VoxelshareRegion } | { collectionId: string; region: VoxelshareRegion } | null {
  const likes = voxelshareLikesRegion(url);
  if (likes !== undefined) return { likes: true, region: likes };
  const collection = parseVoxelshareCollectionUrl(url);
  return collection ? { collectionId: collection.collectionId, region: collection.region } : null;
}
