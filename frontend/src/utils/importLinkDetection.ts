/** URL-shape detection shared by useUploadImport, AddMenu and LinkSourceDialog so they can't drift apart. The parsing itself is the
 *  providers' own (providers/<id>/urls.ts), the same the backend and Grab use; this only adds what the import box
 *  needs, such as taking a link pasted without its scheme. */

import {
  detectProvider,
  MANIFESTS,
  manifestOf,
  parseListUrl,
  parseModelUrl,
  type ProviderId,
} from "../providers/index.generated";

export { hostIs } from "../providers/index.generated";

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

/** A list whose provider imports lists through Thingport Grab only, not the import box. */
export function isGrabOnlyList(url: string): boolean {
  const list = listLinkOf(url);
  return !!list && manifestOf(list.provider).capabilities.listImport === "grab";
}

/** Whether a provider's model files come only through Thingport Grab, on its own pages. */
export const filesNeedGrab = (provider: ProviderId) => MANIFESTS[provider].helpers.grab === "required";

/** Whether a link is a model with print profiles to pick between. */
export function hasPrintProfiles(url: string): boolean {
  const model = modelLinkOf(url);
  return !!model && MANIFESTS[model.provider].capabilities.profiles;
}

export type ModelLinkProblem = "several" | "list" | "notModel" | "disabled";

/** Why a link can't be the page a model is linked to, or null when it can: it takes one model's page, on a provider
 *  an admin hasn't turned off. */
export function modelLinkProblem(link: string, disabled: ReadonlySet<ProviderId>): ModelLinkProblem | null {
  const url = link.trim();
  if (/\s/.test(url)) return "several";
  if (listLinkOf(url)) return "list";
  const model = modelLinkOf(url);
  if (!model) return "notModel";
  return disabled.has(model.provider) ? "disabled" : null;
}
