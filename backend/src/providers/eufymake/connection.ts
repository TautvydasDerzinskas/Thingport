import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkEufymakeAuth } from "./api";
import { getEufymakeConnection, normalizeEufymakeSession, setUserEufymakeSession } from "./session";

// `user_id`: whose token it is, which Grab reads beside it; a paste has it in the mk-userinfo value, or its Gtoken.
const schema = z.object({
  token: z.string().max(10_000).nullable(),
  user_id: z.string().max(100).nullable().optional(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const eufymakeConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getEufymakeConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeEufymakeSession(body.token, body.user_id ?? null);
    if ((body.token ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a eufyMake sign-in: copy the whole mk-userinfo value from the site's local " +
          "storage -- one long line starting JTdC -- and paste it as it comes. A token on its own won't do, as " +
          "eufyMake needs the Gtoken that goes with it.",
      );
    }
    if (body.verify && session) {
      const check = await checkEufymakeAuth(session);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "eufyMake didn't accept this sign-in -- it may have expired. Copy it again from a signed-in makeitreal.eufymake.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach eufyMake to check this sign-in. Try again in a moment.");
      session.userId = check.userId;
    }
    return { configured: await setUserEufymakeSession(userId, session) };
  },
};
