import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkThangsAuth, refreshThangsToken, ThangsAuthError } from "./api";
import { getThangsConnection, normalizeThangsSession, setUserThangsSession } from "./session";

// `token`: the access token, or anything with it in (a Cookie header, copied request headers); `refresh_token` the
// refresh token, which may come in `token` as well. Either one alone will do.
const schema = z.object({
  token: z.string().max(20_000).nullable(),
  refresh_token: z.string().max(10_000).nullable().optional(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. Thingport renews the access token
 *  itself from the refresh token. */
export const thangsConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getThangsConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const joined = [body.token, body.refresh_token].filter(Boolean).join(" ");
    let session = normalizeThangsSession(joined);
    if (joined.trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Thangs sign-in: paste the accessToken or refreshToken cookie, or the Authorization header of a signed-in thangs.com request.",
      );
    }
    if (body.verify && session) {
      const rejected = new HttpError(
        422,
        "Thangs didn't accept this sign-in -- it may have expired. Copy it again from a signed-in thangs.com tab and try again.",
      );
      // 503, not 422: nothing is known to be wrong with the sign-in.
      const unreachable = new HttpError(503, "Couldn't reach Thangs to check this sign-in. Try again in a moment.");
      const expired = !session.expiresAt || session.expiresAt.getTime() <= Date.now();
      if (session.refreshToken && (!session.token || expired)) {
        try {
          const renewed = await refreshThangsToken(session.refreshToken);
          session = { ...session, token: renewed.token, expiresAt: renewed.expiresAt };
        } catch (err) {
          throw err instanceof ThangsAuthError ? rejected : unreachable;
        }
      }
      const check = await checkThangsAuth(session.token!);
      if (check === "rejected") throw rejected;
      if (check === "unreachable") throw unreachable;
    }
    return { configured: await setUserThangsSession(userId, session) };
  },
};
