import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import { GrabcadAuthError, grabcadLikesCard, GrabcadRateLimitError, parseGrabcadLikesUrl } from "./api";
import { getGrabcadConnection, grabcadMemberOf } from "./session";

export const grabcadBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getGrabcadConnection(userId);
    return { connected: state === "connected", account: account?.name ?? account?.member ?? null };
  },
  linkedThrough: "sign-in",
  // The user's likes, its community's only list. They're anyone's to read; the sign-in says whose they are.
  async cards(userId) {
    const me = await grabcadMemberOf(userId);
    if (!me) {
      throw new HttpError(
        409,
        "Connect GrabCAD in Configuration > Providers, or visit it signed in with Thingport Grab",
      );
    }
    const likes = await grabcadLikesCard(me.member);
    return likes ? [likes] : [];
  },
  // Anyone's likes, by their link.
  async card(_userId, source) {
    const likes = parseGrabcadLikesUrl(source.url);
    return likes ? grabcadLikesCard(likes.member) : null;
  },
  httpError(err) {
    if (err instanceof GrabcadAuthError) return new HttpError(400, err.message);
    if (err instanceof GrabcadRateLimitError) return new HttpError(429, err.message);
  },
};
