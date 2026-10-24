// Which provider page a URL is, for the content script and the popup. The parsing is the providers' own
// (providers/<id>/urls.ts), the same the backend and the web app use.

import {
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
} from "./providers/_generated/crealitycloud/urls";
import {
  parseCults3dLikesUrl,
  parseCults3dModelUrl,
  parseCults3dPrintlistUrl,
} from "./providers/_generated/cults3d/urls";
import {
  isMakeronlineLikesUrl,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
} from "./providers/_generated/makeronline/urls";
import {
  makerworldModelUrl,
  parseMakerworldCollectionUrl,
  parseMakerworldModelUrl,
} from "./providers/_generated/makerworld/urls";
import {
  parseMyminifactoryCollectionUrl,
  parseMyminifactoryObjectUrl,
} from "./providers/_generated/myminifactory/urls";
import { parseNexprintCollectionUrl, parseNexprintModelUrl } from "./providers/_generated/nexprint/urls";
import { parsePrintablesCollectionUrl, parsePrintablesModelUrl } from "./providers/_generated/printables/urls";
import {
  parseSnapmakerListUrl as parseSnapmakerListLink,
  parseSnapmakerModelUrl,
  snapmakerListUrl,
} from "./providers/_generated/snapmaker/urls";
import { isThangsLikesUrl, parseThangsCollectionUrl, parseThangsModelUrl } from "./providers/_generated/thangs/urls";
import {
  parseThingiverseCollectionUrl,
  parseThingiverseLikesUrl,
  parseThingiverseThingUrl,
} from "./providers/_generated/thingiverse/urls";

import type { ProviderId } from "./providers/_generated";

export type Provider = ProviderId;

export type Classification =
  | { kind: "single"; provider: "makerworld"; type: "model" }
  | { kind: "single"; provider: "thingiverse"; type: "thing" }
  | { kind: "single"; provider: "printables"; type: "model" }
  | { kind: "single"; provider: "myminifactory"; type: "object" }
  | { kind: "single"; provider: "snapmaker"; type: "model" }
  | { kind: "single"; provider: "makeronline"; type: "model" }
  | { kind: "single"; provider: "crealitycloud"; type: "model" }
  | { kind: "single"; provider: "nexprint"; type: "model" }
  | { kind: "single"; provider: "thangs"; type: "model" }
  | { kind: "single"; provider: "cults3d"; type: "model" }
  | { kind: "batch"; provider: "makerworld"; type: "collection" }
  | { kind: "batch"; provider: "thingiverse"; type: "likes" | "collection" }
  | { kind: "batch"; provider: "printables"; type: "collection" }
  | { kind: "batch"; provider: "myminifactory"; type: "collection" }
  | { kind: "batch"; provider: "snapmaker"; type: SnapmakerList }
  | { kind: "batch"; provider: "makeronline"; type: "collection" | "likes" }
  | { kind: "batch"; provider: "crealitycloud"; type: "collection" | "likes" }
  | { kind: "batch"; provider: "nexprint"; type: "collection" }
  | { kind: "batch"; provider: "thangs"; type: "collection" | "likes" }
  | { kind: "batch"; provider: "cults3d"; type: "collection" | "likes" };

export type SnapmakerList = "likes" | "bookmarks";

export { hostIs } from "./providers/_generated";
export {
  makerworldModelUrl,
  parseMakerworldModelUrl,
  parseThingiverseThingUrl,
  parsePrintablesModelUrl,
  parseMyminifactoryObjectUrl,
  parseSnapmakerModelUrl,
  snapmakerListUrl,
  isMakeronlineLikesUrl,
  parseMakeronlineModelUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
  parseNexprintModelUrl,
  isThangsLikesUrl,
  parseThangsModelUrl,
  parseCults3dModelUrl,
};

export const isMakerworldCollectionUrl = (url: string) => !!parseMakerworldCollectionUrl(url);

export function isMakerworldUrl(url: string | undefined | null): boolean {
  return Boolean(url) && (Boolean(parseMakerworldModelUrl(url!)) || isMakerworldCollectionUrl(url!));
}

export const isThingiverseLikesUrl = (url: string) => !!parseThingiverseLikesUrl(url);
export const isThingiverseCollectionUrl = (url: string) => !!parseThingiverseCollectionUrl(url);
export const isPrintablesCollectionUrl = (url: string) => !!parsePrintablesCollectionUrl(url);
export const isMyminifactoryCollectionUrl = (url: string) => !!parseMyminifactoryCollectionUrl(url);

/** The user's likes and bookmarks share one page, `/creator/<id>?tab=interactions`, whose address stays the same
 *  whichever is shown, so a page without `list` opens on likes, as the site does; the panel switches between them. */
export function parseSnapmakerListUrl(url: string): { userId: string; list: SnapmakerList } | null {
  const parsed = parseSnapmakerListLink(url);
  return parsed && { userId: parsed.userId, list: parsed.list ?? "likes" };
}

export const isMakeronlineCollectionUrl = (url: string) => !!parseMakeronlineCollectionUrl(url);
export const isCrealitycloudCollectionUrl = (url: string) => !!parseCrealitycloudCollectionUrl(url);
export const isNexprintCollectionUrl = (url: string) => !!parseNexprintCollectionUrl(url);
export const isThangsCollectionUrl = (url: string) => !!parseThangsCollectionUrl(url);
export const isCults3dPrintlistUrl = (url: string) => !!parseCults3dPrintlistUrl(url);
export const isCults3dLikesUrl = (url: string) => !!parseCults3dLikesUrl(url);

/** Null keeps the icon hidden. "single" pages get a dedup check; "batch" pages always show it. */
export function classifyUrl(url: string): Classification | null {
  if (isMakerworldCollectionUrl(url)) return { kind: "batch", provider: "makerworld", type: "collection" };
  if (isThingiverseLikesUrl(url)) return { kind: "batch", provider: "thingiverse", type: "likes" };
  if (isThingiverseCollectionUrl(url)) return { kind: "batch", provider: "thingiverse", type: "collection" };
  if (isPrintablesCollectionUrl(url)) return { kind: "batch", provider: "printables", type: "collection" };
  if (isMyminifactoryCollectionUrl(url)) return { kind: "batch", provider: "myminifactory", type: "collection" };
  const snapmakerList = parseSnapmakerListUrl(url);
  if (snapmakerList) return { kind: "batch", provider: "snapmaker", type: snapmakerList.list };
  if (isMakeronlineCollectionUrl(url)) return { kind: "batch", provider: "makeronline", type: "collection" };
  if (isMakeronlineLikesUrl(url)) return { kind: "batch", provider: "makeronline", type: "likes" };
  if (isCrealitycloudCollectionUrl(url)) return { kind: "batch", provider: "crealitycloud", type: "collection" };
  if (parseCrealitycloudLikesUrl(url)) return { kind: "batch", provider: "crealitycloud", type: "likes" };
  if (isNexprintCollectionUrl(url)) return { kind: "batch", provider: "nexprint", type: "collection" };
  if (isThangsCollectionUrl(url)) return { kind: "batch", provider: "thangs", type: "collection" };
  if (isThangsLikesUrl(url)) return { kind: "batch", provider: "thangs", type: "likes" };
  if (isCults3dPrintlistUrl(url)) return { kind: "batch", provider: "cults3d", type: "collection" };
  if (isCults3dLikesUrl(url)) return { kind: "batch", provider: "cults3d", type: "likes" };
  if (parseMakerworldModelUrl(url)) return { kind: "single", provider: "makerworld", type: "model" };
  if (parseThingiverseThingUrl(url)) return { kind: "single", provider: "thingiverse", type: "thing" };
  if (parsePrintablesModelUrl(url)) return { kind: "single", provider: "printables", type: "model" };
  if (parseMyminifactoryObjectUrl(url)) return { kind: "single", provider: "myminifactory", type: "object" };
  if (parseSnapmakerModelUrl(url)) return { kind: "single", provider: "snapmaker", type: "model" };
  if (parseMakeronlineModelUrl(url)) return { kind: "single", provider: "makeronline", type: "model" };
  if (parseCrealitycloudModelUrl(url)) return { kind: "single", provider: "crealitycloud", type: "model" };
  if (parseNexprintModelUrl(url)) return { kind: "single", provider: "nexprint", type: "model" };
  if (parseThangsModelUrl(url)) return { kind: "single", provider: "thangs", type: "model" };
  if (parseCults3dModelUrl(url)) return { kind: "single", provider: "cults3d", type: "model" };
  return null;
}

/** `provider:id` for a model page, the same for every tab and print profile of one model. Null for anything else. */
export function modelKey(url: string): string | null {
  const id =
    parseMakerworldModelUrl(url)?.designId ??
    parseThingiverseThingUrl(url)?.thingId ??
    parsePrintablesModelUrl(url)?.modelId ??
    parseMyminifactoryObjectUrl(url)?.objectId ??
    parseSnapmakerModelUrl(url)?.modelId ??
    parseMakeronlineModelUrl(url)?.modelId ??
    parseCrealitycloudModelUrl(url)?.modelId ??
    parseNexprintModelUrl(url)?.modelId ??
    parseThangsModelUrl(url)?.modelId ??
    parseCults3dModelUrl(url)?.slug;
  const classification = classifyUrl(url);
  return id && classification?.kind === "single" ? `${classification.provider}:${id}` : null;
}
