import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import {
  fetchMakeronlineCollection,
  fetchMakeronlineLikes,
  MAKERONLINE_LIKES_KEY,
  MAKERONLINE_LIKES_NAME,
  MakeronlineAuthError,
} from "./api";
import { getMakeronlineConnection, getUserMakeronlineToken, markMakeronlineTokenRejected } from "./session";

const LIKES_DISCONNECTED: SyncProblem = {
  error: "MakerOnline isn't connected",
  reason: "MakerOnline shows likes to their owner only, and it isn't connected.",
  fix: "you open makeronline.com with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "MakerOnline sign-in ran out",
  reason: "Your MakerOnline sign-in ran out.",
  fix: "you open makeronline.com with Thingport Grab, or connect it again",
};

// Public collections read without a sign-in, so only the likes wait for one.
const signInOnly = (externalId: string) => externalId === MAKERONLINE_LIKES_KEY;

export const makeronlineSync: ProviderSync = {
  async fetchListing(sync) {
    // The user's likes and private collections need their sign-in.
    const token = await getUserMakeronlineToken(sync.userId);
    if (signInOnly(sync.externalId)) {
      if (!token) throw new SyncHeldError(LIKES_DISCONNECTED);
      return (await fetchMakeronlineLikes(token)).entries.map((e) => e.modelId);
    }
    const listing = await fetchMakeronlineCollection(sync.externalId, token);
    return listing ? listing.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    if (!signInOnly(sync.externalId)) return null;
    const connection = await getMakeronlineConnection(sync.userId);
    return connection === "disconnected" ? LIKES_DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  signInOnly,
  rejected: {
    is: (err) => err instanceof MakeronlineAuthError,
    mark: (userId) => markMakeronlineTokenRejected(userId),
    problem: EXPIRED,
  },
  problems: [LIKES_DISCONNECTED, EXPIRED],
  // Its likes page names no user, so a sync reads whoever's token Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserMakeronlineToken(userId))) {
      throw new HttpError(
        400,
        "MakerOnline shows likes to their owner only: connect MakerOnline first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? MAKERONLINE_LIKES_NAME : null),
};
