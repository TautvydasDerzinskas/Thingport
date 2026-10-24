import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { fetchSnapmakerList, SnapmakerAuthError } from "./api";
import { getSnapmakerConnection, getUserSnapmakerToken, markSnapmakerTokenRejected } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Snapmaker Space isn't connected",
  reason: "Snapmaker Space isn't connected.",
  fix: "you connect it",
};
const EXPIRED: SyncProblem = {
  error: "Snapmaker Space sign-in ran out",
  reason: "Your Snapmaker Space sign-in ran out; Thingport Grab renews it while the browser it's in is open.",
  fix: "you open space.snapmaker.com with Thingport Grab, or connect it again",
};

export const snapmakerSync: ProviderSync = {
  async fetchListing(sync) {
    // The user's own likes or bookmarks ("likes-<id>"), read as them: they're never gone.
    const token = await getUserSnapmakerToken(sync.userId);
    if (!token) throw new SnapmakerAuthError();
    const { entries } = await fetchSnapmakerList(sync.externalId.startsWith("likes-") ? "likes" : "bookmarks", token);
    return entries.map((e) => e.modelId);
  },
  async connectionProblem(sync) {
    const connection = await getSnapmakerConnection(sync.userId);
    return connection === "disconnected" ? DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  rejected: { is: (err) => err instanceof SnapmakerAuthError, mark: markSnapmakerTokenRejected, problem: EXPIRED },
  problems: [DISCONNECTED, EXPIRED],
};
