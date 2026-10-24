import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkNexprintAuth } from "./api";
import { getNexprintConnection, normalizeNexprintSession, setUserNexprintSession } from "./session";

// `expires_at`: the auth_token cookie's own expiry, which Grab can read; it's only shown, as the token may outlive it.
const schema = z.object({
  token: z.string().max(10_000).nullable(),
  expires_at: z.string().datetime().nullable().optional(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const nexprintConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getNexprintConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeNexprintSession(body.token, body.expires_at ? new Date(body.expires_at) : null);
    if ((body.token ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a NexPrint sign-in: paste the auth_token cookie, or the Authorization header of a signed-in nexprint.com request.",
      );
    }
    if (body.verify && session) {
      const check = await checkNexprintAuth(session.token);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "NexPrint didn't accept this sign-in -- it may have expired. Copy it again from a signed-in nexprint.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach NexPrint to check this sign-in. Try again in a moment.");
    }
    return { configured: await setUserNexprintSession(userId, session) };
  },
};
