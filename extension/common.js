// Shared between background.js (service worker, via importScripts) and content.js (content
// script, loaded before it in manifest.json's content_scripts.js array) -- plain global
// functions/constants rather than ES module import/export so both loading mechanisms work
// unmodified.

const THINGPORT_STORAGE_KEYS = {
  instanceUrl: "instanceUrl",
  email: "email",
  password: "password",
  disabled: "disabled",
  token: "token",
  tokenExpiresAt: "tokenExpiresAt",
  // The last MakerWorld `token` cookie value pushed to this account's Thingport-stored
  // makerworld_cookie -- lets background.js's cookie sync skip a redundant PATCH when the live
  // browser cookie hasn't actually changed since the last one. See background.js's
  // maybeSyncMakerworldCookie.
  lastSyncedMakerworldCookie: "lastSyncedMakerworldCookie",
};

/** Strips a trailing slash so `${instanceUrl}/api/...` never ends up with a doubled slash,
 *  regardless of whether the user typed one when saving the URL in the popup. */
function thingportNormalizeInstanceUrl(raw) {
  return (raw || "").trim().replace(/\/+$/, "");
}

function thingportApiUrl(instanceUrl, path) {
  return `${thingportNormalizeInstanceUrl(instanceUrl)}/api${path}`;
}

// The following URL matchers are deliberately duplicated from
// frontend/src/components/uploads/useUploadImport.tsx (the web app's own import-link classifier)
// and backend/src/services/{makerworldCloudApi,thingiverseApi,printablesApi}.ts (the single-model
// URL parsers) rather than shared across the build boundary -- this extension ships as plain,
// unbundled JS with no build step, so there's nothing to import them from. Keep both sides in
// sync by hand if a provider ever changes its URL shape.

function thingportIsMakerworldModelUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.toLowerCase().endsWith("makerworld.com")) return null;
  const m = parsed.pathname.match(/\/models?\/(\d+)/i);
  if (!m) return null;
  // The print profile picked on the page, if any (e.g. #profileId-123456) -- same as the
  // backend's parseMakerworldModelUrl.
  const hashMatch = parsed.hash.match(/profileid-(\d+)/i);
  return { designId: m[1], requestedInstanceId: hashMatch ? hashMatch[1] : null };
}

/** Mirrors the backend's buildImportSourceUrl (importService.ts) for MakerWorld -- lets the
 *  guided collection import (see content.js's MakerWorld-collection flow) turn a bare design id
 *  from /import/collection/entries into a real page URL to navigate the tab to, and to check
 *  import status for, without a round trip through the backend just to reconstruct it. */
function thingportMakerworldModelUrl(designId) {
  return `https://makerworld.com/en/models/${designId}`;
}

function thingportIsMakerworldCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().endsWith("makerworld.com") && /\/collections\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function thingportIsThingiverseThingUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return null;
  const m1 = parsed.pathname.match(/thing:(\d+)/i);
  if (m1) return { thingId: m1[1] };
  const m2 = parsed.pathname.match(/\/things\/(\d+)/i);
  return m2 ? { thingId: m2[1] } : null;
}

function thingportIsThingiverseLikesUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
    return /^\/[^/]+\/likes\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function thingportIsThingiverseCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "thingiverse.com" && host !== "www.thingiverse.com") return false;
    return /\/collections\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function thingportIsPrintablesModelUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "printables.com" && host !== "www.printables.com") return null;
  const m = parsed.pathname.match(/\/model\/(\d+)/i);
  return m ? { modelId: m[1] } : null;
}

function thingportIsPrintablesCollectionUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "printables.com" && host !== "www.printables.com") return false;
    return /\/collections\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Classifies the current page for the floating icon's behavior. Returns null for anything not
 *  recognized (icon stays hidden). `kind: "single"` pages get the already-imported dedup check
 *  before showing the icon; `kind: "batch"` pages (a listing of many designs) always show it. */
function thingportClassifyUrl(url) {
  if (thingportIsMakerworldCollectionUrl(url)) return { kind: "batch", provider: "makerworld", type: "collection" };
  if (thingportIsThingiverseLikesUrl(url)) return { kind: "batch", provider: "thingiverse", type: "likes" };
  if (thingportIsThingiverseCollectionUrl(url)) return { kind: "batch", provider: "thingiverse", type: "collection" };
  if (thingportIsPrintablesCollectionUrl(url)) return { kind: "batch", provider: "printables", type: "collection" };
  if (thingportIsMakerworldModelUrl(url)) return { kind: "single", provider: "makerworld", type: "model" };
  if (thingportIsThingiverseThingUrl(url)) return { kind: "single", provider: "thingiverse", type: "thing" };
  if (thingportIsPrintablesModelUrl(url)) return { kind: "single", provider: "printables", type: "model" };
  return null;
}
