import type { ProviderSync } from "../types";
import { fetchNexprintCollection } from "./api";

export const nexprintSync: ProviderSync = {
  async fetchListing(sync) {
    // Collections, the private ones too, list without a sign-in; only their files need one. All of it, not the import
    // dialog's first 600, or models past those would never be found.
    const listing = await fetchNexprintCollection(sync.externalId, Number.POSITIVE_INFINITY);
    return listing ? listing.entries.map((e) => e.modelId) : null;
  },
  problems: [],
};
