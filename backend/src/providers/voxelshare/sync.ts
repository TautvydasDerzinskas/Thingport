import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import { VOXELSHARE_LIKES_KEY, VOXELSHARE_LIKES_NAME, VoxelshareAuthError, fetchVoxelshareLikes } from "./api";
import { readVoxelshareCollection } from "./lists";
import { getUserVoxelshareToken, getVoxelshareConnection, markVoxelshareSessionRejected } from "./session";

const LIKES_DISCONNECTED: SyncProblem = {
  error: "VoxelShare isn't connected",
  reason: "VoxelShare shows likes to their owner only, and it isn't connected.",
  fix: "you open www.voxelshare.com with Thingport Grab, or connect it",
};
const PRIVATE_DISCONNECTED: SyncProblem = {
  error: "VoxelShare isn't connected to read this collection",
  reason: "This collection is private, and VoxelShare isn't connected, so Thingport can't read all of it.",
  fix: "you open www.voxelshare.com with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "VoxelShare sign-in ran out",
  reason: "VoxelShare turned your sign-in down, or it ran out.",
  fix: "you open www.voxelshare.com signed in with Thingport Grab, or connect it again",
};

// The likes need the sign-in; collections read without one, except the user's own private ones.
const signInOnly = (externalId: string) => externalId === VOXELSHARE_LIKES_KEY;

export const voxelshareSync: ProviderSync = {
  async fetchListing(sync) {
    if (signInOnly(sync.externalId)) {
      const token = await getUserVoxelshareToken(sync.userId);
      if (!token) {
        const connection = await getVoxelshareConnection(sync.userId);
        throw new SyncHeldError(connection === "expired" ? EXPIRED : LIKES_DISCONNECTED);
      }
      try {
        // All of them, not the import dialog's first 600, or likes past those would never be found.
        return (await fetchVoxelshareLikes(token, Number.POSITIVE_INFINITY)).entries.map((e) => e.modelId);
      } catch (err) {
        if (!(err instanceof VoxelshareAuthError)) throw err;
        // Only the token this read used: one saved while it ran stays connected.
        await markVoxelshareSessionRejected(sync.userId, token);
        throw new SyncHeldError(EXPIRED);
      }
    }
    const collection = await readVoxelshareCollection(sync.userId, sync.externalId, Number.POSITIVE_INFINITY);
    if (collection === "signIn") {
      const connection = await getVoxelshareConnection(sync.userId);
      throw new SyncHeldError(connection === "expired" ? EXPIRED : PRIVATE_DISCONNECTED);
    }
    return collection ? collection.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    if (!signInOnly(sync.externalId)) return null;
    const connection = await getVoxelshareConnection(sync.userId);
    return connection === "disconnected" ? LIKES_DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  signInOnly,
  problems: [LIKES_DISCONNECTED, PRIVATE_DISCONNECTED, EXPIRED],
  // Its likes page names no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserVoxelshareToken(userId))) {
      throw new HttpError(
        400,
        "VoxelShare shows likes to their owner only: connect VoxelShare first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? VOXELSHARE_LIKES_NAME : null),
};
