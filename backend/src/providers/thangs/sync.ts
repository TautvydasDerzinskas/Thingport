import { HttpError } from "../../utils/fileUtils";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  fetchThangsCollection,
  fetchThangsLikes,
  fetchThangsPurchases,
  THANGS_LIKES_KEY,
  THANGS_LIKES_NAME,
  ThangsAuthError,
} from "./api";
import {
  getThangsConnection,
  getUserThangsId,
  getUserThangsToken,
  markThangsSessionRejected,
  withThangsToken,
} from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Thangs isn't connected",
  reason: "Thangs gives its files to a signed-in user only, and it isn't connected.",
  fix: "you open thangs.com with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Thangs sign-in ran out",
  reason: "Thangs turned your sign-in down; signing out there, or a year since signing in, ends it.",
  fix: "you sign in on thangs.com with Thingport Grab, or connect it again",
};

export const thangsSync: ProviderSync = {
  async fetchListing(sync) {
    // Every file is the user's to download, so the sign-in is there (see connectionProblem). Paid models they own
    // are kept in, the rest of the paid ones left out.
    const token = await getUserThangsToken(sync.userId);
    const thangsId = await getUserThangsId(sync.userId);
    if (!token || !thangsId) throw new ThangsAuthError();
    const owned = await withThangsToken(sync.userId, token, fetchThangsPurchases);
    if (sync.externalId === THANGS_LIKES_KEY) {
      return (await fetchThangsLikes(thangsId, owned, Number.POSITIVE_INFINITY)).entries.map((e) => e.modelId);
    }
    const listing = await withThangsToken(sync.userId, token, (fresh) =>
      fetchThangsCollection(sync.externalId, fresh, owned, Number.POSITIVE_INFINITY),
    );
    return listing ? listing.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    const connection = await getThangsConnection(sync.userId);
    return connection === "disconnected" ? DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof ThangsAuthError,
    mark: (userId) => markThangsSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // Every download is the user's, and its likes page names no user: a sync needs their sign-in either way.
  async assertCanSync(userId) {
    if ((await getThangsConnection(userId)) !== "connected") {
      throw new HttpError(
        400,
        "Thangs gives its files to a signed-in user only: connect Thangs first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (source.externalId === THANGS_LIKES_KEY ? THANGS_LIKES_NAME : null),
};
