import { LIKES_ID_PREFIX } from "../index.generated";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { fetchGrabcadLikes, GrabcadAuthError } from "./api";
import { getGrabcadConnection, markGrabcadSessionRejected } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "GrabCAD isn't connected",
  reason: "GrabCAD gives its files to signed-in users only, and it isn't connected.",
  fix: "you open grabcad.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "GrabCAD sign-in ran out",
  reason: "GrabCAD turned your sign-in down.",
  fix: "you open grabcad.com signed in with Thingport Grab, or connect it again",
};

export const grabcadSync: ProviderSync = {
  // Read without a sign-in: anyone's likes are anyone's to see. All of them, not the import dialog's first few
  // hundred, or ones past those would never be found.
  async fetchListing(sync) {
    if (!sync.externalId.startsWith(LIKES_ID_PREFIX)) return null;
    const likes = await fetchGrabcadLikes(sync.externalId.slice(LIKES_ID_PREFIX.length), Number.POSITIVE_INFINITY);
    return likes ? likes.entries.map((entry) => entry.slug) : null;
  },
  // Every model's files need the sign-in, so a sync waits for one rather than fail them all.
  async connectionProblem(sync) {
    const { state } = await getGrabcadConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof GrabcadAuthError,
    mark: (userId) => markGrabcadSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
};
