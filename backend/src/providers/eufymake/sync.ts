import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import { EUFYMAKE_LIKES_KEY, EUFYMAKE_LIKES_NAME, EufymakeAuthError, fetchEufymakeLikes } from "./api";
import { getEufymakeConnection, getUserEufymakeAuth, markEufymakeSessionRejected } from "./session";

const LIKES_DISCONNECTED: SyncProblem = {
  error: "eufyMake isn't connected",
  reason: "eufyMake shows likes to their owner only, and it isn't connected.",
  fix: "you open makeitreal.eufymake.com with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "eufyMake sign-in ran out",
  reason: "eufyMake turned your sign-in down.",
  fix: "you open makeitreal.eufymake.com signed in with Thingport Grab, or connect it again",
};

// The likes are eufyMake's only list, and need the sign-in.
const signInOnly = (externalId: string) => externalId === EUFYMAKE_LIKES_KEY;

export const eufymakeSync: ProviderSync = {
  async fetchListing(sync) {
    const auth = await getUserEufymakeAuth(sync.userId);
    if (!auth) throw new SyncHeldError(LIKES_DISCONNECTED);
    // All of them, not the import dialog's first 600, or likes past those would never be found.
    return (await fetchEufymakeLikes(auth, Number.POSITIVE_INFINITY)).entries.map((e) => e.modelId);
  },
  async connectionProblem(sync) {
    const connection = await getEufymakeConnection(sync.userId);
    return connection === "disconnected" ? LIKES_DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  signInOnly,
  rejected: {
    is: (err) => err instanceof EufymakeAuthError,
    mark: (userId) => markEufymakeSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [LIKES_DISCONNECTED, EXPIRED],
  // Its likes page names no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserEufymakeAuth(userId))) {
      throw new HttpError(
        400,
        "eufyMake shows likes to their owner only: connect eufyMake first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? EUFYMAKE_LIKES_NAME : null),
};
