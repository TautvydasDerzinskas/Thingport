// The popup's "Recently viewed": the last few model pages opened on any site Grab runs on, connected to Thingport or
// not. Kept in this browser's local storage only, never sent anywhere; thumbnails are the providers' own image URLs.

import type { ViewedModel } from "../shared/messages";
import { classifyUrl, modelKey } from "../shared/urls";

const STORAGE_KEY = "recentlyViewed";
const KEPT = 10;

async function read(): Promise<ViewedModel[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as ViewedModel[] | undefined) ?? [];
}

/** Opening a listed model again moves it to the front, with what its page shows now. */
export async function recordViewedModel(model: Pick<ViewedModel, "url" | "title" | "image">): Promise<null> {
  const key = modelKey(model.url);
  const classification = classifyUrl(model.url);
  if (!key || !classification) return null;
  const entry: ViewedModel = {
    // From the address rather than the sender's word, like the rest of the entry's checks.
    provider: classification.provider,
    url: model.url,
    title: model.title?.trim().slice(0, 200) || null,
    image: model.image && /^https:\/\//i.test(model.image) ? model.image : null,
    viewedAt: Date.now(),
  };
  const rest = (await read()).filter((other) => modelKey(other.url) !== key);
  await chrome.storage.local.set({ [STORAGE_KEY]: [entry, ...rest].slice(0, KEPT) });
  return null;
}

export function getRecentlyViewed(): Promise<ViewedModel[]> {
  return read();
}

export async function clearRecentlyViewed(): Promise<null> {
  await chrome.storage.local.remove(STORAGE_KEY);
  return null;
}
