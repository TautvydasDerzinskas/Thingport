/** URL-shape detection shared by useUploadImport and AddMenu so they can't drift apart. */

export type ImportProviderKey =
  | "makerworld"
  | "thingiverse"
  | "printables"
  | "myminifactory"
  | "snapmaker"
  | "makeronline"
  | "crealitycloud"
  | "nexprint"
  | "thangs"
  | "cults3d";

/** True for `domain` itself and its subdomains, never for a look-alike that only ends in the same letters
 *  (`fake-makerworld.com`), which a bare `endsWith(domain)` would take for the provider. */
export function hostIs(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
}

export function detectImportProvider(url: string): ImportProviderKey | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  if (hostIs(host, "makerworld.com")) return "makerworld";
  if (host === "thingiverse.com" || host === "www.thingiverse.com") return "thingiverse";
  if (host === "printables.com" || host === "www.printables.com") return "printables";
  if (host === "myminifactory.com" || host === "www.myminifactory.com") return "myminifactory";
  if (host === "space.snapmaker.com") return "snapmaker";
  if (host === "makeronline.com" || host === "www.makeronline.com") return "makeronline";
  if (host === "crealitycloud.com" || host === "www.crealitycloud.com") return "crealitycloud";
  if (host === "nexprint.com" || host === "www.nexprint.com") return "nexprint";
  if (host === "thangs.com" || host === "www.thangs.com") return "thangs";
  if (host === "cults3d.com" || host === "www.cults3d.com") return "cults3d";
  return null;
}

/** Collection pages go to the collection picker instead of the single-link flow. */
export function isMakerworldCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && hostIs(parsed.hostname, "makerworld.com") && /\/collections\/\d+/i.test(parsed.pathname));
}

export function isMakerworldModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && hostIs(parsed.hostname, "makerworld.com") && /\/models?\/\d+/i.test(parsed.pathname));
}

/** Thingiverse and Printables have their own backend import paths, so skip the generic inspect/zip
 * flow for them. */
export function isThingiverseThingUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /thing:\d+/i.test(parsed.pathname) || /\/things\/\d+/i.test(parsed.pathname);
}

export function isThingiverseLikesUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /^\/[^/]+\/likes\/?$/i.test(parsed.pathname);
}

export function isThingiverseCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /\/collections\/\d+/i.test(parsed.pathname);
}

export function isPrintablesCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return false;
  return /\/collections\/\d+/i.test(parsed.pathname);
}

/** See isThingiverseThingUrl. */
export function isPrintablesModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return false;
  return /\/model\/\d+/i.test(parsed.pathname);
}

/** See isThingiverseThingUrl. A language prefix ("/it/object/...") is allowed. */
export function isMyminifactoryObjectUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "myminifactory.com" && host !== "www.myminifactory.com") return false;
  return /^\/(?:[a-z]{2}\/)?object\/(?:[^/]*-)?\d+\/?$/i.test(parsed.pathname);
}

export function isMyminifactoryCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "myminifactory.com" && host !== "www.myminifactory.com") return false;
  return /^\/(?:[a-z]{2}\/)?users\/[^/]+\/collection\/[^/]+\/?$/i.test(parsed.pathname);
}

/** See isThingiverseThingUrl. `#profileId-<id>` may pick a print profile. */
export function isSnapmakerModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname.toLowerCase() !== "space.snapmaker.com") return false;
  return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model\/\d+(?:-[^/]*)?\/?$/i.test(parsed.pathname);
}

/** The user's own likes or bookmarks: one page, `/creator/<id>?tab=interactions`, with `list` saying which. */
export function isSnapmakerListUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.hostname.toLowerCase() !== "space.snapmaker.com") return false;
  return (
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?creator\/\d+\/?$/i.test(parsed.pathname) &&
    parsed.searchParams.get("tab") === "interactions" &&
    ["likes", "bookmarks"].includes(parsed.searchParams.get("list") ?? "")
  );
}

function isMakeronlineHost(parsed: URL): boolean {
  return /^(www\.)?makeronline\.com$/i.test(parsed.hostname);
}

/** See isThingiverseThingUrl. `/en/model/<title>/<id>.html`; `#profileId-<id>` may pick a print profile. */
export function isMakeronlineModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isMakeronlineHost(parsed)) return false;
  return /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?model\/(?:[^/]+\/)?\d+(?:\.html)?\/?$/i.test(parsed.pathname);
}

/** A MakerOnline collection, or the signed-in user's likes (`/en/user/likes/models.html`). */
export function isMakeronlineListUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isMakeronlineHost(parsed)) return false;
  return /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/)?user\/(?:collectionDetail\/(?:[\w-]+\/)?\d+|likes\/models)(?:\.html)?\/?$/i.test(
    parsed.pathname,
  );
}

function isCrealitycloudHost(parsed: URL): boolean {
  return /^(www\.)?crealitycloud\.com$/i.test(parsed.hostname);
}

const CREALITYCLOUD_LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;

/** See isThingiverseThingUrl. `/model-detail/<alias>`; `#profileId-<id>` may pick a print profile. */
export function isCrealitycloudModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isCrealitycloudHost(parsed)) return false;
  return new RegExp(String.raw`^/${CREALITYCLOUD_LANG}model-detail/[\w-]+/?$`, "i").test(parsed.pathname);
}

/** A Creality Cloud collection (`/collection/<alias>`), or the user's likes (`/user/<id>/likes`). */
export function isCrealitycloudListUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isCrealitycloudHost(parsed)) return false;
  return new RegExp(String.raw`^/${CREALITYCLOUD_LANG}(?:collection/[\w-]+|user/\d+/likes)/?$`, "i").test(
    parsed.pathname,
  );
}

function isNexprintHost(parsed: URL): boolean {
  return /^(www\.)?nexprint\.com$/i.test(parsed.hostname);
}

const NEXPRINT_LANG = String.raw`(?:[a-z]{2}(?:-[a-z]{2,4})?/)?`;

/** See isThingiverseThingUrl. `/en/models/<id>`; `?printConfigId=<id>` may pick a print profile. */
export function isNexprintModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isNexprintHost(parsed)) return false;
  return new RegExp(String.raw`^/${NEXPRINT_LANG}models/G\d+/?$`, "i").test(parsed.pathname);
}

/** A NexPrint collection: `/en/collection/<id>`, or open on its owner's page (`/en/<user>/home?...&collectionId=`). */
export function isNexprintCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isNexprintHost(parsed)) return false;
  if (new RegExp(String.raw`^/${NEXPRINT_LANG}collection/G\d+/?$`, "i").test(parsed.pathname)) return true;
  return (
    new RegExp(String.raw`^/${NEXPRINT_LANG}U\d+/home/?$`, "i").test(parsed.pathname) &&
    /^G\d+$/i.test(parsed.searchParams.get("collectionId") ?? "")
  );
}

function isThangsHost(parsed: URL): boolean {
  return /^(www\.)?thangs\.com$/i.test(parsed.hostname);
}

/** See isThingiverseThingUrl. `/designer/<user>/3d-model/<name>-<id>` (also under `/prints`, and with a subpage), or
 *  `/m/<id>`. */
export function isThangsModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isThangsHost(parsed)) return false;
  return (
    /^\/(?:prints\/)?designer\/[^/]+\/3d-model\/(?:[^/]*-)?\d+(?:\/.*)?$/i.test(parsed.pathname) ||
    /^\/m\/\d+\/?$/i.test(parsed.pathname)
  );
}

/** A Thangs collection (`/designer/<user>/collection/<name>-<id>`, `/mythangs/collections/<id>`) or the user's own
 *  likes (`/mythangs/liked-models`). */
export function isThangsListUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isThangsHost(parsed)) return false;
  return (
    /^\/designer\/[^/]+\/collection\/(?:[^/]*-)?\d+(?:\/.*)?$/i.test(parsed.pathname) ||
    /^\/(?:mythangs\/collections|c)\/\d+\/?$/i.test(parsed.pathname) ||
    /^\/mythangs\/liked-models\/?$/i.test(parsed.pathname)
  );
}

/** Cults3D's path segments, decoded and lower-cased: it writes them in each of its languages, accents and all. */
function cults3dSegments(url: string): string[] | null {
  const parsed = parseUrl(url);
  if (!parsed || !/^(www\.)?cults3d\.com$/i.test(parsed.hostname)) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  try {
    return parts.map((part) => decodeURIComponent(part).toLowerCase());
  } catch {
    return parts.map((part) => part.toLowerCase());
  }
}

// What each of Cults3D's languages calls a model page, likes and printlists ("design collections"). Kept in step
// with the backend's cults3dApi.ts.
const CULTS3D_MODEL_WORDS = new Set([
  "3d-model",
  "modell-3d",
  "modelo-3d",
  "modèle-3d",
  "modello-3d",
  "3d-moderu",
  "3d-móxíng",
]);
const CULTS3D_LIKES_WORDS = new Set(["likes", "mi-piace", "iine-ichiran", "curtidas", "laiki", "beğeniler", "xǐhuān"]);
const CULTS3D_PRINTLIST_WORDS = new Set([
  "design-collections",
  "drucklisten",
  "colecciones-de-diseños",
  "collections-de-designs",
  "raccolta-progetti",
  "dezain-korekushon",
  "designs-colecoes",
  "dizain-kollektsii",
  "tasarım-koleksiyonlar",
  "shèjì-xìliè",
]);
const CULTS3D_LIST_PAGES = new Set([
  "latest",
  "popular",
  "selected",
  "trending",
  "best-sellers",
  "random",
  "mine",
  "new",
]);

/** See isThingiverseThingUrl. `/<locale>/3d-model/<category>/<slug>` in any of its languages, or
 *  `/<locale>/creations/<slug>`. */
export function isCults3dModelUrl(url: string): boolean {
  const parts = cults3dSegments(url);
  if (!parts || !/^[a-z]{2}$/.test(parts[0] ?? "")) return false;
  if (CULTS3D_MODEL_WORDS.has(parts[1]) && parts.length >= 4) return true;
  return parts[1] === "creations" && parts.length === 3 && !CULTS3D_LIST_PAGES.has(parts[2]);
}

/** A user's likes (`/<locale>/users/<nick>/likes`) or a printlist (`/<locale>/design-collections/<nick>/<slug>`). */
export function isCults3dListUrl(url: string): boolean {
  const parts = cults3dSegments(url);
  if (!parts || parts.length !== 4 || !/^[a-z]{2}$/.test(parts[0])) return false;
  return CULTS3D_LIKES_WORDS.has(parts[3]) || CULTS3D_PRINTLIST_WORDS.has(parts[1]);
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
