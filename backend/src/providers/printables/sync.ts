import {
  PRINTABLES_FORGOTTEN,
  printablesPushIsOff,
  pushedPrintablesModels,
  WAITING_FOR_GRAB,
} from "../../services/providerListingsService";
import type { ProviderSync } from "../types";
import { checkPrintablesCollection, fetchPrintablesCollectionEntries } from "./api";

export const printablesSync: ProviderSync = {
  async fetchListing(sync) {
    // Private collections and likes come from Thingport Grab, as of the user's last visit.
    const pushed = await pushedPrintablesModels(sync.userId, sync.externalId);
    if (pushed === "waiting") throw new Error(WAITING_FOR_GRAB);
    if (pushed) return pushed;
    if (!(await checkPrintablesCollection(sync.externalId))) {
      // Private, most likely: with the user's Printables account forgotten, Grab no longer says which
      // ones are. Paused rather than unsynced, until they give it again.
      if (await printablesPushIsOff(sync.userId)) throw new Error(PRINTABLES_FORGOTTEN);
      return null;
    }
    const { entries } = await fetchPrintablesCollectionEntries(sync.externalId);
    return entries.map((e) => e.modelId);
  },
  problems: [],
};
