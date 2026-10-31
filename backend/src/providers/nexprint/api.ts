import { credentialRequest } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import {
  nexprintCollectionUrl,
  nexprintModelUrl,
  parseNexprintCollectionUrl,
  parseNexprintModelUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
export { nexprintCollectionUrl, nexprintModelUrl, parseNexprintCollectionUrl, parseNexprintModelUrl };

// NexPrint (Elegoo's model site) has no public API, so this is the one its own pages call, under /gateway: answers are
// `{code, msg, data}`, code 0 when it went well and 401 for a missing or refused sign-in. Details, categories and
// collections, private ones included, need no sign-in; file downloads and the user's own collection list need their
// token, sent as a Bearer token.
const SITE_ORIGIN = manifest.site;
const API_BASE = `${SITE_ORIGIN}/gateway/api/v1`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const CODE_OK = 0;
const CODE_UNAUTHORIZED = 401;

// The kinds of file presigned-download-url signs: a model's own file, and a print profile's 3MF.
const FILE_TYPE_MODEL = 2;
const FILE_TYPE_PROFILE = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** NexPrint's internal ids are 19-digit numbers, past what a JS number holds, so they always come as strings. */
function id(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

/** The ids its pages show: a "G" and digits for models, profiles and collections, a "U" and digits for users. */
function outId(value: unknown, prefix: "G" | "U"): string | null {
  const text = str(value)?.toUpperCase();
  return text && new RegExp(`^${prefix}\\d+$`).test(text) ? text : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export class NexprintAuthError extends Error {
  constructor() {
    super(
      "NexPrint didn't accept your sign-in; it may have expired. Visit nexprint.com with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "NexprintAuthError";
  }
}

function headers(token: string | null, json: boolean): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    "client-id": "Nexprint",
    "user-lang": "en",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchApi(
  path: string,
  { query, body }: { query?: Record<string, string | number>; body?: unknown },
  token: string | null,
): Promise<{ code: number | null; message: string | null; data: unknown }> {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let json: unknown;
  let status: number;
  try {
    const res = await credentialRequest("nexprint-api", url, {
      method: body === undefined ? "GET" : "POST",
      headers: headers(token, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    json = await res.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
  const code = isRecord(json) && typeof json.code === "number" ? json.code : null;
  if (token && (code === CODE_UNAUTHORIZED || status === 401)) throw new NexprintAuthError();
  return { code, message: isRecord(json) ? str(json.msg) : null, data: isRecord(json) ? json.data : null };
}

function failure(what: string, code: number | null, message: string | null): Error {
  return new Error(`Couldn't read ${what} on NexPrint${message ? `: ${message}` : ` (code ${code})`}`);
}

/** Who the token belongs to, or "rejected"/"unreachable". */
export async function checkNexprintAuth(
  token: string,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const { code, data } = await fetchApi("/model-user-server/member/user_data", { body: {} }, token);
    const user = isRecord(data) && isRecord(data.userData) ? data.userData : null;
    // Only a refusal says the token is bad; any other error code is NexPrint's own trouble.
    if (code !== CODE_OK) return code === CODE_UNAUTHORIZED ? "rejected" : "unreachable";
    if (!user || !outId(user.userId, "U")) return "rejected";
    return { userId: outId(user.userId, "U")!, name: str(user.nickname) };
  } catch (err) {
    return err instanceof NexprintAuthError ? "rejected" : "unreachable";
  }
}

export type NexprintProfile = {
  /** Its "G" id, the one the site's links carry. */
  id: string;
  /** Its internal id, which signs its file. */
  settingId: string;
  fileId: string;
  title: string;
  designers: boolean;
  /** The profile's own picture, which becomes its file's thumbnail. */
  coverUrl: string | null;
};

export type NexprintModelFile = { fileId: string; name: string };

export type NexprintModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  /** Its "G" id, the one Thingport keeps for it. */
  modelId: string;
  /** Its internal id, which signs its files. */
  internalId: string;
  profiles: NexprintProfile[];
  /** The model's own files that aren't a print profile's 3MF. */
  files: NexprintModelFile[];
};

function authorOf(author: unknown): ImportedAuthorInfo | null {
  if (!isRecord(author)) return null;
  const userId = outId(author.userId, "U");
  const name = str(author.nickname);
  if (!userId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: userId,
    name,
    handle: null,
    bio: null,
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/en/${userId}/home`],
    avatarUrl: str(author.avatarUrl),
    backgroundUrl: null,
  };
}

function imageName(url: string, index: number): string {
  return url.split("/").pop()?.split("?")[0] || `image-${index}.jpg`;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function nexprintMetaFromDetail(data: Record<string, unknown>): NexprintModelResolution | null {
  const modelId = outId(data.modelId, "G");
  const internalId = id(data.id);
  if (!modelId || !internalId) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(data.modelName);
  if (title) meta.title = title;
  const description = str(data.modelDetail);
  if (description) {
    const markdown = htmlToMarkdown(description)?.trim();
    if (markdown) meta.description = markdown;
  }
  const tags = [...new Set((Array.isArray(data.modelTagList) ? data.modelTagList : []).flatMap((t) => str(t) ?? []))];
  if (tags.length) meta.tags = tags;
  const images = [
    ...new Set([str(data.coverImgUrl), ...records(data.modelPicList).map((pic) => str(pic.fileUrl))].filter(Boolean)),
  ] as string[];
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(data.author);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // The model's own category, then its parents, so a subcategory beats its parent.
  const categories = records(data.classificationInfos).toSorted((a, b) => count(b.level) - count(a.level));
  const categoryIds = [
    ...new Set(
      [data.classificationId, ...categories.map((c) => c.id)]
        .map((value) => Number(value))
        .filter((value) => Number.isSafeInteger(value) && value > 0),
    ),
  ];
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  const authorId = id(data.authorId);
  const profiles = records(data.settingInfoList).flatMap((setting): NexprintProfile[] => {
    const profileId = outId(setting.settingOutId, "G");
    const settingId = id(setting.id);
    const fileId = isRecord(setting.settingFile) ? id(setting.settingFile.fileId) : null;
    if (!profileId || !settingId || !fileId || setting.open === false || setting.isInvalid === true) return [];
    return [
      {
        id: profileId,
        settingId,
        fileId,
        title: str(setting.settingName) ?? `Profile ${profileId}`,
        designers: setting.isCreator === true || (!!authorId && id(setting.userId) === authorId),
        coverUrl: str(setting.settingCoverImgUrl),
      },
    ];
  });
  // The model's file list repeats each profile's 3MF; those come with their profile instead.
  const profileFiles = new Set(profiles.map((profile) => profile.fileId));
  const files = new Map<string, NexprintModelFile>();
  for (const file of records(data.modelFileList)) {
    const fileId = id(file.fileId);
    if (fileId && !profileFiles.has(fileId) && !files.has(fileId)) {
      files.set(fileId, { fileId, name: str(file.fileName) ?? `nexprint-${modelId}-${files.size}` });
    }
  }
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    modelId,
    internalId,
    profiles,
    files: [...files.values()],
  };
}

/** By its "G" id. Null for a model that doesn't exist, was deleted or isn't public. */
export async function resolveNexprintModel(modelId: string): Promise<NexprintModelResolution | null> {
  const { code, message, data } = await fetchApi(
    "/model-library-server/model-base-info/get",
    { query: { id: modelId, loadGeneratorInfo: "true", loadSupportPrintProfile: "true" } },
    null,
  );
  if (code !== CODE_OK) throw failure("this model", code, message);
  // A model that isn't there comes back as one with every field null.
  return isRecord(data) ? nexprintMetaFromDetail(data) : null;
}

export type NexprintProfileScope = "url" | "designer" | "all";

/** Which profiles an import brings, as for MakerWorld: "url" the one the link names, else the designer's first (else
 *  the first); "designer" every one the designer made; "all" every one. */
export function selectNexprintProfiles(
  resolution: Pick<NexprintModelResolution, "profiles">,
  scope: NexprintProfileScope,
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

export type NexprintFile = { name: string; url: string };

/** The extension a signed link's file has, when its name lacks one. */
function withExtension(name: string, url: string): string {
  let ext = "";
  try {
    ext = decodeURIComponent(new URL(url).pathname).match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "";
  } catch {}
  return ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name;
}

/** Signs files for the signed-in user, all in one call. Throws NexprintAuthError for a token NexPrint doesn't take. */
async function signFiles(
  files: { fileId: string; type: number; bizId: string; name: string }[],
  token: string,
): Promise<NexprintFile[]> {
  if (!files.length) return [];
  const { code, message, data } = await fetchApi(
    "/model-library-server/common/presigned-download-url",
    { body: { fileInfoList: files.map((f) => ({ fileId: f.fileId, type: String(f.type), bizId: f.bizId })) } },
    token,
  );
  if (code !== CODE_OK || !isRecord(data)) throw failure("this model's files", code, message);
  const urls = new Map(
    records(data.fileInfoList).flatMap((f) =>
      id(f.fileId) && str(f.resultUrl) ? [[id(f.fileId)!, str(f.resultUrl)!]] : [],
    ),
  );
  return files.flatMap((file) => {
    const url = urls.get(file.fileId);
    return url ? [{ name: withExtension(file.name, url), url }] : [];
  });
}

/** Signed links to the model's own files (not its profiles'). */
export function fetchNexprintModelFiles(
  resolution: Pick<NexprintModelResolution, "files" | "internalId">,
  token: string,
): Promise<NexprintFile[]> {
  return signFiles(
    resolution.files.map((file) => ({ ...file, type: FILE_TYPE_MODEL, bizId: resolution.internalId })),
    token,
  );
}

/** A signed link to one print profile's 3MF, named after the profile. Null when NexPrint doesn't sign it. */
export async function fetchNexprintProfileFile(profile: NexprintProfile, token: string): Promise<NexprintFile | null> {
  const name = profile.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || profile.id;
  const [file] = await signFiles(
    [{ fileId: profile.fileId, type: FILE_TYPE_PROFILE, bizId: profile.settingId, name }],
    token,
  );
  return file ?? null;
}

/** NexPrint's signed file links point at its Aliyun OSS bucket. */
export function isNexprintFileHost(hostname: string): boolean {
  return /^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/i.test(hostname);
}

export type NexprintModelSummary = { modelId: string; title: string; cover: string | null };
export type NexprintListing = { entries: NexprintModelSummary[]; total: number; truncated: boolean };

const PAGE_SIZE = 50;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** Every page of a collection's models, as the site orders them; models no longer shared are left out, since they
 *  can't be imported. */
async function fetchCollectionModels(collectionId: string, maxItems: number): Promise<NexprintListing> {
  const entries: NexprintModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const pageSize = Math.min(PAGE_SIZE, maxItems);
    const { code, message, data } = await fetchApi(
      `/model-library-server/model-collection/${collectionId}/model/page`,
      { query: { pageSize, pageNo: page } },
      null,
    );
    if (code !== CODE_OK || !isRecord(data)) throw failure("this collection", code, message);
    total = count(data.total) || total;
    const items = records(data.list);
    for (const item of items) {
      const modelId = outId(item.modelId, "G");
      if (!modelId || item.isInvalid === true || item.open === false || seen.has(modelId)) continue;
      seen.add(modelId);
      entries.push({ modelId, title: str(item.modelName) ?? `Model ${modelId}`, cover: str(item.coverImgUrl) });
      if (entries.length >= maxItems) break;
    }
    if (items.length < pageSize || page * pageSize >= total) break;
  }
  return { entries, total, truncated: entries.length >= maxItems && total > entries.length };
}

export type NexprintCollectionInfo = {
  id: string;
  name: string;
  ownerId: string | null;
  private: boolean;
  modelCount: number;
};

function collectionInfo(data: unknown): NexprintCollectionInfo | null {
  if (!isRecord(data)) return null;
  const collectionId = outId(data.collectOutId, "G");
  if (!collectionId) return null;
  return {
    id: collectionId,
    name: str(data.collectionName) ?? "NexPrint collection",
    ownerId: isRecord(data.author) ? outId(data.author.userId, "U") : null,
    private: data.collectionOpenStatus === false,
    modelCount: count(data.countNum),
  };
}

/** A collection's details by its "G" id. Null for one that doesn't exist. */
export async function fetchNexprintCollectionInfo(collectionId: string): Promise<NexprintCollectionInfo | null> {
  const { code, message, data } = await fetchApi(`/model-library-server/model-collection/${collectionId}`, {}, null);
  if (code !== CODE_OK) throw failure("this collection", code, message);
  return collectionInfo(data);
}

/** A collection's models; private ones read without a sign-in too. Null for one that doesn't exist. */
export async function fetchNexprintCollection(
  collectionId: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<(NexprintListing & { info: NexprintCollectionInfo }) | null> {
  const info = await fetchNexprintCollectionInfo(collectionId);
  if (!info) return null;
  return { ...(await fetchCollectionModels(collectionId, maxItems)), info };
}

/** The user's own collections, as the sync dialog's Browse tab shows them. NexPrint lists no liked models anywhere,
 *  so there's no likes card. */
export async function listNexprintCollections(token: string): Promise<ProviderCollectionCard[]> {
  const { code, message, data } = await fetchApi("/model-library-server/model-collection/list", {}, token);
  if (code !== CODE_OK) throw failure("your collections", code, message);
  const cards: ProviderCollectionCard[] = [];
  for (const info of records(data).map(collectionInfo)) {
    if (!info) continue;
    // The list has the collection's own cover only; its first models make the card's.
    const thumbnails = info.modelCount
      ? (await fetchCollectionModels(info.id, CARD_THUMBNAILS)).entries.flatMap((entry) => entry.cover ?? [])
      : [];
    cards.push({
      id: info.id,
      name: info.name,
      url: nexprintCollectionUrl(info.id, info.ownerId),
      modelCount: info.modelCount,
      thumbnails,
      private: info.private,
      owner: null,
    });
  }
  return cards;
}

/** NexPrint's recommended models, as its homepage shows them; it has no trending list. Public; no sign-in. */
export async function fetchNexprintRecommended(limit: number): Promise<TrendingModel[]> {
  const { data } = await fetchApi(
    "/model-library-server/model-base-info/recommend/web",
    // A fixed seed, so the list is the same for everyone until it's fetched again.
    { query: { pageSize: limit, pageNo: 1, seed: 1, loadGeneratorInfo: "true" } },
    null,
  );
  return recordsOf(asRecord(data)?.list).flatMap((entry) => {
    const model = asRecord(entry.model);
    const modelId = asText(model?.modelId);
    if (!model || !modelId || model.nsfw === true) return [];
    const names = asRecord(model.modelNameTranslateMap);
    return [
      {
        id: modelId,
        title: asText(names?.en) ?? asText(model.modelName) ?? modelId,
        url: nexprintModelUrl(modelId),
        image: webImage(model.coverImgUrl),
        // NexPrint counts likes as "stars"; the odd casing is its own.
        likes: asCount(asRecord(model.statistics)?.staticsModelStarPeoPleCount),
        author: asText(model.authorName),
        paid: false,
      },
    ];
  });
}
