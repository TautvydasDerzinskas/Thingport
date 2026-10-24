// The popup's "Recent imports" strip. The list is in the browser's sync storage, so it follows the
// user to their other browsers and devices. Each shows the provider's own picture of the model, as its page showed it
// (see recentlyViewed.ts); without one, Thingport's thumbnail, which is too big for the sync quota, so each browser
// caches its own in local storage. Entries reflect the model as it was when imported.

import type { Print } from "../shared/api";
import type { RecentImport } from "../shared/messages";
import { normalizeInstanceUrl } from "../shared/storage";
import { classifyUrl, modelKey } from "../shared/urls";
import { apiFetchBlob } from "./api";
import { getStoredConfig, isConfigured, type ConfiguredConfig } from "./config";
import { getRecentlyViewed } from "./recentlyViewed";

const RECENT_IMPORTS_STORAGE_KEY = "recentImports";
const THUMBS_STORAGE_KEY = "recentImportThumbs";
const RECENT_IMPORTS_KEPT = 5;
const RECENT_IMPORT_THUMB_PX = 96;
// The whole list is one sync item, capped at 8 KB: longer picture addresses are left out.
const PROVIDER_IMAGE_MAX_CHARS = 400;

/** No email: the account is a hash of instance + email, so sync never carries the address. */
type SyncedRecentImport = {
  printId: string;
  title: string | null;
  url: string;
  thumbPath: string | null;
  account: string;
  /** The model page it was imported from. Missing from older entries. */
  sourceUrl?: string | null;
  /** The provider's picture of the model, as its page showed it. */
  providerImage?: string | null;
};

/** Up to 1.3.0 the list, thumbnails included, lived in local storage only. */
type LegacyRecentImport = Omit<SyncedRecentImport, "account" | "thumbPath"> & {
  thumbDataUrl: string | null;
  instanceUrl: string;
  email: string;
};

async function accountKey(config: ConfiguredConfig): Promise<string> {
  const text = `${normalizeInstanceUrl(config.instanceUrl)}\n${config.email.trim().toLowerCase()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function thumbKey(entry: Pick<SyncedRecentImport, "account" | "printId">): string {
  return `${entry.account}:${entry.printId}`;
}

async function readThumbs(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(THUMBS_STORAGE_KEY);
  return (stored[THUMBS_STORAGE_KEY] as Record<string, string> | undefined) ?? {};
}

/** Drops thumbnails for models that fell off the list. */
async function writeThumbs(thumbs: Record<string, string>, list: SyncedRecentImport[]): Promise<void> {
  const kept = Object.fromEntries(list.map(thumbKey).flatMap((key) => (thumbs[key] ? [[key, thumbs[key]]] : [])));
  await chrome.storage.local.set({ [THUMBS_STORAGE_KEY]: kept });
}

/** Moves a pre-sync list into sync storage, once. Only the signed-in account's entries can be
 *  re-keyed, since the hash needs the email; the rest are dropped. */
async function migrateLegacy(config: ConfiguredConfig): Promise<SyncedRecentImport[] | null> {
  const stored = await chrome.storage.local.get(RECENT_IMPORTS_STORAGE_KEY);
  const legacy = stored[RECENT_IMPORTS_STORAGE_KEY] as LegacyRecentImport[] | undefined;
  if (!legacy) return null;
  await chrome.storage.local.remove(RECENT_IMPORTS_STORAGE_KEY);
  const account = await accountKey(config);
  const instanceUrl = normalizeInstanceUrl(config.instanceUrl);
  const mine = legacy.filter((e) => e.instanceUrl === instanceUrl && e.email === config.email);
  const list = mine.map(({ printId, title, url }) => ({ printId, title, url, thumbPath: null, account }));
  const thumbs = await readThumbs();
  for (const e of mine) if (e.thumbDataUrl) thumbs[thumbKey({ account, printId: e.printId })] = e.thumbDataUrl;
  const synced = await readSynced();
  const merged = [...synced, ...list.filter((e) => !synced.some((s) => thumbKey(s) === thumbKey(e)))];
  await chrome.storage.sync.set({ [RECENT_IMPORTS_STORAGE_KEY]: merged.slice(0, RECENT_IMPORTS_KEPT) });
  await writeThumbs(thumbs, merged);
  return merged;
}

async function readSynced(): Promise<SyncedRecentImport[]> {
  const stored = await chrome.storage.sync.get(RECENT_IMPORTS_STORAGE_KEY);
  return (stored[RECENT_IMPORTS_STORAGE_KEY] as SyncedRecentImport[] | undefined) ?? [];
}

/** The picture the model's own page showed, if it was opened in this browser lately. */
async function providerImageFor(sourceUrl: string): Promise<string | null> {
  const key = modelKey(sourceUrl);
  if (!key) return null;
  const image = (await getRecentlyViewed()).find((viewed) => modelKey(viewed.url) === key)?.image ?? null;
  return image && image.length <= PROVIDER_IMAGE_MAX_CHARS ? image : null;
}

/** `titleHint` covers zip imports, whose job reports only the id. Scoped to instance + account. */
export async function recordRecentImport(print: Print, titleHint: string | null, sourceUrl: string): Promise<void> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) return;
  await migrateLegacy(config);
  const thumbPath = print.thumb_url || print.preview_images?.[0]?.url || null;
  const providerImage = await providerImageFor(sourceUrl);
  const entry: SyncedRecentImport = {
    printId: print.id,
    title: print.title || print.name || titleHint || null,
    url: `${normalizeInstanceUrl(config.instanceUrl)}/models/${print.id}`,
    thumbPath,
    account: await accountKey(config),
    sourceUrl,
    providerImage,
  };
  // Another profile of a listed model moves it to the front instead of adding a slot.
  const rest = (await readSynced()).filter((e) => thumbKey(e) !== thumbKey(entry));
  // Lists from other accounts share the slots; only the newest few overall are kept.
  const list = [entry, ...rest].slice(0, RECENT_IMPORTS_KEPT * 2);
  await chrome.storage.sync.set({ [RECENT_IMPORTS_STORAGE_KEY]: list });
  const thumbs = await readThumbs();
  const thumb = thumbPath && !providerImage ? await fetchThumbDataUrl(config, thumbPath).catch(() => null) : null;
  if (thumb) thumbs[thumbKey(entry)] = thumb;
  await writeThumbs(thumbs, list);
}

/** A small center-cropped square JPEG data URL. */
async function fetchThumbDataUrl(config: ConfiguredConfig, thumbPath: string): Promise<string | null> {
  const blob = await apiFetchBlob(config, thumbPath);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(RECENT_IMPORT_THUMB_PX, RECENT_IMPORT_THUMB_PX);
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      RECENT_IMPORT_THUMB_PX,
      RECENT_IMPORT_THUMB_PX,
    );
  bitmap.close();
  const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 })).arrayBuffer());
  let binary = "";
  for (let i = 0; i < jpeg.length; i += 0x8000) binary += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/** Entries synced from another browser have no thumbnail here yet; they're fetched and cached on
 *  first view. */
export async function getRecentImports(): Promise<RecentImport[]> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) return [];
  const all = (await migrateLegacy(config)) ?? (await readSynced());
  const account = await accountKey(config);
  const mine = all.filter((e) => e.account === account).slice(0, RECENT_IMPORTS_KEPT);
  const thumbs = await readThumbs();
  const missing = mine.filter((e) => !e.providerImage && !thumbs[thumbKey(e)] && e.thumbPath);
  if (missing.length) {
    await Promise.all(
      missing.map(async (e) => {
        const thumb = await fetchThumbDataUrl(config, e.thumbPath!).catch(() => null);
        if (thumb) thumbs[thumbKey(e)] = thumb;
      }),
    );
    await writeThumbs(thumbs, all);
  }
  return mine.map((e) => ({
    printId: e.printId,
    title: e.title,
    url: e.url,
    image: e.providerImage ?? thumbs[thumbKey(e)] ?? null,
    provider: (e.sourceUrl && classifyUrl(e.sourceUrl)?.provider) || null,
  }));
}
