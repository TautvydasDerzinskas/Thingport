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
