// The user's Creality Cloud sign-in, which downloads its files and reads the user's likes: the model_token and
// model_user_id cookies, which its API takes together. The site sets them once at sign-in for a week and never renews
// them, so Grab only sends each new pair on, with the cookie's expiry for the app to show.

import type { SessionSource } from "./sessionSync";

const SITE = "https://www.crealitycloud.com";

export const crealitycloudSession: SessionSource = {
  async read() {
    const [token, user] = await Promise.all([
      chrome.cookies.get({ url: SITE, name: "model_token" }),
      chrome.cookies.get({ url: SITE, name: "model_user_id" }),
    ]);
    if (!token?.value || !user?.value) return null;
    const value = `model_token=${token.value}; model_user_id=${user.value}`;
    return {
      value,
      body: {
        token: value,
        expires_at: token.expirationDate ? new Date(token.expirationDate * 1000).toISOString() : null,
      },
      userId: decodeURIComponent(user.value),
    };
  },
  signedOut: { token: null },
};
