import { brandOwnedPrinters, ownedPrintersOf } from "../ownedPrinters";
import { fetchSnapmakerDeviceModels, SnapmakerAuthError } from "./api";
import { getSnapmakerConnection, getUserSnapmakerToken, markSnapmakerTokenRejected } from "./session";

/** The printers bound to the user's Snapmaker account, which the account's own API lists to its Snapmaker Space
 *  sign-in. */
export const snapmakerPrinters = ownedPrintersOf<string>({
  connected: async (userId) => (await getSnapmakerConnection(userId)) === "connected",
  auth: getUserSnapmakerToken,
  list: async (token) => {
    const models = await fetchSnapmakerDeviceModels(token);
    return models && brandOwnedPrinters("snapmaker", models);
  },
  isRejection: (err) => err instanceof SnapmakerAuthError,
  markRejected: (userId) => markSnapmakerTokenRejected(userId),
});
