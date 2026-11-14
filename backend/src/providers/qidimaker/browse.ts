import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { QIDIMAKER_LIKES_KEY, QidimakerAuthError, listQidimakerCollections, qidimakerCollectionUrl } from "./api";
import { readQidimakerCollection } from "./lists";
import {
  getQidimakerAccountName,
  getQidimakerConnection,
  getUserQidimakerToken,
  markQidimakerSessionRejected,
} from "./session";

export const qidimakerBrowse: ProviderBrowse = {
  async account(userId) {
    return {
      connected: (await getQidimakerConnection(userId)) === "connected",
      account: await getQidimakerAccountName(userId),
    };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections, the default one among them, read with their sign-in.
  async cards(userId) {
    const token = await getUserQidimakerToken(userId);
    if (!token) {
      throw new HttpError(409, "Connect QIDI Maker in Configuration > Providers, or visit it with Thingport Grab");
    }
    try {
      return await listQidimakerCollections(token);
    } catch (err) {
      if (err instanceof QidimakerAuthError) await markQidimakerSessionRejected(userId, token);
      throw err;
    }
  },
  // Any collection the user can read: their own, or anyone's public one.
  async card(userId, source) {
    if (source.externalId === QIDIMAKER_LIKES_KEY) {
      if (!(await getUserQidimakerToken(userId))) return null;
      return (await this.cards(userId)).find((own) => own.id === QIDIMAKER_LIKES_KEY) ?? null;
    }
    const collection = await readQidimakerCollection(userId, source.externalId, 4);
    if (!collection || collection === "signIn") return null;
    return {
      id: source.externalId,
      name: collection.info.name,
      url: qidimakerCollectionUrl(source.externalId),
      modelCount: collection.info.modelCount,
      thumbnails: collection.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: collection.info.private,
      owner: null,
    };
  },
  httpError: (err) => (err instanceof QidimakerAuthError ? new HttpError(400, err.message) : undefined),
};
