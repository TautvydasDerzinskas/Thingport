import { hostIs } from "../_lib/hosts";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types";

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return hostIs(parsed.hostname, "makerworld.com") ? parsed : null;
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

export function makerworldModelUrl(designId: string): string {
  return `https://makerworld.com/en/models/${designId}`;
}

export function parseMakerworldCollectionUrl(url: string): { collectionId: string } | null {
  const match = parseUrl(url)?.pathname.match(/\/collections\/(\d+)/i);
  return match ? { collectionId: match[1] } : null;
}

export const urls: ProviderUrls = {
  isHost: (hostname) => hostIs(hostname, "makerworld.com"),
  parseModel(url): ModelLink | null {
    const model = parseMakerworldModelUrl(url);
    return model && { externalId: model.designId, requestedProfileId: model.requestedInstanceId };
  },
  parseList(url): ListLink | null {
    const collection = parseMakerworldCollectionUrl(url);
    if (!collection) return null;
    const id = collection.collectionId;
    return { kind: "collection", externalId: id, url: `https://makerworld.com/en/collections/${id}` };
  },
  modelUrl: makerworldModelUrl,
};
