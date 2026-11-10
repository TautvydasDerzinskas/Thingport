// What the content script does differently on each provider's pages. A provider with nothing of its own has an
// empty entry; the type makes sure every provider has one.

import type { ListKind, ProviderId } from "./index.generated";
import { parseCrealitycloudLikesUrl } from "./crealitycloud/urls.generated";
import { parseSnapmakerListUrl, snapmakerListUrl } from "../shared/urls";
import { crealitycloudUserId, loadCrealitycloudProfiles } from "./crealitycloud/content";
import { isUnboughtCgtraderModel } from "./cgtrader/content";
import { isUnboughtCults3dModel } from "./cults3d/content";
import { isUnboughtPixup3dModel } from "./pixup3d/content";
import { isUnboughtThreedexportModel } from "./threedexport/content";
import { meshyPlanLock, type MeshyPlanLock } from "./meshy/content";
import { loadMakeronlineProfiles } from "./makeronline/content";
import { loadMakerworldDesignForPage, makerworldProfileIds, makerworldScripts } from "./makerworld/pageData";
import { loadNexprintProfiles } from "./nexprint/content";
import { loadSnapmakerProfiles, snapmakerUserId } from "./snapmaker/content";
import { thangsDownloadBlock } from "./thangs/content";

export type ProfileScope = "url" | "designer" | "all";

/** What the panel shows in place of an import the site wouldn't allow. */
export type ImportBlock = { title: string; hint: string };

/** The generator script a page's model was built from: its name(s), and whether its creator kept it back. */
export type ScriptState = { filenames: string[]; withheld: boolean };

export type ContentModule = {
  /** The print profile ids each scope brings, the page's own first, for the panel's picker and its import. Null
   *  when they can't be read. */
  loadProfiles?(url: string): Promise<((scope: ProfileScope) => string[]) | null>;
  /** A link to one of the model's print profiles, where it isn't `#profileId-<id>`. */
  profileUrl?(url: string, profileId: string): string;
  /** Why the model on this page can't be imported, or null when it can, or that can't be told. */
  blockReason?(url: string): Promise<ImportBlock | null>;
  /** What the panel says of a list's model the instance marks as one the user can't import, by its reason. */
  listBlocks?: Readonly<Record<string, ImportBlock>>;
  /** The script this page's model was generated from, or null where it wasn't generated from one. A withheld
   *  script still lets the model import; it is only the script that can't come along. */
  scriptState?(url: string): Promise<ScriptState | null>;
  /** For lists only their owner sees, which the instance reads as the user, so they're offered on the owner's own
   *  page alone: the list's address as the instance takes it, or null on someone else's. Undefined for a list anyone
   *  sees. */
  ownList?(url: string, kind: ListKind): Promise<string | null | undefined>;
};

const PIXUP3D_PAID: ImportBlock = {
  title: "Paid model",
  hint: "Buy it on PIXUP first. Once it's in your library, Thingport imports it.",
};

const MESHY_BLOCKS: Record<MeshyPlanLock, ImportBlock> = {
  community: {
    title: "Needs Meshy Pro",
    hint:
      "Meshy keeps other people's community models for its Pro and Studio plans. Your own import on a free plan, " +
      "unless its AI agent made them.",
  },
  own: {
    title: "Needs a paid Meshy plan",
    hint: "Meshy keeps the models its AI agent made for paid plans, even yours.",
  },
};

export const CONTENT_MODULES: { readonly [K in ProviderId]: ContentModule } = {
  makerworld: {
    async loadProfiles(url) {
      const page = await loadMakerworldDesignForPage(url);
      return page ? (scope) => makerworldProfileIds(page.design, scope, page.requestedInstanceId) : null;
    },
    async scriptState(url) {
      const page = await loadMakerworldDesignForPage(url);
      return (page && makerworldScripts(page.design)) ?? null;
    },
  },
  printables: {},
  thingiverse: {},
  myminifactory: {
    // A bought object imports from the user's library; one they haven't has a cart button where its download is.
    async blockReason() {
      return document.querySelector('[data-component-name="DownloadButton"]')
        ? null
        : {
            title: "Paid model",
            hint: "Buy it on MyMiniFactory first. Once it's in your library, Thingport imports it from there.",
          };
    },
  },
  snapmaker: {
    loadProfiles: loadSnapmakerProfiles,
    // Likes and bookmarks share one page, whose address doesn't say which: the instance's names it.
    async ownList(url) {
      const [own, list] = [await snapmakerUserId(), parseSnapmakerListUrl(url)];
      return own && list && own === list.userId ? snapmakerListUrl(own, list.list) : null;
    },
  },
  makeronline: { loadProfiles: loadMakeronlineProfiles },
  crealitycloud: {
    loadProfiles: loadCrealitycloudProfiles,
    // Anyone can open a user's likes, but only their owner sees what's in them.
    async ownList(url, kind) {
      if (kind !== "likes") return undefined;
      const own = await crealitycloudUserId();
      return own && own === parseCrealitycloudLikesUrl(url)?.userId ? url : null;
    },
  },
  nexprint: {
    loadProfiles: loadNexprintProfiles,
    profileUrl(url, profileId) {
      const named = new URL(url);
      named.hash = "";
      named.searchParams.set("printConfigId", profileId);
      return named.toString();
    },
  },
  // Thangs counts every download against the account's daily ones, so one it would refuse isn't tried.
  thangs: { blockReason: thangsDownloadBlock },
  // Its only list, the likes, is the viewer's own page (/user/me/), which names no one else.
  eufymake: {},
  // Its collections and anyone's likes are anyone's to read.
  pinshape: {},
  // Its only list, the liked products, is the user's own page (/like-product), which names no one else.
  toymakr3d: {},
  // Its only list, the saved projects, is a tab of the user's own profile, which the instance matches to its
  // sign-in: a link to anyone else's is turned away there.
  makerables: {},
  // Its lists, the liked models and the wishlist, are the user's own pages (/profile/…), which name no one else. A
  // paid model is imported from the user's own purchases, so one they haven't bought isn't tried.
  cgtrader: {
    async blockReason(url) {
      return (await isUnboughtCgtraderModel(url))
        ? {
            title: "Paid model",
            hint: "Buy it on CGTrader first. Once it's in your purchases, Thingport imports it from there.",
          }
        : null;
    },
  },
  // Anyone's likes are anyone's to read, and every model is free.
  grabcad: {},
  // Its own pages need nothing special: a CAD project's export runs in a tab Grab opens on the editor
  // (owlcad/background.ts), not on the page the panel is shown on.
  owlcad: {},
  cults3d: {
    async blockReason(url) {
      return (await isUnboughtCults3dModel(url))
        ? {
            title: "Paid model",
            hint: "Buy it on Cults3D first. Once it's in your downloads, Thingport imports it from there.",
          }
        : null;
    },
  },
  // Its collections are anyone's to read, and the user's generations are their own workspace's. Meshy keeps other
  // people's community models for its Pro and Studio plans, and its AI agent's generations for paid ones, so one the
  // account's plan can't download isn't tried.
  meshy: {
    async blockReason(url) {
      const lock = await meshyPlanLock(url);
      return lock && MESHY_BLOCKS[lock];
    },
    listBlocks: MESHY_BLOCKS,
  },
  // Anyone's wishlist and collections are anyone's to read. A free model is ordered for $0 by the instance, a paid
  // one only imports once bought, so one the user hasn't bought isn't tried.
  pixup3d: {
    async blockReason(url) {
      return (await isUnboughtPixup3dModel(url)) ? PIXUP3D_PAID : null;
    },
    listBlocks: { paid: PIXUP3D_PAID },
  },
  // Its only list, the favourites, is the user's own page (/my/likes), which names no one else. A paid or ticket model
  // the user hasn't got is turned away by the import itself, with a message that says to buy or redeem it on Fab365.
  fab365: {},
  // Anyone's public collections are anyone's to read, and the user's own are read with their sign-in. A paid model is
  // imported once bought, so one their page offers to sell them isn't tried.
  threedexport: {
    async blockReason(url) {
      return isUnboughtThreedexportModel(url)
        ? { title: "Paid model", hint: "Buy it on 3DExport first. Once it's yours, Thingport imports it." }
        : null;
    },
  },
};
