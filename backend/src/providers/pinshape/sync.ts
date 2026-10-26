import { LIKES_ID_PREFIX } from "../index.generated";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { fetchPinshapeCollection, fetchPinshapeLikes, PinshapeAuthError } from "./api";
import { getPinshapeConnection, markPinshapeSessionRejected } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Pinshape isn't connected",
  reason: "Pinshape gives its files to signed-in users only, and it isn't connected.",
  fix: "you open pinshape.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Pinshape sign-in ran out",
  reason: "Pinshape turned your sign-in down.",
  fix: "you open pinshape.com signed in with Thingport Grab, or connect it again",
};

export const pinshapeSync: ProviderSync = {
  // Read without a sign-in: collections and likes are anyone's to see. Its profile shows only 12 of someone's likes,
  // so a sync of them finds new ones as they show up there.
  async fetchListing(sync) {
    if (sync.externalId.startsWith(LIKES_ID_PREFIX)) {
      const likes = await fetchPinshapeLikes(sync.externalId.slice(LIKES_ID_PREFIX.length));
      return likes ? likes.entries.map((entry) => entry.modelId) : null;
    }
    // All of them, not the import dialog's first few hundred, or models past those would never be found.
    const collection = await fetchPinshapeCollection(sync.externalId, Number.POSITIVE_INFINITY);
    return collection ? collection.entries.map((entry) => entry.modelId) : null;
  },
  // Every model's files need the sign-in, so a sync waits for one rather than fail them all.
  async connectionProblem(sync) {
    const { state } = await getPinshapeConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof PinshapeAuthError,
    mark: (userId) => markPinshapeSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
};
