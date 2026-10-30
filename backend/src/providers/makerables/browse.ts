import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  MakerablesAuthError,
  MakerablesForbiddenError,
  MakerablesRateLimitError,
  makerablesSavedCard,
  makerablesSavedKey,
} from "./api";
import { getMakerablesConnection, getUserMakerablesAccount, makerablesToken } from "./session";

export const makerablesBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getMakerablesConnection(userId);
    return { connected: state === "connected", account: account?.name ?? account?.userId ?? null };
  },
  linkedThrough: "sign-in",
  // The user's own saved projects, read with their sign-in: Makerables has no other list.
  async cards(userId) {
    const connected = await getUserMakerablesAccount(userId);
    if (!connected) {
      throw new HttpError(409, "Connect Makerables in Configuration > Providers, or visit it with Thingport Grab");
    }
    const token = await makerablesToken(userId, connected.cookie);
    return [await makerablesSavedCard(connected.account.userId, token)];
  },
  // Only the user's own: Makerables turns down a call for anyone else's saved projects.
  async card(userId, source) {
    const connected = await getUserMakerablesAccount(userId);
    if (!connected || source.externalId !== makerablesSavedKey(connected.account.userId)) return null;
    const token = await makerablesToken(userId, connected.cookie);
    return makerablesSavedCard(connected.account.userId, token);
  },
  httpError(err) {
    if (err instanceof MakerablesAuthError) return new HttpError(400, err.message);
    if (err instanceof MakerablesForbiddenError) return new HttpError(403, err.message);
    if (err instanceof MakerablesRateLimitError) return new HttpError(429, err.message);
  },
};
