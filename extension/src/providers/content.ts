// What the content script does differently on each provider's pages. A provider with nothing of its own has an
// empty entry; the type makes sure every provider has one.

import type { ListKind, ProviderId } from "./index.generated";
import { parseCrealitycloudLikesUrl } from "./crealitycloud/urls.generated";
import { parseSnapmakerListUrl, snapmakerListUrl } from "../shared/urls";
import { crealitycloudUserId, loadCrealitycloudProfiles } from "./crealitycloud/content";
import { isUnboughtCults3dModel } from "./cults3d/content";
import { loadMakeronlineProfiles } from "./makeronline/content";
import { loadMakerworldDesignForPage, makerworldProfileIds } from "./makerworld/pageData";
import { loadNexprintProfiles } from "./nexprint/content";
import { loadSnapmakerProfiles, snapmakerUserId } from "./snapmaker/content";
import { thangsDownloadBlock } from "./thangs/content";

export type ProfileScope = "url" | "designer" | "all";

/** What the panel shows in place of an import the site wouldn't allow. */
export type ImportBlock = { title: string; hint: string };

export type ContentModule = {
  /** The print profile ids each scope brings, the page's own first, for the panel's picker and its import. Null
   *  when they can't be read. */
  loadProfiles?(url: string): Promise<((scope: ProfileScope) => string[]) | null>;
  /** A link to one of the model's print profiles, where it isn't `#profileId-<id>`. */
  profileUrl?(url: string, profileId: string): string;
  /** Why the model on this page can't be imported, or null when it can, or that can't be told. */
  blockReason?(url: string): Promise<ImportBlock | null>;
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
  // Anything public on it is anyone's to read: models, their files, collections and creators.
  threedprintsocial: {},
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
