import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkPinshapeAuth } from "./api";
import {
  getPinshapeConnection,
  normalizePinshapeSession,
  pinshapeCookie,
  setUserPinshapeSession,
  type PinshapeAccount,
} from "./session";

const schema = z.object({
  session: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const pinshapeConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getPinshapeConnection(userId);
    return { status: state, account: account?.name ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizePinshapeSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Pinshape sign-in: paste the Cookie header of a signed-in pinshape.com request " +
          "(with its remember_token or session cookie), or the remember_token cookie's value.",
      );
    }
    let account: PinshapeAccount | null = null;
    if (session) {
      // Who it is, for its likes and collections; asked whether or not it's to be verified, as Grab sends a new one
      // only when it changes. Only a check asked for can turn it down.
      const check = await checkPinshapeAuth(pinshapeCookie(session));
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "Pinshape didn't accept this sign-in -- it may have expired. Copy it again from a signed-in pinshape.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach Pinshape to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserPinshapeSession(userId, session, account) };
  },
};
