/** URL-shape detection shared by useUploadImport and AddMenu so they can't drift apart. The parsing itself is the
 *  providers' own (providers/<id>/urls.ts), the same the backend and Grab use; this only adds what the import box
 *  needs, such as taking a link pasted without its scheme. */

import { detectProvider, MANIFESTS, parseListUrl, parseModelUrl, type ProviderId } from "../providers/_generated";

export { hostIs } from "../providers/_generated";

export type ImportProviderKey = ProviderId;

/** A link as typed, with https:// where it was left out. */
const withScheme = (url: string) => (url.includes("://") ? url : `https://${url}`);

export function detectImportProvider(url: string): ImportProviderKey | null {
  return detectProvider(withScheme(url));
}

/** The model page a link is, on whichever provider. */
export const modelLinkOf = (url: string) => parseModelUrl(withScheme(url));

/** The collection, likes or bookmarks a link is, which go to the list picker instead of the single-link flow. */
export const listLinkOf = (url: string) => parseListUrl(withScheme(url));

/** MakerWorld collections import through Thingport Grab only, not the import box. */
export const isMakerworldCollectionUrl = (url: string) => listLinkOf(url)?.provider === "makerworld";

/** Whether a link is a model with print profiles to pick between. */
export function hasPrintProfiles(url: string): boolean {
  const model = modelLinkOf(url);
  return !!model && MANIFESTS[model.provider].capabilities.profiles;
}

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
