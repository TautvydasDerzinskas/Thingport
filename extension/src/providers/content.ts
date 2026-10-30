// What the content script does differently on each provider's pages. A provider with nothing of its own has an
// empty entry; the type makes sure every provider has one.

import type { ListKind, ProviderId } from "./index.generated";
import { parseCrealitycloudLikesUrl } from "./crealitycloud/urls.generated";
import { parseSnapmakerListUrl, snapmakerListUrl } from "../shared/urls";
import { crealitycloudUserId, loadCrealitycloudProfiles } from "./crealitycloud/content";
import { isUnboughtCgtraderModel } from "./cgtrader/content";
import { isUnboughtCults3dModel } from "./cults3d/content";
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
  /** The script this page's model was generated from, or null where it wasn't generated from one. A withheld
   *  script still lets the model import; it is only the script that can't come along. */
  scriptState?(url: string): Promise<ScriptState | null>;
  /** For lists only their owner sees, which the instance reads as the user, so they're offered on the owner's own
   *  page alone: the list's address as the instance takes it, or null on someone else's. Undefined for a list anyone
   *  sees. */
  ownList?(url: string, kind: ListKind): Promise<string | null | undefined>;
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
    async blockReason() {
      return isUnboughtCults3dModel()
        ? {
            title: "Paid model",
            hint: "Buy it on Cults3D first. Once it's in your downloads, Thingport imports it from there.",
          }
        : null;
    },
  },
};
