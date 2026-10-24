import { HttpError } from "../../utils/fileUtils";
import {
  PRINTABLES_FORGOTTEN,
  pushedLikes,
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
  // Printables shows likes to their owner only, and Grab reads them as that user: a sync of someone else's would be
  // fed the user's own likes under the other's name. The likes Grab pushed prove whose they are; the account saved on
  // the user can be typed into the app, so it proves nothing.
  async assertCanSync(userId, source) {
    if (!source.likesOf) return;
    const likes = await pushedLikes(userId);
    if (likes?.card.owner?.toLowerCase() !== source.likesOf.toLowerCase()) {
      throw new HttpError(
        400,
        "Printables shows likes to their owner only, so only your own can be synced, once Thingport Grab has seen them",
      );
    }
  },
};
