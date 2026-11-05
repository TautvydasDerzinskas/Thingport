import { credentialRequest } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import { isGeneratorScript } from "../../services/printCreation";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import {
  isMakeronlineLikesUrl,
  MAKERONLINE_LIKES_KEY,
  MAKERONLINE_LIKES_URL,
  makeronlineCollectionUrl,
  makeronlineModelUrl,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
export {
  isMakeronlineLikesUrl,
  MAKERONLINE_LIKES_KEY,
  MAKERONLINE_LIKES_URL,
  makeronlineCollectionUrl,
  makeronlineModelUrl,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
};

// MakerOnline (Anycubic) has no public API, so this is the one its own pages call. Answers come with a `code` of their
// own, 0 for success. Details, public collections and categories need no sign-in; likes and the user's own collections
// need their token, sent bare in Authorization. Files can't be fetched from here at all: the download call wants a
// Risk-Token that only MakerOnline's anti-bot script, running in a real page, makes. So Thingport plans which files a
// model needs, and Thingport Grab gets their links signed on a makeronline.com page (see grabImportService.ts).
const SITE_ORIGIN = manifest.site;
const API_BASE = `${SITE_ORIGIN}/api`;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;

const CODE_OK = 0;
const CODE_UNAUTHORIZED = -1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  return typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? String(value) : null;
}

export class MakeronlineAuthError extends Error {
  constructor() {
    super(
      "MakerOnline didn't accept your sign-in; it may have expired. Visit makeronline.com with Thingport Grab, or " +
        "connect it again in Configuration > Providers.",
    );
    this.name = "MakeronlineAuthError";
  }
}

export const MAKERONLINE_LIKES_NAME = "MakerOnline likes";
async function fetchApi(
  path: string,
  token: string | null,
): Promise<{ code: number | null; message: string | null; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let body: unknown;
  try {
    const res = await credentialRequest("makeronline-api", `${API_BASE}${path}`, {
      headers: { Accept: "application/json", lang: "en", ...(token ? { Authorization: token } : {}) },
      signal: controller.signal,
    });
    body = await res.json().catch(() => null);
    if (res.status === 401 && token) throw new MakeronlineAuthError();
  } finally {
    clearTimeout(timeout);
  }
  const code = isRecord(body) && typeof body.code === "number" ? body.code : null;
  if (code === CODE_UNAUTHORIZED && token) throw new MakeronlineAuthError();
  return { code, message: isRecord(body) ? str(body.message) : null, data: isRecord(body) ? body.data : null };
}

/** Who the token signs in as, or "rejected"/"unreachable". Without a token the call asks for an id, so a token that
 *  answers with one is a real sign-in. */
export async function checkMakeronlineToken(
  token: string,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const { code, data } = await fetchApi("/user/personal/info", token);
    if (code !== CODE_OK || !isRecord(data) || !str(data.id)) return code === null ? "unreachable" : "rejected";
    return { userId: str(data.id)!, name: str(data.display_name) ?? str(data.user_name) };
  } catch (err) {
    return err instanceof MakeronlineAuthError ? "rejected" : "unreachable";
  }
}

export type MakeronlineProfile = {
  id: string;
  title: string;
  creatorId: string | null;
  /** The profile's 3MF; all its plates share it. */
  fileKey: string | null;
  fileName: string | null;
  /** The profile's own picture, which becomes its file's thumbnail. */
  coverUrl: string | null;
};

/** One of the model's own files (STLs and the like), as the download call names it. */
export type MakeronlineModelFile = { key: string; name: string };

export type MakeronlineModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  creatorId: string | null;
  profiles: MakeronlineProfile[];
  modelFiles: MakeronlineModelFile[];
};

function creatorAuthor(detail: Record<string, unknown>): ImportedAuthorInfo | null {
  const creatorId = str(detail.user_id);
  const name = str(detail.user_display_name) ?? str(detail.user_name);
  if (!creatorId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: creatorId,
    name,
    handle: str(detail.show_user_name)?.replace(/^@/, "") ?? null,
    bio: null,
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/en/user/personalInfo/${creatorId}.html`],
    avatarUrl: str(detail.user_avatar),
    backgroundUrl: null,
  };
}

function imageName(url: string, index: number): string {
  return url.split("/").pop()?.split("?")[0] || `image-${index}.jpg`;
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function makeronlineMetaFromDetail(detail: Record<string, unknown>): MakeronlineModelResolution {
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(detail.title);
  if (title) meta.title = title;
  const description = str(detail.desc);
  if (description) {
    const markdown = htmlToMarkdown(description)?.trim();
    if (markdown) meta.description = markdown;
  }
  if (Array.isArray(detail.tags)) {
    const tags = [...new Set(detail.tags.flatMap((tag) => (str(tag) ? [str(tag)!] : [])))];
    if (tags.length) meta.tags = tags;
  }
  // The main image first, as the page shows it.
  const images = (Array.isArray(detail.images) ? detail.images.filter(isRecord) : [])
    .toSorted((a, b) => Number(b.is_main === 1) - Number(a.is_main === 1))
    .flatMap((image) => (str(image.url) ? [str(image.url)!] : []));
  if (images[0]) meta.previewImageUrl = images[0];
  const author = creatorAuthor(detail);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // Most specific first, so a subcategory beats its parent when both are configured.
  const categoryIds = (Array.isArray(detail.categories) ? detail.categories.filter(isRecord) : [])
    .filter((category) => typeof category.id === "number")
    .toSorted((a, b) => Number(b.level ?? 0) - Number(a.level ?? 0))
    .map((category) => category.id as number);
  if (!categoryIds.length && typeof detail.model_category_id === "number") categoryIds.push(detail.model_category_id);
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  const profiles = (Array.isArray(detail.print_profiles) ? detail.print_profiles.filter(isRecord) : []).flatMap(
    (profile) => {
      const profileId = id(profile.id);
      if (!profileId) return [];
      const file = Array.isArray(profile.files) ? profile.files.find(isRecord) : undefined;
      return [
        {
          id: profileId,
          title: str(profile.title) ?? `Profile ${profileId}`,
          creatorId: str(profile.user_id),
          fileKey: str(file?.key),
          fileName: str(file?.file_name),
          coverUrl: str(profile.main_image),
        },
      ];
    },
  );
  const modelFiles = (Array.isArray(detail.files) ? detail.files.filter(isRecord) : []).flatMap((file, index) =>
    str(file.key) ? [{ key: str(file.key)!, name: str(file.file_name) ?? `makeronline-${index}` }] : [],
  );
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    creatorId: str(detail.user_id),
    profiles,
    modelFiles,
  };
}

/** Null for a model that doesn't exist, was deleted or isn't public. */
export async function resolveMakeronlineModel(
  modelId: string,
  token: string | null = null,
): Promise<MakeronlineModelResolution | null> {
  const { code, message, data } = await fetchApi(`/mold/detail?id=${encodeURIComponent(modelId)}`, token);
  if (code === CODE_OK && isRecord(data) && id(data.id)) return makeronlineMetaFromDetail(data);
  if (code !== null && code > 0) return null;
  throw new Error(`Couldn't read this MakerOnline model${message ? `: ${message}` : ""}`);
}

export type MakeronlineProfileScope = "url" | "designer" | "all";

/** Which profiles an import brings, as for MakerWorld: "url" the one the link names, else the designer's first (else
 *  the first); "designer" every one the designer made; "all" every one. */
export function selectMakeronlineProfiles(
  resolution: Pick<MakeronlineModelResolution, "creatorId" | "profiles">,
  scope: MakeronlineProfileScope,
  requestedProfileId: string | null,
): string[] {
  const profiles = resolution.profiles.filter((profile) => profile.fileKey);
  const designers = profiles.filter((profile) => profile.creatorId === resolution.creatorId);
  if (scope === "all") return profiles.map((profile) => profile.id);
  if (scope === "designer") return (designers.length ? designers : profiles.slice(0, 1)).map((profile) => profile.id);
  const requested = requestedProfileId && profiles.find((profile) => profile.id === requestedProfileId);
  const pick = requested || designers[0] || profiles[0];
  return pick ? [pick.id] : [];
}

/** One file for Grab to get signed: `payload` is the body of MakerOnline's own download call, as its page sends it. */
export type MakeronlineDownloadRequest = {
  payload: { key: string; file_type: 1 | 2; is_batch_down: 0; mold_id?: number; print_profile_id?: number };
  name: string;
  profile_id: string | null;
};

/** The files an import of `scope` needs: each picked profile's 3MF, or, for a model without profiles, its model
 *  files. */
export function makeronlineDownloadPlan(
  modelId: string,
  resolution: MakeronlineModelResolution,
  scope: MakeronlineProfileScope,
  requestedProfileId: string | null,
): MakeronlineDownloadRequest[] {
  const modelFile = (file: { key: string; name: string }): MakeronlineDownloadRequest => ({
    payload: { key: file.key, file_type: 1, is_batch_down: 0, mold_id: Number(modelId) },
    name: file.name,
    profile_id: null,
  });
  const picked = selectMakeronlineProfiles(resolution, scope, requestedProfileId);
  if (picked.length) {
    const profiles: MakeronlineDownloadRequest[] = picked.map((profileId) => {
      const profile = resolution.profiles.find((p) => p.id === profileId)!;
      return {
        payload: { key: profile.fileKey!, file_type: 2, is_batch_down: 0, print_profile_id: Number(profileId) },
        name: profile.fileName ?? `makeronline-${modelId}-${profileId}.3mf`,
        profile_id: profileId,
      };
    });
    // A profile is one printer's 3MF; the script the model was generated from belongs to the model, so it
    // comes alongside and untagged. Without this a model with profiles never asks for its scripts at all.
    return [...profiles, ...resolution.modelFiles.filter((file) => isGeneratorScript(file.name)).map(modelFile)];
  }
  return resolution.modelFiles.map(modelFile);
}

/** The hosts MakerOnline's signed file links point at: its own, and its private S3 buckets. */
export function isMakeronlineFileHost(hostname: string): boolean {
  return (
    /(^|\.)makeronline\.com$/i.test(hostname) || /^acop-[a-z0-9-]+\.s3[a-z0-9.-]*\.amazonaws\.com$/i.test(hostname)
  );
}

export type MakeronlineModelSummary = { modelId: string; title: string; cover: string | null };
export type MakeronlineListing = { entries: MakeronlineModelSummary[]; total: number; truncated: boolean };

const PAGE_SIZE = 20;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** Every page of a paged list, newest first; models taken down are left out, since they can't be imported. */
async function fetchPagedModels(
  path: (page: number) => string,
  token: string | null,
  what: string,
  maxItems: number,
): Promise<MakeronlineListing | null> {
  const entries: MakeronlineModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const { code, message, data } = await fetchApi(path(page), token);
    // A private collection of someone else's, or one that's gone.
    if (code !== null && code > 0 && page === 1) return null;
    if (code !== CODE_OK || !isRecord(data)) {
      throw new Error(`Couldn't read ${what} on MakerOnline${message ? `: ${message}` : ""}`);
    }
    const pageInfo = isRecord(data.page) ? data.page : {};
    total = typeof pageInfo.total === "number" ? pageInfo.total : total;
    const items = Array.isArray(data.data) ? data.data.filter(isRecord) : [];
    for (const item of items) {
      const modelId = id(item.mold_id);
      if (!modelId || (item.status != null && item.status !== 1) || seen.has(modelId)) continue;
      seen.add(modelId);
      entries.push({ modelId, title: str(item.title) ?? `Model ${modelId}`, cover: str(item.main_image) });
      if (entries.length >= maxItems) break;
    }
    const lastPage = typeof pageInfo.last_page === "number" ? pageInfo.last_page : page;
    if (!items.length || page >= lastPage) break;
  }
  return { entries, total, truncated: entries.length >= maxItems && total > entries.length };
}

/** The token's user's liked models. */
export async function fetchMakeronlineLikes(
  token: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<MakeronlineListing> {
  const listing = await fetchPagedModels(
    (page) => `/user/like/index?page=${page}&page_size=${PAGE_SIZE}`,
    token,
    "your likes",
    maxItems,
  );
  return listing ?? { entries: [], total: 0, truncated: false };
}

/** A collection's models. Null for one that's gone, or private and not the token's user's. */
export async function fetchMakeronlineCollection(
  collectionId: string,
  token: string | null,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<MakeronlineListing | null> {
  return fetchPagedModels(
    (page) => `/user/collection/sub-index?id=${encodeURIComponent(collectionId)}&page=${page}&page_size=${PAGE_SIZE}`,
    token,
    "this collection",
    maxItems,
  );
}

export type MakeronlineCollectionInfo = { name: string; ownerId: string | null; private: boolean; modelCount: number };

export async function fetchMakeronlineCollectionInfo(
  collectionId: string,
  token: string | null,
): Promise<MakeronlineCollectionInfo | null> {
  const { code, data } = await fetchApi(`/user/collection/info?id=${encodeURIComponent(collectionId)}`, token);
  if (code !== CODE_OK || !isRecord(data)) return null;
  return {
    name: str(data.name) ?? `Collection ${collectionId}`,
    ownerId: str(data.user_id),
    private: data.permission === 1,
    modelCount: typeof data.mold_num === "number" ? data.mold_num : 0,
  };
}

/** The user's likes, then their own collections, as the sync dialog's Browse tab shows them. */
export async function listMakeronlineCollections(token: string, userId: string): Promise<ProviderCollectionCard[]> {
  const likes = await fetchMakeronlineLikes(token, CARD_THUMBNAILS);
  const cards: ProviderCollectionCard[] = [
    {
      id: MAKERONLINE_LIKES_KEY,
      name: MAKERONLINE_LIKES_NAME,
      url: MAKERONLINE_LIKES_URL,
      modelCount: likes.total,
      thumbnails: likes.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: true,
      owner: null,
    },
  ];
  for (let page = 1; ; page++) {
    const { code, data } = await fetchApi(`/user/collection/index?page=${page}&page_size=${PAGE_SIZE}`, token);
    if (code !== CODE_OK || !isRecord(data)) throw new Error("Couldn't read your MakerOnline collections");
    const items = Array.isArray(data.data) ? data.data.filter(isRecord) : [];
    for (const item of items) {
      const collectionId = id(item.id);
      if (!collectionId) continue;
      const thumbs = Array.isArray(item.sub_data) ? item.sub_data.filter(isRecord) : [];
      cards.push({
        id: collectionId,
        name: str(item.name) ?? `Collection ${collectionId}`,
        url: makeronlineCollectionUrl(userId, collectionId),
        modelCount: typeof item.mold_num === "number" ? item.mold_num : 0,
        thumbnails: thumbs
          .flatMap((thumb) => (str(thumb.main_image) ? [str(thumb.main_image)!] : []))
          .slice(0, CARD_THUMBNAILS),
        private: item.permission === 1,
        owner: null,
      });
    }
    const pageInfo = isRecord(data.page) ? data.page : {};
    if (!items.length || page >= (typeof pageInfo.last_page === "number" ? pageInfo.last_page : page)) break;
  }
  return cards;
}

/** MakerOnline's trending models, from its homepage's "Trending" list, leaving out adult ones. Public; no sign-in. */
export async function fetchMakeronlineTrending(limit: number): Promise<TrendingModel[]> {
  const res = await fetch(`${API_BASE}/index/recommend-trending/v2.5`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", lang: "en" },
    // A fixed seed, so the list is the same for everyone until it's fetched again.
    body: JSON.stringify({ is_first: 1, page: 1, page_size: limit, seed: "1", print_type: 0, exclude_ids: [] }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MakerOnline returned HTTP ${res.status}`);
  const body = asRecord(await res.json());
  return recordsOf(body?.data).flatMap((item) => {
    const modelId = asText(item.mold_id);
    if (!modelId || asCount(item.is_adult_nsfw)) return [];
    return [
      {
        id: modelId,
        title: asText(item.title) ?? modelId,
        url: makeronlineModelUrl(modelId),
        image: webImage(item.mold_image),
        likes: asCount(item.like_num),
        author: asText(item.user_display_name) ?? asText(item.user_name),
        paid: false,
      },
    ];
  });
}
