// The user's GrabCAD sign-in, which downloads its files: Rails' session cookie, all there is of it -- the site has no
// remember-me cookie, and keeps a sign-in two days from its last use. A visitor gets a session cookie too, so it's only
// read from a signed-in page (see providers/grabcad/content.ts), and sent on when it changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { grabcad } = MANIFESTS;

export const grabcadSession: SessionSource = {
  async read() {
    const name = grabcad.sessionCookies.session;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const value = (await chrome.cookies.get({ url: grabcad.site, name }))?.value;
    if (!value) return null;
    const cookie = `${name}=${value}`;
    // Its cookie says nothing of whose it is; the instance asks the site.
    return { value: cookie, body: { session: cookie }, userId: null };
  },
  signedOut: { session: null },
};
