// GENERATED from providers/*/ by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.

import { hostIs } from "./_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderManifest, ProviderUrls } from "./_lib/types.generated";
import makerworld from "./makerworld/manifest.generated";
import { urls as makerworldUrls } from "./makerworld/urls.generated";
import printables from "./printables/manifest.generated";
import { urls as printablesUrls } from "./printables/urls.generated";
import thingiverse from "./thingiverse/manifest.generated";
import { urls as thingiverseUrls } from "./thingiverse/urls.generated";
import myminifactory from "./myminifactory/manifest.generated";
import { urls as myminifactoryUrls } from "./myminifactory/urls.generated";
import snapmaker from "./snapmaker/manifest.generated";
import { urls as snapmakerUrls } from "./snapmaker/urls.generated";
import makeronline from "./makeronline/manifest.generated";
import { urls as makeronlineUrls } from "./makeronline/urls.generated";
import crealitycloud from "./crealitycloud/manifest.generated";
import { urls as crealitycloudUrls } from "./crealitycloud/urls.generated";
import nexprint from "./nexprint/manifest.generated";
import { urls as nexprintUrls } from "./nexprint/urls.generated";
import thangs from "./thangs/manifest.generated";
import { urls as thangsUrls } from "./thangs/urls.generated";
import cults3d from "./cults3d/manifest.generated";
import { urls as cults3dUrls } from "./cults3d/urls.generated";
import eufymake from "./eufymake/manifest.generated";
import { urls as eufymakeUrls } from "./eufymake/urls.generated";
import pinshape from "./pinshape/manifest.generated";
import { urls as pinshapeUrls } from "./pinshape/urls.generated";
import owlcad from "./owlcad/manifest.generated";
import { urls as owlcadUrls } from "./owlcad/urls.generated";
import toymakr3d from "./toymakr3d/manifest.generated";
import { urls as toymakr3dUrls } from "./toymakr3d/urls.generated";
import makerables from "./makerables/manifest.generated";
import { urls as makerablesUrls } from "./makerables/urls.generated";
import cgtrader from "./cgtrader/manifest.generated";
import { urls as cgtraderUrls } from "./cgtrader/urls.generated";
import grabcad from "./grabcad/manifest.generated";
import { urls as grabcadUrls } from "./grabcad/urls.generated";

export type {
  AuthField,
  AuthSlot,
  LegacyIdsField,
  ListKind,
  ListLink,
  Logo,
  ModelLink,
  Need,
  ProviderManifest,
  ProviderUrls,
  SignIn,
} from "./_lib/types.generated";
export { hostIs } from "./_lib/hosts.generated";
export { LIKES_ID_PREFIX } from "./_lib/lists.generated";

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
  "eufymake",
  "pinshape",
  "owlcad",
  "toymakr3d",
  "makerables",
  "cgtrader",
  "grabcad",
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
  eufymake,
  pinshape,
  owlcad,
  toymakr3d,
  makerables,
  cgtrader,
  grabcad,
} as const;

/** What each site is, in two or three sentences (providers/<id>/docs.ts), for the UI that introduces a provider
 *  rather than listing it: Thingport Grab's popup, which shows it for the site the user is on. */
export const ABOUT: { readonly [K in ProviderId]: string } = {
  makerworld:
    "Bambu Lab's model site, and the one that put print profiles front and centre: models arrive tuned for a machine and a filament, ready to send to the printer. Designers earn points for them, which buy Bambu gear in its shop.",
  printables:
    "Prusa Research's repository, called PrusaPrinters until the 2022 rename. It runs several design contests a month and pays contributors in prusameters, points that turn into vouchers for Prusa's own shop.",
  thingiverse:
    "The original: MakerBot put it up in 2008, and millions of designs later it is still where much of 3D printing's common stock lives, most of it openly licensed. It belongs to UltiMaker now, after MakerBot's merger.",
  myminifactory:
    "London's iMakr started it in 2013 on a promise: every file test-printed before it went up. It leans heavily on tabletop miniatures, and runs Scan the World, a free archive of scanned sculptures and museum pieces.",
  snapmaker:
    "Snapmaker's own model site, built around the U1, its multi-colour toolchanger. The company made its name with modular machines that 3D print, laser-cut and carve from one frame.",
  makeronline:
    "Anycubic's model platform. The company is best known for making resin printing cheap with the Photon, and MakerOnline mixes free and paid models with print profiles and regular designer contests.",
  crealitycloud:
    "Creality's library and companion app, from the maker of the Ender 3 — the printer that put a 3D printer on most people's first bench. Besides models and profiles it doubles as a remote control for Creality machines.",
  nexprint:
    "Elegoo's model platform, opened in 2025. Elegoo made its name with the Mars resin printers and the Neptune line, and NexPrint carries profiles for both its own slicer and OrcaSlicer, so models come ready to slice.",
  thangs:
    "A search engine that matches shapes rather than words: Physna's deep-learning index finds the models geometrically like the one you hand it. It opened in 2020 with a million objects indexed, and sells models now as well.",
  cults3d:
    "An independent French marketplace for free and paid designs, going since 2014. It sells model by model rather than by subscription, and leans towards figurines, cosplay props and jewellery.",
  eufymake:
    "Make it Real is the design library of eufyMake — Anker's maker brand, called AnkerMake until 2025. It grew up around the E1 UV printer, whose Kickstarter raised over $44m, more than any project there had before.",
  pinshape:
    "One of the older community libraries: started in Vancouver in 2013, bought by Formlabs three years on, and run by MatterHackers now. Everything on it is free, and its collections are anyone's to follow.",
  owlcad:
    "A parametric CAD app that runs in the browser, with a gallery of two halves: a library of CC0 and CC-BY parts to build from, and the projects its users share. Those are CAD, not meshes, so its editor builds the files.",
  toymakr3d:
    "One designer's shop of articulated robot and mecha models — Transformers, Megazords, Gundams and the like, printed in place with joints that already move. Most are free to download, the rest are sold.",
  makerables:
    "Makera's project site, where desktop CNC meets 3D printing. Makera makes the Carvera mills, and every project here is free and carries its CAM files and machining programs beside the models they cut.",
  cgtrader:
    "A Vilnius-born marketplace of over three million 3D models, started in 2011: game and film assets, renders and a large 3D printing catalogue, sold by their designers and many of them free.",
  grabcad:
    "An engineers' community started in Estonia in 2009 and owned by Stratasys since 2014. Its free library holds millions of CAD models, from machine parts to whole assemblies, mostly as STEP files and native CAD formats.",
};

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
  "eufymake",
  "pinshape",
  "toymakr3d",
  "makerables",
  "cgtrader",
  "grabcad",
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
  eufymake: eufymakeUrls,
  pinshape: pinshapeUrls,
  owlcad: owlcadUrls,
  toymakr3d: toymakr3dUrls,
  makerables: makerablesUrls,
  cgtrader: cgtraderUrls,
  grabcad: grabcadUrls,
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** A provider's manifest as the type says any can be, for the fields only some have. */
export function manifestOf(id: ProviderId): ProviderManifest {
  return MANIFESTS[id];
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
