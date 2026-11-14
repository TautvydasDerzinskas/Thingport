import { brandOwnedPrinters, ownedPrintersOf } from "../ownedPrinters";
import { CrealitycloudAuthError, fetchCrealitycloudDeviceModels, type CrealitycloudAuth } from "./api";
import { getCrealitycloudConnection, getUserCrealitycloudAuth, markCrealitycloudSessionRejected } from "./session";

/** The printers bound to the user's Creality Cloud account, which its site lists to their sign-in. */
export const crealitycloudPrinters = ownedPrintersOf<CrealitycloudAuth>({
  connected: async (userId) => (await getCrealitycloudConnection(userId)) === "connected",
  auth: getUserCrealitycloudAuth,
  list: async (auth) => {
    const models = await fetchCrealitycloudDeviceModels(auth);
    return models && brandOwnedPrinters("creality", models);
  },
  isRejection: (err) => err instanceof CrealitycloudAuthError,
  markRejected: (userId) => markCrealitycloudSessionRejected(userId),
});
