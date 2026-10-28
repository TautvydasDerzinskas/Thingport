import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkToymakr3dAuth } from "./api";
import {
  getToymakr3dConnection,
  normalizeToymakr3dSession,
  setUserToymakr3dSession,
  toymakr3dCookie,
  type Toymakr3dAccount,
} from "./session";

const schema = z.object({
  session: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const toymakr3dConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getToymakr3dConnection(userId);
    return { status: state, account: account?.name ?? account?.username ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeToymakr3dSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Toymakr3D sign-in: paste the Cookie header of a signed-in toymakr3d.com request, " +
          "with its toymakr3dcom_session or remember_web_… cookie in it.",
      );
    }
    let account: Toymakr3dAccount | null = null;
    if (session) {
      // Who it is, to show beside the connection; asked whether or not it's to be verified, as Grab sends a new one
      // only when it changes. Only a check asked for can turn it down.
      const check = await checkToymakr3dAuth(toymakr3dCookie(session));
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "Toymakr3D didn't accept this sign-in -- it may have expired. Copy it again from a signed-in toymakr3d.com " +
            "tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach Toymakr3D to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserToymakr3dSession(userId, session, account) };
  },
};
