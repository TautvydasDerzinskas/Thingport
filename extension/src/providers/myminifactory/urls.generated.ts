// GENERATED from providers/myminifactory/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
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

/** Null for malformed percent-encoding (`%zz`), which decodeURIComponent throws on. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** `/object/3d-print-<slug>-<id>`, optionally behind a language prefix (`/it/object/...`). */
export function parseMyminifactoryObjectUrl(url: string): { objectId: string } | null {
  const m = parseUrl(url)?.pathname.match(/^\/(?:[a-z]{2}\/)?object\/(?:[^/]*-)?(\d+)\/?$/i);
  return m ? { objectId: m[1] } : null;
}

/** `/users/<username>/collection/<slug>`. A collection is only addressable by its owner and slug. */
export function parseMyminifactoryCollectionUrl(url: string): { username: string; slug: string } | null {
  const m = parseUrl(url)?.pathname.match(/^\/(?:[a-z]{2}\/)?users\/([^/]+)\/collection\/([^/]+)\/?$/i);
  if (!m) return null;
  const username = safeDecode(m[1]);
  const slug = safeDecode(m[2]);
  return username && slug ? { username, slug: slug.toLowerCase() } : null;
}

/** The id a sync keeps for a collection: usernames aren't case-sensitive, so one collection syncs once. */
export function myminifactoryCollectionKey(username: string, slug: string): string {
  return `${username.toLowerCase()}/${slug.toLowerCase()}`;
}

export function myminifactoryCollectionUrl(username: string, slug: string): string {
  return `${SITE_ORIGIN}/users/${encodeURIComponent(username)}/collection/${encodeURIComponent(slug)}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const object = parseMyminifactoryObjectUrl(url);
    return object && { externalId: object.objectId, requestedProfileId: null };
  },
  parseList(url): ListLink | null {
    const collection = parseMyminifactoryCollectionUrl(url);
    if (!collection) return null;
    // Addressed by owner and slug: MyMiniFactory's collection pages carry no id.
    const { username, slug } = collection;
    return {
      kind: "collection",
      externalId: myminifactoryCollectionKey(username, slug),
      url: myminifactoryCollectionUrl(username, slug),
    };
  },
  // MyMiniFactory redirects an object id with any slug, or none, to its page.
  modelUrl: (objectId) => `${SITE_ORIGIN}/object/3d-print-${objectId}`,
};
