// Printables' API, asked as the signed-in user from a printables.com page, the way the site itself
// does: its CORS rules allow this page's origin, and the token is the user's own session. Reads
// what Printables shows its owner only: private collections and likes (see background/
// providerAccounts.ts for where it goes).

import type { PrintablesPush, PrintablesPushPlan } from "../../shared/messages";
import { request } from "../../shared/messages";
import { sleep } from "../../content/runtime";
import { MANIFESTS } from "../index.generated";

const { graphql: GRAPHQL_URL, media: MEDIA_BASE } = MANIFESTS.printables.endpoints;
const PAGE_SIZE = 30;
// Safety caps against a cursor that never ends, and a pause between pages for Printables' throttling.
const MAX_PAGES = 20;
const PAGE_DELAY_MS = 1000;
const CARD_THUMBNAILS = 3;

type Me = { id: string; handle: string };

async function graphql(token: string, query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const res = await providerCredentialRequest("printables-api", GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Printables answered HTTP ${res.status}`);
  const body = (await res.json()) as { data?: unknown; errors?: unknown };
  if (!body.data) throw new Error("Printables answered without data");
  return body.data;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function mediaUrl(image: unknown): string | null {
  const filePath = record(image)?.filePath;
  return typeof filePath === "string" && filePath ? `${MEDIA_BASE}${filePath}` : null;
}

/** The session token. HttpOnly, so the background reads it; null while signed out. */
export async function printablesToken(): Promise<string | null> {
  return request("GET_PRINTABLES_TOKEN").catch(() => null);
}

export async function readMe(token: string): Promise<Me | null> {
  const me = record(record(await graphql(token, "query { me { id handle } }"))?.me);
  return me && me.id != null && typeof me.handle === "string" ? { id: String(me.id), handle: me.handle } : null;
}

/** Every page of a cursor-paged list, as the site's own "load more" walks it. The last page ends
 *  with an empty cursor. */
async function allPages(
  token: string,
  query: string,
  field: string,
  variables: Record<string, unknown>,
): Promise<{ items: Record<string, unknown>[]; truncated: boolean }> {
  const items: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    if (page) await sleep(PAGE_DELAY_MS);
    const node = record(record(await graphql(token, query, { ...variables, limit: PAGE_SIZE, cursor }))?.[field]);
    const pageItems = (Array.isArray(node?.items) ? (node.items as unknown[]) : []).flatMap((item) => {
      const found = record(item);
      return found ? [found] : [];
    });
    items.push(...pageItems);
    const next = node?.cursor;
    if (!pageItems.length || typeof next !== "string" || !next) return { items, truncated: false };
    cursor = next;
  }
  // Read further, a visit would run into Printables' throttling.
  return { items, truncated: true };
}

/** A list cut short at the cap leaves its later models out of syncs, so say so where it can be seen. */
function warnTruncated(label: string): void {
  console.warn(`[Thingport Grab] Only the first ${MAX_PAGES * PAGE_SIZE} of your Printables ${label} were read.`);
}

const COLLECTIONS_QUERY = `query ($userId: ID!) {
  userCollections(userId: $userId) { id name private printsCount thumbnails11 { image { filePath } } }
}`;

const LIKES_QUERY = `query ($likedUserId: ID!, $limit: Int, $cursor: String) {
  moreLikedPrints2(likedUserId: $likedUserId, limit: $limit, cursor: $cursor, includeDeleted: false, printType: all, query: "") {
    items { id }
    cursor
  }
}`;

// Liked items are a print interface with no image field, so a few pictures are looked up per model.
const MODEL_IMAGE_QUERY = `query ($id: ID!) { print(id: $id) { image { filePath } } }`;

const COLLECTION_MODELS_QUERY = `query ($collectionId: ID!, $limit: Int, $cursor: String) {
  moreCollectionModels(collectionId: $collectionId, limit: $limit, cursor: $cursor, ordering: added_to_collection) {
    items { model: print { id name } }
    cursor
  }
}`;
const COLLECTION_TITLE_QUERY = `query ($id: ID!) { collection(id: $id) { name } }`;

/** A collection's name and models as its signed-in owner sees them, private ones included, for the
 *  import panel: the instance itself only sees public collections. */
export async function readCollectionForPanel(
  token: string,
  collectionId: string,
): Promise<{ title: string | null; entries: { id: string; title: string }[]; truncated: boolean }> {
  const name = record(record(await graphql(token, COLLECTION_TITLE_QUERY, { id: collectionId }))?.collection)?.name;
  const { items, truncated } = await allPages(token, COLLECTION_MODELS_QUERY, "moreCollectionModels", {
    collectionId,
  });
  const entries = items.flatMap((item) => {
    const model = record(item.model);
    if (!model || model.id == null) return [];
    return [{ id: String(model.id), title: typeof model.name === "string" ? model.name : `Model ${model.id}` }];
  });
  return { title: typeof name === "string" && name ? name : null, entries, truncated };
}

async function readCollections(token: string, me: Me): Promise<PrintablesPush["collections"]> {
  const listed = record(await graphql(token, COLLECTIONS_QUERY, { userId: me.id }))?.userCollections;
  if (!Array.isArray(listed)) throw new Error("no collections in the answer");
  return listed.flatMap((value) => {
    const c = record(value);
    if (!c || c.id == null) return [];
    const thumbnails = (Array.isArray(c.thumbnails11) ? c.thumbnails11 : [])
      .flatMap((t) => mediaUrl(record(t)?.image) ?? [])
      .slice(0, CARD_THUMBNAILS);
    return [
      {
        id: String(c.id),
        name: typeof c.name === "string" ? c.name : `Collection ${c.id}`,
        model_count: typeof c.printsCount === "number" ? c.printsCount : 0,
        thumbnails,
        private: c.private === true,
      },
    ];
  });
}

async function readLikes(token: string, me: Me): Promise<NonNullable<PrintablesPush["likes"]>> {
  const { items: liked, truncated } = await allPages(token, LIKES_QUERY, "moreLikedPrints2", { likedUserId: me.id });
  if (truncated) warnTruncated("likes");
  const ids = liked.flatMap((item) => (item.id != null ? [String(item.id)] : []));
  const thumbnails: string[] = [];
  for (const id of ids.slice(0, CARD_THUMBNAILS)) {
    const url = await graphql(token, MODEL_IMAGE_QUERY, { id })
      .then((data) => mediaUrl(record(record(data)?.print)?.image))
      .catch(() => null);
    if (url) thumbnails.push(url);
  }
  return { ids, thumbnails, model_count: ids.length };
}

async function readCollectionModels(token: string, collectionId: string): Promise<string[]> {
  const { items, truncated } = await allPages(token, COLLECTION_MODELS_QUERY, "moreCollectionModels", { collectionId });
  if (truncated) warnTruncated(`collection ${collectionId}'s models`);
  return items.flatMap((item) => {
    const id = record(item.model)?.id;
    return id != null ? [String(id)] : [];
  });
}

/** Each part on its own, so one Printables refuses doesn't keep the others from Thingport. A part
 *  left out keeps what the instance last had. Logged to the page's console, the only place a
 *  content script can say what went wrong. */
async function part<T>(label: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[Thingport Grab] Couldn't read your Printables ${label}:`, err);
    return undefined;
  }
}

export async function readPrintables(token: string, me: Me, plan: PrintablesPushPlan): Promise<PrintablesPush> {
  const { wanted } = plan;
  const collections = await part("collections", () => readCollections(token, me));
  const likes = plan.likes ? await part("likes", () => readLikes(token, me)) : undefined;
  const listings: Record<string, string[]> = {};
  // The instance asks for a few per visit, the stalest first (see wantedPrintablesListings).
  for (const collectionId of wanted.filter((key) => /^\d+$/.test(key))) {
    const ids = await part(`collection ${collectionId}`, () => readCollectionModels(token, collectionId));
    if (ids) listings[collectionId] = ids;
  }
  return { user: me, collections, likes, listings };
}

// The token lasts minutes; the site renews an expired one only after it loads, so it's asked for again.
const TOKEN_WAIT_MS = 30_000;
const TOKEN_POLL_MS = 2_000;

/** Reads and sends what only the user sees on Printables, when it's time (or `now`). */
async function pushPrintables(
  token: string,
  me: { id: string; handle: string },
  { now = false, listings = {} }: { now?: boolean; listings?: Record<string, string[]> } = {},
): Promise<void> {
  try {
    const plan = await request("PRINTABLES_PUSH_DUE", { now });
    if (!plan) return;
    const push = await readPrintables(token, me, plan);
    await request("PUSH_PRINTABLES", { ...push, listings: { ...push.listings, ...listings } });
  } catch {}
}

/** Right away, with the models of a collection whose sync was just turned on on its page: the
 *  instance can't have asked for them yet, and would otherwise wait for the next visit to read it. */
export async function pushPrintablesNow(collectionId: string, modelIds: string[]): Promise<void> {
  const token = await printablesToken();
  const me = token ? await readMe(token).catch(() => null) : null;
  if (token && me) await pushPrintables(token, me, { now: true, listings: { [collectionId]: modelIds } });
}

/** At most hourly, what only the signed-in user sees on Printables: private collections and likes,
 *  for syncing them (above). The push names the account too: reported on its own, it
 *  would link an account the user forgot in the app again. */
export async function syncPrintables(): Promise<void> {
  // The token lasts minutes; the site renews an expired one only after it loads, so keep asking.
  for (let waited = 0; waited < TOKEN_WAIT_MS; waited += TOKEN_POLL_MS) {
    const token = await printablesToken();
    const me = token ? await readMe(token).catch(() => null) : null;
    if (token && me) return pushPrintables(token, me);
    await sleep(TOKEN_POLL_MS);
  }
}
