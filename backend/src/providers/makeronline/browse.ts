import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchMakeronlineCollection,
  fetchMakeronlineCollectionInfo,
  listMakeronlineCollections,
  MakeronlineAuthError,
  makeronlineCollectionUrl,
  MAKERONLINE_LIKES_KEY,
} from "./api";
import { getMakeronlineConnection, getUserMakeronlineId, getUserMakeronlineToken } from "./session";

export const makeronlineBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getMakeronlineConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections, read with their sign-in.
  async cards(userId) {
    const [token, makeronlineId] = await Promise.all([getUserMakeronlineToken(userId), getUserMakeronlineId(userId)]);
    if (!token || !makeronlineId) {
      throw new HttpError(409, "Connect MakerOnline in Configuration > Providers, or visit it with Thingport Grab");
    }
    return listMakeronlineCollections(token, makeronlineId);
  },
  // Any collection the user can see: public ones without a sign-in, their own private ones with it.
  async card(userId, source) {
    if (source.externalId === MAKERONLINE_LIKES_KEY) {
      return (await this.cards(userId)).find((own) => own.id === MAKERONLINE_LIKES_KEY) ?? null;
    }
    const token = await getUserMakeronlineToken(userId);
    const info = await fetchMakeronlineCollectionInfo(source.externalId, token);
    const listing = info ? await fetchMakeronlineCollection(source.externalId, token, 4) : null;
    if (!info || !listing) return null;
    return {
      id: source.externalId,
      name: info.name,
      url: makeronlineCollectionUrl(info.ownerId, source.externalId),
      modelCount: info.modelCount,
      thumbnails: listing.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
      private: info.private,
      owner: null,
    };
  },
  httpError: (err) => (err instanceof MakeronlineAuthError ? new HttpError(400, err.message) : undefined),
};
