import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";
import manifest from "./manifest";

const SITE_ORIGIN = manifest.site;
// Only Snapmaker Space: its other subdomains are the shop, the forum and the sign-in.
const SITE_HOST = new URL(SITE_ORIGIN).hostname;

export type SnapmakerList = "likes" | "bookmarks";

function isHost(hostname: string): boolean {
  return hostname.toLowerCase() === SITE_HOST;
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

/** `/en/model/<id>-<slug>`, the slug and language prefix optional; `#profileId-<id>` picks a print profile. */
export function parseSnapmakerModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model\/(\d+)(?:-[^/]*)?\/?$/i);
  if (!m) return null;
  return { modelId: m[1], requestedProfileId: parsed!.hash.match(/profileId-(\d+)/i)?.[1] ?? null };
}

export function snapmakerModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/model/${modelId}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** The user's likes and bookmarks share one page, `/creator/<id>?tab=interactions`, whose address doesn't change
 *  between the two; `list` tells them apart in the addresses Thingport keeps. */
export function parseSnapmakerListUrl(url: string): { userId: string; list: SnapmakerList | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?creator\/(\d+)\/?$/i);
  if (!m || parsed!.searchParams.get("tab") !== "interactions") return null;
  const list = parsed!.searchParams.get("list");
  return { userId: m[1], list: list === "likes" || list === "bookmarks" ? list : null };
}

export function snapmakerListUrl(userId: string, list: SnapmakerList): string {
  return `${SITE_ORIGIN}/en/creator/${userId}?tab=interactions&list=${list}`;
}

/** The id a sync keeps for the user's likes or bookmarks. */
export function snapmakerListKey(userId: string, list: SnapmakerList): string {
  return `${list}-${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseSnapmakerModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    const parsed = parseSnapmakerListUrl(url);
    if (!parsed?.list) return null;
    // The user's own likes or bookmarks; Snapmaker shows them to their owner only.
    const { userId, list } = parsed;
    return { kind: list, externalId: snapmakerListKey(userId, list), url: snapmakerListUrl(userId, list) };
  },
  modelUrl: (modelId) => snapmakerModelUrl(modelId),
};
