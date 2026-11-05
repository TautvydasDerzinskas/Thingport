// GENERATED from providers/meshy/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIsSite } from "../_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types.generated";
import manifest from "./manifest.generated";

const SITE_ORIGIN = manifest.site;

function isHost(hostname: string): boolean {
  return hostIsSite(hostname, manifest.hosts[0]);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
const UUID_ONLY = new RegExp(`^${UUID}$`, "i");
// Every page is also served under a language prefix (`/ja/posts/…`); English has none.
const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
// A post's page, `/posts/<slug>-<id>`, and the older address of the same post, `/3d-models/<slug>-<id>`. The slug is
// whatever the title made of it, Chinese percent-encoded included, and may be left off, so the id at the end is what
// says which post it is.
const POST_PATH = new RegExp(String.raw`^/${LANG}(?:posts|3d-models)/(?:[^/]*-)?(${UUID})/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^/${LANG}collections/(${UUID})/?$`, "i");
const WORKSPACE_PATH = new RegExp(String.raw`^/${LANG}workspace/?$`, "i");

// A model the user generated, in their own workspace, is kept apart from posts, whose ids look the same.
const TASK_PREFIX = "task-";

/** A post, the community's models, by its id. */
export function parseMeshyPostUrl(url: string): { postId: string } | null {
  const m = parseUrl(url)?.pathname.match(POST_PATH);
  return m ? { postId: m[1].toLowerCase() } : null;
}

export function meshyPostUrl(postId: string): string {
  return `${SITE_ORIGIN}/posts/${postId}`;
}

/** One of the user's own generations, as their workspace opens it: `/workspace?task=<id>`. */
export function parseMeshyTaskUrl(url: string): { taskId: string } | null {
  const parsed = parseUrl(url);
  const taskId = parsed?.searchParams.get("task") ?? "";
  return parsed && WORKSPACE_PATH.test(parsed.pathname) && UUID_ONLY.test(taskId)
    ? { taskId: taskId.toLowerCase() }
    : null;
}

export function meshyTaskUrl(taskId: string): string {
  return `${SITE_ORIGIN}/workspace?task=${taskId}`;
}

/** The id a generation is kept under. */
export function meshyTaskKey(taskId: string): string {
  return `${TASK_PREFIX}${taskId}`;
}

/** The task a kept id names, or null for a post's. */
export function meshyTaskIdOf(externalId: string): string | null {
  return externalId.startsWith(TASK_PREFIX) ? externalId.slice(TASK_PREFIX.length) : null;
}

export function parseMeshyCollectionUrl(url: string): { collectionId: string } | null {
  const m = parseUrl(url)?.pathname.match(COLLECTION_PATH);
  return m ? { collectionId: m[1].toLowerCase() } : null;
}

export function meshyCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/collections/${collectionId}`;
}

/** The user's own generations, their workspace. It is whoever's signed in, with no address of its own, so
 *  `?user=<their Meshy id>` is what Thingport keeps it by, as Makerables' saved projects are. */
export function parseMeshyGenerationsUrl(url: string): { userId: string } | null {
  const parsed = parseUrl(url);
  const userId = parsed?.searchParams.get("user") ?? "";
  if (!parsed || !WORKSPACE_PATH.test(parsed.pathname) || parsed.searchParams.has("task")) return null;
  return UUID_ONLY.test(userId) ? { userId: userId.toLowerCase() } : null;
}

export function meshyGenerationsUrl(userId: string): string {
  return `${SITE_ORIGIN}/workspace?user=${userId}`;
}

/** The id a sync keeps a user's generations by. */
export function meshyGenerationsKey(userId: string): string {
  return `generations-${userId}`;
}

/** A creator's profile, by the short handle Meshy gives them (`s1754341417b55bb`, or one they chose). */
export function meshyProfileUrl(handle: string): string {
  return `${SITE_ORIGIN}/@${encodeURIComponent(handle)}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const post = parseMeshyPostUrl(url);
    if (post) return { externalId: post.postId, requestedProfileId: null };
    const task = parseMeshyTaskUrl(url);
    return task && { externalId: meshyTaskKey(task.taskId), requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parseMeshyCollectionUrl(url);
    if (collection) {
      const { collectionId } = collection;
      return { kind: "collection", externalId: collectionId, url: meshyCollectionUrl(collectionId) };
    }
    const generations = parseMeshyGenerationsUrl(url);
    if (!generations) return null;
    const { userId } = generations;
    return { kind: "collection", externalId: meshyGenerationsKey(userId), url: meshyGenerationsUrl(userId) };
  },
  modelUrl(externalId) {
    const taskId = meshyTaskIdOf(externalId);
    return taskId ? meshyTaskUrl(taskId) : meshyPostUrl(externalId);
  },
};
