// Sites Grab works on only once the user allows it. A new provider every week, each added to the manifest, would
// have the browser disable Grab for everyone after every update until they approved it again. So access to each is
// asked for at runtime, when the user enables it in the popup (within the manifest's optional_host_permissions), and
// the background registers the content script there. It only ever runs on the sites listed here: the providers whose
// manifest (providers/) says their site is optional.

import { MANIFESTS, PROVIDER_IDS } from "../providers/index.generated";

type Manifests = typeof MANIFESTS;
type OptionalId = {
  [K in keyof Manifests]: Manifests[K]["extension"]["site"] extends "optional" ? K : never;
}[keyof Manifests];

export type OptionalSite = { id: OptionalId; name: string; origins: string[] };

export const OPTIONAL_SITES: readonly OptionalSite[] = PROVIDER_IDS.filter(
  (id): id is OptionalId => MANIFESTS[id].extension.site === "optional",
).map((id) => ({ id, name: MANIFESTS[id].name, origins: [...MANIFESTS[id].extension.origins] }));

const scriptId = (site: OptionalSite) => `site-${site.id}`;

export function siteEnabled(site: OptionalSite): Promise<boolean> {
  return chrome.permissions.contains({ origins: site.origins });
}

/** Registers the content script for every site whose access is granted, and drops it for the rest. Safe to run
 *  any time: from startup, and whenever access is granted or taken back, in the browser's own settings too. */
export async function syncSiteScripts(): Promise<void> {
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id));
  for (const site of OPTIONAL_SITES) {
    const id = scriptId(site);
    const granted = await siteEnabled(site);
    try {
      if (granted && !registered.has(id)) {
        await chrome.scripting.registerContentScripts([
          { id, matches: site.origins, js: ["content.js"], runAt: "document_idle" },
        ]);
      } else if (!granted && registered.has(id)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      }
    } catch (err) {
      // Two wake-ups racing to register the same script; the other one did it.
      console.warn(`[sites] ${site.id}:`, err);
    }
  }
}

/** Runs Grab in the site's tabs already open: a registration only reaches pages loaded after it. The content
 *  script guards against running twice. */
export async function injectIntoOpenTabs(site: OptionalSite): Promise<void> {
  const tabs = await chrome.tabs.query({ url: site.origins });
  await Promise.all(
    tabs.map((tab) =>
      tab.id == null
        ? undefined
        : chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined),
    ),
  );
}
