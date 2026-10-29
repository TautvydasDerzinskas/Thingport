// The user's CGTrader sign-in, which downloads its files and reads their liked models and wishlist: Rails' session
// cookie, and beside it the token AWS's bot check gave this browser, which the downloads want too. The token isn't
// bound to this browser, so the instance sends it as its own. A visitor gets a session cookie as well, so it's only
// read while the `user_id` cookie a signed-in browser has is there too, and sent on when either changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { cgtrader } = MANIFESTS;

export const cgtraderSession: SessionSource = {
  async read() {
    const { session: sessionName, waf: wafName, user: userName } = cgtrader.sessionCookies;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: cgtrader.site });
    const value = (name: string) => cookies.find((cookie) => cookie.name === name && cookie.value)?.value;
    const session = value(sessionName);
    if (!session || !value(userName)) return null;
    const waf = value(wafName);
    const cookie = `${sessionName}=${session}${waf ? `; ${wafName}=${waf}` : ""}`;
    // Its cookies say nothing of whose they are; the instance asks the site.
    return { value: cookie, body: { session: cookie }, userId: null };
  },
  signedOut: { session: null },
};
