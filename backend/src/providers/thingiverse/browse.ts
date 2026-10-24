import { prisma } from "../../db";
import { LIKES_ID_PREFIX } from "../_generated";
import { thingiverseLikesUrl } from "../_generated/thingiverse/urls";
import { getThingiverseAccessToken } from "./token";
import type { ProviderCollectionCard } from "../../services/providerCollectionCard";
import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchThingiverseCollectionCard,
  fetchThingiverseLikesSummary,
  listThingiverseUserCollections,
  resolveThingiverseUser,
  ThingiverseAuthError,
  ThingiverseRateLimitError,
} from "./api";

async function requireToken(): Promise<string> {
  const token = await getThingiverseAccessToken();
  if (!token) throw new HttpError(409, "Thingiverse isn't connected on this Thingport yet");
  return token;
}

/** A user's likes, which anyone can see, as one more collection to sync with. */
async function likesCard(username: string, token: string): Promise<ProviderCollectionCard | null> {
  const likes = await fetchThingiverseLikesSummary(username, token);
  if (!likes) return null;
  return {
    id: `${LIKES_ID_PREFIX}${likes.username.toLowerCase()}`,
    name: "Liked models",
    url: thingiverseLikesUrl(likes.username),
    modelCount: likes.count,
    thumbnails: likes.thumbnails,
    private: false,
    owner: likes.username,
  };
}

export const thingiverseBrowse: ProviderBrowse = {
  async account(userId) {
    const [user, token] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { thingiverseUsername: true } }),
      getThingiverseAccessToken(),
    ]);
    return { connected: Boolean(token), account: user?.thingiverseUsername ?? null };
  },
  async setAccount(userId, value) {
    const token = value ? await requireToken() : null;
    const user = token ? await resolveThingiverseUser(value!, token) : null;
    if (value && !user) throw new HttpError(404, `Thingiverse has no user "${value}"`);
    await prisma.user.update({ where: { id: userId }, data: { thingiverseUsername: user?.username ?? null } });
  },
  async cards(userId) {
    const token = await requireToken();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { thingiverseUsername: true } });
    if (!user?.thingiverseUsername) throw new HttpError(409, "Tell Thingport your Thingiverse username first");
    const username = user.thingiverseUsername;
    // Its likes sync like a collection; a failed count costs only them.
    const [likes, collections] = await Promise.all([
      likesCard(username, token).catch(() => null),
      listThingiverseUserCollections(username, token),
    ]);
    return [...(likes ? [likes] : []), ...collections];
  },
  async card(_userId, source) {
    const token = await requireToken();
    return source.likesOf ? likesCard(source.likesOf, token) : fetchThingiverseCollectionCard(source.externalId, token);
  },
  httpError(err) {
    if (err instanceof ThingiverseRateLimitError) return new HttpError(429, err.message);
    if (err instanceof ThingiverseAuthError) return new HttpError(400, err.message);
  },
};
