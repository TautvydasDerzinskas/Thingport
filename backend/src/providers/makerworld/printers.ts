import { brandPrinterForName, printersForBambuCode } from "../../printers/catalogue";
import type { ProviderOwnedPrinters } from "../types";
import { extractMakerworldBearerToken, fetchBoundPrinters } from "./api";
import { getMakerworldConnection, getUserMakerworldCookie, markMakerworldCookieRejected } from "./session";

/** The printers bound to the Bambu Lab account the user's MakerWorld sign-in is: by their model code, else their
 *  product name. */
export const makerworldPrinters: ProviderOwnedPrinters = {
  connected: async (userId) => (await getMakerworldConnection(userId)) === "connected",
  async read(userId) {
    const cookie = await getUserMakerworldCookie(userId);
    const token = extractMakerworldBearerToken(cookie);
    if (!cookie || !token) return "signed-out";
    const bound = await fetchBoundPrinters(token);
    if (bound === "rejected") {
      // Only while it's still the cookie stored: a newer one may have come since it was read.
      await markMakerworldCookieRejected(userId, cookie);
      return "rejected";
    }
    return (
      bound &&
      bound.flatMap((device) => {
        const summary =
          printersForBambuCode(device.model)[0] ?? brandPrinterForName("bambulab", device.product)?.printer;
        return summary ? [{ printerId: summary.id, nozzle: device.nozzle }] : [];
      })
    );
  },
};
