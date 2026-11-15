import { HttpError } from "../../utils/fileUtils";
import { createLogger } from "../../logger";
import type { ProviderBrowse } from "../types";
import {
  VOXELSHARE_SITES,
  VoxelshareAuthError,
  listVoxelshareCollections,
  voxelshareCollectionUrl,
  voxelshareLikesSiteOf,
} from "./api";
import { readVoxelshareCollection } from "./lists";
import {
  getUserVoxelshareToken,
  getVoxelshareAccountName,
  getVoxelshareConnection,
  markVoxelshareSessionRejected,
} from "./session";

const log = createLogger("voxelshare");
const CONNECT = "Connect VoxelShare in Configuration > Providers, or visit it with Thingport Grab";

/** A site's likes and own collections, read with its sign-in; one it turns down is remembered. */
async function siteCards(userId: string, region: (typeof VOXELSHARE_SITES)[number], token: string) {
  try {
    return await listVoxelshareCollections(token, region);
  } catch (err) {
    if (err instanceof VoxelshareAuthError) await markVoxelshareSessionRejected(userId, token, region);
    throw err;
  }
}

export const voxelshareBrowse: ProviderBrowse = {
  async account(userId) {
    const sites = await Promise.all(
      VOXELSHARE_SITES.map(async (region) => ({
        connected: (await getVoxelshareConnection(userId, region)) === "connected",
        account: await getVoxelshareAccountName(userId, region),
      })),
    );
    const connected = sites.filter((site) => site.connected);
    return { connected: connected.length > 0, account: connected.find((site) => site.account)?.account ?? null };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections on each site they're signed in to, the default one among them. A site
  // that can't be read leaves the other's shown, and fails the tab only when no site could be.
  async cards(userId) {
    const signedIn = (
      await Promise.all(
        VOXELSHARE_SITES.map(async (region) => ({ region, token: await getUserVoxelshareToken(userId, region) })),
      )
    ).filter((site): site is { region: (typeof site)["region"]; token: string } => Boolean(site.token));
    if (!signedIn.length) throw new HttpError(409, CONNECT);
    const read = await Promise.allSettled(signedIn.map(({ region, token }) => siteCards(userId, region, token)));
    const failed = read.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
    if (failed.length === read.length) throw failed[0];
    // A sign-in turned down is remembered, and shown as expired; anything else is worth a line.
    for (const err of failed) {
      if (!(err instanceof VoxelshareAuthError))
        log.warn("one site's lists couldn't be read", { user: userId, error: err });
    }
    return read.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  },
  // Any collection the user can read: their own, or anyone's public one.
  async card(userId, source) {
    const likesSite = voxelshareLikesSiteOf(source.externalId);
    if (likesSite !== undefined) {
      const token = await getUserVoxelshareToken(userId, likesSite);
      if (!token) return null;
      return (await siteCards(userId, likesSite, token)).find((own) => own.id === source.externalId) ?? null;
    }
    const collection = await readVoxelshareCollection(userId, source.externalId, 4);
    if (!collection || collection === "signIn") return null;
    return {
      id: source.externalId,
      name: collection.info.name,
      url: voxelshareCollectionUrl(source.externalId),
      modelCount: collection.info.modelCount,
      thumbnails: collection.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: collection.info.private,
      owner: null,
    };
  },
  httpError: (err) => (err instanceof VoxelshareAuthError ? new HttpError(400, err.message) : undefined),
};
