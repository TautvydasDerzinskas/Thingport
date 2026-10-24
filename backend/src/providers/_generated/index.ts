// GENERATED from providers/*/manifest.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.

import { hostIs } from "./_lib/hosts";
import makerworld from "./makerworld/manifest";
import printables from "./printables/manifest";
import thingiverse from "./thingiverse/manifest";
import myminifactory from "./myminifactory/manifest";
import snapmaker from "./snapmaker/manifest";
import makeronline from "./makeronline/manifest";
import crealitycloud from "./crealitycloud/manifest";
import nexprint from "./nexprint/manifest";
import thangs from "./thangs/manifest";
import cults3d from "./cults3d/manifest";

export type { Chip, Logo, Need, ProviderManifest, SignIn } from "./_lib/types";
export { hostIs } from "./_lib/hosts";

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

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** The provider whose site `hostname` is, subdomains included; null for any other site. */
export function providerOfHost(hostname: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => MANIFESTS[id].hosts.some((domain) => hostIs(hostname, domain))) ?? null;
}
