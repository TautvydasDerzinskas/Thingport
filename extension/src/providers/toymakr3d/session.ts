// The user's Toymakr3D sign-in, which downloads its files and reads their liked products: Laravel's session cookie,
// and the remember-me cookie that signs them in again once it runs out. A visitor gets a session cookie too, so it's
// only read from a signed-in page (see providers/toymakr3d/content.ts), and sent on when it changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { toymakr3d } = MANIFESTS;

export const toymakr3dSession: SessionSource = {
  async read() {
    const { remember: rememberPrefix, session: sessionName } = toymakr3d.sessionCookies;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: toymakr3d.site });
    // Laravel's remember-me cookie is named for a hash of the site's app key, so it's found by its prefix.
    const remember = cookies.find((cookie) => cookie.name.startsWith(rememberPrefix) && cookie.value);
    const session = cookies.find((cookie) => cookie.name === sessionName && cookie.value);
    if (!remember && !session) return null;
    const cookie = [remember && `${remember.name}=${remember.value}`, session && `${session.name}=${session.value}`]
      .filter(Boolean)
      .join("; ");
    // Its cookies say nothing of whose they are; the instance asks the site.
    return { value: cookie, body: { session: cookie }, userId: null };
  },
  signedOut: { session: null },
};
