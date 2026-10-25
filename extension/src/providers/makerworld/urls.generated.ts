// GENERATED from providers/makerworld/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIs } from "../_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types.generated";
import manifest from "./manifest.generated";

const SITE_ORIGIN = manifest.site;
const DOMAIN = manifest.hosts[0];

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return hostIs(parsed.hostname, DOMAIN) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseMakerworldModelUrl(url: string): { designId: string; requestedInstanceId: string | null } | null {
  const parsed = parseUrl(url);
  const designMatch = parsed?.pathname.match(/\/models?\/(\d+)/i);
  if (!designMatch) return null;
  const hashMatch = parsed!.hash.match(/profileid-(\d+)/i);
  return { designId: designMatch[1], requestedInstanceId: hashMatch ? hashMatch[1] : null };
}

/** `#profileId-<id>` picks a print profile, as the site's own links do. */
export function makerworldModelUrl(designId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/models/${designId}${profileId ? `#profileId-${profileId}` : ""}`;
}

export function makerworldCollectionUrl(collectionId: string): string {
  return `${SITE_ORIGIN}/en/collections/${collectionId}`;
}

/** A creator's page by their numeric id, which always resolves; their handle may change. */
export function makerworldUserUrl(userId: string): string {
  return `${SITE_ORIGIN}/en/u/${userId}`;
}

export function parseMakerworldCollectionUrl(url: string): { collectionId: string } | null {
  const match = parseUrl(url)?.pathname.match(/\/collections\/(\d+)/i);
  return match ? { collectionId: match[1] } : null;
}

export const urls: ProviderUrls = {
  isHost: (hostname) => hostIs(hostname, DOMAIN),
  parseModel(url): ModelLink | null {
    const model = parseMakerworldModelUrl(url);
    return model && { externalId: model.designId, requestedProfileId: model.requestedInstanceId };
  },
  parseList(url): ListLink | null {
    const collection = parseMakerworldCollectionUrl(url);
    if (!collection) return null;
    const id = collection.collectionId;
    return { kind: "collection", externalId: id, url: makerworldCollectionUrl(id) };
  },
  modelUrl: (designId) => makerworldModelUrl(designId),
  authorUrl: makerworldUserUrl,
};
