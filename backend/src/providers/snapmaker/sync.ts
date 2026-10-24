import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import { fetchSnapmakerList, parseSnapmakerListUrl, SnapmakerAuthError, snapmakerListName } from "./api";
import {
  getSnapmakerConnection,
  getUserSnapmakerId,
  getUserSnapmakerToken,
  markSnapmakerTokenRejected,
} from "./session";

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
  // Snapmaker shows likes and bookmarks to their owner only, and a sync reads them with the user's own sign-in: one
  // of someone else's would be fed the user's own under the other's name.
  async assertCanSync(userId, source) {
    const own = await getUserSnapmakerId(userId);
    if (!own || own !== parseSnapmakerListUrl(source.url)?.userId) {
      throw new HttpError(
        400,
        "Snapmaker Space shows likes and bookmarks to their owner only, so only your own can be synced, once Snapmaker is connected",
      );
    }
  },
  listName(source) {
    const list = parseSnapmakerListUrl(source.url)?.list;
    return list ? snapmakerListName(list) : null;
  },
};
