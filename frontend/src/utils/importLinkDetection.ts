/** URL-shape detection shared by useUploadImport and AddMenu so they can't drift apart. The parsing itself is the
 *  providers' own (providers/<id>/urls.ts), the same the backend and Grab use; this only adds what the import box
 *  needs, such as taking a link pasted without its scheme. */

import { detectProvider, type ProviderId } from "../providers/_generated";
import {
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
} from "../providers/_generated/crealitycloud/urls";
import {
  parseCults3dLikesUrl,
  parseCults3dModelUrl,
  parseCults3dPrintlistUrl,
} from "../providers/_generated/cults3d/urls";
import {
  isMakeronlineLikesUrl,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
} from "../providers/_generated/makeronline/urls";
import { parseMakerworldCollectionUrl, parseMakerworldModelUrl } from "../providers/_generated/makerworld/urls";
import {
  parseMyminifactoryCollectionUrl,
  parseMyminifactoryObjectUrl,
} from "../providers/_generated/myminifactory/urls";
import { parseNexprintCollectionUrl, parseNexprintModelUrl } from "../providers/_generated/nexprint/urls";
import { parsePrintablesCollectionUrl, parsePrintablesModelUrl } from "../providers/_generated/printables/urls";
import { parseSnapmakerListUrl, parseSnapmakerModelUrl } from "../providers/_generated/snapmaker/urls";
import { isThangsLikesUrl, parseThangsCollectionUrl, parseThangsModelUrl } from "../providers/_generated/thangs/urls";
import {
  parseThingiverseCollectionUrl,
  parseThingiverseLikesUrl,
  parseThingiverseThingUrl,
} from "../providers/_generated/thingiverse/urls";

export { hostIs } from "../providers/_generated";

export type ImportProviderKey = ProviderId;

/** A link as typed, with https:// where it was left out. */
const withScheme = (url: string) => (url.includes("://") ? url : `https://${url}`);

export function detectImportProvider(url: string): ImportProviderKey | null {
  return detectProvider(withScheme(url));
}

/** Collection pages go to the collection picker instead of the single-link flow. */
export const isMakerworldCollectionUrl = (url: string) => !!parseMakerworldCollectionUrl(withScheme(url));
export const isMakerworldModelUrl = (url: string) => !!parseMakerworldModelUrl(withScheme(url));

/** Thingiverse and Printables have their own backend import paths, so skip the generic inspect/zip
 * flow for them. */
export const isThingiverseThingUrl = (url: string) => !!parseThingiverseThingUrl(withScheme(url));
export const isThingiverseLikesUrl = (url: string) => !!parseThingiverseLikesUrl(withScheme(url));
export const isThingiverseCollectionUrl = (url: string) => !!parseThingiverseCollectionUrl(withScheme(url));

/** A numbered collection only: a user's liked models only Grab can read, as their owner. */
export const isPrintablesCollectionUrl = (url: string) => !!parsePrintablesCollectionUrl(withScheme(url));
export const isPrintablesModelUrl = (url: string) => !!parsePrintablesModelUrl(withScheme(url));

export const isMyminifactoryObjectUrl = (url: string) => !!parseMyminifactoryObjectUrl(withScheme(url));
export const isMyminifactoryCollectionUrl = (url: string) => !!parseMyminifactoryCollectionUrl(withScheme(url));

export const isSnapmakerModelUrl = (url: string) => !!parseSnapmakerModelUrl(withScheme(url));
/** The user's own likes or bookmarks: one page, `/creator/<id>?tab=interactions`, with `list` saying which. */
export const isSnapmakerListUrl = (url: string) => !!parseSnapmakerListUrl(withScheme(url))?.list;

export const isMakeronlineModelUrl = (url: string) => !!parseMakeronlineModelUrl(withScheme(url));
/** A MakerOnline collection, or the signed-in user's likes. */
export const isMakeronlineListUrl = (url: string) =>
  !!parseMakeronlineCollectionUrl(withScheme(url)) || isMakeronlineLikesUrl(withScheme(url));

export const isCrealitycloudModelUrl = (url: string) => !!parseCrealitycloudModelUrl(withScheme(url));
/** A Creality Cloud collection, or the user's likes. */
export const isCrealitycloudListUrl = (url: string) =>
  !!parseCrealitycloudCollectionUrl(withScheme(url)) || !!parseCrealitycloudLikesUrl(withScheme(url));

export const isNexprintModelUrl = (url: string) => !!parseNexprintModelUrl(withScheme(url));
export const isNexprintCollectionUrl = (url: string) => !!parseNexprintCollectionUrl(withScheme(url));

export const isThangsModelUrl = (url: string) => !!parseThangsModelUrl(withScheme(url));
/** A Thangs collection, or the user's own likes. */
export const isThangsListUrl = (url: string) =>
  !!parseThangsCollectionUrl(withScheme(url)) || isThangsLikesUrl(withScheme(url));

export const isCults3dModelUrl = (url: string) => !!parseCults3dModelUrl(withScheme(url));
/** A user's likes or a printlist. */
export const isCults3dListUrl = (url: string) =>
  !!parseCults3dLikesUrl(withScheme(url)) || !!parseCults3dPrintlistUrl(withScheme(url));

export const IMPORT_LINK_EXAMPLES: Record<ImportProviderKey, { model: string; collection: string }> = {
  makerworld: {
    model: "https://makerworld.com/en/models/123456-example-model",
    collection: "https://makerworld.com/en/collections/12345-example-collection",
  },
  thingiverse: {
    model: "https://www.thingiverse.com/thing:1234567",
    collection: "https://www.thingiverse.com/username/collections/12345-example-collection",
  },
  printables: {
    model: "https://www.printables.com/model/123456-example-model",
    collection: "https://www.printables.com/@username/collections/12345-example-collection",
  },
  myminifactory: {
    model: "https://www.myminifactory.com/object/3d-print-example-model-123456",
    collection: "https://www.myminifactory.com/users/username/collection/example-collection",
  },
  snapmaker: {
    model: "https://space.snapmaker.com/en/model/12345-example-model",
    collection: "https://space.snapmaker.com/en/creator/12345?tab=interactions&list=likes",
  },
  makeronline: {
    model: "https://www.makeronline.com/en/model/Example-Model/123456.html",
    collection: "https://www.makeronline.com/en/user/collectionDetail/…/123456.html",
  },
  crealitycloud: {
    model: "https://www.crealitycloud.com/model-detail/example-model",
    collection: "https://www.crealitycloud.com/collection/3d-model-collection-AbCdEf",
  },
  nexprint: {
    model: "https://www.nexprint.com/en/models/G1234567",
    collection: "https://www.nexprint.com/en/collection/G12345678",
  },
  thangs: {
    model: "https://thangs.com/designer/username/3d-model/Example%20Model-1234567",
    collection: "https://thangs.com/designer/username/collection/Example%20Collection-123456",
  },
  cults3d: {
    model: "https://cults3d.com/en/3d-model/art/example-model",
    collection: "https://cults3d.com/en/design-collections/username/example-printlist",
  },
};
