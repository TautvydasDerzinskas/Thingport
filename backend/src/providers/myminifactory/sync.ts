import { getMyminifactoryApiKey } from "./apiKey";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { checkMyminifactoryCollection, fetchMyminifactoryCollectionObjects } from "./api";

const DISCONNECTED: SyncProblem = {
  error: "MyMiniFactory isn't connected on this Thingport",
  reason: "MyMiniFactory isn't connected on this Thingport.",
  fix: "an admin connects it again",
};

export const myminifactorySync: ProviderSync = {
  async fetchListing(sync) {
    const apiKey = await getMyminifactoryApiKey();
    if (!apiKey) throw new Error(DISCONNECTED.error);
    const [username, slug] = sync.externalId.split("/");
    if (!(await checkMyminifactoryCollection(username, slug, apiKey))) return null;
    const listing = await fetchMyminifactoryCollectionObjects(username, slug, apiKey);
    return listing ? listing.entries.map((e) => e.objectId) : null;
  },
  async connectionProblem() {
    return (await getMyminifactoryApiKey()) ? null : DISCONNECTED;
  },
  problems: [DISCONNECTED],
};
