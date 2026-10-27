// The user's eufyMake sign-in, which reads their likes. The site keeps it in page storage rather than a cookie, as
// "mk-userinfo": its auth token and the user's id, whose MD5 goes with the token. So Grab reads it from an open
// makeitreal.eufymake.com tab, as the site does: the tab's session copy first, then the lasting one. Since October
// 2026 the value is base64 of the percent-encoded JSON, so it is decoded the way the site's own store reads it.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { eufymake } = MANIFESTS;

type UserInfo = { token: string; userId: string } | null;

/** Runs in the page, so it must stand on its own. */
function readUserInfo(): UserInfo {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem("mk-userinfo") ?? "";
      // Base64 of the percent-encoded JSON, behind the `exp@<unix seconds>;` stamp the store puts on values that run
      // out; older builds kept the JSON as it was.
      const plain = raw.startsWith("{") ? raw : decodeURIComponent(atob(raw));
      const json = plain.startsWith("exp@") ? plain.slice(plain.indexOf(";") + 1) : plain;
      const info = JSON.parse(json) as Record<string, unknown> | null;
      const token = info?.auth_token;
      const userId = info?.user_id;
      if (typeof token === "string" && token && typeof userId === "string" && userId) return { token, userId };
    } catch {} // "expired", or not a value Grab can read: not a sign-in.
  }
  return null;
}

export const eufymakeSession: SessionSource = {
  async read() {
    const tabs = await chrome.tabs.query({ url: [...eufymake.extension.origins] }).catch(() => []);
    let readAny = false;
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readUserInfo });
        readAny = true;
        const info = result?.result as UserInfo | undefined;
        if (!info) continue;
        if (!/^[0-9a-f]{32,128}$/i.test(info.token) || !/^[0-9a-f]{40}$/i.test(info.userId)) continue;
        return {
          value: `${info.userId}:${info.token}`,
          body: { token: info.token, user_id: info.userId },
          userId: info.userId,
        };
      } catch {} // A tab still loading, or one Grab may not reach: another may answer.
    }
    // Signed out only when a tab said so; with none to ask, nothing is known.
    return readAny ? null : undefined;
  },
  signedOut: { token: null },
};
