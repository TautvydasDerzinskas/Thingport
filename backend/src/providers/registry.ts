// What the backend knows of each provider beyond its manifest (providers/<id>/manifest.ts). Every provider needs an
// entry, so tsc fails until a new one has it.

import type { Category } from "@prisma/client";
import { MANIFESTS, PROVIDER_IDS, type ProviderId, type ProviderManifest } from "./_generated";
import { crealitycloudImport, crealitycloudTrending } from "./crealitycloud";
import { cults3dImport, cults3dTrending } from "./cults3d";
import { makeronlineImport, makeronlineTrending } from "./makeronline";
import { makerworldTrending } from "./makerworld";
import { myminifactoryImport, myminifactoryTrending } from "./myminifactory";
import { nexprintImport, nexprintTrending } from "./nexprint";
import { printablesImport, printablesTrending } from "./printables";
import { snapmakerImport, snapmakerTrending } from "./snapmaker";
import { thangsImport, thangsTrending } from "./thangs";
import { thingiverseImport, thingiverseTrending } from "./thingiverse";
import type { CustomImport, ProviderTrending, SourcedImport } from "./types";

export type ProviderBackend = {
  /** Why a batch import stopped when the provider turned the user's sign-in down, read after "failed because". */
  authStopText: string;
  /** How its models import on the shared pipeline. MakerWorld, with neither, imports through importService.ts's
   *  link import, its model pages being what that reads, with its captcha, cookie and cloud API in its folder. */
  sourcedImport?: SourcedImport<any, any>;
  /** How its models import, for a provider that doesn't go the shared way. */
  customImport?: CustomImport;
  /** Its list for the dashboard's trending panel, where its manifest says it has one. */
  trending?: ProviderTrending;
};

type Manifests = typeof MANIFESTS;
/** A provider's entry: its trending list is required where its manifest declares one. */
type Entry<K extends ProviderId> = ProviderBackend &
  (Manifests[K]["capabilities"]["trending"] extends false ? unknown : { trending: ProviderTrending });

export const PROVIDERS = {
  makerworld: {
    authStopText: "the MakerWorld session expired — update the cookie in Settings, then retry",
    trending: makerworldTrending,
  },
  printables: {
    // Printables has no sign-in; its imports never stop for one.
    authStopText: "Printables turned the request down — wait a while, then retry",
    sourcedImport: printablesImport,
    trending: printablesTrending,
  },
  thingiverse: {
    authStopText:
      "Thingiverse turned the instance's App Token down — an admin can check it in Administration, then retry",
    sourcedImport: thingiverseImport,
    trending: thingiverseTrending,
  },
  myminifactory: {
    authStopText:
      "MyMiniFactory turned your sign-in down — visit myminifactory.com signed in with Thingport Grab, then retry",
    sourcedImport: myminifactoryImport,
    trending: myminifactoryTrending,
  },
  snapmaker: {
    authStopText: "your Snapmaker sign-in ran out — visit space.snapmaker.com with Thingport Grab, then retry",
    sourcedImport: snapmakerImport,
    trending: snapmakerTrending,
  },
  makeronline: {
    authStopText:
      "MakerOnline turned your sign-in down — visit makeronline.com signed in with Thingport Grab, then retry",
    customImport: makeronlineImport,
    trending: makeronlineTrending,
  },
  crealitycloud: {
    authStopText:
      "Creality Cloud turned your sign-in down — visit crealitycloud.com signed in with Thingport Grab, then retry",
    sourcedImport: crealitycloudImport,
    trending: crealitycloudTrending,
  },
  nexprint: {
    authStopText: "NexPrint turned your sign-in down — visit nexprint.com signed in with Thingport Grab, then retry",
    sourcedImport: nexprintImport,
    trending: nexprintTrending,
  },
  thangs: {
    authStopText: "Thangs turned your sign-in down — visit thangs.com signed in with Thingport Grab, then retry",
    sourcedImport: thangsImport,
    trending: thangsTrending,
  },
  cults3d: {
    authStopText:
      "Cults3D turned your API key or sign-in down — check the key in Configuration → Providers, or visit cults3d.com " +
      "signed in with Thingport Grab, then retry",
    sourcedImport: cults3dImport,
    trending: cults3dTrending,
  },
} satisfies { [K in ProviderId]: Entry<K> } as { readonly [K in ProviderId]: ProviderBackend };

const errorCodes = (id: ProviderId): ProviderManifest["errorCodes"] => MANIFESTS[id].errorCodes;

/** Providers whose models come with print profiles, so a re-import may add one. */
export const PROFILE_PROVIDERS: ReadonlySet<string> = new Set(
  PROVIDER_IDS.filter((id) => MANIFESTS[id].capabilities.profiles),
);

/** The codes of the errors that mean the provider turned the user's sign-in down, or wants one. */
export const SESSION_CODES: ReadonlySet<string> = new Set(PROVIDER_IDS.flatMap((id) => errorCodes(id).session ?? []));

/** The codes of the errors that mean the account's daily downloads are used up. */
export const DOWNLOAD_LIMIT_CODES: ReadonlySet<string> = new Set(
  PROVIDER_IDS.flatMap((id) => errorCodes(id).downloadLimit ?? []),
);

export type CatIdsField = `${ProviderId}CatIds` & keyof Category;

/** The Category column a category keeps this site's category ids in, and whether they're text or numbers. */
export function catIdsField(id: ProviderId): { field: CatIdsField; text: boolean } {
  return { field: `${id}CatIds`, text: MANIFESTS[id].capabilities.categoryIds === "text" };
}
