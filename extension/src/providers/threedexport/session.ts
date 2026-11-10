// The user's 3DExport sign-in, which downloads its files and reads their own collections: the site's remember-me pair,
// the user's number (`nm_userid`) and a hash (`nm_hash`), kept ten years. A visitor's number is -1 and comes with no
// hash, and signing out turns the user's back into that, so the cookies alone say whether anyone is signed in.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { threedexport } = MANIFESTS;

export const threedexportSession: SessionSource = {
  async read() {
    const { user: userName, hash: hashName } = threedexport.sessionCookies;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: threedexport.site });
    const userId = cookies.find((cookie) => cookie.name === userName)?.value ?? "";
    const hash = cookies.find((cookie) => cookie.name === hashName)?.value ?? "";
    if (!/^\d+$/.test(userId) || Number(userId) <= 0 || !/^[0-9a-f]{32}$/i.test(hash)) return null;
    const cookie = `${userName}=${userId}; ${hashName}=${hash}`;
    return { value: cookie, body: { session: cookie }, userId };
  },
  signedOut: { session: null },
};
