// What a Meshy post's or collection's page knows of whether the signed-in account may download its models, asked as
// the page asks: Meshy keeps community models for its Pro and Studio plans, and says so for each model before its
// Download button is shown. It judges a model by what it's asked as, so the user's own post is asked of as their
// generation.

import { MANIFESTS } from "../index.generated";
import { meshyChunkIndex, meshySessionOf } from "./cookie";
import { parseMeshyCollectionUrl, parseMeshyPostUrl } from "./urls.generated";

const { meshy } = MANIFESTS;

function cookie(name: string): string | null {
  const pair = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/** The page's own access token, from the sign-in cookie its Supabase client keeps fresh, and whose it is; null when
 *  signed out or when it has run out, which only the page renews. */
function signIn(): { token: string; userId: string | null } | null {
  const prefix = meshy.sessionCookies.session;
  const chunks = document.cookie
    .split("; ")
    .map((part) => part.split("="))
    .filter(([name]) => name === prefix || name?.startsWith(`${prefix}.`))
    .toSorted(([a], [b]) => meshyChunkIndex(a) - meshyChunkIndex(b))
    .map(([, ...value]) => value.join("="));
  const session = chunks.length ? meshySessionOf(chunks.join("")) : null;
  const fresh = typeof session?.expires_at === "number" && session.expires_at * 1000 > Date.now();
  if (typeof session?.access_token !== "string" || !fresh) return null;
  return { token: session.access_token, userId: typeof session.user?.id === "string" ? session.user.id : null };
}

async function getJson(path: string, token: string | null): Promise<Record<string, unknown> | null> {
  const deviceId = cookie(meshy.sessionCookies.device);
  // The panel waits on this to show the import button, so an answer that stalls doesn't block either.
  const res = await fetch(`${location.origin}/meshyd-api/web${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "X-Device-Id": deviceId } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

export type MeshyPlanLock = "community" | "own";

type Session = NonNullable<ReturnType<typeof signIn>>;
type Item = { kind?: unknown; refId?: unknown };
type Post = { id?: unknown; author?: { id?: unknown }; items?: Item[]; coverItem?: Item };

// The plans Meshy's pages ask a model's download status for; any other downloads every model, so they don't ask.
const ASKED_TIERS = new Set(["free", "starter"]);
// A collection's posts are read 100 at a time, as many as the instance lists.
const PAGE_SIZE = 100;
const MAX_PAGES = 6;
const CHECKS_AT_ONCE = 4;

/** The account's plan ("free", "pro", …); null when Meshy doesn't say. */
async function tierOf(session: Session): Promise<string | null> {
  const tier = ((await getJson("/v1/me/tier", session.token))?.result as { tier?: unknown } | undefined)?.tier;
  return typeof tier === "string" ? tier : null;
}

const modelOf = (items: Item[] | undefined): string | null => {
  const refId = items?.find((item) => item.kind === "model" && typeof item.refId === "string")?.refId;
  return typeof refId === "string" ? refId : null;
};

/** Whose post the signed-in account's plan can't download, by what Meshy says of its first model: "community" for
 *  someone else's, "own" for the user's own, which Meshy judges as their generation, as Thingport imports it. */
async function postLock(post: Post, session: Session): Promise<MeshyPlanLock | null> {
  // A listed post carries only its cover, which may be a picture; the post itself has the rest.
  const taskId =
    modelOf(post.items ?? (post.coverItem ? [post.coverItem] : undefined)) ??
    modelOf(((await getJson(`/public/community/posts/${post.id}`, null))?.result as Post | undefined)?.items);
  if (!taskId) return null;
  const own = Boolean(session.userId) && post.author?.id === session.userId;
  const type = own ? "Task" : "Showcase";
  const status = (await getJson(`/v2/tasks/${taskId}/downloadable-status?type=${type}`, session.token))?.result as
    { downloadableStatus?: unknown } | undefined;
  if (status?.downloadableStatus !== "Forbidden") return null;
  return own ? "own" : "community";
}

/** Why the signed-in account's plan can't download the post on this page. Only a signed-in answer can tell; anything
 *  else never blocks. */
export async function meshyPlanLock(url: string): Promise<MeshyPlanLock | null> {
  const postId = parseMeshyPostUrl(url)?.postId;
  const session = signIn();
  if (!postId || !session) return null;
  try {
    if (!ASKED_TIERS.has((await tierOf(session)) ?? "")) return null;
    const post = (await getJson(`/public/community/posts/${postId}`, null))?.result as Post | undefined;
    return post ? await postLock(post, session) : null;
  } catch {
    return null;
  }
}

/** The posts of the collection on this page that the signed-in account's plan can't download, by id. A free plan is
 *  kept from every other person's community model -- over forty asked, featured or not, all said so -- so only the
 *  user's own posts are asked of. Those it can't tell of are left out. */
export async function meshyCollectionLocks(url: string): Promise<Map<string, MeshyPlanLock>> {
  const locks = new Map<string, MeshyPlanLock>();
  const collectionId = parseMeshyCollectionUrl(url)?.collectionId;
  const session = signIn();
  if (!collectionId || !session) return locks;
  try {
    const tier = await tierOf(session);
    if (!ASKED_TIERS.has(tier ?? "")) return locks;
    const own: Post[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const path = `/public/community/posts?communityCollectionId=${collectionId}&pageNum=${page}&pageSize=${PAGE_SIZE}`;
      const posts = (await getJson(path, null))?.result;
      if (!Array.isArray(posts)) break;
      for (const post of posts as Post[]) {
        if (typeof post.id !== "string") continue;
        if (session.userId && post.author?.id === session.userId) own.push(post);
        // Starter's community downloads are counted, not kept from it.
        else if (tier === "free") locks.set(post.id, "community");
      }
      if (posts.length < PAGE_SIZE) break;
    }
    for (let i = 0; i < own.length; i += CHECKS_AT_ONCE) {
      const batch = own.slice(i, i + CHECKS_AT_ONCE);
      const found = await Promise.all(batch.map((post) => postLock(post, session).catch(() => null)));
      batch.forEach((post, index) => {
        const lock = found[index];
        if (lock) locks.set(post.id as string, lock);
      });
    }
  } catch {
    // What was told before stays told.
  }
  return locks;
}
