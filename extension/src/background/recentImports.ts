// The popup's "Recent imports" strip. The list is in the browser's sync storage, so it follows the
// user to their other browsers and devices, one item per import: a sync item holds 8 KB at most, which a list of
// them with long titles and addresses could outgrow, while one is far short of it. Each shows the provider's own
// picture of the model, as its page showed it (see recentlyViewed.ts); without one, Thingport's thumbnail, which is
// too big for the sync quota, so each browser caches its own in local storage. Entries reflect the model as it was
// when imported.

import type { Print } from "../shared/api";
import type { RecentImport } from "../shared/messages";
import { normalizeInstanceUrl } from "../shared/storage";
import { classifyUrl, modelKey } from "../shared/urls";
import { apiFetchBlob } from "./api";
import { getStoredConfig, isConfigured, type ConfiguredConfig } from "./config";
import { getRecentlyViewed } from "./recentlyViewed";

/** The whole list used to be this one sync item (and, up to 1.3.0, a local one: see migrateLegacy). */
const RECENT_IMPORTS_STORAGE_KEY = "recentImports";
/** Then `recentImport:<account>:<printId>` per import. */
const ITEM_PREFIX = "recentImport:";
const THUMBS_STORAGE_KEY = "recentImportThumbs";
/** Shown per account; twice as many are kept overall, shared by every account synced. */
const RECENT_IMPORTS_KEPT = 5;
const RECENT_IMPORT_THUMB_PX = 96;
// Each well short of a sync item's 8 KB, with room for what else an entry holds.
const TITLE_MAX_CHARS = 200;
const ADDRESS_MAX_CHARS = 2000;

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
  /** When it was imported, newest first. Entries from the single-item list sort behind every newer one. */
  importedAt?: number;
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

const itemKey = (entry: Pick<SyncedRecentImport, "account" | "printId">) => `${ITEM_PREFIX}${thumbKey(entry)}`;

const capped = (text: string | null | undefined, max: number) => (text && text.length <= max ? text : null);

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
  const added = list.filter((e) => !synced.some((s) => thumbKey(s) === thumbKey(e)));
  // Behind every timed entry, in the order they were listed.
  await chrome.storage.sync.set(
    Object.fromEntries(added.map((e, i) => [itemKey(e), { ...e, importedAt: added.length - i }])),
  );
  const merged = await readSynced();
  await writeThumbs(thumbs, merged);
  return merged;
}

/** Every account's entries, newest first. A single-item list is split into items here: from before, its entries go
 *  behind any timed one. Once that's done, a browser still on an older version writes it afresh with only what it
 *  imported since, which is newer than everything stored, a model imported again there included. */
async function readSynced(): Promise<SyncedRecentImport[]> {
  const stored = await chrome.storage.sync.get(null);
  const items = Object.entries(stored)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as SyncedRecentImport);
  const old = stored[RECENT_IMPORTS_STORAGE_KEY] as SyncedRecentImport[] | undefined;
  if (Array.isArray(old)) {
    const newest = items.reduce((max, e) => Math.max(max, e.importedAt ?? 0), 0);
    const start = items.length ? Math.max(Date.now(), newest + old.length) : old.length;
    for (const [i, e] of old.entries()) e.importedAt = start - i;
    await chrome.storage.sync.set(Object.fromEntries(old.map((e) => [itemKey(e), e])));
    await chrome.storage.sync.remove(RECENT_IMPORTS_STORAGE_KEY);
    const replaced = new Set(old.map(thumbKey));
    return [...items.filter((e) => !replaced.has(thumbKey(e))), ...old].toSorted(
      (a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0),
    );
  }
  return items.toSorted((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0));
}

/** The picture the model's own page showed, if it was opened in this browser lately. */
async function providerImageFor(sourceUrl: string): Promise<string | null> {
  const key = modelKey(sourceUrl);
  if (!key) return null;
  return capped((await getRecentlyViewed()).find((viewed) => modelKey(viewed.url) === key)?.image, ADDRESS_MAX_CHARS);
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
    title: (print.title || print.name || titleHint || "").slice(0, TITLE_MAX_CHARS) || null,
    url: `${normalizeInstanceUrl(config.instanceUrl)}/models/${print.id}`,
    thumbPath: capped(thumbPath, ADDRESS_MAX_CHARS),
    account: await accountKey(config),
    sourceUrl: capped(sourceUrl, ADDRESS_MAX_CHARS),
    providerImage,
    importedAt: Date.now(),
  };
  // Another profile of a listed model overwrites its item, which moves it to the front.
  await chrome.storage.sync.set({ [itemKey(entry)]: entry });
  // Lists from other accounts share the slots; only the newest few overall are kept.
  const all = await readSynced();
  const list = all.slice(0, RECENT_IMPORTS_KEPT * 2);
  const dropped = all.slice(RECENT_IMPORTS_KEPT * 2).map(itemKey);
  if (dropped.length) await chrome.storage.sync.remove(dropped);
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
