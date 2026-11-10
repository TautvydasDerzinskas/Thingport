import { HttpError } from "../../utils/fileUtils";
import { SyncHeldError, type SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { FAB365_LIKES_KEY, FAB365_LIKES_NAME, Fab365AuthError, fetchFab365Likes } from "./api";
import { getFab365Connection, getUserFab365Auth, withFab365Auth } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Fab365 isn't connected",
  reason: "Fab365 shows favourites to their owner only, and it isn't connected.",
  fix: "you open fab365.net signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Fab365 sign-in ran out",
  reason: "Fab365 turned your sign-in down.",
  fix: "you open fab365.net signed in with Thingport Grab, or connect it again",
};

// The favourites are Fab365's only list, and need the sign-in.
const signInOnly = (externalId: string) => externalId === FAB365_LIKES_KEY;

export const fab365Sync: ProviderSync = {
  async fetchListing(sync) {
    const connected = await getUserFab365Auth(sync.userId);
    if (!connected) throw new SyncHeldError(DISCONNECTED);
    const likes = await withFab365Auth(sync.userId, connected.auth, (auth) => fetchFab365Likes(auth));
    return likes.entries.map((entry) => entry.itemId);
  },
  async connectionProblem(sync) {
    const { state } = await getFab365Connection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  signInOnly,
  rejected: {
    is: (err) => err instanceof Fab365AuthError,
    // Marked already, by the read it turned down, and only while it was still the sign-in stored: a newer one saved
    // meanwhile isn't marked for it.
    mark: async () => undefined,
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // Its favourites page names no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserFab365Auth(userId).catch(() => null))) {
      throw new HttpError(
        400,
        "Fab365 shows favourites to their owner only: connect Fab365 first, or visit it signed in with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? FAB365_LIKES_NAME : null),
};
