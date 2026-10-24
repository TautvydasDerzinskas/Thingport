import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  CrealitycloudAuthError,
  crealitycloudLikesKey,
  fetchCrealitycloudCollection,
  fetchCrealitycloudLikes,
} from "./api";
import { getCrealitycloudConnection, getUserCrealitycloudAuth, markCrealitycloudSessionRejected } from "./session";

const LIKES_DISCONNECTED: SyncProblem = {
  error: "Creality Cloud isn't connected",
  reason: "Creality Cloud shows likes to their owner only, and it isn't connected.",
  fix: "you open crealitycloud.com with Thingport Grab, or connect it",
};
const LIKES_OTHER_ACCOUNT: SyncProblem = {
  error: "Creality Cloud is connected to another account",
  reason: "These likes are another Creality Cloud account's than the one connected now.",
  fix: "you connect the account the likes are from again",
};
const EXPIRED: SyncProblem = {
  error: "Creality Cloud sign-in ran out",
  reason: "Creality Cloud turned your sign-in down; it lasts a week from when you signed in there.",
  fix: "you sign in on crealitycloud.com with Thingport Grab, or connect it again",
};

// Collections, the private ones too, list without a sign-in; the user's likes ("likes-<id>") need theirs.
const signInOnly = (externalId: string) => externalId.startsWith("likes-");

export const crealitycloudSync: ProviderSync = {
  async fetchListing(sync) {
    if (signInOnly(sync.externalId)) {
      const auth = await getUserCrealitycloudAuth(sync.userId);
      if (!auth) throw new SyncHeldError(LIKES_DISCONNECTED);
      // The sign-in may since be another account's, whose likes aren't this sync's.
      if (crealitycloudLikesKey(auth.userId) !== sync.externalId) throw new SyncHeldError(LIKES_OTHER_ACCOUNT);
      return (await fetchCrealitycloudLikes(auth)).entries.map((e) => e.modelId);
    }
    const listing = await fetchCrealitycloudCollection(sync.externalId);
    return listing ? listing.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    if (!signInOnly(sync.externalId)) return null;
    const connection = await getCrealitycloudConnection(sync.userId);
    return connection === "disconnected" ? LIKES_DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  signInOnly,
  // Only the likes are read with the sign-in, so only they wait for a new one.
  rejected: {
    is: (err) => err instanceof CrealitycloudAuthError,
    mark: markCrealitycloudSessionRejected,
    problem: EXPIRED,
    onlyThis: true,
  },
  problems: [LIKES_DISCONNECTED, LIKES_OTHER_ACCOUNT, EXPIRED],
};
