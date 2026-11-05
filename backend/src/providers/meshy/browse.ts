import { mapWithConcurrency } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchMeshyCollection,
  fetchMeshyUserCollections,
  MeshyAccountChangedError,
  MeshyAuthError,
  MeshyBlockedError,
  meshyCollectionCard,
  meshyGenerationsCard,
  meshyGenerationsKey,
  MeshyRateLimitError,
  parseMeshyCollectionUrl,
} from "./api";
import { getMeshyConnection, getUserMeshyAuth, withMeshyAuth } from "./session";

const CONNECT_FIRST = "Connect Meshy in Configuration > Providers, or visit it with Thingport Grab";
// Each card is a call of its own; a few at a time, so a user with many collections doesn't send them all at once.
const CARD_CONCURRENCY = 4;

export const meshyBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getMeshyConnection(userId);
    return { connected: state === "connected", account: account?.name ?? account?.handle ?? null };
  },
  linkedThrough: "sign-in",
  // The user's own generations, then the collections they made: every file needs their sign-in anyway.
  async cards(userId) {
    const connected = await getUserMeshyAuth(userId);
    if (!connected) throw new HttpError(409, CONNECT_FIRST);
    const { account } = connected;
    const generations = await withMeshyAuth(userId, connected.auth, (auth) =>
      meshyGenerationsCard(account.userId, auth),
    );
    const collections = await fetchMeshyUserCollections(account.userId);
    const owner = account.handle ?? account.name;
    return [
      generations,
      ...(await mapWithConcurrency(collections, CARD_CONCURRENCY, (collection) =>
        meshyCollectionCard({ ...collection, owner }),
      )),
    ];
  },
  async card(userId, source) {
    const collectionId = parseMeshyCollectionUrl(source.url)?.collectionId;
    if (collectionId) {
      const found = await fetchMeshyCollection(collectionId);
      return found && meshyCollectionCard({ id: found.id, name: found.name, owner: null });
    }
    // Only the user's own generations: nobody else's workspace can be read.
    const connected = await getUserMeshyAuth(userId);
    if (!connected || source.externalId !== meshyGenerationsKey(connected.account.userId)) return null;
    return withMeshyAuth(userId, connected.auth, (auth) => meshyGenerationsCard(connected.account.userId, auth));
  },
  httpError(err) {
    if (err instanceof MeshyAuthError) return new HttpError(400, err.message);
    if (err instanceof MeshyRateLimitError) return new HttpError(429, err.message);
    if (err instanceof MeshyBlockedError) return new HttpError(503, err.message);
    if (err instanceof MeshyAccountChangedError) return new HttpError(409, err.message);
  },
};
