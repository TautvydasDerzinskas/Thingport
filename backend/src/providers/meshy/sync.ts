import { HttpError } from "../../utils/fileUtils";
import { SyncHeldError, type SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  fetchMeshyCollection,
  fetchMeshyCollectionPosts,
  fetchMeshyGenerations,
  MESHY_GENERATIONS_NAME,
  MeshyAuthError,
  meshyGenerationsKey,
  parseMeshyCollectionUrl,
  parseMeshyGenerationsUrl,
} from "./api";
import { getMeshyConnection, getUserMeshyAuth, markMeshySessionRejected, withMeshyAuth } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Meshy isn't connected",
  reason: "Meshy only hands its files to a signed-in account, and it isn't connected.",
  fix: "you open meshy.ai signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Meshy sign-in ended",
  reason: "Meshy turned your sign-in down.",
  fix: "you open meshy.ai signed in with Thingport Grab, or connect it again",
};
const ANOTHER_ACCOUNT: SyncProblem = {
  error: "Meshy account changed",
  reason: "These generations are another Meshy account's, and only their owner can read them.",
  fix: "you connect that account again, or unsync this collection",
};

export const meshySync: ProviderSync = {
  async fetchListing(sync) {
    const collection = parseMeshyCollectionUrl(sync.sourceUrl);
    if (collection) {
      // Gone is a clear answer only from the collection itself: an empty listing may just be an empty collection.
      if (!(await fetchMeshyCollection(collection.collectionId))) return null;
      const listing = await fetchMeshyCollectionPosts(collection.collectionId, Number.POSITIVE_INFINITY);
      return listing.entries.map((entry) => entry.externalId);
    }
    const connected = await getUserMeshyAuth(sync.userId);
    if (!connected) throw new SyncHeldError(DISCONNECTED);
    // Another account's, synced before this one was connected: held rather than unsynced, since connecting that
    // account again is all it takes.
    if (sync.externalId !== meshyGenerationsKey(connected.account.userId)) throw new SyncHeldError(ANOTHER_ACCOUNT);
    // All of them, not the import dialog's first few hundred, or generations past those would never be found.
    const listing = await withMeshyAuth(sync.userId, connected.auth, (auth) =>
      fetchMeshyGenerations(auth, Number.POSITIVE_INFINITY),
    );
    return listing.entries.map((entry) => entry.externalId);
  },
  // Every file needs the sign-in, so without one a sync waits rather than failing each model it finds.
  async connectionProblem(sync) {
    const { state } = await getMeshyConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof MeshyAuthError,
    mark: (userId) => markMeshySessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED, ANOTHER_ACCOUNT],
  // Meshy shows a workspace to its owner alone, so only the connected account's generations can be synced.
  async assertCanSync(userId, source) {
    if (!parseMeshyGenerationsUrl(source.url)) return;
    const connected = await getUserMeshyAuth(userId).catch(() => null);
    if (!connected) {
      throw new HttpError(
        400,
        "Meshy shows generations to their owner only: connect Meshy first, or visit it with Thingport Grab",
      );
    }
    if (source.externalId !== meshyGenerationsKey(connected.account.userId)) {
      throw new HttpError(400, "Those are another Meshy account's generations: only your own can be synced.");
    }
  },
  // The workspace has no name of its own on the site, so the collection it syncs into is named here.
  listName: (source) => (parseMeshyGenerationsUrl(source.url) ? MESHY_GENERATIONS_NAME : null),
};
