import { HttpError } from "../../utils/fileUtils";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  checkThreedexportAuth,
  fetchThreedexportCollection,
  fetchThreedexportDefault,
  THREEDEXPORT_DEFAULT_KEY,
  ThreedexportAuthError,
  threedexportDefaultName,
  type ThreedexportSession,
  threedexportVisit,
} from "./api";
import { getThreedexportConnection, getUserThreedexportSession, threedexportRejection } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "3DExport isn't connected",
  reason: "3DExport gives its files to signed-in users only, and it isn't connected.",
  fix: "you open 3dexport.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "3DExport sign-in ran out",
  reason: "3DExport turned your sign-in down; signing out of 3dexport.com ends it.",
  fix: "you open 3dexport.com signed in with Thingport Grab, or connect it again",
};

/** Whether a sync follows the user's Default Collection, which is whoever's signed in. */
const isDefault = (sync: { externalId: string }) => sync.externalId === THREEDEXPORT_DEFAULT_KEY;

/** A collection its page no longer shows: gone, unless the sign-in it was read with is what the site turned down. A
 *  private one shows only to its owner, so a sign-in that ran out looks just like a deleted collection, and a sync must
 *  hold rather than unsync it then. */
async function goneUnlessSignedOut(session: ThreedexportSession): Promise<null> {
  const check = await checkThreedexportAuth(session);
  if (check === "rejected") throw new ThreedexportAuthError(session);
  if (check === "unreachable") throw new Error("Couldn't ask 3DExport whether the sign-in still works");
  return null;
}

export const threedexportSync: ProviderSync = {
  // All of a collection's models, not the import dialog's first few hundred, or ones past those would never be found.
  // Paid ones are kept: which the user bought, its pages don't say, and the import refuses the rest.
  async fetchListing(sync) {
    // Read with the sign-in where there is one: a private collection shows only to its owner.
    const session = await getUserThreedexportSession(sync.userId);
    if (isDefault(sync) && !session) throw new ThreedexportAuthError();
    try {
      const visit = threedexportVisit(session);
      if (isDefault(sync)) {
        return (await fetchThreedexportDefault(visit, Number.POSITIVE_INFINITY)).entries.map((entry) => entry.itemId);
      }
      if (!/^\d{1,12}$/.test(sync.externalId)) return null;
      const found = await fetchThreedexportCollection(sync.externalId, visit, Number.POSITIVE_INFINITY);
      if (!found) return session ? goneUnlessSignedOut(session) : null;
      return found.entries.map((entry) => entry.itemId);
    } catch (err) {
      throw session ? await threedexportRejection(sync.userId, session.hash, err) : err;
    }
  },
  // Every model's files need the sign-in, so a sync waits for one rather than fail them all.
  async connectionProblem(sync) {
    const { state } = await getThreedexportConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof ThreedexportAuthError,
    // Marked already, by the read it turned down, and only while it was still the sign-in stored: a newer one saved
    // meanwhile isn't marked for it.
    mark: async () => undefined,
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // The Default Collection names no one, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (isDefault(source) && !(await getUserThreedexportSession(userId))) {
      throw new HttpError(
        400,
        "3DExport shows your Default Collection to you alone: connect 3DExport first, or visit it with Thingport Grab",
      );
    }
  },
  // The Default Collection is whoever's signed in, and named so.
  listName: (source) => (isDefault(source) ? threedexportDefaultName() : null),
};
