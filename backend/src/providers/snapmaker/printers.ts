import type { RegionId } from "../index.generated";
import { brandOwnedPrinters, ownedPrintersOf } from "../ownedPrinters";
import type { OwnedPrinter, ProviderOwnedPrinters } from "../types";
import { fetchSnapmakerDeviceModels, SnapmakerAuthError } from "./api";
import manifest from "./manifest.generated";
import { getSnapmakerConnection, getUserSnapmakerToken, markSnapmakerTokenRejected } from "./session";

const siteOf = (region: RegionId | null) =>
  ownedPrintersOf<string>({
    connected: async (userId) => (await getSnapmakerConnection(userId, region)) === "connected",
    auth: (userId) => getUserSnapmakerToken(userId, region),
    list: async (token) => {
      const models = await fetchSnapmakerDeviceModels(token, region);
      return models && brandOwnedPrinters("snapmaker", models);
    },
    isRejection: (err) => err instanceof SnapmakerAuthError,
    markRejected: (userId, token) => markSnapmakerTokenRejected(userId, token, region),
  });

const SITES = [siteOf(null), ...manifest.regions.map((region) => siteOf(region.id))];

/** The printers bound to the user's Snapmaker accounts, which each site's account API lists to its Snapmaker Space
 *  sign-in. The China site's accounts are separate ones, so every site signed in to is asked; one answer is enough. */
export const snapmakerPrinters: ProviderOwnedPrinters = {
  connected: async (userId) => (await Promise.all(SITES.map((site) => site.connected(userId)))).some(Boolean),
  async read(userId) {
    const answers = await Promise.all(SITES.map((site) => site.read(userId).catch(() => null)));
    const found = answers.filter((answer): answer is OwnedPrinter[] => Array.isArray(answer));
    if (found.length) return found.flat();
    if (answers.includes("rejected")) return "rejected";
    return answers.every((answer) => answer === "signed-out") ? "signed-out" : null;
  },
};
