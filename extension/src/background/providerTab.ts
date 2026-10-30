// The provider site each open tab is on, so the popup can put the one the user is looking at first.
//
// The popup can't read the tab's address itself: that needs "tabs" or activeTab, and a new permission in the
// manifest has browsers disable Grab until every user approves the update. Grab's content script is already on the
// site, though, so it says which provider it is -- on load, when its address changes and whenever its tab comes
// back to the front -- and the background notes it against the tab the message came from. The popup asks for the active tab's, and gets nothing
// for a tab that never reported. So it works on the sites Grab runs on (the built-in three, and the optional ones
// once enabled) and nowhere else, which is where there's something to say anyway.
//
// The browser tops that up with where each tab is going (onProviderTabUrl below). An SPA's own links, which is most
// of the clicking on these sites, change the address without loading a document: the browser reports that as the
// tab loading, but the page only notices on its next poll, up to a second later. Going by the address keeps the
// note right in between, rather than dropping it until the page speaks again.
//
// A note per tab, not one for the last site seen: provider tabs come in handfuls, and the popup is asked about
// whichever of them is in front. A note goes when its tab navigates away or closes, and they all go when the
// browser starts, so none outlives the page it describes or lands on a tab that reused its id.
//
// It lives in storage rather than a variable because the service worker sleeps between the page loading and the
// popup opening.

import { providerOfHost } from "../providers/index.generated";
import { STORAGE_KEYS, type ProviderTabs } from "../shared/storage";
import type { Provider } from "../shared/urls";

// Every write below reads the notes first, so they take turns: two tabs reporting at once would otherwise each
// write back what it read, and the first of them would be lost.
let pending: Promise<unknown> = Promise.resolve();
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}

async function noted(): Promise<ProviderTabs> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.providerTab);
  return (stored[STORAGE_KEYS.providerTab] as ProviderTabs | undefined) ?? {};
}

async function write(tabs: ProviderTabs): Promise<void> {
  if (Object.keys(tabs).length) await chrome.storage.local.set({ [STORAGE_KEYS.providerTab]: tabs });
  else await chrome.storage.local.remove(STORAGE_KEYS.providerTab);
}

export async function noteProviderTab(provider: Provider, tabId: number): Promise<null> {
  // Pages say it again every time their tab comes forward, which is often: writing only what changes keeps the
  // storage listeners quiet.
  await queued(async () => {
    const tabs = await noted();
    if (tabs[tabId] !== provider) await write({ ...tabs, [tabId]: provider });
  });
  return null;
}

/** The provider whose site tab `tabId` is on; null for a tab on anything else, and for one that never reported. */
export async function getTabProvider(tabId: number): Promise<Provider | null> {
  return (await noted())[tabId] ?? null;
}

/** The tab is loading `url`, as the browser tells it -- undefined where Grab has no access to read it, which is
 *  every site it doesn't run on. So the address decides: a note for the provider it belongs to, and none at all
 *  otherwise. Taking it from here rather than waiting for the page to report again is what keeps a site's own links
 *  from losing the note, as they navigate without loading a document and so without running the content script. */
export async function onProviderTabUrl(tabId: number, url: string | undefined): Promise<void> {
  const provider = url ? providerOfHost(hostOf(url)) : null;
  if (provider) await noteProviderTab(provider, tabId);
  else await forgetProviderTab(tabId);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** The tab has gone or moved on, so nothing will correct its note: drop it rather than leave it describing a page
 *  that isn't there. */
export async function forgetProviderTab(tabId: number): Promise<void> {
  await queued(async () => {
    const tabs = await noted();
    if (!(tabId in tabs)) return;
    await write(Object.fromEntries(Object.entries(tabs).filter(([id]) => Number(id) !== tabId)));
  });
}

/** A fresh browser session: no note survives it, and the ids they are filed under belong to other tabs now. */
export async function forgetProviderTabs(): Promise<void> {
  await queued(() => chrome.storage.local.remove(STORAGE_KEYS.providerTab));
}
