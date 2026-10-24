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

/** A NexPrint id as Thingport keeps it, in upper case; null for anything else. */
function outId(value: string | null | undefined, prefix: "G" | "U"): string | null {
  const text = value?.trim().toUpperCase();
  return text && new RegExp(`^${prefix}\\d+$`).test(text) ? text : null;
}

const LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;
const MODEL_PATH = new RegExp(String.raw`^/${LANG}models/(G\d+)/?$`, "i");
const COLLECTION_PATH = new RegExp(String.raw`^/${LANG}collection/(G\d+)/?$`, "i");
const USER_HOME_PATH = new RegExp(String.raw`^/${LANG}(U\d+)/home/?$`, "i");

/** `/en/models/<id>`; `?printConfigId=<id>` names a print profile, as the site's own links do. Thingport's
 *  `#profileId-<id>` names one too, and wins. */
export function parseNexprintModelUrl(url: string): { modelId: string; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.pathname.match(MODEL_PATH);
  if (!m) return null;
  const fromHash = parsed!.hash.match(/profileId-(G\d+)/i)?.[1];
  return {
    modelId: m[1].toUpperCase(),
    requestedProfileId: outId(fromHash ?? parsed!.searchParams.get("printConfigId"), "G"),
  };
}

export function nexprintModelUrl(modelId: string, profileId?: string | null): string {
  return `${SITE_ORIGIN}/en/models/${modelId}${profileId ? `?printConfigId=${profileId}` : ""}`;
}

/** A collection: `/en/collection/<id>`, or as its owner's page shows it, `/en/<user>/home?...&collectionId=<id>`. */
export function parseNexprintCollectionUrl(url: string): { collectionId: string; ownerId: string | null } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const direct = parsed.pathname.match(COLLECTION_PATH);
  if (direct) return { collectionId: direct[1].toUpperCase(), ownerId: null };
  const home = parsed.pathname.match(USER_HOME_PATH);
  const collectionId = home ? outId(parsed.searchParams.get("collectionId"), "G") : null;
  return collectionId ? { collectionId, ownerId: home![1].toUpperCase() } : null;
}

/** On its owner's page when the owner is known, the way the site links to it; else its own address. */
export function nexprintCollectionUrl(collectionId: string, ownerId?: string | null): string {
  return ownerId
    ? `${SITE_ORIGIN}/en/${ownerId}/home?component=UserCollect&subComp=UserCollectDetail&collectionId=${collectionId}`
    : `${SITE_ORIGIN}/en/collection/${collectionId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseNexprintModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: model.requestedProfileId };
  },
  parseList(url): ListLink | null {
    const collection = parseNexprintCollectionUrl(url);
    if (!collection) return null;
    const { collectionId, ownerId } = collection;
    return { kind: "collection", externalId: collectionId, url: nexprintCollectionUrl(collectionId, ownerId) };
  },
  modelUrl: (modelId) => nexprintModelUrl(modelId),
};
