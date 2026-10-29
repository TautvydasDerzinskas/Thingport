import { HttpError } from "../../utils/fileUtils";
import { SyncHeldError, type SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { CgtraderAuthError, CGTRADER_LISTS, fetchCgtraderList, type CgtraderList } from "./api";
import { getCgtraderConnection, getUserCgtraderSession, markCgtraderSessionRejected } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "CGTrader isn't connected",
  reason: "CGTrader shows your liked models and wishlist to you alone, and it isn't connected.",
  fix: "you open cgtrader.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "CGTrader sign-in ran out",
  reason: "CGTrader turned your sign-in down.",
  fix: "you open cgtrader.com signed in with Thingport Grab, or connect it again",
};

/** Which of the user's lists a sync follows, by what it's kept by. */
const listOf = (externalId: string): CgtraderList | null =>
  (Object.keys(CGTRADER_LISTS) as CgtraderList[]).find((list) => CGTRADER_LISTS[list].key === externalId) ?? null;

export const cgtraderSync: ProviderSync = {
  async fetchListing(sync) {
    const list = listOf(sync.externalId);
    if (!list) return null;
    const session = await getUserCgtraderSession(sync.userId);
    if (!session) throw new SyncHeldError(DISCONNECTED);
    // All of them, not the import dialog's first few hundred, or ones past those would never be found.
    return (await fetchCgtraderList(list, session, Number.POSITIVE_INFINITY)).entries.map((entry) => entry.slug);
  },
  async connectionProblem(sync) {
    const { state } = await getCgtraderConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof CgtraderAuthError,
    mark: (userId) => markCgtraderSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // Its lists' pages name no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (listOf(source.externalId) && !(await getUserCgtraderSession(userId))) {
      throw new HttpError(
        400,
        "CGTrader shows liked models and wishlists to their owner only: connect CGTrader first, or visit it with " +
          "Thingport Grab",
      );
    }
  },
  listName: (source) => {
    const list = listOf(source.externalId);
    return list && CGTRADER_LISTS[list].name;
  },
};
