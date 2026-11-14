import { credentialRequest } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { regionalId, splitRegionalId, type RegionId } from "../index.generated";
import {
  parseSnapmakerListUrl,
  parseSnapmakerModelUrl,
  snapmakerCreatorUrl,
  snapmakerListKey,
  snapmakerListUrl,
  snapmakerModelUrl,
  type SnapmakerList,
} from "./urls.generated";
import manifest from "./manifest.generated";
import { snapmakerLicenseFrom } from "./license";
export {
  parseSnapmakerListUrl,
  parseSnapmakerModelUrl,
  snapmakerListKey,
  snapmakerListUrl,
  snapmakerModelUrl,
  type SnapmakerList,
};

// Snapmaker Space has no public API, so this is the one its own pages call. Every answer is HTTP 200 with a `code` of
// its own. Details are public, but their file links come signed for whoever asked, so files only download with the
// user's access token. Its China site runs the same pages on an API and accounts of its own.

/** A site of Snapmaker Space's: null its main one, else the region's id. */
export type SnapmakerRegion = RegionId | null;

const CHINA = manifest.regions[0];
const apiBase = (region: SnapmakerRegion) => (region ? CHINA.endpoints.api : manifest.endpoints.api);

/** A site's pages' host, as messages name it. */
export function snapmakerSiteHost(region: SnapmakerRegion): string {
  return new URL(region ? CHINA.site : manifest.site).hostname;
}

/** A model id kept by Thingport, as the site it's from and that site's own id. */
export function snapmakerSiteIdOf(externalId: string): { region: SnapmakerRegion; id: string } {
  return splitRegionalId(externalId, manifest.regions);
}

const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;

const CODE_OK = 200;
const CODE_UNAUTHORIZED = 110002;
const CODE_NOT_FOUND = 603000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function id(value: unknown): string | null {
  return typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)) ? String(value) : null;
}

/** A sign-in the site it was sent to turned down; `region` says which site's. */
export class SnapmakerAuthError extends Error {
  readonly region: SnapmakerRegion;
  constructor(region: SnapmakerRegion = null) {
    super(
      `Snapmaker didn't accept your sign-in; it may have expired. Visit ${snapmakerSiteHost(region)} with Thingport ` +
        "Grab, or connect it again in Configuration > Providers.",
    );
    this.name = "SnapmakerAuthError";
    this.region = region;
  }
}

export function snapmakerListName(list: SnapmakerList, region: SnapmakerRegion = null): string {
  const site = region ? "Snapmaker Space China" : "Snapmaker Space";
  return `${site} ${list === "likes" ? "likes" : "bookmarks"}`;
}

async function fetchApi(
  path: string,
  token: string | null,
  region: SnapmakerRegion = null,
): Promise<{ code: number | null; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let body: unknown;
  try {
    const res = await credentialRequest("snapmaker-api", `${apiBase(region)}${path}`, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal,
    });
    body = await res.json().catch(() => null);
    if (res.status === 401) throw new SnapmakerAuthError(region);
  } finally {
    clearTimeout(timeout);
  }
  const code = isRecord(body) && typeof body.code === "number" ? body.code : null;
  if (code === CODE_UNAUTHORIZED) throw new SnapmakerAuthError(region);
  return { code, data: isRecord(body) ? body.data : null };
}

/** Whether a site takes a token: the user's likes answer only to a signed-in user. */
export async function checkSnapmakerToken(
  token: string,
  region: SnapmakerRegion = null,
): Promise<"ok" | "rejected" | "unreachable"> {
  try {
    const { code } = await fetchApi("/model/like/my?page=1&pageSize=1", token, region);
    return code === CODE_OK ? "ok" : "unreachable";
  } catch (err) {
    return err instanceof SnapmakerAuthError ? "rejected" : "unreachable";
  }
}

/** `coverUrl`: the profile's own picture, which becomes its file's thumbnail. */
export type SnapmakerProfile = { id: string; title: string; creatorId: string | null; coverUrl: string | null };

export type SnapmakerModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  creatorId: string | null;
  profiles: SnapmakerProfile[];
};

/** The model's category, then its parents up to the top level (Snapmaker's root, "Categories", left out), so a
 *  subcategory beats its parent when both are configured. */
function categoryChain(detail: Record<string, unknown>): number[] {
  const ids: number[] = [];
  const walk = (node: unknown) => {
    if (!isRecord(node)) return;
    if (typeof node.id === "number" && node.parentId != null) ids.unshift(node.id);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  walk(detail.categoryTree);
  if (!ids.length && typeof detail.categoryId === "number") ids.push(detail.categoryId);
  return ids;
}

/** The model's designer, kept as the site's own (`cn-<id>` the China site's), whose accounts are its own. */
function creatorAuthor(detail: Record<string, unknown>, region: SnapmakerRegion): ImportedAuthorInfo | null {
  const creatorId = id(detail.creatorId);
  const name = str(detail.creatorName);
  if (!creatorId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: regionalId(region, creatorId),
    name,
    handle: null,
    bio: null,
    bioTranslated: null,
    links: [snapmakerCreatorUrl(creatorId, region)],
    avatarUrl: str(detail.creatorAvatar),
    backgroundUrl: null,
  };
}

function imageName(url: string, index: number): string {
  return url.split("/").pop()?.split("?")[0] || `image-${index}.jpg`;
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. Snapmaker translates titles,
 *  descriptions and tags into English; the translation is used where there is one. The China site's own categories
 *  and licences have the main site's ids. */
export function snapmakerMetaFromDetail(
  detail: Record<string, unknown>,
  region: SnapmakerRegion = null,
): SnapmakerModelResolution {
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(detail.translatedTitle) ?? str(detail.title);
  if (title) meta.title = title;
  const description = str(detail.translatedDescription) ?? str(detail.description);
  if (description) {
    const markdown = htmlToMarkdown(description)?.trim();
    if (markdown) meta.description = markdown;
  }
  const rawTags =
    Array.isArray(detail.translatedTags) && detail.translatedTags.length ? detail.translatedTags : detail.tags;
  if (Array.isArray(rawTags)) {
    const tags = [...new Set(rawTags.flatMap((tag) => (str(tag) ? [str(tag)!] : [])))];
    if (tags.length) meta.tags = tags;
  }
  const cover = str(detail.coverUrl);
  if (cover) meta.previewImageUrl = cover;
  const author = creatorAuthor(detail, region);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  const categoryIds = categoryChain(detail);
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  meta.license = snapmakerLicenseFrom(detail);
  const images = Array.isArray(detail.images) ? detail.images.flatMap((url) => (str(url) ? [str(url)!] : [])) : [];
  const profiles = Array.isArray(detail.printProfiles)
    ? detail.printProfiles.flatMap((profile) => {
        if (!isRecord(profile) || !id(profile.id)) return [];
        return [
          {
            id: id(profile.id)!,
            title: str(profile.translatedTitle) ?? str(profile.title) ?? `Profile ${String(profile.id)}`,
            creatorId: id(profile.creatorId),
            coverUrl: Array.isArray(profile.pictures) ? str(profile.pictures[0]) : null,
          },
        ];
      })
    : [];
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: imageName(url, index) })),
    creatorId: id(detail.creatorId),
    profiles,
  };
}

/** The model's public details as its site answers them, profiles included, by the id Thingport keeps (`cn-<id>` the
 *  China site's). Null for a model that doesn't exist or isn't public. */
export async function fetchSnapmakerDetail(externalId: string): Promise<Record<string, unknown> | null> {
  const { region, id: modelId } = snapmakerSiteIdOf(externalId);
  const { code, data } = await fetchApi(`/model/detail/${encodeURIComponent(modelId)}`, null, region);
  if (code === CODE_NOT_FOUND) return null;
  if (code !== CODE_OK || !isRecord(data)) throw new Error(`Couldn't read this Snapmaker model (code ${code})`);
  return data;
}

/** By the id Thingport keeps. Null for a model that doesn't exist or isn't public. */
export async function resolveSnapmakerModel(externalId: string): Promise<SnapmakerModelResolution | null> {
  const detail = await fetchSnapmakerDetail(externalId);
  return detail ? snapmakerMetaFromDetail(detail, snapmakerSiteIdOf(externalId).region) : null;
}

export type SnapmakerFile = { name: string; url: string };
export type SnapmakerDownloads = { modelFiles: SnapmakerFile[]; profiles: (SnapmakerFile & { profileId: string })[] };

/** Snapmaker writes spaces in file names as `+`. */
function fileName(value: unknown, fallback: string): string {
  return (str(value) ?? fallback).replace(/\+/g, " ");
}

/** Signed links to the model's files and its print profiles' 3MFs, for the token's user, by the id Thingport keeps;
 *  the token is that site's. Null for a model that doesn't exist. Throws SnapmakerAuthError for a token the site
 *  doesn't take. */
export async function fetchSnapmakerDownloads(externalId: string, token: string): Promise<SnapmakerDownloads | null> {
  const { region, id: modelId } = snapmakerSiteIdOf(externalId);
  const { code, data } = await fetchApi(`/model/download/${encodeURIComponent(modelId)}`, token, region);
  if (code === CODE_NOT_FOUND) return null;
  if (code !== CODE_OK || !isRecord(data)) throw new Error(`Couldn't get this Snapmaker model's files (code ${code})`);
  const modelFiles = Array.isArray(data.modelFiles)
    ? data.modelFiles.flatMap((file, index) =>
        isRecord(file) && str(file.downloadUrl)
          ? [{ name: fileName(file.fileName, `snapmaker-${modelId}-${index}`), url: str(file.downloadUrl)! }]
          : [],
      )
    : [];
  const profiles = Array.isArray(data.printProfiles)
    ? data.printProfiles.flatMap((file) =>
        isRecord(file) && id(file.profileId) && str(file.downloadUrl)
          ? [
              {
                profileId: id(file.profileId)!,
                name: fileName(file.fileName, `snapmaker-${modelId}-${String(file.profileId)}.3mf`),
                url: str(file.downloadUrl)!,
              },
            ]
          : [],
      )
    : [];
  return { modelFiles, profiles };
}

/** The signed hosts Snapmaker's file links point at, and where they redirect: on the China site, its private file
 *  store too. */
export function isSnapmakerFileHost(hostname: string): boolean {
  return (
    /^(models|space)\.snapmaker\.(com|cn)$/i.test(hostname) || /^cdn-model-private\.snapmaker\.cn$/i.test(hostname)
  );
}

export type SnapmakerProfileScope = "url" | "designer" | "all";

/** Which profiles an import brings, as for MakerWorld: "url" the one the link names, else the designer's first (else
 *  the first); "designer" every one the designer made; "all" every one. */
export function selectSnapmakerProfiles(
  resolution: Pick<SnapmakerModelResolution, "creatorId" | "profiles">,
  scope: SnapmakerProfileScope,
  requestedProfileId: string | null,
): string[] {
  const { profiles, creatorId } = resolution;
  const designers = profiles.filter((profile) => profile.creatorId === creatorId);
  if (scope === "all") return profiles.map((profile) => profile.id);
  if (scope === "designer") return (designers.length ? designers : profiles.slice(0, 1)).map((profile) => profile.id);
  const requested = requestedProfileId && profiles.find((profile) => profile.id === requestedProfileId);
  const pick = requested || designers[0] || profiles[0];
  return pick ? [pick.id] : [];
}

export type SnapmakerModelSummary = { modelId: string; title: string; cover: string | null };

const PAGE_SIZE = 30;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

function listPath(list: SnapmakerList, page: number, pageSize: number): string {
  return `/model/${list === "likes" ? "like" : "collect"}/my?page=${page}&pageSize=${pageSize}`;
}

/** The token's user's likes or bookmarks on its site, newest first, under the ids Thingport keeps. Deleted models are
 *  left out: they can't be imported. */
export async function fetchSnapmakerList(
  list: SnapmakerList,
  token: string,
  maxItems: number = LISTING_MAX_ENTRIES,
  region: SnapmakerRegion = null,
): Promise<{ entries: SnapmakerModelSummary[]; total: number; truncated: boolean }> {
  const entries: SnapmakerModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const { code, data } = await fetchApi(listPath(list, page, PAGE_SIZE), token, region);
    if (code !== CODE_OK || !isRecord(data)) throw new Error(`Couldn't read your Snapmaker ${list} (code ${code})`);
    total = typeof data.total === "number" ? data.total : total;
    const items = Array.isArray(data.list) ? data.list.filter(isRecord) : [];
    for (const item of items) {
      const modelId = id(item.id);
      if (!modelId || item.is_deleted === true || seen.has(modelId)) continue;
      seen.add(modelId);
      entries.push({
        modelId: regionalId(region, modelId),
        title: str(item.translatedTitle) ?? str(item.title) ?? `Model ${modelId}`,
        cover: str(item.cover_url),
      });
      if (entries.length >= maxItems) break;
    }
    if (items.length < PAGE_SIZE || page * PAGE_SIZE >= total) break;
  }
  return { entries, total, truncated: entries.length >= maxItems && total > entries.length };
}

/** The user's likes and bookmarks on a site, as the sync dialog's Browse tab shows them; `userId` is theirs there. */
export async function listSnapmakerCollections(
  token: string,
  userId: string,
  region: SnapmakerRegion = null,
): Promise<ProviderCollectionCard[]> {
  const cards: ProviderCollectionCard[] = [];
  for (const list of ["likes", "bookmarks"] as const) {
    const { entries, total } = await fetchSnapmakerList(list, token, CARD_THUMBNAILS, region);
    cards.push({
      id: snapmakerListKey(userId, list, region),
      name: snapmakerListName(list, region),
      url: snapmakerListUrl(userId, list, region),
      modelCount: total,
      thumbnails: entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: true,
      owner: null,
    });
  }
  return cards;
}

/** A site's featured models, as its homepage shows them; it has no trending list. Public; no sign-in. */
export async function fetchSnapmakerFeatured(limit: number, region: SnapmakerRegion = null): Promise<TrendingModel[]> {
  const { data } = await fetchApi(`/model/home-featured?page=1&pageSize=${limit}`, null, region);
  return recordsOf(asRecord(data)?.list).flatMap((item) => {
    const siteId = asText(item.id);
    if (!siteId || item.is_nsfw === true) return [];
    const modelId = regionalId(region, siteId);
    return [
      {
        id: modelId,
        title: asText(item.translatedTitle) ?? asText(item.title) ?? siteId,
        url: snapmakerModelUrl(modelId),
        image: webImage(item.cover_url),
        likes: asCount(item.like_count),
        author: asText(item.creator_name),
        paid: false,
      },
    ];
  });
}
