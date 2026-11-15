// The user's QIDI Maker sign-in, which reads their own collections and likes: its `token` cookie, kept for 90 days and
// out of reach of the page's own scripts, so it's read from the browser's cookies. Only a signed-in visitor has it at
// all, so each new one is sent on.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { qidimaker } = MANIFESTS;

export const qidimakerSession: SessionSource = {
  async read() {
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookie = await chrome.cookies.get({ url: qidimaker.site, name: qidimaker.sessionCookies.token });
    const token = cookie?.value ?? "";
    if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
    // The cookie says nothing of whose it is; the instance asks the site.
    return { value: token, body: { token }, userId: null };
  },
  signedOut: { token: null },
};
