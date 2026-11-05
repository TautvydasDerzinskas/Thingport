// The user's Meshy sign-in, which downloads its files and reads their own generations: Supabase's sb-auth-auth-token
// cookie, split across .0, .1, … when it outgrows one, with the browser's device id and AWS bot-check token beside it so
// Meshy sees the device the sign-in came from. Thingport renews the session itself, so Grab sends it on only when the
// browser's sign-in or bot-check token changes.

import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";
import { meshyChunkIndex, meshySessionOf } from "./cookie";

const { meshy } = MANIFESTS;

export const meshySession: SessionSource = {
  async read() {
    const { session, device, waf } = meshy.sessionCookies;
    // A lookup that fails throws on, so the sync takes it as unreadable rather than signed out.
    const cookies = await chrome.cookies.getAll({ url: meshy.site });
    const chunks = cookies
      .filter((cookie) => (cookie.name === session || cookie.name.startsWith(`${session}.`)) && cookie.value)
      .toSorted((a, b) => meshyChunkIndex(a.name) - meshyChunkIndex(b.name));
    if (!chunks.length) return null;
    const signIn = chunks.map((chunk) => `${chunk.name}=${chunk.value}`).join("; ");
    const beside = [device, waf].flatMap((name) => {
      const cookie = cookies.find((c) => c.name === name && c.value);
      return cookie ? [`${name}=${cookie.value}`] : [];
    });
    const sent = [signIn, ...beside].join("; ");
    const userId = meshySessionOf(chunks.map((chunk) => chunk.value).join(""))?.user?.id;
    // The bot-check token counts as a change too: the instance sends the one it was last given with every call.
    return { value: sent, body: { session: sent }, userId: typeof userId === "string" ? userId : null };
  },
  signedOut: { session: null },
};
