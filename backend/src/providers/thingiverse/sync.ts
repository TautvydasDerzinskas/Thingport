import { getThingiverseAccessToken } from "../../services/settingsService";
import { syncLikesUsername } from "../names";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  checkThingiverseCollection,
  checkThingiverseUser,
  fetchThingiverseCollectionThings,
  fetchThingiverseUserLikes,
} from "./api";

const DISCONNECTED: SyncProblem = {
  error: "Thingiverse isn't connected on this Thingport",
  reason: "Thingiverse isn't connected on this Thingport.",
  fix: "an admin connects it again",
};

export const thingiverseSync: ProviderSync = {
  async fetchListing(sync) {
    const token = await getThingiverseAccessToken();
    if (!token) throw new Error(DISCONNECTED.error);
    const likesOf = syncLikesUsername(sync);
    if (likesOf) {
      if (!(await checkThingiverseUser(likesOf, token))) return null;
      const { entries } = await fetchThingiverseUserLikes(likesOf, token);
      return entries.map((e) => e.thingId);
    }
    if (!(await checkThingiverseCollection(sync.externalId, token))) return null;
    const { entries } = await fetchThingiverseCollectionThings(sync.externalId, token);
    return entries.map((e) => e.thingId);
  },
  async connectionProblem() {
    return (await getThingiverseAccessToken()) ? null : DISCONNECTED;
  },
  problems: [DISCONNECTED],
};
