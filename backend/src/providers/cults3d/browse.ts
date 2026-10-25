import { HttpError } from "../../utils/fileUtils";
import { syncLikesUsername } from "../names";
import type { ProviderBrowse } from "../types";
import {
  Cults3dAuthError,
  cults3dLikesKey,
  cults3dLikesName,
  cults3dLikesUrl,
  Cults3dRateLimitError,
  fetchCults3dLikes,
  fetchCults3dOrders,
  listCults3dCollections,
  type Cults3dCredentials,
} from "./api";
import { getCults3dConnection, getUserCults3dCredentials, markCults3dApiRejected } from "./session";

/** Runs `call` with the user's API key and the models they own; remembers a rejected key. */
async function withCults3d<T>(
  userId: string,
  call: (session: { credentials: Cults3dCredentials; owned: Set<string> }) => Promise<T>,
): Promise<T> {
  const credentials = await getUserCults3dCredentials(userId);
  if (!credentials) throw new HttpError(409, "Enter your Cults3D nickname and API key in Configuration > Providers");
  try {
    const owned = new Set((await fetchCults3dOrders(credentials)).keys());
    return await call({ credentials, owned });
  } catch (err) {
    if (err instanceof Cults3dAuthError) await markCults3dApiRejected(userId);
    throw err;
  }
}

export const cults3dBrowse: ProviderBrowse = {
  async account(userId) {
    const connection = await getCults3dConnection(userId);
    return { connected: connection.api === "connected", account: connection.nick };
  },
  linkedThrough: "API key",
  // The user's likes and their own printlists.
  cards(userId) {
    return withCults3d(userId, ({ credentials, owned }) => listCults3dCollections(credentials, owned));
  },
  async card(userId, source) {
    const likesOf = source.likesOf ?? syncLikesUsername({ externalId: source.externalId, sourceUrl: source.url });
    if (likesOf) {
      // Anyone's likes, which its API shows to any key.
      return withCults3d(userId, async ({ credentials, owned }) => {
        const likes = await fetchCults3dLikes(credentials, likesOf, owned);
        if (!likes) return null;
        return {
          id: cults3dLikesKey(likesOf),
          name: cults3dLikesName(likesOf),
          url: cults3dLikesUrl(likesOf),
          modelCount: likes.total,
          thumbnails: likes.entries.slice(0, 4).flatMap((entry) => entry.cover ?? []),
          private: false,
          owner: likesOf,
        };
      });
    }
    // Its API shows the user their own printlists only.
    const own = (await this.cards(userId)).find((card) => card.id === source.externalId);
    if (!own)
      throw new HttpError(404, "Only your own Cults3D printlists can be found: Cults3D's API shows no one else's.");
    return own;
  },
  httpError(err) {
    if (err instanceof Cults3dAuthError) return new HttpError(400, err.message);
    if (err instanceof Cults3dRateLimitError) return new HttpError(429, err.message);
  },
};
