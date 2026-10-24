import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { fetchNexprintCollection, listNexprintCollections, NexprintAuthError, nexprintCollectionUrl } from "./api";
import { getNexprintConnection, getUserNexprintToken } from "./session";

export const nexprintBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getNexprintConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's own collections, read with their sign-in.
  async cards(userId) {
    const token = await getUserNexprintToken(userId);
    if (!token) {
      throw new HttpError(409, "Connect NexPrint in Configuration > Providers, or visit it with Thingport Grab");
    }
    return listNexprintCollections(token);
  },
  // Any collection, by its "G" id: NexPrint lists even private ones without a sign-in.
  async card(_userId, source) {
    const collection = await fetchNexprintCollection(source.externalId, 4);
    if (!collection) return null;
    return {
      id: source.externalId,
      name: collection.info.name,
      url: nexprintCollectionUrl(source.externalId, collection.info.ownerId),
      modelCount: collection.info.modelCount,
      thumbnails: collection.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: collection.info.private,
      owner: null,
    };
  },
  httpError: (err) => (err instanceof NexprintAuthError ? new HttpError(400, err.message) : undefined),
};
