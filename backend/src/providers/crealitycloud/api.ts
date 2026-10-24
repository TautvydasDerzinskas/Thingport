import { randomUUID } from "node:crypto";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import {
  crealitycloudCollectionUrl,
  crealitycloudLikesKey,
  crealitycloudLikesUrl,
  crealitycloudModelUrl,
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
} from "../_generated/crealitycloud/urls";
import manifest from "../_generated/crealitycloud/manifest";
export {
  crealitycloudCollectionUrl,
  crealitycloudLikesKey,
  crealitycloudLikesUrl,
  crealitycloudModelUrl,
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
};

// Creality Cloud has no public API, so this is the one its own pages call: every call a POST with a JSON body, and
// every answer `{code, msg, result}` with a code of its own. It refuses ("Invalid Parameter") any call without the
// whole set of `__cxy_*` headers its site sends. Details, file lists, print profiles and collections need no sign-in;
// downloads and likes need the user's token and user id.
const SITE_ORIGIN = manifest.site;
const API_BASE = `${SITE_ORIGIN}/api/cxy`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
// Cloudflare turns away a request without a browser's User-Agent.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const DEVICE_ID = randomUUID();

const CODE_OK = 0;
const CODE_INVALID_TOKEN = 4;
// Deleted (512), private (513), doesn't exist (517), and taken down, under review or unlicensed (1000069-1000074).
const MISSING_CODES = new Set([512, 513, 517, 1000069, 1000070, 1000071, 1000072, 1000074]);

/** The user's sign-in: Creality Cloud wants the token and the user id it belongs to together. */
export type CrealitycloudAuth = { token: string; userId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && /^[\w-]+$/.test(value) ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class CrealitycloudAuthError extends Error {
  constructor() {
    super(
      "Creality Cloud didn't accept your sign-in; it may have expired. Visit crealitycloud.com with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "CrealitycloudAuthError";
  }
}

/** A model's id: 24 hex digits, where its alias is words. */
export function isCrealitycloudModelId(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value);
}

export const CREALITYCLOUD_LIKES_NAME = "Creality Cloud likes";

function headers(auth: CrealitycloudAuth | null): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: SITE_ORIGIN,
    "User-Agent": USER_AGENT,
    __cxy_app_id_: "cxy-gen2",
    __cxy_app_ver_: "7.3.28",
    __cxy_app_ch_: "Chrome 152.0.0.0",
    __cxy_brand_: "creality",
    __cxy_platform_: "2",
    __cxy_os_lang_: "0",
    __cxy_os_ver_: "macOS 10.15.7",
    __cxy_timezone_: "0",
    __cxy_duid_: DEVICE_ID,
    __cxy_requestid_: randomUUID(),
    ...(auth ? { __cxy_token_: auth.token, __cxy_uid_: auth.userId } : {}),
  };
}

async function fetchApi(
  path: string,
  body: Record<string, unknown>,
  auth: CrealitycloudAuth | null,
): Promise<{ code: number | null; message: string | null; result: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let json: unknown;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: headers(auth),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
  const code = isRecord(json) && typeof json.code === "number" ? json.code : null;
  if (code === CODE_INVALID_TOKEN && auth) throw new CrealitycloudAuthError();
  return { code, message: isRecord(json) ? str(json.msg) : null, result: isRecord(json) ? json.result : null };
}

function failure(what: string, code: number | null, message: string | null): Error {
  return new Error(`Couldn't read ${what} on Creality Cloud${message ? `: ${message}` : ` (code ${code})`}`);
}

/** Who the sign-in belongs to, or "rejected"/"unreachable". */
export async function checkCrealitycloudAuth(
  auth: CrealitycloudAuth,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const { code, result } = await fetchApi("/v3/user/getInfo", {}, auth);
    const base = isRecord(result) && isRecord(result.profileUserInfo) ? result.profileUserInfo.base : null;
    if (code !== CODE_OK || !isRecord(base) || !id(base.userId)) return code === null ? "unreachable" : "rejected";
    return { userId: id(base.userId)!, name: str(base.nickName) };
  } catch (err) {
    return err instanceof CrealitycloudAuthError ? "rejected" : "unreachable";
  }
}

/** `coverUrl`: the profile's own picture, which becomes its file's thumbnail. */
export type CrealitycloudProfile = {
  id: string;
  title: string;
  creatorId: string | null;
  designers: boolean;
  coverUrl: string | null;
};

export type CrealitycloudModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** The model's 24-hex id, which its file and profile calls take. */
  groupId: string;
  /** Its alias, the id Thingport keeps for it; the hex id where it has none. */
  alias: string;
  creatorId: string | null;
  profiles: CrealitycloudProfile[];
};

function creatorAuthor(userInfo: unknown): ImportedAuthorInfo | null {
  if (!isRecord(userInfo)) return null;
  const creatorId = id(userInfo.userId);
  const name = str(userInfo.nickName);
  if (!creatorId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: creatorId,
    name,
    handle: null,
    bio: str(userInfo.introduction),
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/user/${creatorId}`],
    avatarUrl: str(userInfo.avatar),
    backgroundUrl: null,
  };
}

function imageName(url: string, index: number): string {
  return url.split("/").pop()?.split("?")[0] || `image-${index}.jpg`;
}

function coverUrls(value: unknown): string[] {
  return (Array.isArray(value) ? value.filter(isRecord) : []).flatMap((cover) =>
    str(cover.url) ? [str(cover.url)!] : [],
  );
}

/** A print profile's name: what it says about its settings, and the printer it's for. */
function profileTitle(profile: Record<string, unknown>, profileId: string): string {
  const settings = str(profile.secondName) ?? str(profile.name);
  const printer = str(profile.printerName);
  if (settings && printer) return `${settings} (${printer})`;
  return settings ?? printer ?? `Profile ${profileId}`;
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. `profiles` is the model's 3MF list. */
export function crealitycloudMetaFromDetail(
  groupItem: Record<string, unknown>,
  profiles: Record<string, unknown>[] = [],
): CrealitycloudModelResolution | null {
  const groupId = id(groupItem.id);
  if (!groupId) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(groupItem.groupName);
  if (title) meta.title = title;
  const description = str(groupItem.groupDesc);
  if (description) {
    const markdown = htmlToMarkdown(description)?.trim();
    if (markdown) meta.description = markdown;
  }
  if (Array.isArray(groupItem.tags)) {
    const tags = [
      ...new Set(groupItem.tags.flatMap((tag) => (isRecord(tag) && str(tag.name) ? [str(tag.name)!] : []))),
    ];
    if (tags.length) meta.tags = tags;
  }
  const images = coverUrls(groupItem.covers);
  if (images[0]) meta.previewImageUrl = images[0];
  const author = creatorAuthor(groupItem.userInfo);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // The model's own category, then its parent, as the site lists them, so a subcategory beats its parent.
  const categoryIds = [
    ...new Set(
      [
        groupItem.categoryId,
        ...(Array.isArray(groupItem.categories) ? groupItem.categories : []).map((c) => (isRecord(c) ? c.id : null)),
      ]
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  const creatorId = isRecord(groupItem.userInfo) ? id(groupItem.userInfo.userId) : null;
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    groupId,
    alias: str(groupItem.urlAlias)?.toLowerCase() ?? groupId,
    creatorId,
    profiles: profiles.flatMap((profile) => {
      const profileId = id(profile.id);
      if (!profileId) return [];
      const owner = isRecord(profile.userInfo) ? id(profile.userInfo.userId) : null;
      return [
        {
          id: profileId,
          title: profileTitle(profile, profileId),
          creatorId: owner,
          designers: profile.isAuth === true || (!!owner && owner === creatorId),
          coverUrl: coverUrls(profile.covers)[0] ?? str(profile.thumbnail),
        },
      ];
    }),
  };
}

const PROFILE_PAGE_SIZE = 199;

async function fetchProfiles(groupId: string): Promise<Record<string, unknown>[]> {
  const { code, message, result } = await fetchApi(
    "/v3/model/3mfList",
    { page: 1, pageSize: PROFILE_PAGE_SIZE, modelGroupId: groupId, filterType: 11 },
    null,
  );
  if (code !== CODE_OK) throw failure("this model's print profiles", code, message);
  return isRecord(result) && Array.isArray(result.list) ? result.list.filter(isRecord) : [];
}

/** By alias or id. Null for a model that doesn't exist, was deleted or isn't public. */
export async function resolveCrealitycloudModel(modelId: string): Promise<CrealitycloudModelResolution | null> {
  const { code, message, result } = await fetchApi("/v3/model/modelGroupDetail", { id: modelId }, null);
  if (code !== null && MISSING_CODES.has(code)) return null;
  if (code !== CODE_OK || !isRecord(result) || !isRecord(result.groupItem)) throw failure("this model", code, message);
  const groupId = id(result.groupItem.id);
  if (!groupId) return null;
  return crealitycloudMetaFromDetail(result.groupItem, await fetchProfiles(groupId));
}

export type CrealitycloudProfileScope = "url" | "designer" | "all";

/** Which profiles an import brings, as for MakerWorld: "url" the one the link names, else the designer's first (else
 *  the first); "designer" every one the designer made; "all" every one. */
export function selectCrealitycloudProfiles(
  resolution: Pick<CrealitycloudModelResolution, "profiles">,
  scope: CrealitycloudProfileScope,
  requestedProfileId: string | null,
): string[] {
  const { profiles } = resolution;
  const designers = profiles.filter((profile) => profile.designers);
  if (scope === "all") return profiles.map((profile) => profile.id);
  if (scope === "designer") return (designers.length ? designers : profiles.slice(0, 1)).map((profile) => profile.id);
  const requested = requestedProfileId && profiles.find((profile) => profile.id === requestedProfileId);
  const pick = requested || designers[0] || profiles[0];
  return pick ? [pick.id] : [];
}

export type CrealitycloudFile = { name: string; url: string };

/** The extension a signed link's file has, since Creality Cloud names files without one. */
function withExtension(name: string, url: string): string {
  let ext = "";
  try {
    ext = decodeURIComponent(new URL(url).pathname).match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
  } catch {}
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name;
}

/** Signed links to every one of the model's own files, for the signed-in user. Throws CrealitycloudAuthError for a
 *  sign-in Creality Cloud doesn't take. */
export async function fetchCrealitycloudModelFiles(
  groupId: string,
  auth: CrealitycloudAuth,
): Promise<CrealitycloudFile[] | null> {
  // No file ids: every file.
  const { code, message, result } = await fetchApi(
    "/v3/model/memberDownload",
    { modelId: groupId, trailType: 0, fileIds: [] },
    auth,
  );
  if (code !== null && MISSING_CODES.has(code)) return null;
  if (code !== CODE_OK || !isRecord(result)) throw failure("this model's files", code, message);
  return (Array.isArray(result.downloadUrls) ? result.downloadUrls.filter(isRecord) : []).flatMap((file, index) => {
    const url = str(file.url);
    return url ? [{ name: withExtension(str(file.fileName) ?? `crealitycloud-${groupId}-${index}`, url), url }] : [];
  });
}

/** A signed link to one print profile's 3MF. Null for a profile that's gone. */
export async function fetchCrealitycloudProfileFile(
  profile: Pick<CrealitycloudProfile, "id" | "title">,
  auth: CrealitycloudAuth,
): Promise<CrealitycloudFile | null> {
  const { code, message, result } = await fetchApi("/v3/model/3mfDownload", { id: profile.id }, auth);
  if (code !== null && MISSING_CODES.has(code)) return null;
  if (code !== CODE_OK || !isRecord(result) || !str(result.downloadUrl)) {
    throw failure("this print profile's file", code, message);
  }
  const url = str(result.downloadUrl)!;
  return { name: withExtension(profile.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || profile.id, url), url };
}

/** Creality Cloud's signed file links point at its Aliyun OSS buckets. */
export function isCrealitycloudFileHost(hostname: string): boolean {
  return /^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(hostname);
}

export type CrealitycloudModelSummary = { modelId: string; title: string; cover: string | null };
export type CrealitycloudListing = { entries: CrealitycloudModelSummary[]; total: number; truncated: boolean };

const PAGE_SIZE = 24;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** Every page of a list of models, as the site orders it; models no longer shared are left out, since they can't be
 *  imported. */
async function fetchPagedModels(
  path: string,
  body: Record<string, unknown>,
  auth: CrealitycloudAuth | null,
  what: string,
  maxItems: number,
): Promise<CrealitycloudListing> {
  const entries: CrealitycloudModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const { code, message, result } = await fetchApi(path, { ...body, page, pageSize: PAGE_SIZE }, auth);
    if (code !== CODE_OK || !isRecord(result)) throw failure(what, code, message);
    total = count(result.count) || total;
    const items = Array.isArray(result.list) ? result.list.filter(isRecord) : [];
    for (const item of items) {
      const modelId = str(item.urlAlias)?.toLowerCase() ?? id(item.id);
      if (!modelId || item.isShared === false || seen.has(modelId)) continue;
      seen.add(modelId);
      entries.push({
        modelId,
        title: str(item.groupName) ?? `Model ${modelId}`,
        cover: coverUrls(item.covers)[0] ?? null,
      });
      if (entries.length >= maxItems) break;
    }
    if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
  }
  return { entries, total, truncated: entries.length >= maxItems && total > entries.length };
}

/** The signed-in user's liked models. */
export async function fetchCrealitycloudLikes(
  auth: CrealitycloudAuth,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<CrealitycloudListing> {
  return fetchPagedModels("/v3/model/likeListPage", {}, auth, "your likes", maxItems);
}

export type CrealitycloudCollectionInfo = {
  folderId: string;
  alias: string;
  name: string;
  ownerId: string | null;
  private: boolean;
  modelCount: number;
};

function collectionInfo(result: unknown): CrealitycloudCollectionInfo | null {
  if (!isRecord(result) || !id(result.id) || !id(result.customizationUrl)) return null;
  return {
    folderId: id(result.id)!,
    alias: id(result.customizationUrl)!,
    name: str(result.thematicName) ?? "Creality Cloud collection",
    ownerId: id(result.creator),
    private: result.isPublic === false,
    modelCount: count(result.modelQuantity),
  };
}

/** A collection by its alias, or by its folder id (`byFolderId`). Null for one that doesn't exist. */
export async function fetchCrealitycloudCollectionInfo(
  key: string,
  { byFolderId = false } = {},
): Promise<CrealitycloudCollectionInfo | null> {
  const { code, message, result } = await fetchApi(
    "/v2/thematic/detail",
    byFolderId ? { id: key } : { customizationUrl: key },
    null,
  );
  if (code !== null && MISSING_CODES.has(code)) return null;
  if (code !== CODE_OK) throw failure("this collection", code, message);
  return collectionInfo(result);
}

/** A collection's models, by its alias. Null for one that doesn't exist. */
export async function fetchCrealitycloudCollection(
  collectionId: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<(CrealitycloudListing & { info: CrealitycloudCollectionInfo }) | null> {
  const info = await fetchCrealitycloudCollectionInfo(collectionId);
  if (!info) return null;
  const listing = await fetchPagedModels(
    "/v3/collection/listCollFolderModel",
    { folderId: info.folderId },
    null,
    "this collection",
    maxItems,
  );
  return { ...listing, info };
}

// The folder kinds listCollFolder answers with: the user's own collections, beside lists the site keeps for them
// (likes, downloads, browsing history) that have no address of their own.
const FOLDER_KIND_COLLECTION = 3;

/** The user's likes, then their own collections, as the sync dialog's Browse tab shows them. */
export async function listCrealitycloudCollections(auth: CrealitycloudAuth): Promise<ProviderCollectionCard[]> {
  const likes = await fetchCrealitycloudLikes(auth, CARD_THUMBNAILS);
  const cards: ProviderCollectionCard[] = [
    {
      id: crealitycloudLikesKey(auth.userId),
      name: CREALITYCLOUD_LIKES_NAME,
      url: crealitycloudLikesUrl(auth.userId),
      modelCount: likes.total,
      thumbnails: likes.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: true,
      owner: null,
    },
  ];
  const { code, message, result } = await fetchApi(
    "/v3/collection/listCollFolder",
    { userId: Number(auth.userId), page: 1, pageSize: 100 },
    auth,
  );
  if (code !== CODE_OK || !isRecord(result)) throw failure("your collections", code, message);
  const folders = (Array.isArray(result.list) ? result.list.filter(isRecord) : []).filter(
    (folder) => folder.type === FOLDER_KIND_COLLECTION && id(folder.id),
  );
  for (const folder of folders) {
    // The folder list leaves out the alias a collection's address is made of.
    const info = await fetchCrealitycloudCollectionInfo(id(folder.id)!, { byFolderId: true });
    if (!info) continue;
    const thumbs = (Array.isArray(folder.coverList) ? folder.coverList.filter(isRecord) : []).flatMap((cover) =>
      isRecord(cover.covers) && str(cover.covers.url) ? [str(cover.covers.url)!] : [],
    );
    cards.push({
      id: info.alias,
      name: str(folder.name) ?? info.name,
      url: crealitycloudCollectionUrl(info.alias),
      modelCount: count(folder.modelQuantity),
      thumbnails: thumbs.slice(0, CARD_THUMBNAILS),
      private: folder.isPublic === false,
      owner: null,
    });
  }
  return cards;
}

/** Creality Cloud's recommended models, as its homepage shows them; it has no trending list. Public; no sign-in. */
export async function fetchCrealitycloudRecommended(limit: number): Promise<TrendingModel[]> {
  const { result } = await fetchApi("/v3/model/recommendv4", { cursor: "", limit }, null);
  return recordsOf(asRecord(result)?.list).flatMap((entry) => {
    const model = asRecord(entry.model);
    const modelId = asText(model?.id);
    // Only models it rates for everyone.
    if (!model || !modelId || (asText(model.maturityRating) ?? "general") !== "general") return [];
    return [
      {
        id: modelId,
        title: asText(model.groupName) ?? modelId,
        url: crealitycloudModelUrl(modelId),
        image: webImage(recordsOf(model.covers)[0]?.url),
        likes: asCount(model.likeCount),
        author: asText(asRecord(model.userInfo)?.nickName),
        paid: model.isPay === true,
      },
    ];
  });
}
