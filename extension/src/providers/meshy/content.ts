// What a Meshy post's page knows of whether the signed-in account may download it, asked as the page asks: Meshy keeps
// community models for its Pro and Studio plans, and says so for each model before its Download button is shown.

import { MANIFESTS } from "../index.generated";
import { meshyChunkIndex, meshySessionOf } from "./cookie";
import { parseMeshyPostUrl } from "./urls.generated";

const { meshy } = MANIFESTS;
const API = `${location.origin}/meshyd-api/web`;

function cookie(name: string): string | null {
  const pair = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

/** The page's own access token, from the sign-in cookie its Supabase client keeps fresh; null when signed out or when
 *  it has run out, which only the page renews. */
function accessToken(): string | null {
  const prefix = meshy.sessionCookies.session;
  const chunks = document.cookie
    .split("; ")
    .map((part) => part.split("="))
    .filter(([name]) => name === prefix || name?.startsWith(`${prefix}.`))
    .toSorted(([a], [b]) => meshyChunkIndex(a) - meshyChunkIndex(b))
    .map(([, ...value]) => value.join("="));
  const session = chunks.length ? meshySessionOf(chunks.join("")) : null;
  const fresh = typeof session?.expires_at === "number" && session.expires_at * 1000 > Date.now();
  return typeof session?.access_token === "string" && fresh ? session.access_token : null;
}

async function getJson(path: string, token: string | null): Promise<Record<string, unknown> | null> {
  const deviceId = cookie(meshy.sessionCookies.device);
  // The panel waits on this to show the import button, so an answer that stalls doesn't block either.
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "X-Device-Id": deviceId } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

/** A community post the signed-in account's plan can't download, by what Meshy says of its first model. Only a
 *  signed-in answer can tell; anything else never blocks. */
export async function isMeshyPlanLocked(url: string): Promise<boolean> {
  const postId = parseMeshyPostUrl(url)?.postId;
  const token = accessToken();
  if (!postId || !token) return false;
  try {
    const post = (await getJson(`/public/community/posts/${postId}`, null))?.result as
      { items?: { kind?: unknown; refId?: unknown }[] } | undefined;
    const taskId = post?.items?.find((item) => item.kind === "model" && typeof item.refId === "string")?.refId;
    if (typeof taskId !== "string") return false;
    const status = (await getJson(`/v2/tasks/${taskId}/downloadable-status?type=Showcase`, token))?.result as
      { downloadableStatus?: unknown } | undefined;
    return status?.downloadableStatus === "Forbidden";
  } catch {
    return false;
  }
}
