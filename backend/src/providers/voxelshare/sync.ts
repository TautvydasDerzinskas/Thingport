import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import {
  VoxelshareAuthError,
  fetchVoxelshareLikes,
  voxelshareLikesName,
  voxelshareLikesSiteOf,
  voxelshareSiteHost,
  voxelshareSiteIdOf,
  type VoxelshareRegion,
} from "./api";
import { readVoxelshareCollection } from "./lists";
import { getUserVoxelshareToken, getVoxelshareConnection, markVoxelshareSessionRejected } from "./session";

/** What holds a sync on a site. Each site's are worded apart, as a held sync's is found again by its error. */
function problemsOf(region: VoxelshareRegion) {
  const name = region ? "VoxelShare China" : "VoxelShare";
  const host = voxelshareSiteHost(region);
  const likesDisconnected: SyncProblem = {
    error: `${name} isn't connected`,
    reason: `${name} shows likes to their owner only, and it isn't connected.`,
    fix: `you open ${host} with Thingport Grab, or connect it`,
  };
  const privateDisconnected: SyncProblem = {
    error: `${name} isn't connected to read this collection`,
    reason: `This collection is private, and ${name} isn't connected, so Thingport can't read all of it.`,
    fix: `you open ${host} with Thingport Grab, or connect it`,
  };
  const expired: SyncProblem = {
    error: `${name} sign-in ran out`,
    reason: `${name} turned your sign-in down, or it ran out.`,
    fix: `you open ${host} signed in with Thingport Grab, or connect it again`,
  };
  return { likesDisconnected, privateDisconnected, expired };
}

const PROBLEMS = { main: problemsOf(null), cn: problemsOf("cn") };
const problemsFor = (region: VoxelshareRegion) => PROBLEMS[region ?? "main"];

// The likes need the sign-in; collections read without one, except the user's own private ones.
const signInOnly = (externalId: string) => voxelshareLikesSiteOf(externalId) !== undefined;

export const voxelshareSync: ProviderSync = {
  async fetchListing(sync) {
    const likesSite = voxelshareLikesSiteOf(sync.externalId);
    if (likesSite !== undefined) {
      const problems = problemsFor(likesSite);
      const token = await getUserVoxelshareToken(sync.userId, likesSite);
      if (!token) {
        const connection = await getVoxelshareConnection(sync.userId, likesSite);
        throw new SyncHeldError(connection === "expired" ? problems.expired : problems.likesDisconnected);
      }
      try {
        // All of them, not the import dialog's first 600, or likes past those would never be found.
        return (await fetchVoxelshareLikes(token, Number.POSITIVE_INFINITY, likesSite)).entries.map((e) => e.modelId);
      } catch (err) {
        if (!(err instanceof VoxelshareAuthError)) throw err;
        // Only the token this read used: one saved while it ran stays connected.
        await markVoxelshareSessionRejected(sync.userId, token, likesSite);
        throw new SyncHeldError(problems.expired);
      }
    }
    const collection = await readVoxelshareCollection(sync.userId, sync.externalId, Number.POSITIVE_INFINITY);
    if (collection === "signIn") {
      const { region } = voxelshareSiteIdOf(sync.externalId);
      const problems = problemsFor(region);
      const connection = await getVoxelshareConnection(sync.userId, region);
      throw new SyncHeldError(connection === "expired" ? problems.expired : problems.privateDisconnected);
    }
    return collection ? collection.entries.map((e) => e.modelId) : null;
  },
  async connectionProblem(sync) {
    const likesSite = voxelshareLikesSiteOf(sync.externalId);
    if (likesSite === undefined) return null;
    const problems = problemsFor(likesSite);
    const connection = await getVoxelshareConnection(sync.userId, likesSite);
    return connection === "disconnected"
      ? problems.likesDisconnected
      : connection === "expired"
        ? problems.expired
        : null;
  },
  signInOnly,
  problems: Object.values(PROBLEMS).flatMap(Object.values),
  // Its likes page names no user, so a sync reads whoever's sign-in Thingport has on that site: there has to be one.
  async assertCanSync(userId, source) {
    const likesSite = voxelshareLikesSiteOf(source.externalId);
    if (likesSite !== undefined && !(await getUserVoxelshareToken(userId, likesSite))) {
      throw new HttpError(
        400,
        `VoxelShare shows likes to their owner only: connect ${likesSite ? "VoxelShare China" : "VoxelShare"} first, ` +
          `or visit ${voxelshareSiteHost(likesSite)} with Thingport Grab`,
      );
    }
  },
  listName: (source) => {
    const likesSite = voxelshareLikesSiteOf(source.externalId);
    return likesSite === undefined ? null : voxelshareLikesName(likesSite);
  },
};
