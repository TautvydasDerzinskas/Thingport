import { hostIsSite } from "../_lib/hosts";
import { LIKES_ID_PREFIX } from "../_lib/lists";
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

// A model's page is `/library/<slug>`, and its tabs `/details`, `/files` and `/likes` after it. The slug is all its
// links and its API know it by -- there's no number -- and can start with a dash or an underscore (`-7821`). The
// library's own listings sit beside the models under these words.
const MODEL_PATH = /^\/library\/([a-z0-9_-]{1,200})(?:\/(?:details|files|likes))?\/?$/i;
const LIBRARY_PAGES = new Set(["category", "software", "tag", "sort", "new"]);
// A member's page is `/<slug>`, with their likes at `/<slug>/likes`; the site's own sections sit beside them.
const LIKES_PATH = /^\/([a-z0-9][a-z0-9._-]{0,99})\/likes\/?$/i;
const SITE_PAGES = new Set([
  "library",
  "engineers",
  "groups",
  "challenges",
  "questions",
  "tutorials",
  "dashboard",
  "home",
  "profile",
  "community",
]);

export function parseGrabcadModelUrl(url: string): { slug: string } | null {
  const m = parseUrl(url)?.pathname.match(MODEL_PATH);
  const slug = m?.[1].toLowerCase();
  return slug && /[a-z0-9]/.test(slug) && !LIBRARY_PAGES.has(slug) ? { slug } : null;
}

export function grabcadModelUrl(slug: string): string {
  return `${SITE_ORIGIN}/library/${slug}`;
}

/** Someone's likes, anyone's to read: `/<member>/likes`, by the slug their page is at. */
export function parseGrabcadLikesUrl(url: string): { member: string } | null {
  const member = parseUrl(url)?.pathname.match(LIKES_PATH)?.[1].toLowerCase();
  return member && !SITE_PAGES.has(member) ? { member } : null;
}

export function grabcadLikesUrl(member: string): string {
  return `${SITE_ORIGIN}/${member}/likes`;
}

/** What a sync of someone's likes is kept by: their member slug. */
export function grabcadLikesKey(member: string): string {
  return `${LIKES_ID_PREFIX}${member}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseGrabcadModelUrl(url);
    return model && { externalId: model.slug, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const likes = parseGrabcadLikesUrl(url);
    return (
      likes && {
        kind: "likes",
        externalId: grabcadLikesKey(likes.member),
        url: grabcadLikesUrl(likes.member),
        likesOf: likes.member,
      }
    );
  },
  modelUrl: (slug) => grabcadModelUrl(slug),
};
