import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { listSnapmakerCollections, SnapmakerAuthError } from "./api";
import { getSnapmakerConnection, getUserSnapmakerId, getUserSnapmakerToken } from "./session";

export const snapmakerBrowse: ProviderBrowse = {
  async account(userId) {
    return { connected: (await getSnapmakerConnection(userId)) === "connected", account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes and bookmarks, which only they can read, with their own sign-in.
  async cards(userId) {
    const [token, snapmakerId] = await Promise.all([getUserSnapmakerToken(userId), getUserSnapmakerId(userId)]);
    if (!token || !snapmakerId) {
      throw new HttpError(409, "Connect Snapmaker Space in Configuration > Providers, or visit it with Thingport Grab");
    }
    return listSnapmakerCollections(token, snapmakerId);
  },
  // Only the user's own likes and bookmarks are there to find.
  async card(userId, source) {
    return (await this.cards(userId)).find((own) => own.id === source.externalId) ?? null;
  },
  httpError: (err) => (err instanceof SnapmakerAuthError ? new HttpError(400, err.message) : undefined),
};
