// The user's Pinshape sign-in, which downloads its files: Flask-Login's remember_token cookie, good for a year where
// they ticked Remember Me, and the session cookie beside it. A visitor gets a session cookie too, so it's only read
// from a signed-in page (see providers/pinshape/content.ts), and sent on when it changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { pinshape } = MANIFESTS;

async function cookieValue(name: string): Promise<string> {
  try {
    return (await chrome.cookies.get({ url: pinshape.site, name }))?.value ?? "";
  } catch {
    return "";
  }
}

export const pinshapeSession: SessionSource = {
  async read() {
    const { remember, session } = pinshape.sessionCookies;
    const [rememberValue, sessionValue] = await Promise.all([cookieValue(remember), cookieValue(session)]);
    if (!rememberValue && !sessionValue) return null;
    const cookie = [rememberValue && `${remember}=${rememberValue}`, sessionValue && `${session}=${sessionValue}`]
      .filter(Boolean)
      .join("; ");
    // The remember token starts with whose it is.
    return { value: cookie, body: { session: cookie }, userId: rememberValue.match(/^\d+/)?.[0] ?? null };
  },
  signedOut: { session: null },
};
