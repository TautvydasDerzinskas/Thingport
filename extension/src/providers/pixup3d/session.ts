// The user's PIXUP sign-in, which downloads its files: Rails' session, kept whole in its cookie, which the site issues
// anew with every answer. A visitor gets a session cookie too, so it's only read from a signed-in page (see
// providers/pixup3d/content.ts), and sent on when it changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { pixup3d } = MANIFESTS;

export const pixup3dSession: SessionSource = {
  async read() {
    const name = pixup3d.sessionCookies.session;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const value = (await chrome.cookies.get({ url: pixup3d.site, name }))?.value;
    if (!value) return null;
    const cookie = `${name}=${value}`;
    // Its cookie is encrypted, saying nothing of whose it is; the instance asks the site.
    return { value: cookie, body: { session: cookie }, userId: null };
  },
  signedOut: { session: null },
};
