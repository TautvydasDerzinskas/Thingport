// A model page's print profiles next to the library's model: which of them it hasn't got yet.

import { CONTENT_MODULES, type ProfileScope } from "../providers/content";
import type { ProviderId } from "../providers/index.generated";

/** The page's profiles the model lacks, every one and the designer's, the page's own first. */
export type MissingProfiles = { total: number; all: string[]; designer: string[] };

/** The link naming one of the page's print profiles, as the instance reads it. */
export function profileUrl(provider: ProviderId, url: string, profileId: string): string {
  const own = CONTENT_MODULES[provider].profileUrl;
  return own ? own(url, profileId) : `${url.split("#")[0]}#profileId-${profileId}`;
}

/** `ids` without the ones the model has. Case-blind: the instance keeps some sites' ids in another case than their
 *  pages show them. */
export function withoutHeld(ids: string[], held: readonly string[]): string[] {
  const have = new Set(held.map((id) => id.toLowerCase()));
  return ids.filter((id) => !have.has(id.toLowerCase()));
}

export function missingOf(ids: (scope: ProfileScope) => string[], held: readonly string[]): MissingProfiles | null {
  const all = ids("all");
  if (!all.length) return null;
  return { total: all.length, all: withoutHeld(all, held), designer: withoutHeld(ids("designer"), held) };
}

/** What the library's model lacks of the page's print profiles. "none" where there's nothing it could lack: the site
 *  has no print profiles, or this page none. Null where it can't be told: the instance doesn't say which the model has
 *  (older than 1.6.0), or the page won't list them. */
export async function profileGap(
  provider: ProviderId,
  url: string,
  held: readonly string[] | null | undefined,
): Promise<MissingProfiles | "none" | null> {
  const load = CONTENT_MODULES[provider].loadProfiles;
  if (!load) return "none";
  const ids = await load(url).catch(() => null);
  if (!ids) return null;
  if (!ids("all").length) return "none";
  return held ? missingOf(ids, held) : null;
}
