import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchPixup3dCollectionCards,
  parsePixup3dCollectionUrl,
  parsePixup3dWishlistUrl,
  Pixup3dAuthError,
  pixup3dCollectionCard,
  Pixup3dRateLimitError,
  pixup3dWishlistCard,
} from "./api";
import { getPixup3dConnection, pixup3dMemberOf, withPixup3dSession } from "./session";

export const pixup3dBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getPixup3dConnection(userId);
    return { connected: state === "connected", account: account?.name ?? account?.username ?? null };
  },
  linkedThrough: "sign-in",
  // The user's wishlist and their own collections, the private ones too. They're anyone's to read, those aside; the
  // sign-in says whose they are.
  async cards(userId) {
    const me = await pixup3dMemberOf(userId);
    return withPixup3dSession(userId, async (session) => {
      if (!me || !session) {
        throw new HttpError(
          409,
          "Connect PIXUP in Configuration > Providers, or visit it signed in with Thingport Grab",
        );
      }
      const wishlist = await pixup3dWishlistCard(me.username);
      const collections = await fetchPixup3dCollectionCards(me.username, session);
      return [...(wishlist ? [wishlist] : []), ...collections];
    });
  },
  // Anyone's wishlist or collection, by its link; a private collection only its owner's.
  async card(userId, source) {
    const wishlist = parsePixup3dWishlistUrl(source.url);
    if (wishlist) return pixup3dWishlistCard(wishlist.username);
    const collection = parsePixup3dCollectionUrl(source.url);
    if (!collection) return null;
    return withPixup3dSession(userId, (session) =>
      pixup3dCollectionCard(collection.username, collection.collectionId, session),
    );
  },
  httpError(err) {
    if (err instanceof Pixup3dAuthError) return new HttpError(400, err.message);
    if (err instanceof Pixup3dRateLimitError) return new HttpError(429, err.message);
  },
};
