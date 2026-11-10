// The user's Fab365 sign-in, which downloads the files and reads their favourites. The site keeps it in page storage
// rather than a cookie: `accessToken`, a short-lived JWT, with `refreshToken` beside it. So Grab reads both from an open
// fab365.net tab and sends them; the backend renews the access token from the refresh token as it runs out. Only a
// signed-in tab has an accessToken, so a visitor sends nothing.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { fab365 } = MANIFESTS;

type Tokens = { access: string; refresh: string | null; userId: string } | null;

/** Runs in the page, so it must stand on its own. */
function readTokens(): Tokens {
  try {
    const access = localStorage.getItem("accessToken") ?? "";
    const payload = access.split(".")[1];
    if (!payload) return null;
    // The JWT's payload is base64url; its `loginId` is who the sign-in is.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>;
    const userId = typeof claims.loginId === "string" ? claims.loginId : null;
    if (!userId) return null;
    const refresh = localStorage.getItem("refreshToken") ?? "";
    return { access, refresh: refresh || null, userId };
  } catch {
    return null; // Not a token Grab can read: not a sign-in.
  }
}

export const fab365Session: SessionSource = {
  async read() {
    const tabs = await chrome.tabs.query({ url: [...fab365.extension.origins] }).catch(() => []);
    let readAny = false;
    let unreadable = false;
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readTokens });
        readAny = true;
        const tokens = result?.result as Tokens | undefined;
        if (!tokens) continue;
        return {
          value: tokens.access,
          body: { access_token: tokens.access, refresh_token: tokens.refresh },
          userId: tokens.userId,
        };
      } catch {
        // A tab still loading, or one Grab may not reach: another may answer, but this one may hold the sign-in.
        unreadable = true;
      }
    }
    // Signed out only when every tab asked said so. fab365.net and www.fab365.net keep their storage apart, so a tab
    // without the sign-in doesn't speak for one that couldn't be read; with none to ask, nothing is known either.
    return readAny && !unreadable ? null : undefined;
  },
  signedOut: { access_token: null, refresh_token: null },
};
