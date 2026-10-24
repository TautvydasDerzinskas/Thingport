// GENERATED from providers/*/ by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.

import { hostIs } from "./_lib/hosts";
import type { ListLink, ModelLink, ProviderUrls } from "./_lib/types";
import makerworld from "./makerworld/manifest";
import { urls as makerworldUrls } from "./makerworld/urls";
import printables from "./printables/manifest";
import { urls as printablesUrls } from "./printables/urls";
import thingiverse from "./thingiverse/manifest";
import { urls as thingiverseUrls } from "./thingiverse/urls";
import myminifactory from "./myminifactory/manifest";
import { urls as myminifactoryUrls } from "./myminifactory/urls";
import snapmaker from "./snapmaker/manifest";
import { urls as snapmakerUrls } from "./snapmaker/urls";
import makeronline from "./makeronline/manifest";
import { urls as makeronlineUrls } from "./makeronline/urls";
import crealitycloud from "./crealitycloud/manifest";
import { urls as crealitycloudUrls } from "./crealitycloud/urls";
import nexprint from "./nexprint/manifest";
import { urls as nexprintUrls } from "./nexprint/urls";
import thangs from "./thangs/manifest";
import { urls as thangsUrls } from "./thangs/urls";
import cults3d from "./cults3d/manifest";
import { urls as cults3dUrls } from "./cults3d/urls";

export type {
  Chip,
  LegacyIdsField,
  ListKind,
  ListLink,
  Logo,
  ModelLink,
  Need,
  ProviderManifest,
  ProviderUrls,
  SignIn,
} from "./_lib/types";
export { hostIs } from "./_lib/hosts";
export { LIKES_ID_PREFIX } from "./_lib/lists";

/** Every provider, in the order lists show them. */
export const PROVIDER_IDS = [
  "makerworld",
  "printables",
  "thingiverse",
  "myminifactory",
  "snapmaker",
  "makeronline",
  "crealitycloud",
  "nexprint",
  "thangs",
  "cults3d",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MANIFESTS = {
  makerworld,
  printables,
  thingiverse,
  myminifactory,
  snapmaker,
  makeronline,
  crealitycloud,
  nexprint,
  thangs,
  cults3d,
} as const;

/** The providers with a list for the dashboard's trending panel, in the panel's order. */
export const TRENDING_PROVIDER_IDS = [
  "printables",
  "makerworld",
  "thangs",
  "makeronline",
  "thingiverse",
  "myminifactory",
  "cults3d",
  "crealitycloud",
  "nexprint",
  "snapmaker",
] as const;
export type TrendingProviderId = (typeof TRENDING_PROVIDER_IDS)[number];

export const URLS: { readonly [K in ProviderId]: ProviderUrls } = {
  makerworld: makerworldUrls,
  printables: printablesUrls,
  thingiverse: thingiverseUrls,
  myminifactory: myminifactoryUrls,
  snapmaker: snapmakerUrls,
  makeronline: makeronlineUrls,
  crealitycloud: crealitycloudUrls,
  nexprint: nexprintUrls,
  thangs: thangsUrls,
  cults3d: cults3dUrls,
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** The provider whose site `hostname` is, subdomains included; null for any other site. */
export function providerOfHost(hostname: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => MANIFESTS[id].hosts.some((domain) => hostIs(hostname, domain))) ?? null;
}

/** The provider whose links a URL's host is, as its parsers read them (narrower than providerOfHost: Snapmaker's
 *  are on space.snapmaker.com only); null for any other site or no URL. */
export function detectProvider(url: string): ProviderId | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return PROVIDER_IDS.find((id) => URLS[id].isHost(hostname)) ?? null;
}

/** The model a link is the page of, on whichever provider. */
export function parseModelUrl(url: string): (ModelLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const model = provider && URLS[provider].parseModel(url);
  return model ? { provider: provider!, ...model } : null;
}

/** The list (collection, likes, bookmarks) a link is the page of, on whichever provider. */
export function parseListUrl(url: string): (ListLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const list = provider && URLS[provider].parseList(url);
  return list ? { provider: provider!, ...list } : null;
}

/** A model's page; null for a provider there's no manifest for. */
export function modelUrl(provider: string, externalId: string): string | null {
  return isProviderId(provider) ? URLS[provider].modelUrl(externalId) : null;
}
