// The user's Thangs sign-in, which downloads its files: the accessToken cookie (a week-long token, sent as a Bearer
// token) and the refreshToken cookie that renews it. Thingport renews the access token itself, so Grab only sends them
// on when the browser's change: a sign-in, or the site renewing its own.

import type { SessionSource } from "./sessionSync";
import { MANIFESTS } from "../shared/providers/_generated";

const { thangs } = MANIFESTS;

const JWT = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/;

/** The cookie's token, or "" when there is none. Throws when it can't be read, or its percent-encoding is malformed:
 *  no reason to think the user signed out. */
async function cookieValue(name: string): Promise<string> {
  const cookie = await chrome.cookies.get({ url: thangs.site, name });
  const value = cookie?.value ? decodeURIComponent(cookie.value) : "";
  return JWT.test(value) ? value : "";
}

export const thangsSession: SessionSource = {
  async read() {
    const [token, refreshToken] = await Promise.all([
      cookieValue(thangs.sessionCookies.token),
      cookieValue(thangs.sessionCookies.refresh),
    ]);
    if (!token && !refreshToken) return null;
    return { value: `${token} ${refreshToken}`, body: { token: token || null, refresh_token: refreshToken || null } };
  },
  signedOut: { token: null },
};
