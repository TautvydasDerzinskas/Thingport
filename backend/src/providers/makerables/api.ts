import { assertCredentialDestination, credentialRequest } from "../credentialRequest";
import { IMPORT_TIMEOUT_SECONDS } from "../../config";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ImportedAuthorInfo, ImportedPageMetadata } from "../../services/importResolvers";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, webImage, type TrendingModel } from "../../services/trendingModel";
import { sleep } from "../../utils/concurrency";
import manifest from "./manifest.generated";
import {
  isMakerablesProjectId,
  makerablesProjectUrl,
  makerablesSavedKey,
  makerablesSavedUrl,
  parseMakerablesProjectUrl,
  parseMakerablesSavedUrl,
} from "./urls.generated";
export {
  isMakerablesProjectId,
  makerablesProjectUrl,
  makerablesSavedKey,
  makerablesSavedUrl,
  parseMakerablesProjectUrl,
  parseMakerablesSavedUrl,
};

// Makerables is a Next.js site over a REST API of its own at /api, which answers every call with a
// {code, success, message, data} envelope -- so the envelope's code is what says what happened, not the HTTP status
// alone. A project, its files and its listings are anyone's to read, and its files sit on its CDN unsigned; only the
// user's saved projects need a sign-in, and that one only reads their own. The sign-in itself is Auth0's: the
// browser's __session cookie, which /auth/access-token turns into the Bearer token the API takes (session.ts).
// Its Cloudflare lets Node's own fetch through.

const SITE_ORIGIN = manifest.site;
const API_ORIGIN = manifest.endpoints.api;
const PROVIDER = manifest.id;
const TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_WAIT_MS = 2000;
// Auth0's Next.js SDK splits the sign-in cookie across `__session__0`, `__session__1`, … when it outgrows one.
const SESSION_COOKIE_PREFIX = manifest.sessionCookies.session;

// The biggest page each listing takes: its saved projects count in pages, its project query by cursor.
const SAVED_PAGE_SIZE = 100;
const QUERY_PAGE_SIZE = 100;
const LISTING_MAX_ENTRIES = 600;
// Past these there are surely no more: at 100 a page, this is far more than any one account has saved.
const MAX_LIST_PAGES = 40;
const CARD_THUMBNAILS = 4;

export class MakerablesAuthError extends Error {
  constructor() {
    super(
      "Makerables didn't accept your sign-in; it may have expired. Visit makerables.com signed in with Thingport " +
        "Grab, or connect it again in Configuration > Providers.",
    );
    this.name = "MakerablesAuthError";
  }
}

export class MakerablesRateLimitError extends Error {
  constructor() {
    super("Makerables rate-limited Thingport. Wait a while, then try again.");
    this.name = "MakerablesRateLimitError";
  }
}

/** Someone else's saved projects: Makerables shows them to their owner alone. */
export class MakerablesForbiddenError extends Error {
  constructor() {
    super("Makerables shows saved projects to their owner only.");
    this.name = "MakerablesForbiddenError";
  }
}

type Envelope = { status: number; code: number | null; success: boolean; message: string | null; data: unknown };

async function request(path: string, token: string | null): Promise<Envelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${API_ORIGIN}${path}`;
    const init: RequestInit = {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        // The site translates a project into the reader's language; English is what Thingport imports.
        "x-locale": "en",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    };
    // With a token, each redirect hop is checked before the token goes along.
    const res = token ? await credentialRequest("makerables-api", url, init) : await fetch(url, init);
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      status: res.status,
      code: asCount(body?.code),
      success: body?.success === true,
      message: asText(body?.message),
      data: body?.data ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** One call, by the envelope's own code rather than the HTTP status. Too many at once are waited out a couple of
 *  times, then refused; a refused sign-in and someone else's list are thrown as themselves, and something the site
 *  hasn't got comes back as null rather than an error. */
async function get(path: string, token: string | null = null): Promise<unknown> {
  let res = await request(path, token);
  for (let retry = 1; retry <= RATE_LIMIT_RETRIES && res.status === 429; retry++) {
    await sleep(RATE_LIMIT_WAIT_MS * retry);
    res = await request(path, token);
  }
  if (res.status === 429) throw new MakerablesRateLimitError();
  if (res.code === 401) throw new MakerablesAuthError();
  if (res.code === 403) throw new MakerablesForbiddenError();
  if (res.code === 404) return null;
  if (!res.success)
    throw new Error(`Makerables refused the call (HTTP ${res.status}${res.message ? `: ${res.message}` : ""})`);
  return res.data;
}

const query = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .flatMap(([k, v]) => (v === undefined ? [] : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`]))
    .join("&");

// ---- A project ----

/** One of a project's files, as its tab lists it. */
export type MakerablesFile = { id: string; name: string; url: string; size: number | null };

export type MakerablesModelResolution = {
  /** The slug, which is what a project is kept under and what its page's address is. */
  slug: string;
  /** Its id, which its file calls take. */
  projectId: string;
  meta: Partial<ImportedPageMetadata>;
  galleryImages: { url: string; filename: string }[];
};

/** A file's name with the extension the site keeps apart from it, which a plate is told by. */
function fileName(record: Record<string, unknown>): string | null {
  const name = asText(record.name);
  const ext = asText(record.file_type);
  if (!name) return null;
  if (!ext) return name;
  const dotted = ext.startsWith(".") ? ext : `.${ext}`;
  return name.toLowerCase().endsWith(dotted.toLowerCase()) ? name : `${name}${dotted}`;
}

function filesIn(data: unknown): MakerablesFile[] {
  return recordsOf(data).flatMap((record) => {
    const id = asText(record.id);
    const url = webImage(record.file_path);
    const name = fileName(record);
    return id && url && name ? [{ id, name, url, size: asCount(record.file_size) }] : [];
  });
}

/** The ids of the categories a project is in, the parent's and the child's. The site lists the parent first, and its
 *  `level` counts the other way round from what the name suggests, so a `parent_id` is what tells a child; Thingport
 *  maps the most specific it knows, so they come back child first. */
function categoryIdsIn(data: unknown): number[] {
  return recordsOf(data)
    .flatMap((category) => {
      const id = asCount(category.id);
      return id === null ? [] : [{ id, child: asCount(category.parent_id) !== null }];
    })
    .toSorted((a, b) => Number(b.child) - Number(a.child))
    .map((category) => category.id);
}

function authorIn(data: unknown): ImportedAuthorInfo | null {
  const creator = asRecord(data);
  const externalId = creator && asText(creator.id);
  const name = creator && asText(creator.nick_name);
  if (!externalId || !name) return null;
  return {
    provider: PROVIDER,
    externalId,
    name,
    handle: null,
    bio: null,
    bioTranslated: null,
    links: [`${SITE_ORIGIN}/user/${externalId}`],
    avatarUrl: webImage(creator.picture),
    backgroundUrl: null,
  };
}

/** A picture's own name, the site's resizing path and query left off. */
function pictureName(url: string, fallback: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || fallback;
  } catch {
    return fallback;
  }
}

/** The project's pictures: its cover first, then its gallery, each without the repeats. */
function galleryIn(project: Record<string, unknown>): { url: string; filename: string }[] {
  const cover = webImage(project.cover_web);
  const gallery = Array.isArray(project.gallery) ? project.gallery.map((item) => webImage(item)) : [];
  const seen = new Set<string>();
  return [cover, ...gallery].flatMap((url) => {
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, filename: pictureName(url, `image-${seen.size}.jpg`) }];
  });
}

/** A project's description: what its page says, and the finishing notes it keeps beside them. */
function descriptionIn(project: Record<string, unknown>): string | null {
  const parts = [
    htmlToMarkdown(asText(project.description) ?? ""),
    htmlToMarkdown(asText(project.post_processing) ?? ""),
  ].filter((part): part is string => Boolean(part));
  if (!parts.length) return null;
  return parts.length > 1 ? `${parts[0]}\n\n## Post-processing\n\n${parts[1]}` : parts[0];
}

/** A project by its slug, or by its id for a link that names it that way; null when Makerables doesn't show it. */
export async function resolveMakerablesProject(projectId: string): Promise<MakerablesModelResolution | null> {
  const by = isMakerablesProjectId(projectId) ? "id" : "slug";
  const project = asRecord(await get(`/projects?${query({ [by]: projectId })}`));
  if (!project) return null;
  const slug = asText(project.slug);
  const id = asText(project.id);
  if (!slug || !id) return null;
  const author = authorIn(project.creator);
  const gallery = galleryIn(project);
  return {
    slug,
    projectId: id,
    galleryImages: gallery,
    meta: {
      title: asText(project.name),
      description: descriptionIn(project),
      tags: recordsOf(project.tags).flatMap((tag) => {
        const name = asText(tag.name);
        return name ? [name] : [];
      }),
      previewImageUrl: gallery[0]?.url ?? null,
      creator: author?.name ?? null,
      author,
      siteCategoryIds: categoryIdsIn(project.categories),
      categorySite: PROVIDER,
    },
  };
}

/** The Model Files tab: the CAD and mesh files a project is made from, which is what Thingport imports. Its two other
 *  tabs hold the toolpaths cut from them -- NC programs and CAM projects -- which no slicer or printer takes. */
export async function fetchMakerablesModelFiles(projectId: string): Promise<MakerablesFile[]> {
  return filesIn(await get(`/projects/original-files?${query({ project_id: projectId })}`));
}

/** Its files are on its own CDN, open to anyone with the link. */
export function isMakerablesFileHost(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(manifest.endpoints.files).hostname;
}

// ---- Listings ----

export type MakerablesProjectSummary = { slug: string; title: string; cover: string | null; likes: number | null };

export type MakerablesListing = { entries: MakerablesProjectSummary[]; total: number; truncated: boolean };

function summariesIn(data: unknown): MakerablesProjectSummary[] {
  return recordsOf(data).flatMap((record) => {
    const slug = asText(record.slug);
    if (!slug) return [];
    return [
      {
        slug,
        title: asText(record.name) ?? slug,
        cover: webImage(record.cover_web),
        likes: asCount(record.likes_count),
      },
    ];
  });
}

/** One page of the saved projects of `account`, the Makerables user the sign-in belongs to. */
async function savedPage(
  account: string,
  token: string,
  page: number,
): Promise<{ entries: MakerablesProjectSummary[]; total: number }> {
  const data = asRecord(
    await get(
      `/users/favorites?${query({ id: account, category: "project", page, pageSize: SAVED_PAGE_SIZE })}`,
      token,
    ),
  );
  return {
    entries: summariesIn(data?.data),
    total: asCount(asRecord(data?.pagination)?.total) ?? 0,
  };
}

/** The user's saved projects, the first `maxItems` of them, newest save first as the site lists them. */
export async function fetchMakerablesSaved(
  account: string,
  token: string,
  maxItems: number = LISTING_MAX_ENTRIES,
): Promise<MakerablesListing> {
  const entries: MakerablesProjectSummary[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const read = await savedPage(account, token, page);
    total = read.total;
    for (const entry of read.entries) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      entries.push(entry);
    }
    if (read.entries.length < SAVED_PAGE_SIZE || entries.length >= maxItems || entries.length >= total) break;
  }
  const kept = entries.slice(0, maxItems);
  return { entries: kept, total: Math.max(total, kept.length), truncated: kept.length < total };
}

/** The saved projects as the Browse tab's card: the user's own, so there's one card. */
export async function makerablesSavedCard(account: string, token: string): Promise<ProviderCollectionCard> {
  const listing = await fetchMakerablesSaved(account, token, CARD_THUMBNAILS);
  return {
    id: makerablesSavedKey(account),
    name: MAKERABLES_SAVED_NAME,
    url: makerablesSavedUrl(account),
    modelCount: listing.total,
    thumbnails: listing.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
    // The Saved tab is the owner's own: nobody else can read it.
    private: true,
    owner: null,
  };
}

/** What a sync names the collection it keeps the saved projects in. */
export const MAKERABLES_SAVED_NAME = "Makerables saved projects";

// ---- Trending ----

/** The most-liked projects, which is what the site's own "Most liked" sort gives. */
export async function fetchMakerablesPopular(limit: number): Promise<TrendingModel[]> {
  const wanted = Math.max(1, Math.min(limit, QUERY_PAGE_SIZE));
  const data = asRecord(await get(`/projects/query?${query({ limit: wanted, sort: "popular" })}`));
  return recordsOf(data?.projects)
    .flatMap((project) => {
      const slug = asText(project.slug);
      if (!slug) return [];
      return [
        {
          id: slug,
          title: asText(project.name) ?? slug,
          url: makerablesProjectUrl(slug),
          image: webImage(project.cover_web),
          likes: asCount(project.likes_count),
          author: asText(asRecord(project.creator)?.nick_name),
          // Makerables has no paid projects: every one of them downloads for nothing.
          paid: false,
        },
      ];
    })
    .slice(0, limit);
}

// ---- The sign-in ----

/** An access token minted from the browser's session cookie, and the cookie itself where Makerables handed back a
 *  new one, which is what the caller must keep from then on. */
export type MakerablesToken = { token: string; expiresAt: Date | null; cookie: string | null };

/** The access token the API takes, from the sign-in cookie. This is the site's own call, which its pages make on
 *  every load: while the token it holds is still good it hands that one back untouched, and only once it has run out
 *  does it ask Auth0 for another and write a new session cookie, which comes back here to be kept.
 *  Throws MakerablesAuthError when the cookie no longer signs anyone in. */
export async function mintMakerablesToken(cookie: string): Promise<MakerablesToken> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  let body: Record<string, unknown> | null;
  try {
    const url = `${SITE_ORIGIN}/auth/access-token`;
    assertCredentialDestination("makerables-session", url);
    res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT, Cookie: cookie },
      // Its redirect to the sign-in page is an answer, not a hop to follow: followed, it would come back as the
      // page's HTML and read as a sign-in it won't take.
      redirect: "manual",
      signal: controller.signal,
    });
    // Inside the timeout: a body that never arrives would otherwise hang past it.
    body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 429) throw new MakerablesRateLimitError();
  // Only these say the cookie itself is no good: it answers one it won't take with a 401, and one it can't read at
  // all with a redirect to its sign-in. Anything else -- a 5xx, a block, an error page -- is the site being unwell,
  // and must not be read as a refusal, or an outage would mark every user's sign-in expired.
  if (res.status === 401 || (res.status >= 300 && res.status < 400)) throw new MakerablesAuthError();
  const token = body && asText(body.token);
  if (!token) throw new Error(`Makerables didn't hand over an access token (HTTP ${res.status})`);
  const expires = asCount(body!.expires_at);
  return {
    token,
    expiresAt: expires ? new Date(expires * 1000) : null,
    cookie: sessionCookieIn(res.headers.getSetCookie()),
  };
}

/** The session cookie a response set, as a Cookie header; null when it set none, which is its usual answer. A chunk
 *  it cleared is left out, so a sign-in that shrank to fewer chunks doesn't keep the ones it dropped. */
function sessionCookieIn(setCookies: readonly string[]): string | null {
  const pairs = setCookies.flatMap((header) => {
    const [name, ...rest] = (header.split(";", 1)[0] ?? "").trim().split("=");
    const value = rest.join("=");
    return name.startsWith(SESSION_COOKIE_PREFIX) && value ? [`${name}=${value}`] : [];
  });
  return pairs.length ? pairs.join("; ") : null;
}

/** Who the sign-in belongs to on Makerables: their user id, which their saved projects are read by, and the name
 *  their account shows. */
export type MakerablesAccount = { userId: string; name: string | null };

/** Whose sign-in a token is, or null when Makerables doesn't say. Throws MakerablesAuthError for one it turned down. */
export async function fetchMakerablesAccount(token: string): Promise<MakerablesAccount | null> {
  const me = asRecord(await get("/users/me", token));
  const userId = me && asText(me.id);
  return userId ? { userId, name: asText(me.nick_name) ?? asText(me.full_name) } : null;
}
