import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  CrealitycloudAuthError,
  crealitycloudCollectionUrl,
  fetchCrealitycloudCollection,
  listCrealitycloudCollections,
} from "./api";
import { getCrealitycloudConnection, getUserCrealitycloudAuth } from "./session";

export const crealitycloudBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getCrealitycloudConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections, read with their sign-in.
  async cards(userId) {
    const auth = await getUserCrealitycloudAuth(userId);
    if (!auth) {
      throw new HttpError(409, "Connect Creality Cloud in Configuration > Providers, or visit it with Thingport Grab");
    }
    return listCrealitycloudCollections(auth);
  },
  // Any collection, by its alias: Creality Cloud lists even private ones without a sign-in.
  async card(userId, source) {
    if (source.externalId.startsWith("likes-")) {
      return (await this.cards(userId)).find((own) => own.id === source.externalId) ?? null;
    }
    const collection = await fetchCrealitycloudCollection(source.externalId, 4);
    if (!collection) return null;
    return {
      id: source.externalId,
      name: collection.info.name,
      url: crealitycloudCollectionUrl(source.externalId),
      modelCount: collection.info.modelCount,
      thumbnails: collection.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: collection.info.private,
      owner: null,
    };
  },
  httpError: (err) => (err instanceof CrealitycloudAuthError ? new HttpError(400, err.message) : undefined),
};
