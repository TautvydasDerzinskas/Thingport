import { HttpError } from "../../utils/fileUtils";
import type { ProviderBrowse } from "../types";
import {
  CgtraderAuthError,
  CgtraderBlockedError,
  CgtraderRateLimitError,
  cgtraderListCard,
  CGTRADER_LISTS,
  type CgtraderList,
} from "./api";
import { getCgtraderConnection, getUserCgtraderSession } from "./session";

const LISTS = Object.keys(CGTRADER_LISTS) as CgtraderList[];

export const cgtraderBrowse: ProviderBrowse = {
  async account(userId) {
    const { state, account } = await getCgtraderConnection(userId);
    return { connected: state === "connected", account: account?.username ?? null };
  },
  linkedThrough: "sign-in",
  // The user's liked models and wishlist, read with their sign-in: CGTrader shows them to their owner alone.
  async cards(userId) {
    const session = await getUserCgtraderSession(userId);
    if (!session) {
      throw new HttpError(409, "Connect CGTrader in Configuration > Providers, or visit it with Thingport Grab");
    }
    return Promise.all(LISTS.map((list) => cgtraderListCard(list, session)));
  },
  async card(userId, source) {
    const list = LISTS.find((name) => CGTRADER_LISTS[name].key === source.externalId);
    const session = list ? await getUserCgtraderSession(userId) : null;
    return list && session ? cgtraderListCard(list, session) : null;
  },
  httpError(err) {
    if (err instanceof CgtraderAuthError) return new HttpError(400, err.message);
    if (err instanceof CgtraderRateLimitError) return new HttpError(429, err.message);
    if (err instanceof CgtraderBlockedError) return new HttpError(503, err.message);
  },
};
