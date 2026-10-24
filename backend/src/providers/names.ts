// What the backend calls a provider and the things it files, kept apart from the services so provider modules can use
// them without reaching the registry they're part of.

import { isProviderId, MANIFESTS } from "./_generated";

export function providerName(provider: string): string {
  return isProviderId(provider) ? MANIFESTS[provider].name : provider;
}

/** The collection a user's likes are filed into, by import and sync alike. */
export function likesCollectionName(username: string, provider: string = "thingiverse"): string {
  return `${providerName(provider)} likes (@${username})`;
}
