// Which provider page a URL is, for the content script and the popup. The parsing is the providers' own
// (providers/<id>/urls.ts), the same the backend and the web app use.

import { type ListKind, parseListUrl, parseModelUrl, type ProviderId, MANIFESTS } from "./providers/_generated";
import { parseSnapmakerListUrl as parseSnapmakerListLink } from "./providers/_generated/snapmaker/urls";

export type Provider = ProviderId;

export type Classification =
  { kind: "single"; provider: Provider; externalId: string } | { kind: "batch"; provider: Provider; type: ListKind };

export type SnapmakerList = "likes" | "bookmarks";

export { hostIs } from "./providers/_generated";
export { snapmakerListUrl } from "./providers/_generated/snapmaker/urls";

/** The user's likes and bookmarks share one page, `/creator/<id>?tab=interactions`, whose address stays the same
 *  whichever is shown, so a page without `list` opens on likes, as the site does; the panel switches between them. */
export function parseSnapmakerListUrl(url: string): { userId: string; list: SnapmakerList } | null {
  const parsed = parseSnapmakerListLink(url);
  return parsed && { userId: parsed.userId, list: parsed.list ?? "likes" };
}

/** Null keeps the icon hidden. "single" pages get a dedup check; "batch" pages always show it. */
export function classifyUrl(url: string): Classification | null {
  const snapmakerList = parseSnapmakerListUrl(url);
  if (snapmakerList) return { kind: "batch", provider: MANIFESTS.snapmaker.id, type: snapmakerList.list };
  const list = parseListUrl(url);
  // Printables likes are their owner's alone, read as the user and pushed (see content/printables.ts), not imported here.
  if (list && !(list.provider === MANIFESTS.printables.id && list.kind === "likes")) {
    return { kind: "batch", provider: list.provider, type: list.kind };
  }
  const model = parseModelUrl(url);
  return model && { kind: "single", provider: model.provider, externalId: model.externalId };
}

/** `provider:id` for a model page, the same for every tab and print profile of one model. Null for anything else. */
export function modelKey(url: string): string | null {
  const classification = classifyUrl(url);
  return classification?.kind === "single" ? `${classification.provider}:${classification.externalId}` : null;
}

export function isMakerworldUrl(url: string | undefined | null): boolean {
  return Boolean(url) && classifyUrl(url!)?.provider === MANIFESTS.makerworld.id;
}
