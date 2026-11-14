import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { VOXELSHARE_LIKES_KEY, VoxelshareAuthError, listVoxelshareCollections, voxelshareCollectionUrl } from "./api";
import { readVoxelshareCollection } from "./lists";
import {
  getUserVoxelshareToken,
  getVoxelshareAccountName,
  getVoxelshareConnection,
  markVoxelshareSessionRejected,
} from "./session";

export const voxelshareBrowse: ProviderBrowse = {
  async account(userId) {
    return {
      connected: (await getVoxelshareConnection(userId)) === "connected",
      account: await getVoxelshareAccountName(userId),
    };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections, the default one among them, read with their sign-in.
  async cards(userId) {
    const token = await getUserVoxelshareToken(userId);
    if (!token) {
      throw new HttpError(409, "Connect VoxelShare in Configuration > Providers, or visit it with Thingport Grab");
    }
    try {
      return await listVoxelshareCollections(token);
    } catch (err) {
      if (err instanceof VoxelshareAuthError) await markVoxelshareSessionRejected(userId, token);
      throw err;
    }
  },
  // Any collection the user can read: their own, or anyone's public one.
  async card(userId, source) {
    if (source.externalId === VOXELSHARE_LIKES_KEY) {
      if (!(await getUserVoxelshareToken(userId))) return null;
      return (await this.cards(userId)).find((own) => own.id === VOXELSHARE_LIKES_KEY) ?? null;
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
