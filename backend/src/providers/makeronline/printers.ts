import { brandOwnedPrinters, ownedPrintersOf } from "../ownedPrinters";
import { fetchMakeronlineProfilePrinter, MakeronlineAuthError } from "./api";
import { getMakeronlineConnection, getUserMakeronlineToken, markMakeronlineTokenRejected } from "./session";

/** The printer the user picked on their MakerOnline profile: Anycubic keeps no list of a user's printers there, only
 *  that one. */
export const makeronlinePrinters = ownedPrintersOf<string>({
  connected: async (userId) => (await getMakeronlineConnection(userId)) === "connected",
  auth: getUserMakeronlineToken,
  list: async (token) => {
    const printer = await fetchMakeronlineProfilePrinter(token);
    if (printer === undefined) return null;
    return printer ? brandOwnedPrinters("anycubic", [[printer]]) : [];
  },
  isRejection: (err) => err instanceof MakeronlineAuthError,
  markRejected: (userId, token) => markMakeronlineTokenRejected(userId, token),
});
