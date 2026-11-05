// The user's Meshy sign-in, which downloads its files and reads their own generations: Supabase's sb-auth-auth-token
// cookie, split across .0, .1, … when it outgrows one, with the browser's device id and AWS bot-check token beside it so
// Meshy sees the device the sign-in came from. Thingport renews the session itself, so Grab sends it on only when the
// browser's sign-in changes, as the site renews its own.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";

const { meshy } = MANIFESTS;

/** Which chunk of the split cookie a name is; -1 for an unsplit one, which comes first on its own. */
const chunkIndex = (name: string) => Number(name.match(/\.(\d{1,2})$/)?.[1] ?? -1);

/** Whose sign-in the cookie is: its session's user id, or null when it can't be read. */
function userIdOf(value: string): string | null {
  try {
    const encoded = value
      .replace(/^base64-/, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const session = JSON.parse(atob(encoded)) as { user?: { id?: unknown } };
    return typeof session.user?.id === "string" ? session.user.id : null;
  } catch {
    return null;
  }
}

export const meshySession: SessionSource = {
  async read() {
    const { session, device, waf } = meshy.sessionCookies;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: meshy.site });
    const chunks = cookies
      .filter((cookie) => (cookie.name === session || cookie.name.startsWith(`${session}.`)) && cookie.value)
      .toSorted((a, b) => chunkIndex(a.name) - chunkIndex(b.name));
    if (!chunks.length) return null;
    const signIn = chunks.map((chunk) => `${chunk.name}=${chunk.value}`).join("; ");
    const beside = [device, waf].flatMap((name) => {
      const cookie = cookies.find((c) => c.name === name && c.value);
      return cookie ? [`${name}=${cookie.value}`] : [];
    });
    return {
      // The sign-in alone says whether it changed: the bot-check token renews far more often, and means nothing new.
      value: signIn,
      body: { session: [signIn, ...beside].join("; ") },
      userId: userIdOf(chunks.map((chunk) => chunk.value).join("")),
    };
  },
  signedOut: { session: null },
};
