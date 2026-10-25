import { readConnection, writeConnection } from "../connections";
import manifest from "./manifest.generated";
import { getMyminifactoryApiKey } from "./apiKey";
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
    const [user, key] = await Promise.all([readConnection(userId, manifest.id), getMyminifactoryApiKey()]);
    return { connected: Boolean(key), account: user?.accountName ?? null };
  },
  async setAccount(userId, value) {
    const key = value ? await requireKey() : null;
    const user = key ? await resolveMyminifactoryUser(value!, key) : null;
    if (value && !user) throw new HttpError(404, `MyMiniFactory has no user "${value}"`);
    await writeConnection(userId, manifest.id, { accountName: user?.username ?? null });
  },
  async cards(userId) {
    const key = await requireKey();
    const username = (await readConnection(userId, manifest.id))?.accountName;
    if (!username) throw new HttpError(409, "Tell Thingport your MyMiniFactory username first");
    return listMyminifactoryUserCollections(username, key);
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
