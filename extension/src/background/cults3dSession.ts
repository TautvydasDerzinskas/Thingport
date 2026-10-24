// The browser's Cults3D sign-in, which opens the site's order and download pages: the _session_id cookie, and the
// cf_clearance cookie Cloudflare gave this browser, with the User-Agent it gave it to. Thingport's server sends them
// as this browser would; the clearance only holds from this browser's IP address. Sent on when they change.

import type { SessionSource } from "./sessionSync";
import { MANIFESTS } from "../shared/providers/_generated";

const { cults3d } = MANIFESTS;
const SITE = cults3d.site;

async function cookieValue(name: string): Promise<string> {
  try {
    const plain = (await chrome.cookies.get({ url: SITE, name }))?.value;
    if (plain) return plain;
    // Cloudflare sets cf_clearance partitioned (CHIPS), keyed to the site itself; a plain lookup doesn't see those, and
    // an exact partition key would have to match its cross-site flag too. An empty one lists every partition's.
    const partitioned = await chrome.cookies.getAll({ domain: cults3d.hosts[0], name, partitionKey: {} });
    const own = partitioned.find((cookie) =>
      /^https:\/\/(www\.)?cults3d\.com$/i.test(cookie.partitionKey?.topLevelSite ?? ""),
    );
    return (own ?? partitioned[0])?.value ?? "";
  } catch {
    return "";
  }
}

export const cults3dSession: SessionSource = {
  slot: "browser",
  async read() {
    const [session, clearance] = await Promise.all([
      cookieValue(cults3d.sessionCookies.session),
      cookieValue(cults3d.sessionCookies.clearance),
    ]);
    if (!session) return null;
    // Only asked for from a signed-in page (see content/cults3d.ts): visitors get a session cookie too.
    const cookie = `${cults3d.sessionCookies.session}=${session}${clearance ? `; ${cults3d.sessionCookies.clearance}=${clearance}` : ""}`;
    return { value: `${cookie} ${navigator.userAgent}`, body: { session: cookie, user_agent: navigator.userAgent } };
  },
  signedOut: { session: null },
};
