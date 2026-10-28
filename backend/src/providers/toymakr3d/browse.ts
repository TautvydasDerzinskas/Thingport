import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { TOYMAKR3D_LIKES_KEY, Toymakr3dAuthError, Toymakr3dRateLimitError, toymakr3dLikesCard } from "./api";
import { getToymakr3dConnection, getUserToymakr3dCookie } from "./session";

export const toymakr3dBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getToymakr3dConnection(userId);
    return { connected: state === "connected", account: account?.name ?? account?.username ?? null };
  },
  linkedThrough: "sign-in",
  // The user's liked products, read with their sign-in: Toymakr3D has no collections.
  async cards(userId) {
    const cookie = await getUserToymakr3dCookie(userId);
    if (!cookie) {
      throw new HttpError(409, "Connect Toymakr3D in Configuration > Providers, or visit it with Thingport Grab");
    }
    return [await toymakr3dLikesCard(cookie)];
  },
  async card(userId, source) {
    const cookie = source.externalId === TOYMAKR3D_LIKES_KEY ? await getUserToymakr3dCookie(userId) : null;
    return cookie ? toymakr3dLikesCard(cookie) : null;
  },
  httpError(err) {
    if (err instanceof Toymakr3dAuthError) return new HttpError(400, err.message);
    if (err instanceof Toymakr3dRateLimitError) return new HttpError(429, err.message);
  },
};
