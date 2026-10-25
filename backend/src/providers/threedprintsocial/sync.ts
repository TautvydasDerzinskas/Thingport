import type { ProviderSync } from "../types";
import { fetchPrintSocialList, printSocialListOf } from "./api";

export const printSocialSync: ProviderSync = {
  // Read without a sign-in: its collections and creators are anyone's to see, and so are their models' files.
  async fetchListing(sync) {
    // All of them, not the import dialog's first few hundred, or models past those would never be found.
    const list = await fetchPrintSocialList(printSocialListOf(sync.externalId), Number.POSITIVE_INFINITY);
    return list ? list.entries.map((entry) => entry.modelId) : null;
  },
  problems: [],
};
