import { brandOwnedPrinters, ownedPrintersOf } from "../ownedPrinters";
import type { OwnedPrinter, ProviderOwnedPrinters } from "../types";
import { fetchVoxelshareDeviceModels, VoxelshareAuthError, type VoxelshareRegion } from "./api";
import manifest from "./manifest.generated";
import { getUserVoxelshareToken, getVoxelshareConnection, markVoxelshareSessionRejected } from "./session";

const SITES: VoxelshareRegion[] = [null, ...manifest.regions.map((region) => region.id)];

/** One site's: the printers bound to the Flashforge account its sign-in is. */
const sitePrinters = (region: VoxelshareRegion) =>
  ownedPrintersOf<string>({
    connected: async (userId) => (await getVoxelshareConnection(userId, region)) === "connected",
    auth: (userId) => getUserVoxelshareToken(userId, region),
    list: async (token) => {
      const models = await fetchVoxelshareDeviceModels(token, region);
      return models && brandOwnedPrinters("flashforge", models);
    },
    isRejection: (err) => err instanceof VoxelshareAuthError,
    markRejected: (userId, token) => markVoxelshareSessionRejected(userId, token, region),
  });

const BY_SITE = SITES.map(sitePrinters);

/** The printers bound to the user's Flashforge accounts, which VoxelShare's API lists to their sign-in on each site
 *  they're signed in to: those of every site that answered, else why none did. */
export const voxelsharePrinters: ProviderOwnedPrinters = {
  connected: async (userId) => (await Promise.all(BY_SITE.map((site) => site.connected(userId)))).includes(true),
  async read(userId) {
    const answers = await Promise.all(BY_SITE.map((site) => site.read(userId).catch(() => null)));
    const lists = answers.filter((answer): answer is OwnedPrinter[] => Array.isArray(answer));
    if (lists.length) return lists.flat();
    if (answers.includes("rejected")) return "rejected";
    return answers.every((answer) => answer === "signed-out") ? "signed-out" : null;
  },
};
