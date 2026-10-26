import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchPinshapeCollectionCards,
  parsePinshapeCollectionUrl,
  parsePinshapeLikesUrl,
  PinshapeAuthError,
  PinshapeBlockedError,
  pinshapeCollectionCard,
  pinshapeLikesCard,
  PinshapeRateLimitError,
} from "./api";
import { getPinshapeConnection, getUserPinshapeCookie } from "./session";

export const pinshapeBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getPinshapeConnection(userId);
    return { connected: state === "connected", account: account?.name ?? null };
  },
  linkedThrough: "sign-in",
  // The user's likes, their own collections and the ones they subscribed to. They're anyone's to read; the sign-in
  // says whose they are.
  async cards(userId) {
    const [cookie, { account }] = await Promise.all([getUserPinshapeCookie(userId), getPinshapeConnection(userId)]);
    if (!cookie || !account) {
      throw new HttpError(
        409,
        "Connect Pinshape in Configuration > Providers, or visit it signed in with Thingport Grab",
      );
    }
    const name = account.key.slice(account.userId.length + 1) || null;
    const [likes, own, subscribed] = await Promise.all([
      pinshapeLikesCard(account.userId, name),
      fetchPinshapeCollectionCards(account.userId, "collections", cookie),
      fetchPinshapeCollectionCards(account.userId, "subscriptions", cookie),
    ]);
    const seen = new Set<string>();
    return [...(likes ? [likes] : []), ...own, ...subscribed].filter(
      (card) => !seen.has(card.id) && !!seen.add(card.id),
    );
  },
  // Anyone's collection or likes, by their link.
  async card(_userId, source) {
    const likes = parsePinshapeLikesUrl(source.url);
    if (likes) return pinshapeLikesCard(likes.userId, likes.name);
    const collection = parsePinshapeCollectionUrl(source.url);
    return collection ? pinshapeCollectionCard(collection.collectionId) : null;
  },
  httpError(err) {
    if (err instanceof PinshapeAuthError) return new HttpError(400, err.message);
    if (err instanceof PinshapeRateLimitError) return new HttpError(429, err.message);
    if (err instanceof PinshapeBlockedError) return new HttpError(503, err.message);
  },
};
