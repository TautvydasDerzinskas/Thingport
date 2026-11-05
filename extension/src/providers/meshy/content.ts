// What a Meshy post's page knows of whether the signed-in account may download it, asked as the page asks: Meshy keeps
// community models for its Pro and Studio plans, and says so for each model before its Download button is shown. It
// judges a model by what it's asked as, so the user's own post is asked of as their generation. A collection's models
// are marked by the instance, which reads the list.

import { MANIFESTS } from "../index.generated";
import { meshyChunkIndex, meshySessionOf } from "./cookie";
import { parseMeshyPostUrl } from "./urls.generated";

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

// The plans Meshy's pages ask a model's download status for; any other downloads every model, so they don't ask.
const ASKED_TIERS = new Set(["free", "starter"]);

/** The account's plan ("free", "pro", …); null when Meshy doesn't say. */
async function tierOf(token: string): Promise<string | null> {
  const tier = ((await getJson("/v1/me/tier", token))?.result as { tier?: unknown } | undefined)?.tier;
  return typeof tier === "string" ? tier : null;
}

/** Whose post the signed-in account's plan can't download, by what Meshy says of its first model: "community" for
 *  someone else's, "own" for the user's own, which Meshy judges as their generation, as Thingport imports it. Only a
 *  signed-in answer can tell; anything else never blocks. */
export async function meshyPlanLock(url: string): Promise<MeshyPlanLock | null> {
  const postId = parseMeshyPostUrl(url)?.postId;
  const session = signIn();
  if (!postId || !session) return null;
  try {
    if (!ASKED_TIERS.has((await tierOf(session.token)) ?? "")) return null;
    const post = (await getJson(`/public/community/posts/${postId}`, null))?.result as
      { author?: { id?: unknown }; items?: { kind?: unknown; refId?: unknown }[] } | undefined;
    const taskId = post?.items?.find((item) => item.kind === "model" && typeof item.refId === "string")?.refId;
    if (typeof taskId !== "string") return null;
    const own = Boolean(session.userId) && post?.author?.id === session.userId;
    const type = own ? "Task" : "Showcase";
    const status = (await getJson(`/v2/tasks/${taskId}/downloadable-status?type=${type}`, session.token))?.result as
      { downloadableStatus?: unknown } | undefined;
    if (status?.downloadableStatus !== "Forbidden") return null;
    return own ? "own" : "community";
  } catch {
    return null;
  }
}
