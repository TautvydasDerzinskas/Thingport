import { HttpError } from "../../utils/fileUtils";
import { SyncHeldError, type SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { fetchMakerablesSaved, MAKERABLES_SAVED_NAME, MakerablesAuthError, makerablesSavedKey } from "./api";
import {
  getMakerablesConnection,
  getUserMakerablesAccount,
  makerablesToken,
  markMakerablesSessionRejected,
} from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Makerables isn't connected",
  reason: "Makerables shows saved projects to their owner only, and it isn't connected.",
  fix: "you open makerables.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Makerables sign-in ran out",
  reason: "Makerables turned your sign-in down.",
  fix: "you open makerables.com signed in with Thingport Grab, or connect it again",
};
const ANOTHER_ACCOUNT: SyncProblem = {
  error: "Makerables account changed",
  reason: "These saved projects are another Makerables account's, and Makerables shows them to their owner only.",
  fix: "you connect that account again, or unsync this collection",
};

export const makerablesSync: ProviderSync = {
  async fetchListing(sync) {
    const connected = await getUserMakerablesAccount(sync.userId);
    if (!connected) throw new SyncHeldError(DISCONNECTED);
    // Another account's, synced before this one was connected: held rather than unsynced, since connecting that
    // account again is all it takes -- a listing read as "gone" would take the collection's link away for good.
    if (sync.externalId !== makerablesSavedKey(connected.account.userId)) throw new SyncHeldError(ANOTHER_ACCOUNT);
    const token = await makerablesToken(sync.userId, connected.cookie);
    // All of them, not the import dialog's first few hundred, or saves past those would never be found.
    const listing = await fetchMakerablesSaved(connected.account.userId, token, Number.POSITIVE_INFINITY);
    return listing.entries.map((entry) => entry.slug);
  },
  async connectionProblem(sync) {
    const { state } = await getMakerablesConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof MakerablesAuthError,
    mark: (userId) => markMakerablesSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED, ANOTHER_ACCOUNT],
  // Makerables shows saved projects to their owner alone, so only the connected account's can be synced.
  async assertCanSync(userId, source) {
    const connected = await getUserMakerablesAccount(userId);
    if (!connected) {
      throw new HttpError(
        400,
        "Makerables shows saved projects to their owner only: connect Makerables first, or visit it with Thingport Grab",
      );
    }
    if (source.externalId !== makerablesSavedKey(connected.account.userId)) {
      throw new HttpError(400, "Those are someone else's saved Makerables projects: only your own can be synced.");
    }
  },
  // The Saved tab has no name of its own on the site, so the collection it syncs into is named here.
  listName: () => MAKERABLES_SAVED_NAME,
};
