/** Shared URL-shape detection for the "Import from link" flow -- both useUploadImport (which
 *  decides which import flow a pasted link should run through) and AddMenu (which highlights the
 *  matching provider chip and blocks MakerWorld collection links) read from this single set of
 *  patterns, so the two can never drift apart on what counts as e.g. "a MakerWorld collection
 *  URL". */

export type ImportProviderKey = "makerworld" | "thingiverse" | "printables";

function parseUrl(url: string): URL | null {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return null;
  }
}

/** Which provider (if any) a pasted link belongs to, regardless of whether it's a single-model
 *  or a collection/likes page -- used to highlight the matching chip as the user types/pastes. */
export function detectImportProvider(url: string): ImportProviderKey | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith("makerworld.com")) return "makerworld";
  if (host === "thingiverse.com" || host === "www.thingiverse.com") return "thingiverse";
  if (host === "printables.com" || host === "www.printables.com") return "printables";
  return null;
}

/** MakerWorld collection URLs (`/en/collections/{id}-{slug}`) list many models rather than
 * being one model page -- route those to the collection picker instead of the single-link
 * inspect/zip flow. */
export function isMakerworldCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return Boolean(parsed && parsed.hostname.toLowerCase().endsWith("makerworld.com") && /\/collections\/\d+/i.test(parsed.pathname));
}

/** A Thingiverse Thing import goes through its own backend path entirely (see
 * importService.ts's importThingiverseThing) rather than the generic inspect/zip-picker flow --
 * skip straight to a plain import call so the zip-entry picker (meant for arbitrary remote
 * zips) never shows up for one. Every recognized model file on the Thing becomes its own plate
 * automatically. */
export function isThingiverseThingUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /thing:\d+/i.test(parsed.pathname) || /\/things\/\d+/i.test(parsed.pathname);
}

/** A Thingiverse user's own "Likes" page (`thingiverse.com/{username}/likes`) -- the site's own
 * bookmark/save mechanism many people use to collect prints worth making. Lists many Things
 * rather than being one Thing page, so route it to the same collection picker MakerWorld
 * collections use. */
export function isThingiverseLikesUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /^\/[^/]+\/likes\/?$/i.test(parsed.pathname);
}

/** A user-curated, named Thingiverse Collection (`thingiverse.com/{username}/collections/{id}`,
 * optionally with a trailing `/things`) -- the site's other bookmark mechanism besides the
 * automatic Likes list above. Also routed to the collection picker. */
export function isThingiverseCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
  return /\/collections\/\d+/i.test(parsed.pathname);
}

/** A user-curated, named Printables Collection (`printables.com/@handle/collections/{id}`) --
 * the site's bookmark mechanism, one page listing many models rather than a single model page.
 * Routed to the same collection picker MakerWorld/Thingiverse collections use. */
export function isPrintablesCollectionUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return false;
  return /\/collections\/\d+/i.test(parsed.pathname);
}

/** A Printables model import goes through its own backend path entirely (see
 * importService.ts's importPrintablesModel) rather than the generic inspect/zip-picker flow --
 * skip straight to a plain import call, same reasoning as isThingiverseThingUrl above (and
 * necessary here too: www.printables.com is Cloudflare-gated, so the generic inspect flow
 * couldn't resolve one of these URLs anyway). */
export function isPrintablesModelUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return false;
  return /\/model\/\d+/i.test(parsed.pathname);
}

/** Sample link shapes shown when a provider chip is clicked in the "Import from link" dialog --
 *  purely illustrative text, not live links. */
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
};
