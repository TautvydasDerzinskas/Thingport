// Sites Grab works on only once the user allows it. A new provider every week, each added to the manifest, would
// have the browser disable Grab for everyone after every update until they approved it again. So access to each is
// asked for at runtime, when the user enables it in the popup (within the manifest's optional_host_permissions), and
// the background registers the content script there. It only ever runs on the sites listed here: the providers whose
// manifest (providers/) says their site is optional.
//
// A provider's regions (its sites for one country) are asked for with it, but it counts as on with its main site's
// alone: one given a region in an update stays on for those who allowed it before, and works there only once they
// allow it again.

import { MANIFESTS, PROVIDER_IDS, type RegionId } from "../providers/index.generated";
import { hostIs } from "../providers/_lib/hosts.generated";

type Manifests = typeof MANIFESTS;
type OptionalId = {
  [K in keyof Manifests]: Manifests[K]["extension"]["site"] extends "optional" ? K : never;
}[keyof Manifests];

/** `origins`: everything turning it on asks for; `main`: its main site's, which it counts as on with; `regions`: each
 *  region's, which it works there with. */
export type OptionalSite = {
  id: OptionalId;
  name: string;
  origins: string[];
  main: string[];
  regions: Partial<Record<RegionId, string[]>>;
};

/** The host of a match pattern such as `*://space.example.com/*`, a leading `*.` left off. */
const patternHost = (origin: string) => (origin.match(/^[^:]+:\/\/([^/]+)/)?.[1] ?? "").replace(/^\*\./, "");

function optionalSite(id: OptionalId): OptionalSite {
  const manifest = MANIFESTS[id];
  const origins: string[] = [...manifest.extension.origins];
  const regionDomains = ("regions" in manifest ? manifest.regions : []).map((region) => ({
    id: region.id,
    hosts: region.hosts as readonly string[],
  }));
  const regionOf = (origin: string) =>
    regionDomains.find((region) => region.hosts.some((domain) => hostIs(patternHost(origin), domain)))?.id;
  const regions: Partial<Record<RegionId, string[]>> = {};
  for (const origin of origins) {
    const region = regionOf(origin);
    if (region) (regions[region] ??= []).push(origin);
  }
  return { id, name: manifest.name, origins, main: origins.filter((origin) => !regionOf(origin)), regions };
}

export const OPTIONAL_SITES: readonly OptionalSite[] = PROVIDER_IDS.filter(
  (id): id is OptionalId => MANIFESTS[id].extension.site === "optional",
).map(optionalSite);

const scriptId = (site: OptionalSite) => `site-${site.id}`;

/** Whether Grab is on for the site: its main site allowed, whatever its regions. */
export function siteEnabled(site: OptionalSite): Promise<boolean> {
  return chrome.permissions.contains({ origins: site.main });
}

/** Whether one of its regions is allowed too: its own sign-in and pages need it. */
export async function regionEnabled(site: OptionalSite, region: RegionId): Promise<boolean> {
  const origins = site.regions[region];
  return Boolean(origins?.length) && chrome.permissions.contains({ origins: origins! });
}

/** The site's origins the browser allows Grab on. */
async function grantedOrigins(site: OptionalSite): Promise<string[]> {
  const granted = await Promise.all(site.origins.map((origin) => chrome.permissions.contains({ origins: [origin] })));
  return site.origins.filter((_, index) => granted[index]);
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/** Registers the content script for every site whose access is granted, on the origins granted, and drops it for the
 *  rest. Safe to run any time: from startup, and whenever access is granted or taken back, in the browser's own
 *  settings too. */
export async function syncSiteScripts(): Promise<void> {
  const registered = new Map(
    (await chrome.scripting.getRegisteredContentScripts()).map((script) => [script.id, script.matches ?? []]),
  );
  for (const site of OPTIONAL_SITES) {
    const id = scriptId(site);
    const matches = (await siteEnabled(site)) ? await grantedOrigins(site) : [];
    const current = registered.get(id);
    try {
      if (current && !sameSet(current, matches)) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      }
      if (matches.length && !(current && sameSet(current, matches))) {
        await chrome.scripting.registerContentScripts([{ id, matches, js: ["content.js"], runAt: "document_idle" }]);
      }
    } catch (err) {
      // Two wake-ups racing to register the same script; the other one did it.
      console.warn(`[sites] ${site.id}:`, err);
    }
  }
}

/** Runs Grab in the site's tabs already open, where it's allowed: a registration only reaches pages loaded after
 *  it. The content script guards against running twice. */
export async function injectIntoOpenTabs(site: OptionalSite): Promise<void> {
  const origins = await grantedOrigins(site);
  if (!origins.length) return;
  const tabs = await chrome.tabs.query({ url: origins });
  await Promise.all(
    tabs.map((tab) =>
      tab.id == null
        ? undefined
        : chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => undefined),
    ),
  );
}
