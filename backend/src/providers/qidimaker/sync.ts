import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import { QIDIMAKER_LIKES_KEY, QIDIMAKER_LIKES_NAME, QidimakerAuthError, fetchQidimakerLikes } from "./api";
import { readQidimakerCollection } from "./lists";
import { getQidimakerConnection, getUserQidimakerToken, markQidimakerSessionRejected } from "./session";

const LIKES_DISCONNECTED: SyncProblem = {
  error: "QIDI Maker isn't connected",
  reason: "QIDI Maker shows likes to their owner only, and it isn't connected.",
  fix: "you open www.qidimaker.com with Thingport Grab, or connect it",
};
const PRIVATE_DISCONNECTED: SyncProblem = {
  error: "QIDI Maker isn't connected to read this collection",
  reason:
    "QIDI Maker answers anyone but a private collection's owner as if it were gone, and it isn't connected, so it " +
    "can't tell whether this one still is.",
  fix: "you open www.qidimaker.com with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "QIDI Maker sign-in ran out",
  reason: "QIDI Maker turned your sign-in down.",
  fix: "you open www.qidimaker.com signed in with Thingport Grab, or connect it again",
};

// The likes need the sign-in; collections read without one, except the user's own private ones.
const signInOnly = (externalId: string) => externalId === QIDIMAKER_LIKES_KEY;

export const qidimakerSync: ProviderSync = {
  async fetchListing(sync) {
    if (signInOnly(sync.externalId)) {
      const token = await getUserQidimakerToken(sync.userId);
      if (!token) throw new SyncHeldError(LIKES_DISCONNECTED);
      try {
        // All of them, not the import dialog's first 600, or likes past those would never be found.
        return (await fetchQidimakerLikes(token, Number.POSITIVE_INFINITY)).entries.map((e) => e.modelId);
      } catch (err) {
        if (!(err instanceof QidimakerAuthError)) throw err;
        // Only the token this read used: one saved while it ran stays connected.
        await markQidimakerSessionRejected(sync.userId, token);
        throw new SyncHeldError(EXPIRED);
      }
    }
    const collection = await readQidimakerCollection(sync.userId, sync.externalId, Number.POSITIVE_INFINITY);
    if (collection === "signIn") {
      const connection = await getQidimakerConnection(sync.userId);
      throw new SyncHeldError(connection === "expired" ? EXPIRED : PRIVATE_DISCONNECTED);
    }
    return collection ? collection.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    if (!signInOnly(sync.externalId)) return null;
    const connection = await getQidimakerConnection(sync.userId);
    return connection === "disconnected" ? LIKES_DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  signInOnly,
  problems: [LIKES_DISCONNECTED, PRIVATE_DISCONNECTED, EXPIRED],
  // Its likes page names no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserQidimakerToken(userId))) {
      throw new HttpError(
        400,
        "QIDI Maker shows likes to their owner only: connect QIDI Maker first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? QIDIMAKER_LIKES_NAME : null),
};
