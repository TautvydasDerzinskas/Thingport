// What the backend calls a provider and the things it files, kept apart from the services so provider modules can use
// them without reaching the registry they're part of.

import { isProviderId, LIKES_ID_PREFIX, MANIFESTS, PROVIDER_IDS, type ProviderId } from "./_generated";

export function providerName(provider: string): string {
  return isProviderId(provider) ? MANIFESTS[provider].name : provider;
}

/** The providers whose manifest says so, named in a sentence: "A, B and C". */
export function providerNames(
  has: (capabilities: (typeof MANIFESTS)[ProviderId]["capabilities"]) => boolean,
  conjunction: "and" | "or" = "and",
): string {
  const names = PROVIDER_IDS.filter((id) => has(MANIFESTS[id].capabilities)).map((id) => MANIFESTS[id].name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}` : (names[0] ?? "");
}

/** The 400 for print profiles asked of a provider whose models have none. */
export const NO_PROFILES_TEXT = `Only ${providerNames((c) => c.profiles)} models have print profiles to pick`;

/** The collection a user's likes are filed into, by import and sync alike. */
export function likesCollectionName(username: string, provider: string): string {
  return `${providerName(provider)} likes (@${username})`;
}

/** The user whose likes a sync follows (on Thingiverse, Printables or Cults3D), as written in its page
 *  address, or null for a collection sync. */
export function syncLikesUsername(sync: { externalId: string; sourceUrl: string }): string | null {
  if (!sync.externalId.startsWith(LIKES_ID_PREFIX)) return null;
  const parts = new URL(sync.sourceUrl).pathname.split("/").filter(Boolean);
  // Printables writes its profile paths as "/@handle"; Cults3D's are "/en/users/<nick>/likes".
  const fromUrl = (/^[a-z]{2}$/.test(parts[0] ?? "") && parts.length === 4 ? parts[2] : parts[0])?.replace(/^@/, "");
  return fromUrl ? decodeURIComponent(fromUrl) : sync.externalId.slice(LIKES_ID_PREFIX.length);
}
