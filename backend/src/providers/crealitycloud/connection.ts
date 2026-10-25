import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkCrealitycloudAuth } from "./api";
import { getCrealitycloudConnection, normalizeCrealitycloudSession, setUserCrealitycloudSession } from "./session";

// `expires_at`: the model_token cookie's own expiry, which Grab can read; it's only shown, as the token may outlive it.
const schema = z.object({
  token: z.string().max(10_000).nullable(),
  expires_at: z.string().datetime().nullable().optional(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const crealitycloudConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getCrealitycloudConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeCrealitycloudSession(body.token, body.expires_at ? new Date(body.expires_at) : null);
    if ((body.token ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Creality Cloud sign-in: paste the Cookie header of a signed-in crealitycloud.com request (it has model_token and model_user_id).",
      );
    }
    if (body.verify && session) {
      const check = await checkCrealitycloudAuth(session);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "Creality Cloud didn't accept this sign-in -- it may have expired. Copy the cookies from a signed-in crealitycloud.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach Creality Cloud to check this sign-in. Try again in a moment.");
    }
    return { configured: await setUserCrealitycloudSession(userId, session) };
  },
};
