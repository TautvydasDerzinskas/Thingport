// GENERATED from providers/snapmaker/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { regionalId, splitRegionalId } from "../_lib/regions.generated";
import type { ListLink, ModelLink, ProviderUrls, RegionId } from "../_lib/types.generated";
import manifest from "./manifest.generated";

/** Each site's origin and the language its links are written in: its main one, and its China one. */
const SITES: Readonly<Record<"main" | RegionId, { origin: string; lang: string }>> = {
  main: { origin: manifest.site, lang: "en" },
  cn: { origin: manifest.regions[0].site, lang: "zh" },
};

const siteOf = (region: RegionId | null) => SITES[region ?? "main"];

export type SnapmakerList = "likes" | "bookmarks";

/** Which site a host is (null the main one), undefined for any other. Only Snapmaker Space: its other subdomains are
 *  the shop, the forum and the sign-in. */
export function snapmakerRegionOfHost(hostname: string): RegionId | null | undefined {
  const host = hostname.toLowerCase();
  if (host === new URL(SITES.main.origin).hostname) return null;
  return manifest.regions.find((region) => new URL(region.site).hostname === host)?.id;
}

function isHost(hostname: string): boolean {
  return snapmakerRegionOfHost(hostname) !== undefined;
}

function parseUrl(url: string): { url: URL; region: RegionId | null } | null {
  try {
    const parsed = new URL(url);
    const region = snapmakerRegionOfHost(parsed.hostname);
    return region === undefined ? null : { url: parsed, region };
  } catch {
    return null;
  }
}

/** `/en/model/<id>-<slug>` on either site, the slug and language prefix optional; `#profileId-<id>` picks a print
 *  profile. The id is the site's own: each site numbers its models itself, so one number is another model on each. */
export function parseSnapmakerModelUrl(
  url: string,
): { modelId: string; region: RegionId | null; requestedProfileId: string | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?model\/(\d+)(?:-[^/]*)?\/?$/i);
  if (!parsed || !m) return null;
  return {
    modelId: m[1],
    region: parsed.region,
    requestedProfileId: parsed.url.hash.match(/profileId-(\d+)/i)?.[1] ?? null,
  };
}

/** A model's page by the id it's kept under, which names the site (`cn-123` the China one's). */
export function snapmakerModelUrl(externalId: string, profileId?: string | null): string {
  const { region, id } = splitRegionalId(externalId, manifest.regions);
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/model/${id}${profileId ? `#profileId-${profileId}` : ""}`;
}

/** The user's likes and bookmarks share one page, `/creator/<id>?tab=interactions`, whose address doesn't change
 *  between the two; `list` tells them apart in the addresses Thingport keeps. */
export function parseSnapmakerListUrl(
  url: string,
): { userId: string; region: RegionId | null; list: SnapmakerList | null } | null {
  const parsed = parseUrl(url);
  const m = parsed?.url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?creator\/(\d+)\/?$/i);
  if (!parsed || !m || parsed.url.searchParams.get("tab") !== "interactions") return null;
  const list = parsed.url.searchParams.get("list");
  return { userId: m[1], region: parsed.region, list: list === "likes" || list === "bookmarks" ? list : null };
}

export function snapmakerListUrl(userId: string, list: SnapmakerList, region: RegionId | null = null): string {
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/creator/${userId}?tab=interactions&list=${list}`;
}

/** The id a sync keeps for the user's likes or bookmarks on a site: `likes-<id>`, `cn-likes-<id>` on the China one. */
export function snapmakerListKey(userId: string, list: SnapmakerList, region: RegionId | null = null): string {
  return regionalId(region, `${list}-${userId}`);
}

/** A creator's page on a site, by their id there. */
export function snapmakerCreatorUrl(userId: string, region: RegionId | null = null): string {
  const site = siteOf(region);
  return `${site.origin}/${site.lang}/creator/${userId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseSnapmakerModelUrl(url);
    return (
      model && { externalId: regionalId(model.region, model.modelId), requestedProfileId: model.requestedProfileId }
    );
  },
  parseList(url): ListLink | null {
    const parsed = parseSnapmakerListUrl(url);
    if (!parsed?.list) return null;
    // The user's own likes or bookmarks; Snapmaker shows them to their owner only.
    const { userId, list, region } = parsed;
    return {
      kind: list,
      externalId: snapmakerListKey(userId, list, region),
      url: snapmakerListUrl(userId, list, region),
    };
  },
  modelUrl: (externalId) => snapmakerModelUrl(externalId),
};
