// GENERATED from providers/_lib/regions.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
// The ids of what's read from a provider's region (manifest `regions`): its id with the region in front, so it's read
// from there again. The main site's ids are kept as they are.

import type { RegionId } from "./types.generated";

const REGIONAL = /^([a-z]{2})-(.+)$/;

/** `id` as it's kept when read from `region`; as it is from the main site (null). */
export function regionalId(region: RegionId | null, id: string): string {
  return region ? `${region}-${id}` : id;
}

/** A kept id's region, out of `regions` (a provider's), and the site's own id; the main site's (null) for any other. */
export function splitRegionalId(
  externalId: string,
  regions: readonly { id: RegionId }[] = [],
): { region: RegionId | null; id: string } {
  const m = externalId.match(REGIONAL);
  const region = m && regions.find((r) => r.id === m[1]);
  return region ? { region: region.id, id: m![2] } : { region: null, id: externalId };
}
