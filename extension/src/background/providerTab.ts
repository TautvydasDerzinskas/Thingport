// The provider site the user is looking at, so the popup can put that provider first.
//
// The popup can't read the tab's address itself: that needs "tabs" or activeTab, and a new permission in the
// manifest has browsers disable Grab until every user approves the update. Grab's content script is already on the
// site, though, so it says which provider it is -- on load and whenever its tab comes back to the front -- and the
// background notes it with the tab the message came from. Only the latest is kept: the popup asks for the active
// tab's and gets nothing when that isn't the tab that reported. So it works on the sites Grab runs on (the built-in
// three, and the optional ones once enabled) and nowhere else, which is where there's something to say anyway.
//
// It lives in storage rather than a variable because the service worker sleeps between the page loading and the
// popup opening.

import { STORAGE_KEYS, type ProviderTab } from "../shared/storage";
import type { Provider } from "../shared/urls";

async function noted(): Promise<ProviderTab | undefined> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.providerTab);
  return stored[STORAGE_KEYS.providerTab] as ProviderTab | undefined;
}

export async function noteProviderTab(provider: Provider, tabId: number): Promise<null> {
  // Pages say it again every time their tab comes forward, which is often: writing only what changes keeps the
  // storage listeners quiet.
  const entry = await noted();
  if (entry?.tabId === tabId && entry.provider === provider) return null;
  await chrome.storage.local.set({ [STORAGE_KEYS.providerTab]: { tabId, provider } satisfies ProviderTab });
  return null;
}

/** The provider whose site tab `tabId` is on; null for any other tab, and for one that never reported. */
export async function getTabProvider(tabId: number): Promise<Provider | null> {
  const entry = await noted();
  return entry?.tabId === tabId ? entry.provider : null;
}

/** The tab is gone, so nothing will correct the note: drop it rather than leave it to match a reused id. */
export async function forgetProviderTab(tabId: number): Promise<void> {
  if ((await noted())?.tabId === tabId) await chrome.storage.local.remove(STORAGE_KEYS.providerTab);
}
