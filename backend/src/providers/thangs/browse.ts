import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchThangsCollection,
  fetchThangsPurchases,
  listThangsCollections,
  THANGS_LIKES_KEY,
  ThangsAuthError,
  ThangsBlockedError,
  thangsCollectionUrl,
  ThangsPrivateCollectionError,
} from "./api";
import {
  getThangsConnection,
  getUserThangsId,
  getUserThangsToken,
  markThangsSessionRejected,
  withThangsToken,
} from "./session";

/** Runs `call` with the user's sign-in, renewed when it's out, and what they bought; remembers a rejection. */
async function withThangs<T>(
  userId: string,
  call: (session: { token: string; thangsId: string; owned: Set<string> }) => Promise<T>,
): Promise<T> {
  try {
    const [token, thangsId] = await Promise.all([getUserThangsToken(userId), getUserThangsId(userId)]);
    if (!token || !thangsId) {
      throw new HttpError(409, "Connect Thangs in Configuration > Providers, or visit it with Thingport Grab");
    }
    const owned = await withThangsToken(userId, token, fetchThangsPurchases);
    return await withThangsToken(userId, token, (fresh) => call({ token: fresh, thangsId, owned }));
  } catch (err) {
    if (err instanceof ThangsAuthError) await markThangsSessionRejected(userId);
    throw err;
  }
}

export const thangsBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getThangsConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes and their own collections, read with their sign-in.
  cards(userId) {
    return withThangs(userId, ({ token, thangsId, owned }) => listThangsCollections(thangsId, token, owned));
  },
  // Any collection the user can see: public ones, and their own private ones.
  async card(userId, source) {
    if (source.externalId === THANGS_LIKES_KEY) {
      return (await this.cards(userId)).find((own) => own.id === THANGS_LIKES_KEY) ?? null;
    }
    return withThangs(userId, async ({ token, owned }) => {
      const collection = await fetchThangsCollection(source.externalId, token, owned, 4);
      if (!collection) return null;
      const { info } = collection;
      return {
        id: source.externalId,
        name: info.name,
        url: thangsCollectionUrl(source.externalId, info.owner, info.name),
        modelCount: info.modelCount,
        thumbnails: collection.entries.flatMap((entry) => (entry.cover ? [entry.cover] : [])),
        private: info.private,
        owner: info.owner,
      };
    });
  },
  httpError(err) {
    if (err instanceof ThangsAuthError) return new HttpError(400, err.message);
    if (err instanceof ThangsBlockedError) return new HttpError(429, err.message);
    if (err instanceof ThangsPrivateCollectionError) return new HttpError(403, err.message);
  },
};
