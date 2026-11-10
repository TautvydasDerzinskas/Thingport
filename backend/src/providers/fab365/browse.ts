import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { FAB365_LIKES_KEY, Fab365AuthError, Fab365RateLimitError, fab365LikesCard } from "./api";
import { getFab365Connection, getUserFab365Auth, withFab365Auth } from "./session";

export const fab365Browse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getFab365Connection(userId);
    return { connected: state === "connected", account: account?.name ?? null };
  },
  linkedThrough: "sign-in",
  // The user's favourites, read with their sign-in: Fab365 has no collections.
  async cards(userId) {
    const connected = await getUserFab365Auth(userId);
    if (!connected) {
      throw new HttpError(
        409,
        "Connect Fab365 in Configuration > Providers, or visit it signed in with Thingport Grab",
      );
    }
    return [await withFab365Auth(userId, connected.auth, (auth) => fab365LikesCard(auth))];
  },
  async card(userId, source) {
    if (source.externalId !== FAB365_LIKES_KEY) return null;
    const connected = await getUserFab365Auth(userId);
    return connected ? withFab365Auth(userId, connected.auth, (auth) => fab365LikesCard(auth)) : null;
  },
  httpError(err) {
    if (err instanceof Fab365AuthError) return new HttpError(400, err.message);
    if (err instanceof Fab365RateLimitError) return new HttpError(429, err.message);
  },
};
