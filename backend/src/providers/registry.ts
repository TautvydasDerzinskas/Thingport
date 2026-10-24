// What the backend knows of each provider beyond its manifest (providers/<id>/manifest.ts). Every provider needs an
// entry, so tsc fails until a new one has it.

import type { Category } from "@prisma/client";
import { MANIFESTS, PROVIDER_IDS, type ProviderId, type ProviderManifest } from "./_generated";
import { siteHost } from "./names";
import {
  crealitycloudImport,
  crealitycloudTrending,
  crealitycloudLists,
  crealitycloudDetails,
  crealitycloudKeptId,
} from "./crealitycloud";
import { cults3dImport, cults3dTrending, cults3dLists, cults3dDetails } from "./cults3d";
import { makeronlineImport, makeronlineTrending, makeronlineLists, makeronlineDetails } from "./makeronline";
import { makerworldTrending, makerworldLists, makerworldDetails } from "./makerworld";
import {
  myminifactoryImport,
  myminifactoryTrending,
  myminifactoryLists,
  myminifactoryDetails,
  myminifactoryInstanceHealth,
} from "./myminifactory";
import { nexprintImport, nexprintTrending, nexprintLists, nexprintDetails } from "./nexprint";
import { printablesImport, printablesTrending, printablesLists, printablesDetails } from "./printables";
import { snapmakerImport, snapmakerTrending, snapmakerLists, snapmakerDetails } from "./snapmaker";
import { thangsImport, thangsTrending, thangsLists, thangsDetails } from "./thangs";
import {
  thingiverseImport,
  thingiverseTrending,
  thingiverseLists,
  thingiverseDetails,
  thingiverseInstanceHealth,
} from "./thingiverse";
import { crealitycloudConnection } from "./crealitycloud/connection";
import { cults3dApiConnection, cults3dBrowserConnection } from "./cults3d/connection";
import { makeronlineConnection } from "./makeronline/connection";
import { makerworldConnection } from "./makerworld/connection";
import { myminifactoryKeyConnection, myminifactorySessionConnection } from "./myminifactory/connection";
import { nexprintConnection } from "./nexprint/connection";
import { snapmakerConnection } from "./snapmaker/connection";
import { thangsConnection } from "./thangs/connection";
import { thingiverseConnection } from "./thingiverse/connection";
import { makerworldSync } from "./makerworld/sync";
import { printablesSync } from "./printables/sync";
import { thingiverseSync } from "./thingiverse/sync";
import { myminifactorySync } from "./myminifactory/sync";
import { snapmakerSync } from "./snapmaker/sync";
import { makeronlineSync } from "./makeronline/sync";
import { crealitycloudSync } from "./crealitycloud/sync";
import { nexprintSync } from "./nexprint/sync";
import { thangsSync } from "./thangs/sync";
import { cults3dSync } from "./cults3d/sync";
import { makerworldBrowse } from "./makerworld/browse";
import { printablesBrowse } from "./printables/browse";
import { thingiverseBrowse } from "./thingiverse/browse";
import { myminifactoryBrowse } from "./myminifactory/browse";
import { snapmakerBrowse } from "./snapmaker/browse";
import { makeronlineBrowse } from "./makeronline/browse";
import { crealitycloudBrowse } from "./crealitycloud/browse";
import { nexprintBrowse } from "./nexprint/browse";
import { thangsBrowse } from "./thangs/browse";
import { cults3dBrowse } from "./cults3d/browse";
import type { AuthSlot } from "./_generated";
import type {
  ConnectionSlot,
  CustomImport,
  ProviderBrowse,
  ProviderDetails,
  ProviderLists,
  ProviderSync,
  ProviderTrending,
  SourcedImport,
  InstanceHealth,
  StopTexts,
} from "./types";
import type { ProfilesImportJobBody } from "../services/importJobRunner";
import type { ImportRequestBody } from "../services/importService";
import { listMakerworldProfileUrls } from "./makerworld/profiles";
import { markMakerworldCookieRejected, MAKERWORLD_REJECTED_ERROR } from "./makerworld/session";

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
  /** How they're checked once synced. */
  sync?: ProviderSync;
  /** How the sync dialog's Browse tab finds them. */
  browse?: ProviderBrowse;
  /** Its list for the dashboard's trending panel, where its manifest says it has one. */
  trending?: ProviderTrending;
  /** How a model's details are read without its files. */
  details: ProviderDetails;
  /** The links of the print profiles a scope picks from the model a link is of, for a provider whose models import by
   *  the shared link import, with the request's credentials. `sourcedImport.profiles.listUrls` for the others. */
  profileUrls?(
    url: string,
    scope: ProfilesImportJobBody["scope"],
    body: ImportRequestBody,
  ): Promise<{ title: string | null; urls: string[] }>;
  /** A job of its own that imports a model's print profiles as one model, where they don't import the shared way. */
  profilesJob?(jobId: string, userId: string, body: ProfilesImportJobBody): Promise<void>;
  /** Remembers its sign-in turned down, for a provider whose imports don't themselves. */
  markRejected?(userId: string): Promise<void>;
  stopTexts?: StopTexts;
  /** The id an import keeps a model under, where its link may name it by another (Creality Cloud's alias). */
  keptId?(externalId: string): Promise<string>;
  /** Its link imports download a model with no print profiles as a zip of its raw files, unpacked into plates. */
  zipOfFiles?: true;
  /** Tests the instance's own credential, for a provider with one (an admin's App Token or API key). */
  instanceHealth?(): Promise<InstanceHealth>;
};

/** The provider whose session a page link of no provider's is imported with. */
export const LINK_PROVIDER: ProviderId = "makerworld";

type Manifests = typeof MANIFESTS;
/** What a provider with collections or likes has for them. */
type Listed = { lists: ProviderLists; sync: ProviderSync; browse: ProviderBrowse };
type Capabilities<K extends ProviderId> = Manifests[K]["capabilities"];
/** A provider's entry: its connections, lists and trending list are required where its manifest declares them. */
type Entry<K extends ProviderId> = ProviderBackend & {
  connection: { [S in Manifests[K]["auth"][number]["slot"]]: ConnectionSlot };
} & (Capabilities<K>["collections"] extends true ? Listed : unknown) &
  (Capabilities<K>["likes"] extends true ? Listed : unknown) &
  (Capabilities<K>["trending"] extends false ? unknown : { trending: ProviderTrending });

const name = (id: ProviderId): string => MANIFESTS[id].name;
const grabSignInStop = (id: ProviderId): string =>
  `${name(id)} turned your sign-in down — visit ${siteHost(id)} signed in with Thingport Grab, then retry`;

export const PROVIDERS = {
  makerworld: {
    connection: { default: makerworldConnection },
    authStopText: `the ${name("makerworld")} session expired — update the cookie in Settings, then retry`,
    lists: makerworldLists,
    sync: makerworldSync,
    browse: makerworldBrowse,
    trending: makerworldTrending,
    details: makerworldDetails,
    profileUrls: listMakerworldProfileUrls,
    zipOfFiles: true,
    // Loaded when it runs: the import runner it shares reaches this registry.
    profilesJob: async (jobId, userId, body) =>
      (await import("./makerworld/jobs")).runMakerworldProfilesJob(jobId, userId, body),
    // Its models import by the shared link import, which doesn't know whose cookie it was.
    markRejected: (userId) => markMakerworldCookieRejected(userId),
    stopTexts: {
      auth: {
        paused: `your ${name("makerworld")} session expired, so connect ${name("makerworld")} again in Configuration > Providers`,
        handedBack: MAKERWORLD_REJECTED_ERROR,
        deferred:
          `will come in on the next sync once you connect ${name("makerworld")} again in Configuration → Providers: ` +
          `${name("makerworld")} turned your sign-in down, and it may have expired.`,
      },
      rateLimited: `${name("makerworld")} asked for a CAPTCHA (too many requests)`,
    },
  },
  printables: {
    connection: {},
    // Printables has no sign-in; its imports never stop for one.
    authStopText: `${name("printables")} turned the request down — wait a while, then retry`,
    sourcedImport: printablesImport,
    lists: printablesLists,
    sync: printablesSync,
    browse: printablesBrowse,
    trending: printablesTrending,
    details: printablesDetails,
  },
  thingiverse: {
    connection: { default: thingiverseConnection },
    authStopText: `${name("thingiverse")} turned the instance's App Token down — an admin can check it in Administration, then retry`,
    sourcedImport: thingiverseImport,
    lists: thingiverseLists,
    sync: thingiverseSync,
    browse: thingiverseBrowse,
    trending: thingiverseTrending,
    details: thingiverseDetails,
    instanceHealth: thingiverseInstanceHealth,
  },
  myminifactory: {
    connection: { default: myminifactorySessionConnection, instance: myminifactoryKeyConnection },
    authStopText: grabSignInStop("myminifactory"),
    sourcedImport: myminifactoryImport,
    lists: myminifactoryLists,
    sync: myminifactorySync,
    browse: myminifactoryBrowse,
    trending: myminifactoryTrending,
    details: myminifactoryDetails,
    instanceHealth: myminifactoryInstanceHealth,
  },
  snapmaker: {
    connection: { default: snapmakerConnection },
    authStopText: `your ${name("snapmaker")} sign-in ran out — visit ${siteHost("snapmaker")} with Thingport Grab, then retry`,
    sourcedImport: snapmakerImport,
    lists: snapmakerLists,
    sync: snapmakerSync,
    browse: snapmakerBrowse,
    trending: snapmakerTrending,
    details: snapmakerDetails,
  },
  makeronline: {
    connection: { default: makeronlineConnection },
    authStopText: grabSignInStop("makeronline"),
    customImport: makeronlineImport,
    lists: makeronlineLists,
    sync: makeronlineSync,
    browse: makeronlineBrowse,
    trending: makeronlineTrending,
    details: makeronlineDetails,
  },
  crealitycloud: {
    connection: { default: crealitycloudConnection },
    authStopText: grabSignInStop("crealitycloud"),
    sourcedImport: crealitycloudImport,
    lists: crealitycloudLists,
    sync: crealitycloudSync,
    browse: crealitycloudBrowse,
    trending: crealitycloudTrending,
    details: crealitycloudDetails,
    keptId: crealitycloudKeptId,
  },
  nexprint: {
    connection: { default: nexprintConnection },
    authStopText: grabSignInStop("nexprint"),
    sourcedImport: nexprintImport,
    lists: nexprintLists,
    sync: nexprintSync,
    browse: nexprintBrowse,
    trending: nexprintTrending,
    details: nexprintDetails,
  },
  thangs: {
    connection: { default: thangsConnection },
    authStopText: grabSignInStop("thangs"),
    sourcedImport: thangsImport,
    lists: thangsLists,
    sync: thangsSync,
    browse: thangsBrowse,
    trending: thangsTrending,
    details: thangsDetails,
  },
  cults3d: {
    connection: { default: cults3dApiConnection, browser: cults3dBrowserConnection },
    authStopText:
      `${name("cults3d")} turned your API key or sign-in down — check the key in Configuration → Providers, or visit ${siteHost("cults3d")} ` +
      "signed in with Thingport Grab, then retry",
    sourcedImport: cults3dImport,
    lists: cults3dLists,
    sync: cults3dSync,
    browse: cults3dBrowse,
    trending: cults3dTrending,
    details: cults3dDetails,
    // Its pages take the browser's own Cloudflare clearance, which Grab sends; FlareSolverr's is no use there.
    stopTexts: {
      blocked: `${name("cults3d")}'s Cloudflare turned Thingport away — visit ${siteHost("cults3d")} with Thingport Grab to renew its clearance`,
    },
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
