// The user's VoxelShare sign-in, which reads their own collections and likes: its `token` cookie, a signed token good
// for 31 days. The site renews it as it's used, and only a signed-in visitor has it at all, so each new one is sent on.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { voxelshare } = MANIFESTS;

// A JSON Web Token: three base64url parts, the first two JSON.
const TOKEN = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/;

export const voxelshareSession: SessionSource = {
  async read() {
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookie = await chrome.cookies.get({ url: voxelshare.site, name: voxelshare.sessionCookies.token });
    const token = cookie?.value ?? "";
    if (!TOKEN.test(token)) return null;
    // The cookie says nothing the instance can show of whose it is; it asks the site.
    return { value: token, body: { token }, userId: null };
  },
  signedOut: { token: null },
};
