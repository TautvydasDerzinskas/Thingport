// The user's MyMiniFactory session, which downloads the paid and login-only models in their library. The cookie is
// HttpOnly, so only the background can read it; it's sent to the instance from each signed-in MyMiniFactory page, so
// imports, the web app's included, pick up the renewed one on the next page opened.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { myminifactory } = MANIFESTS;

export const myminifactorySession: SessionSource = {
  async read() {
    const session = await chrome.cookies.get({ url: myminifactory.site, name: myminifactory.sessionCookies.session });
    // Only asked for from a signed-in page (see content/providerAccount.ts), and never cleared: a visitor has one too.
    if (!session?.value) return undefined;
    const value = `${myminifactory.sessionCookies.session}=${session.value}`;
    return { value, body: { cookie: value } };
  },
};
