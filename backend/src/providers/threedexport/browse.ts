import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchThreedexportCollection,
  fetchThreedexportDefault,
  fetchThreedexportOwnCollections,
  isThreedexportDefaultUrl,
  parseThreedexportCollectionUrl,
  THREEDEXPORT_CARD_THUMBNAILS,
  THREEDEXPORT_DEFAULT_KEY,
  THREEDEXPORT_DEFAULT_URL,
  ThreedexportAuthError,
  threedexportCard,
  threedexportCollectionUrl,
  threedexportDefaultName,
  ThreedexportRateLimitError,
  threedexportVisit,
} from "./api";
import {
  getThreedexportConnection,
  getUserThreedexportSession,
  threedexportAccountOf,
  withThreedexportVisit,
} from "./session";

const CONNECT = "Connect 3DExport in Configuration > Providers, or visit it signed in with Thingport Grab";

export const threedexportBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getThreedexportConnection(userId);
    return { connected: state === "connected", account: account?.username ?? null };
  },
  linkedThrough: "sign-in",
  // The user's collections, their Default Collection and the ones they made, private ones too: the bookmarks page
  // lists them to their owner, and each one's first page gives its pictures.
  async cards(userId) {
    const account = await threedexportAccountOf(userId);
    if (!account || !(await getUserThreedexportSession(userId))) throw new HttpError(409, CONNECT);
    return withThreedexportVisit(userId, async (visit) => {
      const own = await fetchThreedexportOwnCollections(visit);
      const cards = [];
      for (const collection of own) {
        const found =
          collection.key === THREEDEXPORT_DEFAULT_KEY
            ? await fetchThreedexportDefault(visit, THREEDEXPORT_CARD_THUMBNAILS)
            : await fetchThreedexportCollection(collection.key, visit, THREEDEXPORT_CARD_THUMBNAILS);
        if (!found) continue;
        cards.push(
          threedexportCard(collection.key, collection.url, found, {
            private: collection.private,
            owner: account.username,
            name: collection.key === THREEDEXPORT_DEFAULT_KEY ? threedexportDefaultName() : collection.name,
          }),
        );
      }
      return cards;
    });
  },
  // Anyone's public collection by its link, or one of the user's own, private ones too.
  async card(userId, source) {
    if (isThreedexportDefaultUrl(source.url)) {
      if (!(await getUserThreedexportSession(userId))) return null;
      const found = await withThreedexportVisit(userId, (visit) =>
        fetchThreedexportDefault(visit, THREEDEXPORT_CARD_THUMBNAILS),
      );
      const owner = (await getThreedexportConnection(userId)).account?.username ?? null;
      return threedexportCard(THREEDEXPORT_DEFAULT_KEY, THREEDEXPORT_DEFAULT_URL, found, { private: true, owner });
    }
    const collection = parseThreedexportCollectionUrl(source.url);
    if (!collection) return null;
    const url = threedexportCollectionUrl(collection.collectionId);
    // Public when anyone can see it; otherwise private, and only its owner's sign-in shows it.
    const open = await fetchThreedexportCollection(
      collection.collectionId,
      threedexportVisit(),
      THREEDEXPORT_CARD_THUMBNAILS,
    );
    if (open) return threedexportCard(collection.collectionId, url, open, { private: false, owner: null });
    if (!(await getUserThreedexportSession(userId))) return null;
    const own = await withThreedexportVisit(userId, (visit) =>
      fetchThreedexportCollection(collection.collectionId, visit, THREEDEXPORT_CARD_THUMBNAILS),
    );
    const owner = (await getThreedexportConnection(userId)).account?.username ?? null;
    return own && threedexportCard(collection.collectionId, url, own, { private: true, owner });
  },
  httpError(err) {
    if (err instanceof ThreedexportAuthError) return new HttpError(400, err.message);
    if (err instanceof ThreedexportRateLimitError) return new HttpError(429, err.message);
  },
};
