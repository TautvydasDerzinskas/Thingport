import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { EUFYMAKE_LIKES_KEY, EufymakeAuthError, eufymakeLikesCard } from "./api";
import { getEufymakeConnection, getUserEufymakeAuth } from "./session";

export const eufymakeBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getEufymakeConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes, read with their sign-in: eufyMake has no collections.
  async cards(userId) {
    const auth = await getUserEufymakeAuth(userId);
    if (!auth) {
      throw new HttpError(409, "Connect eufyMake in Configuration > Providers, or visit it with Thingport Grab");
    }
    return [await eufymakeLikesCard(auth)];
  },
  async card(userId, source) {
    const auth = source.externalId === EUFYMAKE_LIKES_KEY ? await getUserEufymakeAuth(userId) : null;
    return auth ? eufymakeLikesCard(auth) : null;
  },
  httpError: (err) => (err instanceof EufymakeAuthError ? new HttpError(400, err.message) : undefined),
};
