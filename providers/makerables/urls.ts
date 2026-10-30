import { hostIsSite } from "../_lib/hosts";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";
import manifest from "./manifest";

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

// Every page is also served under a language prefix (`/de/project/…`); English has none.
const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
// The site calls its models projects, at `/project/<slug>`, which is what its pages give as canonical -- a link by
// the project's id resolves to the same page and names it as the slug too, so the slug is what Thingport keeps.
const PROJECT_PATH = new RegExp(String.raw`^/${LANG}project/([A-Za-z0-9][\w.-]{0,150})/?$`, "i");
const USER_PATH = new RegExp(String.raw`^/${LANG}user/([A-Za-z]\d{1,20})/?$`, "i");

export function parseMakerablesProjectUrl(url: string): { projectId: string } | null {
  const m = parseUrl(url)?.pathname.match(PROJECT_PATH);
  return m ? { projectId: m[1].toLowerCase() } : null;
}

/** A project's page, by the slug it's kept under. */
export function makerablesProjectUrl(projectId: string): string {
  return `${SITE_ORIGIN}/project/${projectId}`;
}

/** Whether a project is named by its id rather than its slug, which only a hand-made link is: the site's own say the
 *  slug. Resolving it gives the slug, which is what the import keeps. */
export function isMakerablesProjectId(projectId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
}

/** The saved projects of a user, their profile's Saved tab. The tab has no address of its own -- the page keeps it in
 *  React state -- so `?tab=saved` is what Thingport keeps it by, as Snapmaker's tabbed lists are. */
export function parseMakerablesSavedUrl(url: string): { userId: string } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(USER_PATH);
  if (!m || parsed!.searchParams.get("tab") !== "saved") return null;
  return { userId: m[1].toUpperCase() };
}

export function makerablesSavedUrl(userId: string): string {
  return `${SITE_ORIGIN}/user/${userId}?tab=saved`;
}

/** The id a sync keeps a user's saved projects by. */
export function makerablesSavedKey(userId: string): string {
  return `saved-${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const project = parseMakerablesProjectUrl(url);
    return project && { externalId: project.projectId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const saved = parseMakerablesSavedUrl(url);
    if (!saved) return null;
    // The user's own saved projects; Makerables shows them to their owner alone.
    const { userId } = saved;
    return { kind: "bookmarks", externalId: makerablesSavedKey(userId), url: makerablesSavedUrl(userId) };
  },
  modelUrl: (projectId) => makerablesProjectUrl(projectId),
};
