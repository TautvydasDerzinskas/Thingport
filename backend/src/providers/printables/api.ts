import { IMPORT_BROWSER_USER_AGENT, IMPORT_HTML_MAX_BYTES, IMPORT_TIMEOUT_SECONDS } from "../../config";
import { HttpError } from "../../utils/fileUtils";
import { type ImportedAuthorInfo, type ImportedPageMetadata } from "../../services/importResolvers";
import { htmlToMarkdown } from "../../services/descriptionMarkdown";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { asCount, asRecord, asText, recordsOf, type TrendingModel } from "../../services/trendingModel";
export {
  parsePrintablesCollectionUrl,
  parsePrintablesLikesUrl,
  parsePrintablesModelUrl,
} from "../_generated/printables/urls";

// Unlike Cloudflare-gated www.printables.com, the GraphQL API answers unauthenticated requests.
const PRINTABLES_GRAPHQL_URL = "https://api.printables.com/graphql/";
const PRINTABLES_MEDIA_BASE = "https://media.printables.com/";
const API_TIMEOUT_MS = IMPORT_TIMEOUT_SECONDS * 1000;
const PRINTABLES_PROVIDER = "printables";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mediaUrl(filePath: unknown): string | null {
  return typeof filePath === "string" && filePath.trim() ? `${PRINTABLES_MEDIA_BASE}${filePath.trim()}` : null;
}

async function fetchPrintablesGraphql(query: string, variables: Record<string, unknown>): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(PRINTABLES_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "User-Agent": IMPORT_BROWSER_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.printables.com",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  if (res.status === 429) throw new HttpError(429, "Printables rate-limited this request. Wait a bit and try again.");
  if (!res.ok) return null;
  if (text.length > IMPORT_HTML_MAX_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parsePrintablesErrorMessages(errors: unknown): string | null {
  if (!Array.isArray(errors)) return null;
  const messages: string[] = [];
  for (const err of errors) {
    if (!err || typeof err !== "object") continue;
    const values = (err as Record<string, unknown>).messages;
    if (Array.isArray(values)) {
      for (const v of values) if (typeof v === "string" && v.trim()) messages.push(v.trim());
    }
  }
  return messages.length ? messages.join(", ") : null;
}

const MODEL_QUERY = `
  query ($id: ID!) {
    print(id: $id) {
      id
      name
      description
      user { id handle publicUsername avatarFilePath }
      image { filePath }
      images { filePath }
      tags { name }
      category { id name }
      stls { id name }
    }
  }
`;

const DOWNLOAD_LINK_MUTATION = `
  mutation ($printId: ID!, $source: DownloadSourceEnum!, $files: [DownloadFileInput!]) {
    getDownloadLink(printId: $printId, source: $source, files: $files) {
      ok
      errors { field messages code }
      output { files { id link } }
    }
  }
`;

function extractAuthor(user: Record<string, unknown>): ImportedAuthorInfo | null {
  const externalId = user.id != null ? String(user.id) : null;
  if (!externalId) return null;
  const handle = typeof user.handle === "string" && user.handle.trim() ? user.handle.trim() : null;
  const name =
    (typeof user.publicUsername === "string" && user.publicUsername.trim() && user.publicUsername.trim()) || handle;
  return {
    provider: PRINTABLES_PROVIDER,
    externalId,
    name,
    handle,
    bio: null,
    bioTranslated: null,
    links: handle ? [`https://www.printables.com/@${handle}`] : [],
    avatarUrl: mediaUrl(user.avatarFilePath),
    backgroundUrl: null,
  };
}

export type PrintablesPlateFile = { name: string; id: string };
export type PrintablesGalleryImage = { name: string; url: string };

export type PrintablesModelResolution = {
  meta: Partial<ImportedPageMetadata>;
  /** From the `stls` bucket, which holds every model-file type despite its name. Pre-sliced
   * gcodes/slas are excluded. Download links are resolved separately. */
  plateFiles: PrintablesPlateFile[];
  /** Includes the cover image. */
  galleryImages: PrintablesGalleryImage[];
};

/** Null for a model that doesn't exist or isn't public. */
export async function resolvePrintablesModel(modelId: string): Promise<PrintablesModelResolution | null> {
  const data = (await fetchPrintablesGraphql(MODEL_QUERY, { id: modelId })) as {
    data?: { print?: Record<string, unknown> };
  } | null;
  const model = data?.data?.print;
  if (!isRecord(model)) return null;

  const meta: Partial<ImportedPageMetadata> = {};
  if (typeof model.name === "string" && model.name.trim()) meta.title = model.name.trim();
  if (typeof model.description === "string" && model.description.trim()) {
    const markdown = htmlToMarkdown(model.description);
    if (markdown) meta.description = markdown;
  }
  if (Array.isArray(model.tags)) {
    const tags = model.tags
      .map((t) => (isRecord(t) && typeof t.name === "string" ? t.name.trim() : null))
      .filter((t): t is string => Boolean(t));
    if (tags.length) meta.tags = tags;
  }

  const cover = isRecord(model.image) ? mediaUrl(model.image.filePath) : null;
  if (cover) meta.previewImageUrl = cover;
  const galleryImages: PrintablesGalleryImage[] = Array.isArray(model.images)
    ? model.images
        .map((img, idx) => (isRecord(img) ? { name: `image-${idx}.jpg`, url: mediaUrl(img.filePath) } : null))
        .filter((img): img is PrintablesGalleryImage & { url: string } => Boolean(img?.url))
    : [];

  if (isRecord(model.user)) {
    const author = extractAuthor(model.user);
    if (author) {
      meta.author = author;
      meta.creator = author.name;
    }
  }

  if (isRecord(model.category) && model.category.id != null) {
    const categoryId = Number(model.category.id);
    if (Number.isFinite(categoryId)) {
      meta.siteCategoryIds = [categoryId];
      meta.categorySite = PRINTABLES_PROVIDER;
    }
  }

  const plateFiles: PrintablesPlateFile[] = Array.isArray(model.stls)
    ? model.stls
        .filter((f): f is Record<string, unknown> => isRecord(f) && typeof f.name === "string" && f.id != null)
        .map((f) => ({ name: f.name as string, id: String(f.id) }))
    : [];

  return { meta, plateFiles, galleryImages };
}

/** Printables has no static file URLs; every download goes through this mutation. A file missing
 * from the response is skipped. */
export async function resolvePrintablesDownloadLinks(modelId: string, fileIds: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  if (!fileIds.length) return links;

  const data = (await fetchPrintablesGraphql(DOWNLOAD_LINK_MUTATION, {
    printId: modelId,
    source: "model_detail",
    files: [{ fileType: "stl", ids: fileIds }],
  })) as { data?: { getDownloadLink?: Record<string, unknown> } } | null;

  const result = data?.data?.getDownloadLink;
  if (!isRecord(result)) return links;
  if (result.ok === false) {
    const message = parsePrintablesErrorMessages(result.errors);
    throw new HttpError(400, message || "Printables rejected the download request");
  }
  const output = result.output;
  const files = isRecord(output) ? output.files : null;
  if (Array.isArray(files)) {
    for (const entry of files) {
      if (isRecord(entry) && entry.id != null && typeof entry.link === "string" && entry.link.trim()) {
        links.set(String(entry.id), entry.link.trim());
      }
    }
  }
  return links;
}

export type PrintablesCollectionEntry = { modelId: string; title: string; cover: string | null };

/** Thumbnail listings have no name, only a slug. */
function titleFromSlug(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  if (!words.length) return slug;
  return (
    words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "")
  );
}

const COLLECTION_TITLE_QUERY = `query ($id: ID!) { collection(id: $id) { id name } }`;

export async function fetchPrintablesCollectionTitle(collectionId: string): Promise<string | null> {
  const data = (await fetchPrintablesGraphql(COLLECTION_TITLE_QUERY, { id: collectionId })) as {
    data?: { collection?: Record<string, unknown> };
  } | null;
  const name = data?.data?.collection?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

// How a GraphQL resolver says "no such object", e.g. Django's "Collection matching query does not
// exist." or a "not_found" code. Throttling and other errors don't match.
const NOT_FOUND_ERROR = /not[\s_-]?found|does ?n[o']t exist/i;

/** For a sync: null when Printables answers that the collection doesn't exist, as `collection: null`
 * alone or alongside a not-found error. Throws when there's no clear answer, so an outage is never
 * taken for a deleted collection. */
export async function checkPrintablesCollection(collectionId: string): Promise<{ title: string | null } | null> {
  const data = await fetchPrintablesGraphql(COLLECTION_TITLE_QUERY, { id: collectionId });
  const payload = isRecord(data) && isRecord(data.data) ? data.data : null;
  const errors = isRecord(data) && Array.isArray(data.errors) ? data.errors : [];
  const notFound =
    errors.length > 0 &&
    errors.every((err) => isRecord(err) && typeof err.message === "string" && NOT_FOUND_ERROR.test(err.message));
  if (!payload || !("collection" in payload) || (errors.length && !notFound)) {
    throw new Error("Couldn't read the Printables collection");
  }
  const collection = payload.collection;
  if (collection === null) return null;
  const name = isRecord(collection) ? collection.name : null;
  return { title: typeof name === "string" && name.trim() ? name.trim() : null };
}

// The site's own "load more" query. The last page ends with an empty-string cursor, not null --
// a `cursor == null` check restarts from page 1 forever.
const COLLECTION_MODELS_QUERY = `
  query CollectionModels($collectionId: ID!, $limit: Int, $cursor: String, $ordering: CollectionPrintsOrderingEnum) {
    moreCollectionModels(limit: $limit, cursor: $cursor, collectionId: $collectionId, ordering: $ordering) {
      items {
        id
        model: print { id name slug image { filePath } }
      }
      cursor
    }
  }
`;

const COLLECTION_PAGE_SIZE = 30;
const COLLECTION_MAX_PAGES = 20;
const COLLECTION_MAX_ENTRIES = 600;

/** The caps are a safety net against a non-terminating cursor. Items for deleted/hidden models
 * are skipped. */
async function fetchAllPrintablesCollectionModels(collectionId: string): Promise<PrintablesCollectionEntry[]> {
  const found = new Map<string, PrintablesCollectionEntry>();
  let cursor: string | null = null;
  for (let page = 0; page < COLLECTION_MAX_PAGES && found.size < COLLECTION_MAX_ENTRIES; page++) {
    const data = (await fetchPrintablesGraphql(COLLECTION_MODELS_QUERY, {
      collectionId,
      limit: COLLECTION_PAGE_SIZE,
      cursor,
      ordering: "added_to_collection",
    })) as { data?: { moreCollectionModels?: { items?: unknown[]; cursor?: string | null } } } | null;
    const node = data?.data?.moreCollectionModels;
    const items = Array.isArray(node?.items) ? node.items : [];
    if (!items.length) break;

    for (const item of items) {
      if (found.size >= COLLECTION_MAX_ENTRIES) break;
      if (!isRecord(item) || !isRecord(item.model)) continue;
      const model = item.model;
      if (model.id == null || typeof model.slug !== "string" || !model.slug.trim()) continue;
      const modelId = String(model.id);
      if (found.has(modelId)) continue;
      const cover = isRecord(model.image) ? mediaUrl(model.image.filePath) : null;
      found.set(modelId, { modelId, title: titleFromSlug(model.slug.trim()), cover });
    }

    const nextCursor = node?.cursor;
    if (!nextCursor) break; // empty string or null/undefined both mean "no more pages"
    cursor = nextCursor;
  }
  return Array.from(found.values());
}

/** `truncated` only when the safety caps were hit. */
export async function fetchPrintablesCollectionEntries(
  collectionId: string,
): Promise<{ title: string | null; entries: PrintablesCollectionEntry[]; total: number; truncated: boolean }> {
  const [title, entries] = await Promise.all([
    fetchPrintablesCollectionTitle(collectionId),
    fetchAllPrintablesCollectionModels(collectionId),
  ]);
  return { title, entries, total: entries.length, truncated: entries.length >= COLLECTION_MAX_ENTRIES };
}

const COLLECTION_CARD_FIELDS = "id name private printsCount user { handle } thumbnails11 { image { filePath } }";
const USER_QUERY = `query ($id: ID!) { user(id: $id) { id handle publicUsername } }`;
const USER_COLLECTIONS_QUERY = `query ($userId: ID!) { collections: userCollections(userId: $userId) { ${COLLECTION_CARD_FIELDS} } }`;
const COLLECTION_CARD_QUERY = `query ($id: ID!) { collection(id: $id) { ${COLLECTION_CARD_FIELDS} } }`;

export type PrintablesUser = { id: string; handle: string; name: string | null };

/** A profile link, "@handle", a handle or a numeric id. Null when Printables knows no such user. */
export async function resolvePrintablesUser(input: string): Promise<PrintablesUser | null> {
  let value = input.trim();
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host !== "printables.com" && host !== "www.printables.com") return null;
    value = url.pathname.match(/^\/(?:[a-z]{2}\/)?@([^/]+)/i)?.[1] ?? "";
  } catch {
    // Not a link.
  }
  value = value.replace(/^@/, "");
  if (!value) return null;
  // `user(id:)` takes "@handle" as well as the id; a bare handle is an error.
  const data = await fetchPrintablesGraphql(USER_QUERY, { id: /^\d+$/.test(value) ? value : `@${value}` });
  const user = isRecord(data) && isRecord(data.data) && isRecord(data.data.user) ? data.data.user : null;
  if (!user || user.id == null || typeof user.handle !== "string") return null;
  const name =
    typeof user.publicUsername === "string" && user.publicUsername.trim() ? user.publicUsername.trim() : null;
  return { id: String(user.id), handle: user.handle, name };
}

function collectionCard(value: unknown): ProviderCollectionCard | null {
  if (!isRecord(value) || value.id == null) return null;
  const id = String(value.id);
  const owner = isRecord(value.user) && typeof value.user.handle === "string" ? value.user.handle : null;
  const thumbnails = Array.isArray(value.thumbnails11)
    ? value.thumbnails11.flatMap((t) => {
        const url = isRecord(t) && isRecord(t.image) ? mediaUrl(t.image.filePath) : null;
        return url ? [url] : [];
      })
    : [];
  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Collection ${id}`,
    url: owner
      ? `https://www.printables.com/@${encodeURIComponent(owner)}/collections/${id}`
      : `https://www.printables.com/collections/${id}`,
    modelCount: typeof value.printsCount === "number" ? value.printsCount : 0,
    thumbnails,
    private: value.private === true,
    owner,
  };
}

/** Public ones only: Printables shows a user's private collections to them alone. */
export async function listPrintablesUserCollections(userId: string): Promise<ProviderCollectionCard[]> {
  const data = await fetchPrintablesGraphql(USER_COLLECTIONS_QUERY, { userId });
  const list = isRecord(data) && isRecord(data.data) ? data.data.collections : null;
  if (!Array.isArray(list)) throw new HttpError(502, "Couldn't load your Printables collections");
  return list.flatMap((item) => {
    const card = collectionCard(item);
    return card ? [card] : [];
  });
}

export async function fetchPrintablesCollectionCard(collectionId: string): Promise<ProviderCollectionCard | null> {
  const data = await fetchPrintablesGraphql(COLLECTION_CARD_QUERY, { id: collectionId });
  return collectionCard(isRecord(data) && isRecord(data.data) ? data.data.collection : null);
}

/** Printables' trending models, as its own "Trending" sort lists them. Public; no sign-in. */
export async function fetchPrintablesTrending(limit: number): Promise<TrendingModel[]> {
  // The whole response; the list is under `data`.
  const body = asRecord(
    await fetchPrintablesGraphql(
      `query ($limit: Int!) {
        morePrints(limit: $limit, ordering: "trending") {
          items { id name slug likesCount image { filePath } user { publicUsername } }
        }
      }`,
      { limit },
    ),
  );
  if (!body) throw new Error("Printables didn't answer");
  return recordsOf(asRecord(asRecord(body.data)?.morePrints)?.items).flatMap((item) => {
    const id = asText(item.id);
    if (!id) return [];
    const slug = asText(item.slug);
    return [
      {
        id,
        title: asText(item.name) ?? id,
        url: `https://www.printables.com/model/${id}${slug ? `-${slug}` : ""}`,
        image: mediaUrl(asRecord(item.image)?.filePath),
        likes: asCount(item.likesCount),
        author: asText(asRecord(item.user)?.publicUsername),
        paid: false,
      },
    ];
  });
}
