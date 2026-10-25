import { createHash } from "node:crypto";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import {
  EUFYMAKE_LIKES_KEY,
  EUFYMAKE_LIKES_URL,
  eufymakeModelUrl,
  isEufymakeLikesUrl,
  parseEufymakeModelUrl,
} from "./urls.generated";
import manifest from "./manifest.generated";
export { EUFYMAKE_LIKES_KEY, EUFYMAKE_LIKES_URL, eufymakeModelUrl, isEufymakeLikesUrl, parseEufymakeModelUrl };

// eufyMake's Make it Real has no public API, so this is the one its own pages call, on Anker's API host: every call is
// a JSON POST answered with `{code, msg, data}`, code 0 when it went well and 401 for a missing or refused sign-in.
// Details and their files need no sign-in, the files' links coming signed for a day; only the user's likes need it,
// sent as X-Auth-Token with a Gtoken, which is the MD5 of their user id. A burst of more than a few calls a second is
// answered with a bare 429.
const SITE_ORIGIN = manifest.site;
const API_BASE = manifest.endpoints.api;
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PROVIDER = manifest.id;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const CODE_OK = 0;
const CODE_UNAUTHORIZED = 401;
// What it answers for a model it doesn't know or doesn't show, as for an id that isn't one.
const CODE_NO_MODEL = 220001;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 1500;

// A model's files: each model file on its own, and a zip of them all, which is only needed when there are none.
const FILE_TYPE_MODEL = 1;
const FILE_TYPE_ZIP = 2;
// Its yes/no flags are 1 and 2.
const FLAG_YES = 1;

/** What the site's sign-in sends: its auth token, and the Gtoken that goes with it. */
export type EufymakeAuth = { token: string; gtoken: string };

/** The Gtoken the site sends beside the token: the MD5 of the user's id. */
export function eufymakeGtoken(userId: string): string {
  return createHash("md5").update(userId).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Model ids are 32 hex digits, user ids 40. */
function hexId(value: unknown, length: 32 | 40): string | null {
  const text = str(value)?.toLowerCase();
  return text && new RegExp(`^[0-9a-f]{${length}}$`).test(text) ? text : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => str(item) ?? []) : [];
}

export class EufymakeAuthError extends Error {
  constructor() {
    super(
      "eufyMake didn't accept your sign-in; it may have expired. Visit makeitreal.eufymake.com with Thingport Grab, " +
        "or connect it again in Configuration > Providers.",
    );
    this.name = "EufymakeAuthError";
  }
}

async function post(
  path: string,
  body: unknown,
  auth: EufymakeAuth | null,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "App-Name": "makeitreal",
        "Model-Type": "WEB",
        Origin: SITE_ORIGIN,
        Referer: `${SITE_ORIGIN}/`,
        ...(auth ? { "X-Auth-Token": auth.token, Gtoken: auth.gtoken } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timeout);
  }
}

/** One call's answer. A burst past its limit is waited out a few times, then a 429. */
async function fetchApi(
  path: string,
  body: unknown,
  auth: EufymakeAuth | null,
): Promise<{ code: number | null; message: string | null; data: unknown }> {
  let res = await post(path, body, auth);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await post(path, body, auth);
  }
  if (res.status === 429) throw new HttpError(429, "eufyMake rate-limited this request. Wait a bit and try again.");
  const { json } = res;
  const code = isRecord(json) && typeof json.code === "number" ? json.code : null;
  if (auth && (code === CODE_UNAUTHORIZED || res.status === 401)) throw new EufymakeAuthError();
  return { code, message: isRecord(json) ? str(json.msg) : null, data: isRecord(json) ? json.data : null };
}

function failure(what: string, code: number | null, message: string | null): Error {
  return new Error(`Couldn't read ${what} on eufyMake${message ? `: ${message}` : ` (code ${code})`}`);
}

/** Who the sign-in belongs to, or "rejected"/"unreachable". */
export async function checkEufymakeAuth(
  auth: EufymakeAuth,
): Promise<{ userId: string; name: string | null } | "rejected" | "unreachable"> {
  try {
    const { code, data } = await fetchApi("user/get_user_info", {}, auth);
    // Only a refusal says the sign-in is bad; any other error code is eufyMake's own trouble.
    if (code !== CODE_OK) return code === CODE_UNAUTHORIZED ? "rejected" : "unreachable";
    const user = isRecord(data) && isRecord(data.base_info) ? data.base_info : null;
    const userId = user && hexId(user.user_id, 40);
    if (!userId) return "rejected";
    return { userId, name: str(user.nickname) };
  } catch (err) {
    return err instanceof EufymakeAuthError ? "rejected" : "unreachable";
  }
}

export type EufymakeFile = { name: string; url: string };

export type EufymakeModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
  modelId: string;
  /** Its model files, or the zip of them where it lists none on their own. */
  files: EufymakeFile[];
};

function authorOf(user: unknown): ImportedAuthorInfo | null {
  if (!isRecord(user)) return null;
  const userId = hexId(user.user_id, 40);
  const name = str(user.nickname);
  if (!userId || !name) return null;
  return {
    provider: PROVIDER,
    externalId: userId,
    name,
    handle: null,
    bio: null,
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/user/${userId}/`],
    avatarUrl: str(user.avatar),
    backgroundUrl: null,
  };
}

/** The name in a signed link's path, without its signature. */
function nameFromUrl(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

/** The metadata mapping, apart from the fetch so it can be tested on its own. */
export function eufymakeMetaFromDetail(model: Record<string, unknown>): EufymakeModelResolution | null {
  const modelId = hexId(model.model_id, 32);
  if (!modelId) return null;
  const meta: Partial<ImportedPageMetadata> = {};
  const title = str(model.name);
  if (title) meta.title = title;
  const description = str(model.description);
  if (description) meta.description = description;
  const tags = [...new Set(strings(model.tags))];
  if (tags.length) meta.tags = tags;
  const images = [...new Set(strings(model.covers))];
  if (images[0]) meta.previewImageUrl = images[0];
  const author = authorOf(model.user);
  if (author) {
    meta.author = author;
    meta.creator = author.name;
  }
  // Its subcategory, then the category it's in; "All" is no category.
  const categoryIds = [model.sub_type, model.type].filter(
    (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 1001,
  );
  if (categoryIds.length) {
    meta.siteCategoryIds = categoryIds;
    meta.categorySite = PROVIDER;
  }
  const listed = records(model.model_file).flatMap((file) => {
    const url = str(file.download_link);
    return url ? [{ type: file.file_type, name: str(file.file_name) ?? nameFromUrl(url, `${modelId}`), url }] : [];
  });
  const own = listed.filter((file) => file.type === FILE_TYPE_MODEL);
  const files = (own.length ? own : listed.filter((file) => file.type === FILE_TYPE_ZIP)).map(({ name, url }) => ({
    name,
    url,
  }));
  return {
    meta,
    galleryImages: images.map((url, index) => ({ url, filename: nameFromUrl(url, `image-${index}.jpg`) })),
    modelId,
    files,
  };
}

/** By its id. Null for a model that doesn't exist or isn't shown. */
export async function resolveEufymakeModel(modelId: string): Promise<EufymakeModelResolution | null> {
  const { code, message, data } = await fetchApi("model/get_model_detail", { model_id: modelId }, null);
  if (code === CODE_NO_MODEL) return null;
  if (code !== CODE_OK) throw failure("this model", code, message);
  return isRecord(data) && isRecord(data.model) ? eufymakeMetaFromDetail(data.model) : null;
}

/** eufyMake's file links are signed CloudFront ones. */
export function isEufymakeFileHost(hostname: string): boolean {
  return /^[a-z0-9]+\.cloudfront\.net$/i.test(hostname);
}

export const EUFYMAKE_LIKES_NAME = "eufyMake likes";

export type EufymakeModelSummary = { modelId: string; title: string; cover: string | null };
export type EufymakeListing = { entries: EufymakeModelSummary[]; total: number; truncated: boolean };

const PAGE_SIZE = 50;
const LISTING_MAX_ENTRIES = 600;
const CARD_THUMBNAILS = 4;

/** The user's liked models, the latest first. */
export async function fetchEufymakeLikes(
  auth: EufymakeAuth,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<EufymakeListing> {
  const entries: EufymakeModelSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; entries.length < maxItems; page++) {
    const pageSize = Math.min(PAGE_SIZE, maxItems);
    const { code, message, data } = await fetchApi(
      "user/get_my_like_list",
      { sort: ["create_time:desc"], pagination: { page, page_size: pageSize } },
      auth,
    );
    if (code !== CODE_OK || !isRecord(data)) throw failure("your likes", code, message);
    // Only the first page says how many there are; later ones say 0.
    if (page === 1) total = count(data.total);
    const models = records(data.models);
    const before = entries.length;
    for (const model of models) {
      const modelId = hexId(model.model_id, 32);
      if (!modelId || seen.has(modelId)) continue;
      seen.add(modelId);
      const cover = str(model.cover_tiny_url) ?? strings(model.covers)[0] ?? null;
      entries.push({ modelId, title: str(model.name) ?? `Model ${modelId}`, cover });
      if (entries.length >= maxItems) break;
    }
    // A page with nothing new would repeat forever if the API ignored the page number.
    if (models.length < pageSize || entries.length === before) break;
  }
  return { entries, total: Math.max(total, entries.length), truncated: entries.length >= maxItems && total > maxItems };
}

/** The user's likes, the only list of theirs eufyMake has, as the sync dialog's Browse tab shows it. */
export async function eufymakeLikesCard(auth: EufymakeAuth): Promise<ProviderCollectionCard> {
  const likes = await fetchEufymakeLikes(auth, CARD_THUMBNAILS);
  return {
    id: EUFYMAKE_LIKES_KEY,
    name: EUFYMAKE_LIKES_NAME,
    url: EUFYMAKE_LIKES_URL,
    modelCount: likes.total,
    thumbnails: likes.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
    private: true,
    owner: null,
  };
}

/** The homepage's Featured list, its hottest models first, leaving out adult ones. Public; no sign-in. */
export async function fetchEufymakeFeatured(limit: number): Promise<TrendingModel[]> {
  const { code, message, data } = await fetchApi(
    "model/get_model_list",
    { sort: ["hot_value:desc"], scene: 1, pagination: { page: 1, page_size: limit } },
    null,
  );
  if (code !== CODE_OK) throw failure("its featured models", code, message);
  return recordsOf(asRecord(data)?.models).flatMap((model) => {
    const modelId = hexId(model.model_id, 32);
    if (!modelId || model.adult_flag === FLAG_YES) return [];
    return [
      {
        id: modelId,
        title: asText(model.name) ?? modelId,
        url: eufymakeModelUrl(modelId),
        image: webImage(model.cover_tiny_url) ?? webImage(strings(model.covers)[0]),
        likes: asCount(model.likes),
        author: asText(asRecord(model.user)?.nickname),
        paid: false,
      },
    ];
  });
}
