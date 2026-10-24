// The user's NexPrint sign-in, which downloads its files: the auth_token cookie, sent as a Bearer token. The site keeps
// it for a week and sets it again whenever it refreshes the token, so Grab sends each new one on, with the cookie's
// expiry for the app to show.

import type { SessionSource } from "./sessionSync";
import { MANIFESTS } from "../shared/providers/_generated";

const { nexprint } = MANIFESTS;

export const nexprintSession: SessionSource = {
  async read() {
    const cookie = await chrome.cookies.get({ url: nexprint.site, name: nexprint.sessionCookies.token });
    let token = "";
    try {
      token = cookie?.value ? decodeURIComponent(cookie.value) : "";
    } catch {} // Malformed percent-encoding: not a token.
    // Signed out, the site clears the cookie or leaves a placeholder in it.
    if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
    return {
      value: token,
      body: { token, expires_at: cookie?.expirationDate ? new Date(cookie.expirationDate * 1000).toISOString() : null },
    };
  },
  signedOut: { token: null },
};
