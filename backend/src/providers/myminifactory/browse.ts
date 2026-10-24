import { prisma } from "../../db";
import { getMyminifactoryApiKey } from "../../services/settingsService";
import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  fetchMyminifactoryCollectionCard,
  listMyminifactoryUserCollections,
  MyminifactoryAuthError,
  MyminifactoryRateLimitError,
  resolveMyminifactoryUser,
} from "./api";

async function requireKey(): Promise<string> {
  const key = await getMyminifactoryApiKey();
  if (!key) throw new HttpError(409, "MyMiniFactory isn't connected on this Thingport yet");
  return key;
}

export const myminifactoryBrowse: ProviderBrowse = {
  async account(userId) {
    const [user, key] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { myminifactoryUsername: true } }),
      getMyminifactoryApiKey(),
    ]);
    return { connected: Boolean(key), account: user?.myminifactoryUsername ?? null };
  },
  async setAccount(userId, value) {
    const key = value ? await requireKey() : null;
    const user = key ? await resolveMyminifactoryUser(value!, key) : null;
    if (value && !user) throw new HttpError(404, `MyMiniFactory has no user "${value}"`);
    await prisma.user.update({ where: { id: userId }, data: { myminifactoryUsername: user?.username ?? null } });
  },
  async cards(userId) {
    const key = await requireKey();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { myminifactoryUsername: true } });
    if (!user?.myminifactoryUsername) throw new HttpError(409, "Tell Thingport your MyMiniFactory username first");
    return listMyminifactoryUserCollections(user.myminifactoryUsername, key);
  },
  async card(_userId, source) {
    const key = await requireKey();
    const [username, slug] = source.externalId.split("/");
    return fetchMyminifactoryCollectionCard(username, slug, key);
  },
  httpError(err) {
    if (err instanceof MyminifactoryRateLimitError) return new HttpError(429, err.message);
    if (err instanceof MyminifactoryAuthError) return new HttpError(400, err.message);
  },
};
