// What the backend knows of each provider beyond its manifest (providers/<id>/manifest.ts). Every provider needs an
// entry, so tsc fails until a new one has it.

import type { Category } from "@prisma/client";
import { MANIFESTS, PROVIDER_IDS, type ProviderId, type ProviderManifest } from "./_generated";
import { crealitycloudImport, crealitycloudTrending, crealitycloudLists } from "./crealitycloud";
import { cults3dImport, cults3dTrending, cults3dLists } from "./cults3d";
import { makeronlineImport, makeronlineTrending, makeronlineLists } from "./makeronline";
import { makerworldTrending, makerworldLists } from "./makerworld";
import { myminifactoryImport, myminifactoryTrending, myminifactoryLists } from "./myminifactory";
import { nexprintImport, nexprintTrending, nexprintLists } from "./nexprint";
import { printablesImport, printablesTrending, printablesLists } from "./printables";
import { snapmakerImport, snapmakerTrending, snapmakerLists } from "./snapmaker";
import { thangsImport, thangsTrending, thangsLists } from "./thangs";
import { thingiverseImport, thingiverseTrending, thingiverseLists } from "./thingiverse";
import { crealitycloudConnection } from "./crealitycloud/connection";
import { cults3dApiConnection, cults3dBrowserConnection } from "./cults3d/connection";
import { makeronlineConnection } from "./makeronline/connection";
import { makerworldConnection } from "./makerworld/connection";
import { myminifactoryKeyConnection, myminifactorySessionConnection } from "./myminifactory/connection";
import { nexprintConnection } from "./nexprint/connection";
import { snapmakerConnection } from "./snapmaker/connection";
import { thangsConnection } from "./thangs/connection";
import { thingiverseConnection } from "./thingiverse/connection";
import type { AuthSlot } from "./_generated";
import type { ConnectionSlot, CustomImport, ProviderLists, ProviderTrending, SourcedImport } from "./types";

export type ProviderBackend = {
  /** Each credential its manifest lists under `auth`, by slot. */
  connection: Partial<Record<AuthSlot["slot"], ConnectionSlot>>;
  /** Why a batch import stopped when the provider turned the user's sign-in down, read after "failed because". */
  authStopText: string;
  /** How its models import on the shared pipeline. MakerWorld, with neither, imports through importService.ts's
   *  link import, its model pages being what that reads, with its captcha, cookie and cloud API in its folder. */
  sourcedImport?: SourcedImport<any, any>;
  /** How its models import, for a provider that doesn't go the shared way. */
  customImport?: CustomImport;
  /** How its collections, likes or bookmarks import, where its manifest says it has any. */
  lists?: ProviderLists;
  /** Its list for the dashboard's trending panel, where its manifest says it has one. */
  trending?: ProviderTrending;
};

type Manifests = typeof MANIFESTS;
type Capabilities<K extends ProviderId> = Manifests[K]["capabilities"];
/** A provider's entry: its connections, lists and trending list are required where its manifest declares them. */
type Entry<K extends ProviderId> = ProviderBackend & {
  connection: { [S in Manifests[K]["auth"][number]["slot"]]: ConnectionSlot };
} & (Capabilities<K>["collections"] extends true ? { lists: ProviderLists } : unknown) &
  (Capabilities<K>["likes"] extends true ? { lists: ProviderLists } : unknown) &
  (Capabilities<K>["trending"] extends false ? unknown : { trending: ProviderTrending });

export const PROVIDERS = {
  makerworld: {
    connection: { default: makerworldConnection },
    authStopText: "the MakerWorld session expired — update the cookie in Settings, then retry",
    lists: makerworldLists,
    trending: makerworldTrending,
  },
  printables: {
    connection: {},
    // Printables has no sign-in; its imports never stop for one.
    authStopText: "Printables turned the request down — wait a while, then retry",
    sourcedImport: printablesImport,
    lists: printablesLists,
    trending: printablesTrending,
  },
  thingiverse: {
    connection: { default: thingiverseConnection },
    authStopText:
      "Thingiverse turned the instance's App Token down — an admin can check it in Administration, then retry",
    sourcedImport: thingiverseImport,
    lists: thingiverseLists,
    trending: thingiverseTrending,
  },
  myminifactory: {
    connection: { default: myminifactorySessionConnection, instance: myminifactoryKeyConnection },
    authStopText:
      "MyMiniFactory turned your sign-in down — visit myminifactory.com signed in with Thingport Grab, then retry",
    sourcedImport: myminifactoryImport,
    lists: myminifactoryLists,
    trending: myminifactoryTrending,
  },
  snapmaker: {
    connection: { default: snapmakerConnection },
    authStopText: "your Snapmaker sign-in ran out — visit space.snapmaker.com with Thingport Grab, then retry",
    sourcedImport: snapmakerImport,
    lists: snapmakerLists,
    trending: snapmakerTrending,
  },
  makeronline: {
    connection: { default: makeronlineConnection },
    authStopText:
      "MakerOnline turned your sign-in down — visit makeronline.com signed in with Thingport Grab, then retry",
    customImport: makeronlineImport,
    lists: makeronlineLists,
    trending: makeronlineTrending,
  },
  crealitycloud: {
    connection: { default: crealitycloudConnection },
    authStopText:
      "Creality Cloud turned your sign-in down — visit crealitycloud.com signed in with Thingport Grab, then retry",
    sourcedImport: crealitycloudImport,
    lists: crealitycloudLists,
    trending: crealitycloudTrending,
  },
  nexprint: {
    connection: { default: nexprintConnection },
    authStopText: "NexPrint turned your sign-in down — visit nexprint.com signed in with Thingport Grab, then retry",
    sourcedImport: nexprintImport,
    lists: nexprintLists,
    trending: nexprintTrending,
  },
  thangs: {
    connection: { default: thangsConnection },
    authStopText: "Thangs turned your sign-in down — visit thangs.com signed in with Thingport Grab, then retry",
    sourcedImport: thangsImport,
    lists: thangsLists,
    trending: thangsTrending,
  },
  cults3d: {
    connection: { default: cults3dApiConnection, browser: cults3dBrowserConnection },
    authStopText:
      "Cults3D turned your API key or sign-in down — check the key in Configuration → Providers, or visit cults3d.com " +
      "signed in with Thingport Grab, then retry",
    sourcedImport: cults3dImport,
    lists: cults3dLists,
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
