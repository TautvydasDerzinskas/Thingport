// What the backend knows of each provider beyond its manifest (providers/<id>/manifest.ts). Every provider needs an
// entry, so tsc fails until a new one has it.

import { MANIFESTS, PROVIDER_IDS, type ProviderId, type ProviderManifest } from "./index.generated";
import { siteHost } from "./names";
import makerworldCategories from "./makerworld/categories.json";
import printablesCategories from "./printables/categories.json";
import thingiverseCategories from "./thingiverse/categories.json";
import myminifactoryCategories from "./myminifactory/categories.json";
import snapmakerCategories from "./snapmaker/categories.json";
import makeronlineCategories from "./makeronline/categories.json";
import crealitycloudCategories from "./crealitycloud/categories.json";
import nexprintCategories from "./nexprint/categories.json";
import thangsCategories from "./thangs/categories.json";
import cults3dCategories from "./cults3d/categories.json";
import eufymakeCategories from "./eufymake/categories.json";
import pinshapeCategories from "./pinshape/categories.json";
import toymakr3dCategories from "./toymakr3d/categories.json";
import makerablesCategories from "./makerables/categories.json";
import cgtraderCategories from "./cgtrader/categories.json";
import owlcadCategories from "./owlcad/categories.json";
import {
  crealitycloudImport,
  crealitycloudTrending,
  crealitycloudLists,
  crealitycloudDetails,
  crealitycloudKeptId,
} from "./crealitycloud";
import { cults3dImport, cults3dTrending, cults3dLists, cults3dDetails } from "./cults3d";
import { eufymakeImport, eufymakeTrending, eufymakeLists, eufymakeDetails } from "./eufymake";
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
import { owlcadImport, owlcadDetails } from "./owlcad";
import { pinshapeImport, pinshapeTrending, pinshapeLists, pinshapeDetails } from "./pinshape";
import { toymakr3dImport, toymakr3dTrending, toymakr3dLists, toymakr3dDetails } from "./toymakr3d";
import {
  makerablesImport,
  makerablesTrending,
  makerablesLists,
  makerablesDetails,
  makerablesKeptId,
} from "./makerables";
import { cgtraderImport, cgtraderTrending, cgtraderLists, cgtraderDetails, cgtraderKeptId } from "./cgtrader";
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
import { eufymakeConnection } from "./eufymake/connection";
import { makeronlineConnection } from "./makeronline/connection";
import { makerworldConnection } from "./makerworld/connection";
import { myminifactoryKeyConnection, myminifactorySessionConnection } from "./myminifactory/connection";
import { nexprintConnection } from "./nexprint/connection";
import { pinshapeConnection } from "./pinshape/connection";
import { toymakr3dConnection } from "./toymakr3d/connection";
import { makerablesConnection } from "./makerables/connection";
import { cgtraderConnection } from "./cgtrader/connection";
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
import { eufymakeSync } from "./eufymake/sync";
import { pinshapeSync } from "./pinshape/sync";
import { toymakr3dSync } from "./toymakr3d/sync";
import { makerablesSync } from "./makerables/sync";
import { cgtraderSync } from "./cgtrader/sync";
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
import { eufymakeBrowse } from "./eufymake/browse";
import { pinshapeBrowse } from "./pinshape/browse";
import { toymakr3dBrowse } from "./toymakr3d/browse";
import { makerablesBrowse } from "./makerables/browse";
import { cgtraderBrowse } from "./cgtrader/browse";
import type { AuthSlot } from "./index.generated";
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
  ListImportBody,
  StopTexts,
} from "./types";
import type { ProfilesImportJobBody } from "../services/importJobRunner";
import type { ImportRequestBody } from "../services/importService";
import { listMakerworldProfileUrls } from "./makerworld/profiles";
import {
  markMakerworldCookieRejected,
  MAKERWORLD_REJECTED_ERROR,
  withStoredMakerworldCookie,
} from "./makerworld/session";
import { liftCaptchaCooloffByHand } from "./makerworld/captcha";
import type { GrabImportOptions } from "./makeronline/grabImports";
import type { ImportCookies } from "../services/importResolvers";

/** A provider's ids for the starter categories, by their path ("Parent/Child"). */
export type StarterCategories = Readonly<Record<string, readonly (number | string)[]>>;

export type ProviderBackend = {
  /** Its ids for the starter categories (categories.json beside it), which a new user's come with. */
  starterCategories: StarterCategories;
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
  /** For a provider whose files only Thingport Grab can fetch, on its own pages: where imports that start anywhere
   *  else wait for its next visit there. */
  grabQueue?: GrabQueue;
  /** The import body with the user's stored sign-in where the request brought none, for the provider a link import
   *  of no provider's goes through (LINK_PROVIDER). */
  withStoredAuth?<T extends ImportCookies>(userId: string, body: T): Promise<T>;
  /** Ends a pause it took after a block (MakerWorld's CAPTCHA), when the user retries by hand. */
  liftHolds?(): void;
  /** Tests the instance's own credential, for a provider with one (an admin's App Token or API key). */
  instanceHealth?(): Promise<InstanceHealth>;
};

/** Imports waiting for Thingport Grab, as GrabQueue's provider keeps them. */
export type GrabQueue = {
  queue(userId: string, url: string, options?: GrabImportOptions): Promise<void>;
  /** The picked models of a list, filed once imported into a collection named `title`. */
  queueList(userId: string, title: string, body: ListImportBody): Promise<{ queued: number; collectionId: string }>;
  /** One heads-up for a batch just parked, so the user knows to open the site. */
  notifyQueued(
    userId: string,
    count: number,
    opts?: { label?: string | null; externalUrl?: string | null; internalPath?: string | null },
  ): Promise<void>;
  /** Imported, however it came in: nothing waits for the model any more. */
  clear(userId: string, modelId: string): Promise<void>;
};

/** The provider whose session a page link of no provider's is imported with. */
export const LINK_PROVIDER: ProviderId = "makerworld";

/** A link import's body with LINK_PROVIDER's stored sign-in, where the request brought none. */
export function withLinkAuth<T extends ImportCookies>(userId: string, body: T): Promise<T> {
  return PROVIDERS[LINK_PROVIDER].withStoredAuth?.(userId, body) ?? Promise.resolve(body);
}

/** A retry the user asked for: every provider's pause after a block ends. */
export function liftProviderHolds(): void {
  for (const id of PROVIDER_IDS) PROVIDERS[id].liftHolds?.();
}

// Loaded when used: their waiting imports reach the services that read this registry.
const grabImports = () => import("./makeronline/grabImports");
const owlcadExports = () => import("./owlcad/grabExports");

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
    starterCategories: makerworldCategories,
    connection: { default: makerworldConnection },
    authStopText: `the ${name("makerworld")} session expired — update the cookie in Settings, then retry`,
    lists: makerworldLists,
    sync: makerworldSync,
    browse: makerworldBrowse,
    trending: makerworldTrending,
    details: makerworldDetails,
    profileUrls: listMakerworldProfileUrls,
    // Loaded when it runs: the import runner it shares reaches this registry.
    profilesJob: async (jobId, userId, body) =>
      (await import("./makerworld/jobs")).runMakerworldProfilesJob(jobId, userId, body),
    withStoredAuth: withStoredMakerworldCookie,
    liftHolds: liftCaptchaCooloffByHand,
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
    starterCategories: printablesCategories,
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
    starterCategories: thingiverseCategories,
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
    starterCategories: myminifactoryCategories,
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
    starterCategories: snapmakerCategories,
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
    starterCategories: makeronlineCategories,
    connection: { default: makeronlineConnection },
    authStopText: grabSignInStop("makeronline"),
    customImport: makeronlineImport,
    grabQueue: {
      queue: async (userId, url, options) => (await grabImports()).queueGrabImport(userId, url, options),
      queueList: async (userId, title, body) => (await grabImports()).queueGrabList(userId, title, body),
      notifyQueued: async (userId, count, opts) => (await grabImports()).notifyGrabImportsQueued(userId, count, opts),
      clear: async (userId, modelId) => (await grabImports()).clearGrabImports(userId, modelId),
    },
    lists: makeronlineLists,
    sync: makeronlineSync,
    browse: makeronlineBrowse,
    trending: makeronlineTrending,
    details: makeronlineDetails,
  },
  crealitycloud: {
    starterCategories: crealitycloudCategories,
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
    starterCategories: nexprintCategories,
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
    starterCategories: thangsCategories,
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
    starterCategories: cults3dCategories,
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
  eufymake: {
    starterCategories: eufymakeCategories,
    connection: { default: eufymakeConnection },
    // Only its likes are read with the sign-in; its models import without one.
    authStopText: grabSignInStop("eufymake"),
    sourcedImport: eufymakeImport,
    lists: eufymakeLists,
    sync: eufymakeSync,
    browse: eufymakeBrowse,
    trending: eufymakeTrending,
    details: eufymakeDetails,
  },
  pinshape: {
    starterCategories: pinshapeCategories,
    connection: { default: pinshapeConnection },
    // Only its files are read with the sign-in; its models, collections and likes read without one.
    authStopText: grabSignInStop("pinshape"),
    sourcedImport: pinshapeImport,
    lists: pinshapeLists,
    sync: pinshapeSync,
    browse: pinshapeBrowse,
    trending: pinshapeTrending,
    details: pinshapeDetails,
  },
  toymakr3d: {
    starterCategories: toymakr3dCategories,
    connection: { default: toymakr3dConnection },
    // Its files and the liked products are read with the sign-in; its model pages read without one.
    authStopText: grabSignInStop("toymakr3d"),
    sourcedImport: toymakr3dImport,
    lists: toymakr3dLists,
    sync: toymakr3dSync,
    browse: toymakr3dBrowse,
    trending: toymakr3dTrending,
    details: toymakr3dDetails,
  },
  makerables: {
    starterCategories: makerablesCategories,
    connection: { default: makerablesConnection },
    // Only the saved projects are read with the sign-in; its projects and their files need none.
    authStopText: grabSignInStop("makerables"),
    sourcedImport: makerablesImport,
    lists: makerablesLists,
    sync: makerablesSync,
    browse: makerablesBrowse,
    trending: makerablesTrending,
    details: makerablesDetails,
    // A link may name a project by its id, where it is kept under the slug its page gives as canonical.
    keptId: makerablesKeptId,
  },
  cgtrader: {
    starterCategories: cgtraderCategories,
    connection: { default: cgtraderConnection },
    // Its files and the user's own lists are read with the sign-in; its model pages read without one.
    authStopText: grabSignInStop("cgtrader"),
    sourcedImport: cgtraderImport,
    lists: cgtraderLists,
    sync: cgtraderSync,
    browse: cgtraderBrowse,
    trending: cgtraderTrending,
    details: cgtraderDetails,
    // A link may name a model by its number, where it is kept under its slug.
    keptId: cgtraderKeptId,
    // AWS's bot check rather than Cloudflare's, which FlareSolverr gets a token past -- or the browser's, from Grab.
    stopTexts: {
      blocked: `${name("cgtrader")}'s bot check turned Thingport away — set up FlareSolverr in Administration → Connections, or download something on ${siteHost("cgtrader")} with Thingport Grab`,
    },
  },
  owlcad: {
    starterCategories: owlcadCategories,
    // Nothing is kept for it: everything it serves answers without a sign-in.
    connection: {},
    // It turns no sign-in down, having none to turn down; a batch only stops on a model its editor has to build.
    authStopText: `only ${siteHost("owlcad")}'s own editor can build it`,
    customImport: owlcadImport,
    grabQueue: {
      queue: async (userId, url, options) => (await owlcadExports()).queueOwlcadExport(userId, url, options),
      // Its gallery is one list, so there is no list import to park -- only single models.
      queueList: () => Promise.reject(new Error("OwlCAD has no lists")),
      notifyQueued: async (userId, count, opts) =>
        (await owlcadExports()).notifyOwlcadExportsQueued(userId, count, opts),
      clear: async (userId, modelId) => (await owlcadExports()).clearOwlcadExports(userId, modelId),
    },
    details: owlcadDetails,
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
