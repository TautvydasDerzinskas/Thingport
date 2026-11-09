import { assertCredentialDestination, credentialRequest } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { tidy } from "../../services/descriptionMarkdown";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { mapWithConcurrency, sleep } from "../../utils/concurrency";
import { meshyPostLicense, meshyTaskLicense } from "./license";
import manifest from "./manifest.generated";
import {
  meshyCollectionUrl,
  meshyGenerationsKey,
  meshyGenerationsUrl,
  meshyPostUrl,
  meshyProfileUrl,
  meshyTaskIdOf,
  meshyTaskKey,
  parseMeshyCollectionUrl,
  parseMeshyGenerationsUrl,
} from "./urls.generated";
export {
  meshyCollectionUrl,
  meshyGenerationsKey,
  meshyGenerationsUrl,
  meshyPostUrl,
  meshyTaskIdOf,
  meshyTaskKey,
  parseMeshyCollectionUrl,
  parseMeshyGenerationsUrl,
};

// Meshy is a Next.js app over an API of its own under /meshyd-api/web, which answers {code, result} -- the code says
// what happened ("OK", "NotFound", "LimitExceeded", …), the HTTP status how bad it is. Posts, collections and listings
// are anyone's to read under /public/. A model's files are another matter: the page's viewer streams an encrypted
// format of Meshy's own, and a download is Meshy converting the model for a signed-in account (asset-url), counted
// against that account's downloads. Thingport asks for the same conversion the site's Download button falls back to.
// The sign-in is Supabase's (session.ts). Its AWS bot check guards the pages; the API has let Node through.

const API_ORIGIN = manifest.endpoints.api;
const AUTH_ORIGIN = manifest.endpoints.auth;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
// Converting a model of a few million triangles takes a while; the site's own call waits three minutes.
const CONVERT_TIMEOUT_MS = Math.max(TIMEOUT_MS, 180_000);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
// The public key Meshy's pages ship with, which Supabase wants beside every call to its auth API.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluZnJlY2xzeGZncW52Z2ZweGNjIiwicm9sZSI6ImFub2" +
  "4iLCJpYXQiOjE3MTU1ODQwNjUsImV4cCI6MjAzMTE2MDA2NX0.015muXUW_O30jeBOxEU9-TQOJigcKMUhkNFbPOWu_iA";

// A 3MF, which Meshy's converter hands back print-ready: 75 mm tall, standing on the plate. Its STL is the raw mesh
// in metres, a model nearly two metres tall.
const FORMAT = "3mf";
const PAGE_SIZE = 100;
const LISTING_MAX_ENTRIES = 600;
const MAX_LIST_PAGES = 40;
// A sync reads a list to its end; no account's comes near this, and one that does fails rather than syncs a part.
const SYNC_MAX_PAGES = 1000;
const CARD_THUMBNAILS = 4;

export class MeshyAuthError extends Error {
  constructor() {
    super(
      "Meshy didn't accept your sign-in; it may have ended. Visit meshy.ai signed in with Thingport Grab, or connect " +
        "it again in Configuration > Providers.",
    );
    this.name = "MeshyAuthError";
  }
}

/** A download the account's plan doesn't include: other people's community models are Pro and Studio's, and so are
 *  the user's own generations that Meshy's AI agent made. */
export class MeshyPlanError extends Error {
  constructor(community = true) {
    super(
      community
        ? "Meshy only lets Pro and Studio plans download other people's community models. Your own import on a free " +
            "plan too, unless its AI agent made them."
        : "Meshy only lets paid plans download this generation of yours, as it does with its AI agent's models.",
    );
    this.name = "MeshyPlanError";
  }
}

export class MeshyDownloadLimitError extends Error {
  constructor() {
    super("Your Meshy downloads for this month are used up. They come back at the start of next month.");
    this.name = "MeshyDownloadLimitError";
  }
}

/** A model Meshy won't hand over: its moderation held it back, or it's another account's generation. */
export class MeshyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshyRefusedError";
  }
}

export class MeshyRateLimitError extends Error {
  constructor() {
    super("Meshy rate-limited Thingport. Wait a while, then try again.");
    this.name = "MeshyRateLimitError";
  }
}

export class MeshyBlockedError extends Error {
  constructor() {
    super("Meshy's bot check turned Thingport away. Visit meshy.ai with Thingport Grab, then try again.");
    this.name = "MeshyBlockedError";
  }
}

/** The user connected another Meshy account while a call ran with the last one's sign-in. */
export class MeshyAccountChangedError extends Error {
  constructor() {
    super("Your Meshy sign-in changed to another account while this ran. Try again.");
    this.name = "MeshyAccountChangedError";
  }
}

/** What a signed-in call is made with: the access token, and the browser's device id and bot-check token, so Meshy
 *  sees the device the sign-in came from. `accountId` is whose it is, so a retry never goes as someone else. */
export type MeshyAuth = { token: string; deviceId: string | null; wafToken: string | null; accountId?: string };

type Envelope = { status: number; code: string | null; result: unknown; total: number | null };

const MODERATED = new Set([
  "ForbiddenForNSFW",
  "ForbiddenForIntellectualProperty",
  "ForbiddenByOrganizationIPFiltering",
  "ForbiddenForPublicFigure",
]);

async function request(
  path: string,
  options: { auth?: MeshyAuth | null; method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<Envelope> {
  const { auth = null, method = "GET", body, timeoutMs = TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${API_ORIGIN}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(auth?.deviceId ? { "X-Device-Id": auth.deviceId } : {}),
        ...(auth?.wafToken ? { Cookie: `aws-waf-token=${auth.wafToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    };
    // With a token, each redirect hop is checked before the token goes along.
    const res = auth ? await credentialRequest("meshy-api", url, init) : await fetch(url, init);
    if (res.status === 202 && res.headers.get("x-amzn-waf-action")) {
      await res.body?.cancel().catch(() => undefined);
      throw new MeshyBlockedError();
    }
    const parsed = asRecord(await res.json().catch(() => null));
    return {
      status: res.status,
      code: asText(parsed?.code),
      result: parsed?.result ?? null,
      total: asCount(parsed?.total),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One call, read by its code. Too many at once are waited out a couple of times, then refused; a refused sign-in,
 *  a plan or a limit that stops a download are thrown as themselves; something Meshy hasn't got is null. */
async function call(
  path: string,
  options: Parameters<typeof request>[1] = {},
): Promise<{ result: unknown; total: number | null } | null> {
  let res = await request(path, options);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429 && res.code !== "LimitExceeded"; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path, options);
  }
  // A kicked device or a banned account is as good as signed out: the sign-in no longer works.
  if (res.status === 401 || res.code === "DeviceKicked" || res.code === "AccountBanned") throw new MeshyAuthError();
  if (res.code === "LimitExceeded") throw new MeshyDownloadLimitError();
  if (res.code && MODERATED.has(res.code)) {
    throw new MeshyRefusedError("Meshy's moderation holds this model back from download.");
  }
  // 402 is a plan that can't; 403 a model this account may not have at all.
  if (res.status === 402) throw new MeshyPlanError();
  if (res.status === 404 || res.code === "NotFound" || res.code === "TaskFilesNotFound") return null;
  if (res.status === 403) throw new MeshyRefusedError("Meshy doesn't let this account download that model.");
  if (res.status === 429) throw new MeshyRateLimitError();
  if (res.status >= 400 || res.code !== "OK") {
    throw new Error(`Meshy refused the call (HTTP ${res.status}${res.code ? `: ${res.code}` : ""})`);
  }
  return { result: res.result, total: res.total };
}

const query = (params: Record<string, string | number | boolean | undefined>): string =>
  Object.entries(params)
    .flatMap(([k, v]) => (v === undefined ? [] : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`]))
    .join("&");

// ---- A model ----

/** One of a model's meshes, by the task Meshy generated it as, which is what its download is asked by. */
export type MeshyMesh = { taskId: string; name: string };

export type MeshyModelResolution = {
  /** A post's own id, or a generation's task id. */
  id: string;
  /** "Showcase" for a community post's models, "Task" for the user's own generation: what Meshy counts it as. */
  type: "Showcase" | "Task";
  meshes: MeshyMesh[];
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
};

/** A post's categories ("NaturePlants") as the slugs Meshy's category pages go by ("nature-plants"). */
const categorySlug = (name: string): string => name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, "-").toLowerCase();

/** A name a file can carry: the characters filesystems refuse taken out, and kept short. */
function fileStem(text: string | null, fallback: string): string {
  const stem = [...(text ?? "")]
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return stem || fallback;
}

/** A picture's own name, the query of its signed link left off. */
function pictureName(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

function gallery(urls: (string | null)[]): { url: string; filename: string }[] {
  const seen = new Set<string>();
  return urls.flatMap((url) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, filename: pictureName(url, `image-${seen.size}.png`) }];
  });
}

function authorIn(value: unknown): ImportedAuthorInfo | null {
  const author = asRecord(value);
  const externalId = author && asText(author.id);
  const handle = author && asText(author.uid);
  const name = (author && asText(author.nickname)) ?? handle;
  if (!externalId || !name) return null;
  return {
    provider: PROVIDER,
    externalId,
    name,
    handle,
    bio: null,
    bioTranslated: null,
    links: handle ? [meshyProfileUrl(handle)] : [],
    avatarUrl: webImage(author.avatarUrl),
    backgroundUrl: null,
  };
}

/** An item's picture: a photo's own, or the render of a model. */
const itemPicture = (item: Record<string, unknown>): string | null =>
  item.kind === "image" ? webImage(item.url) : webImage(asRecord(item.thumbnails)?.thumbnailUrl);

/** A post's items in the order its page shows them, the cover first. */
function itemsOf(post: Record<string, unknown>): Record<string, unknown>[] {
  const items = recordsOf(post.items).toSorted((a, b) => (asCount(a.position) ?? 0) - (asCount(b.position) ?? 0));
  if (!items.length) return recordsOf([post.coverItem]);
  const cover = asCount(post.coverPosition) ?? 0;
  return [
    ...items.filter((item) => asCount(item.position) === cover),
    ...items.filter((item) => asCount(item.position) !== cover),
  ];
}

const TITLE_MAX = 80;

/** A prompt as a title: its first sentence, cut at a word once it runs long. Prompts are often a paragraph. */
function promptTitle(prompt: string | null): string | null {
  const sentence = prompt?.split(/(?<=[.!?])\s|\n/)[0]?.trim();
  if (!sentence) return null;
  if (sentence.length <= TITLE_MAX) return sentence.replace(/[.!?]$/, "");
  return `${sentence.slice(0, TITLE_MAX).replace(/\s+\S*$/, "")}…`;
}

const promptIn = (models: Record<string, unknown>[]): string | null =>
  models.map((item) => asText(item.objectPrompt)).find(Boolean) ?? null;

/** What a post is called: its title, or, as a post often has none, the prompt its first model was made from. */
function postTitle(post: Record<string, unknown>, models: Record<string, unknown>[]): string | null {
  return asText(post.title) ?? promptTitle(promptIn(models)) ?? asText(post.slug);
}

/** A community post, by its id; null when Meshy doesn't show it. */
export async function resolveMeshyPost(postId: string): Promise<MeshyModelResolution | null> {
  const post = asRecord((await call(`/public/community/posts/${encodeURIComponent(postId)}`))?.result);
  const id = post && asText(post.id);
  if (!post || !id) return null;
  const items = itemsOf(post);
  const models = items.filter((item) => item.kind === "model" && asText(item.refId));
  const title = postTitle(post, models);
  const stem = fileStem(title, `meshy-${id}`);
  const pictures = gallery(items.map(itemPicture));
  return {
    id,
    type: "Showcase",
    meshes: models.map((item, index) => ({
      taskId: asText(item.refId)!,
      name: `${models.length > 1 ? `${stem} ${index + 1}` : stem}.${FORMAT}`,
    })),
    galleryImages: pictures,
    meta: {
      title,
      // A post without words of its own still has the prompt its model was generated from, unless that's its title.
      description: tidy(asText(post.body) ?? "") ?? (promptIn(models) !== title ? promptIn(models) : null),
      tags: [...new Set(Array.isArray(post.tags) ? post.tags.flatMap((tag) => asText(tag) ?? []) : [])],
      previewImageUrl: pictures[0]?.url ?? null,
      creator: authorIn(post.author)?.name ?? null,
      author: authorIn(post.author),
      siteCategoryIds: Array.isArray(post.categories)
        ? post.categories.flatMap((name) => (asText(name) ? [categorySlug(asText(name)!)] : []))
        : [],
      categorySite: PROVIDER,
      license: meshyPostLicense(models),
    },
  };
}

/** The account a generation is the user's own on, which is who made it. */
export type MeshyAccount = { userId: string; name: string | null; handle: string | null };

/** The model a task left behind, where it's one at all: a generation can also be a picture, a video or a rig. */
function hasMesh(task: Record<string, unknown>): boolean {
  const result = asRecord(task.result);
  return Object.values(result ?? {}).some((stage) => Boolean(webImage(asRecord(stage)?.modelUrl)));
}

/** The prompt a generation was made from, wherever its stages keep it. */
function promptOf(task: Record<string, unknown>): string | null {
  const args = asRecord(task.args);
  return (
    Object.values(args ?? {})
      .map((stage) => asText(asRecord(stage)?.prompt))
      .find(Boolean) ?? null
  );
}

/** One of the user's own generations, read with their sign-in; null when they haven't got it. `account` is whose
 *  sign-in it is, which is who made it. */
export async function resolveMeshyTask(
  taskId: string,
  auth: MeshyAuth,
  account: MeshyAccount | null,
): Promise<MeshyModelResolution | null> {
  const task = asRecord((await call(`/v2/tasks/${encodeURIComponent(taskId)}`, { auth }))?.result);
  const id = task && asText(task.id);
  if (!task || !id || !hasMesh(task)) return null;
  const prompt = promptOf(task);
  const title = asText(task.name) ?? promptTitle(prompt);
  const pictures = gallery([webImage(asRecord(task.result)?.previewUrl)]);
  const author: ImportedAuthorInfo | null = account?.name
    ? {
        provider: PROVIDER,
        externalId: account.userId,
        name: account.name,
        handle: account.handle,
        bio: null,
        bioTranslated: null,
        links: account.handle ? [meshyProfileUrl(account.handle)] : [],
        avatarUrl: null,
        backgroundUrl: null,
      }
    : null;
  return {
    id,
    type: "Task",
    meshes: [{ taskId: id, name: `${fileStem(title, `meshy-${id}`)}.${FORMAT}` }],
    galleryImages: pictures,
    meta: {
      title,
      // What it was generated from, which is all a generation says about itself.
      description: prompt && prompt !== title ? prompt : null,
      tags: [],
      previewImageUrl: pictures[0]?.url ?? null,
      creator: author?.name ?? null,
      author,
      siteCategoryIds: [],
      categorySite: PROVIDER,
      // Left unread where the task has no such field at all, rather than taken as none.
      ...("license" in task ? { license: meshyTaskLicense(task.license) } : {}),
    },
  };
}

/** Whether Meshy keeps a model from the account's plan altogether, as its pages ask before they show Download. False
 *  when it can't be asked; a refused sign-in is thrown, so it can be renewed and asked again. */
async function isPlanForbidden(taskId: string, type: MeshyModelResolution["type"], auth: MeshyAuth): Promise<boolean> {
  const path = `/v2/tasks/${encodeURIComponent(taskId)}/downloadable-status?${query({ type })}`;
  const answer = await call(path, { auth }).catch((err: unknown) => {
    if (err instanceof MeshyAuthError) throw err;
    return null;
  });
  return asRecord(answer?.result)?.downloadableStatus === "Forbidden";
}

/** The signed link to a mesh, converted for the signed-in account. Throws MeshyPlanError for a model the plan can't
 *  have, MeshyDownloadLimitError once the month's downloads are used up; null when the model has nothing to convert. */
export async function meshyDownloadUrl(
  mesh: MeshyMesh,
  type: MeshyModelResolution["type"],
  auth: MeshyAuth,
): Promise<string | null> {
  const path = `/v2/tasks/${encodeURIComponent(mesh.taskId)}/asset-url?${query({ type, format: FORMAT })}`;
  try {
    return webImage((await call(path, { auth, timeoutMs: CONVERT_TIMEOUT_MS }))?.result);
  } catch (err) {
    // A generation the plan can't have at all is refused as a used-up limit, its limit being none.
    const forbidden =
      err instanceof MeshyPlanError ||
      (err instanceof MeshyDownloadLimitError && (await isPlanForbidden(mesh.taskId, type, auth)));
    if (forbidden) throw new MeshyPlanError(type === "Showcase");
    throw err;
  }
}

/** Why the account's plan can't download a model: someone else's community model, or one of the user's own. */
export type MeshyPlanBlock = "community" | "own";

// The plans Meshy's pages ask a model's download status for; any other downloads every model, so they don't ask.
const ASKED_TIERS = new Set(["free", "starter"]);
const BLOCK_CHECKS_AT_ONCE = 4;

/** The models of a listing that Meshy keeps from the account's plan, by id, asked as its pages ask, and only on the
 *  plans they ask for. A free plan is kept from every other person's community model -- over forty asked, featured or
 *  not, all said so -- so only the user's own are asked of, as their generations. One it can't tell of is left out. */
export async function meshyPlanBlocks(
  entries: MeshySummary[],
  accountId: string,
  auth: MeshyAuth,
): Promise<Map<string, MeshyPlanBlock>> {
  const blocks = new Map<string, MeshyPlanBlock>();
  const tier = asText(asRecord((await call("/v1/me/tier", { auth }).catch(() => null))?.result)?.tier);
  if (!tier || !ASKED_TIERS.has(tier)) return blocks;
  const own: MeshySummary[] = [];
  for (const entry of entries) {
    if (meshyTaskIdOf(entry.externalId) || entry.authorId === accountId) own.push(entry);
    // Starter's community downloads are counted, not kept from it.
    else if (tier === "free" && entry.authorId) blocks.set(entry.externalId, "community");
  }
  await mapWithConcurrency(own, BLOCK_CHECKS_AT_ONCE, async (entry) => {
    // A post whose cover is a picture says which its model is only when it's read.
    const taskId =
      meshyTaskIdOf(entry.externalId) ??
      entry.modelTaskId ??
      (await resolveMeshyPost(entry.externalId).catch(() => null))?.meshes[0]?.taskId;
    if (taskId && (await isPlanForbidden(taskId, "Task", auth).catch(() => false))) blocks.set(entry.externalId, "own");
  });
  return blocks;
}

/** Tells Meshy the download happened, as the site does after its own, so it counts toward the model's downloads. A
 *  failure here costs nothing the user cares about, so it's left alone. */
export async function markMeshyDownloaded(taskId: string, auth: MeshyAuth): Promise<void> {
  await call(`/v2/tasks/${encodeURIComponent(taskId)}/mark-downloaded`, {
    auth,
    method: "POST",
    body: { format: FORMAT },
  }).catch(() => undefined);
}

/** Converted files come from Meshy's CloudFront, signed for the one download. */
export function isMeshyFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type MeshySummary = {
  externalId: string;
  title: string;
  cover: string | null;
  likes: number | null;
  /** Who posted it; a generation has no one but the user. */
  authorId?: string | null;
  /** The task its cover model was generated as, where its cover is one. */
  modelTaskId?: string | null;
};

export type MeshyListing = { entries: MeshySummary[]; total: number; truncated: boolean };

function postSummary(post: Record<string, unknown>): MeshySummary | null {
  const id = asText(post.id);
  if (!id) return null;
  const cover = asRecord(post.coverItem);
  const title = postTitle(post, cover?.kind === "model" ? [cover] : []);
  // A post of photos alone, with no title, has nothing else to be called by in a listing.
  const author = authorIn(post.author)?.name;
  return {
    externalId: id.toLowerCase(),
    title: title ?? (author ? `Meshy post by ${author}` : "Meshy post"),
    cover: cover ? itemPicture(cover) : null,
    likes: asCount(asRecord(post.stats)?.likesCount),
    authorId: asText(asRecord(post.author)?.id),
    modelTaskId: cover?.kind === "model" ? asText(cover.refId) : null,
  };
}

/** A listing's pages, PAGE_SIZE records at a time, each record kept as `keep` makes it (null leaves it out), until
 *  `maxItems` are kept or a short page says it ended. With `countAll`, every page is read, for a listing whose own
 *  count takes in what `keep` leaves out. Reading one to its end -- infinite `maxItems`, as a sync does -- fails at
 *  SYNC_MAX_PAGES rather than hand back a list cut short as if it were whole. Null when the listing isn't there. */
async function readPages(
  page: (pageNum: number) => Promise<{ records: Record<string, unknown>[]; total: number | null } | null>,
  keep: (record: Record<string, unknown>) => MeshySummary | null,
  maxItems: number,
  countAll = false,
): Promise<MeshyListing | null> {
  const entries: MeshySummary[] = [];
  const seen = new Set<string>();
  const toEnd = !Number.isFinite(maxItems);
  const maxPages = toEnd ? SYNC_MAX_PAGES : MAX_LIST_PAGES;
  let total: number | null = null;
  let read = 0;
  let ended = false;
  for (let pageNum = 1; pageNum <= maxPages && !ended; pageNum++) {
    const got = await page(pageNum);
    if (!got) {
      if (pageNum === 1) return null;
      ended = true;
      break;
    }
    total = got.total ?? total;
    read += got.records.length;
    for (const record of got.records) {
      const entry = keep(record);
      if (!entry || seen.has(entry.externalId)) continue;
      seen.add(entry.externalId);
      entries.push(entry);
    }
    // A page is short by the records it held, not by those kept: the next may have more to keep.
    ended = got.records.length < PAGE_SIZE || (!countAll && total !== null && read >= total);
    if (!countAll && entries.length >= maxItems) break;
  }
  if (toEnd && !ended) throw new Error(`Meshy's listing runs past ${SYNC_MAX_PAGES} pages; it can't be read whole`);
  const kept = entries.slice(0, maxItems);
  const known = countAll ? entries.length : Math.max(total ?? 0, entries.length);
  // One that stopped short of its end may have more past where it stopped.
  return { entries: kept, total: known, truncated: kept.length < known || !ended };
}

/** A collection's name and owner; null when it's gone. */
export async function fetchMeshyCollection(
  collectionId: string,
): Promise<{ id: string; name: string; ownerId: string | null } | null> {
  const collection = asRecord(
    (await call(`/public/community-collections/${encodeURIComponent(collectionId)}`))?.result,
  );
  const id = collection && asText(collection.id);
  if (!collection || !id) return null;
  return { id, name: asText(collection.name) ?? "Meshy collection", ownerId: asText(collection.userId) };
}

/** The posts in a collection, newest addition first as its page shows them. */
export async function fetchMeshyCollectionPosts(
  collectionId: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<MeshyListing> {
  const listing = await readPages(
    async (pageNum) => {
      const read = await call(
        `/public/community/posts?${query({ pageNum, pageSize: PAGE_SIZE, communityCollectionId: collectionId })}`,
      );
      return read && { records: recordsOf(read.result), total: read.total };
    },
    postSummary,
    maxItems,
  );
  return listing ?? { entries: [], total: 0, truncated: false };
}

/** A collection as the Browse tab's card. */
export async function meshyCollectionCard(collection: {
  id: string;
  name: string;
  owner: string | null;
}): Promise<ProviderCollectionCard> {
  const listing = await fetchMeshyCollectionPosts(collection.id, CARD_THUMBNAILS);
  return {
    id: collection.id,
    name: collection.name,
    url: meshyCollectionUrl(collection.id),
    modelCount: listing.total,
    thumbnails: listing.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
    // Meshy's collections are public: its own listing shows anyone's.
    private: false,
    owner: collection.owner,
  };
}

/** The collections a Meshy account made, in the order its profile lists them. */
export async function fetchMeshyUserCollections(meshyUserId: string): Promise<{ id: string; name: string }[]> {
  const listing = await readPages(
    async (pageNum) => {
      const read = await call(
        `/public/community-collections?${query({ createdBy: meshyUserId, pageNum, pageSize: PAGE_SIZE })}`,
      );
      return read && { records: recordsOf(read.result), total: null };
    },
    (collection) => {
      const id = asText(collection.id);
      // A filter it doesn't apply hands back everyone's collections, so whose each one is gets checked.
      if (!id || asText(collection.userId)?.toLowerCase() !== meshyUserId) return null;
      return {
        externalId: id.toLowerCase(),
        title: asText(collection.name) ?? "Meshy collection",
        cover: null,
        likes: null,
      };
    },
    Number.POSITIVE_INFINITY,
  );
  return (listing?.entries ?? []).map((entry) => ({ id: entry.externalId, name: entry.title }));
}

/** The user's own generations: every finished model in their workspace, newest first, as kept ids. The examples Meshy
 *  puts in every new workspace are its own models, not the user's, and are left out -- and so are the pictures,
 *  videos and rigs a workspace holds too. Meshy's count takes all of those in, so the whole workspace is read to
 *  count what's left. */
export async function fetchMeshyGenerations(
  auth: MeshyAuth,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<MeshyListing> {
  const listing = await readPages(
    async (pageNum) => {
      const read = await call(`/v2/tasks?${query({ pageNum, pageSize: PAGE_SIZE })}`, { auth });
      return read && { records: recordsOf(read.result), total: read.total };
    },
    (task) => {
      const id = asText(task.id);
      const result = asRecord(task.result);
      if (!id || task.status !== "SUCCEEDED" || result?.isExample === true || !hasMesh(task)) return null;
      return {
        externalId: meshyTaskKey(id.toLowerCase()),
        title: asText(task.name) ?? promptTitle(promptOf(task)) ?? `Meshy generation ${id}`,
        cover: webImage(result?.previewUrl),
        likes: null,
      };
    },
    maxItems,
    true,
  );
  return listing ?? { entries: [], total: 0, truncated: false };
}

/** What a sync names the collection it keeps the user's generations in. */
export const MESHY_GENERATIONS_NAME = "Meshy generations";

/** The user's generations as the Browse tab's card: their own, so there's one. */
export async function meshyGenerationsCard(meshyUserId: string, auth: MeshyAuth): Promise<ProviderCollectionCard> {
  const listing = await fetchMeshyGenerations(auth, CARD_THUMBNAILS);
  return {
    id: meshyGenerationsKey(meshyUserId),
    name: MESHY_GENERATIONS_NAME,
    url: meshyGenerationsUrl(meshyUserId),
    modelCount: listing.total,
    thumbnails: listing.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
    // The workspace is its owner's alone.
    private: true,
    owner: null,
  };
}

// ---- Trending ----

/** The most popular posts its creators marked printable: the site's Popular sort with its 3D-printable filter. */
export async function fetchMeshyPopular(limit: number): Promise<TrendingModel[]> {
  const wanted = Math.max(1, Math.min(limit, PAGE_SIZE));
  const read = await call(
    `/public/community/posts?${query({ pageNum: 1, pageSize: wanted, sortBy: "popularity", is3DPrintable: true })}`,
  );
  return recordsOf(read?.result)
    .flatMap((post) => {
      const summary = postSummary(post);
      if (!summary) return [];
      return [
        {
          id: summary.externalId,
          title: summary.title,
          url: meshyPostUrl(summary.externalId),
          image: summary.cover,
          likes: summary.likes,
          author: authorIn(post.author)?.name ?? null,
          // Meshy sells no models; a plan is what lets community ones download.
          paid: false,
        },
      ];
    })
    .slice(0, limit);
}

// ---- The sign-in ----

/** Who the signed-in account is: their user id, which their collections are listed by, and how Meshy shows them. */
export async function fetchMeshyAccount(auth: MeshyAuth): Promise<MeshyAccount | null> {
  const me = asRecord((await call("/v1/me/info", { auth }))?.result);
  const userId = me && asText(me.userId);
  return userId ? { userId: userId.toLowerCase(), name: asText(me.nickname), handle: asText(me.uid) } : null;
}

/** A renewed session: the next access token and the refresh token that renews it after. */
export type MeshyTokens = { accessToken: string; refreshToken: string; expiresAt: Date | null };

/** Supabase's own renewal, as the site's pages make it. Each refresh token renews once and hands back the next, which
 *  the caller must keep. Throws MeshyAuthError when Supabase turns the refresh token down. */
export async function refreshMeshySession(refreshToken: string): Promise<MeshyTokens> {
  const url = `${AUTH_ORIGIN}/auth/v1/token?grant_type=refresh_token`;
  assertCredentialDestination("meshy-auth", url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  let body: Record<string, unknown> | null;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      redirect: "error",
      signal: controller.signal,
    });
    body = asRecord(await res.json().catch(() => null));
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 429) throw new MeshyRateLimitError();
  // Only Supabase's own answer, which names its error, says the refresh token itself is no good. Anything else -- an
  // outage, or a proxy's bare 403 -- must not read as a refusal, or it would sign every user out.
  const refused = [400, 401, 403].includes(res.status) && Boolean(asText(body?.error_code) ?? asText(body?.error));
  if (refused) throw new MeshyAuthError();
  const accessToken = body && asText(body.access_token);
  const nextRefresh = body && asText(body.refresh_token);
  if (!accessToken || !nextRefresh) throw new Error(`Meshy's sign-in didn't renew (HTTP ${res.status})`);
  const expires = asCount(body!.expires_at);
  return { accessToken, refreshToken: nextRefresh, expiresAt: expires ? new Date(expires * 1000) : null };
}

/** The claims of an access token Thingport reads: whose it is and when it runs out. Null for anything else. */
export function decodeMeshyToken(token: string): { userId: string; expiresAt: Date | null } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = asRecord(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const userId = claims && asText(claims.sub);
    if (!userId) return null;
    const exp = asCount(claims!.exp);
    return { userId: userId.toLowerCase(), expiresAt: exp ? new Date(exp * 1000) : null };
  } catch {
    return null;
  }
}
