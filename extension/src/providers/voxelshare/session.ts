// The user's VoxelShare sign-in, which reads their own collections and likes: its `token` cookie, a signed token good
// for 31 days. The site renews it as it's used, and only a signed-in visitor has it at all, so each new one is sent on.
// Its China site has accounts of its own, and its own cookie, which goes to the sign-in named after it.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS, type RegionId } from "../index.generated";

const { voxelshare } = MANIFESTS;

// A JSON Web Token: three base64url parts, the first two JSON.
const TOKEN = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/;

/** The sign-in of one of its sites, from that site's own cookie. */
function siteSession(site: string, slot?: RegionId): SessionSource {
  return {
    async read() {
      // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
      const cookie = await chrome.cookies.get({ url: site, name: voxelshare.sessionCookies.token });
      const token = cookie?.value ?? "";
      if (!TOKEN.test(token)) return null;
      // The cookie says nothing the instance can show of whose it is; it asks the site.
      return { value: token, body: { token }, userId: null };
    },
    signedOut: { token: null },
    ...(slot ? { slot } : {}),
  };
}

export const voxelshareSession = siteSession(voxelshare.site);
export const voxelshareChinaSession = siteSession(voxelshare.regions[0].site, voxelshare.regions[0].id);
