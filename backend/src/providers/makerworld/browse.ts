import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { extractMakerworldBearerToken, MakerworldAuthError, MakerworldCaptchaError } from "./api";
import { fetchMakerworldCollectionCard, listMakerworldOwnCollections } from "./collections";
import { getUserMakerworldCookie } from "./session";

export const makerworldBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: Boolean(extractMakerworldBearerToken(await getUserMakerworldCookie(userId))), account: null };
  },
  linkedThrough: "cookie",
  async cards(userId) {
    const bearer = extractMakerworldBearerToken(await getUserMakerworldCookie(userId));
    if (!bearer) throw new HttpError(409, "Connect MakerWorld in Configuration > Providers first");
    return listMakerworldOwnCollections(bearer);
  },
  async card(userId, source) {
    const bearer = extractMakerworldBearerToken(await getUserMakerworldCookie(userId));
    return fetchMakerworldCollectionCard(source.externalId, bearer);
  },
  httpError(err) {
    if (err instanceof MakerworldCaptchaError) return new HttpError(429, err.message);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    if (err instanceof MakerworldAuthError) {
      return new HttpError(400, "MakerWorld didn't accept your cookie. Update it in Configuration > Providers.");
    }
  },
};
