import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { extractMakerworldBearerToken, MakerworldAuthError } from "./api";
import { checkMakerworldCollection, fetchMakerworldCollectionEntries } from "./collections";
import {
  getMakerworldConnection,
  getUserMakerworldCookie,
  MAKERWORLD_REJECTED_ERROR,
  markMakerworldCookieRejected,
} from "./session";

const DISCONNECTED: SyncProblem = {
  error: "MakerWorld isn't connected",
  reason: "MakerWorld isn't connected.",
  fix: "you connect it again",
};
const EXPIRED: SyncProblem = {
  error: MAKERWORLD_REJECTED_ERROR,
  reason: "MakerWorld turned your sign-in down; it may have expired.",
  fix: "you connect MakerWorld again",
};

export const makerworldSync: ProviderSync = {
  async fetchListing(sync) {
    // A public collection lists without a login; a private one needs the owner's.
    const bearer = extractMakerworldBearerToken(await getUserMakerworldCookie(sync.userId));
    const id = sync.externalId;
    if (!(await checkMakerworldCollection(id, bearer, IMPORT_MAKERWORLD_CALL_DELAY_MS))) return null;
    const { entries } = await fetchMakerworldCollectionEntries(id, bearer, undefined, IMPORT_MAKERWORLD_CALL_DELAY_MS);
    return entries.map((e) => e.designId);
  },
  async connectionProblem(sync) {
    const connection = await getMakerworldConnection(sync.userId);
    return connection === "disconnected" ? DISCONNECTED : connection === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof MakerworldAuthError,
    mark: (userId) => markMakerworldCookieRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // It rate-limits bulk imports hard.
};
