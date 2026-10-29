import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkGrabcadAuth, type GrabcadMember } from "./api";
import { getGrabcadConnection, normalizeGrabcadSession, setUserGrabcadSession } from "./session";

const schema = z.object({
  session: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const grabcadConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getGrabcadConnection(userId);
    return { status: state, account: account?.name ?? account?.member ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeGrabcadSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a GrabCAD sign-in: paste the Cookie header of a signed-in grabcad.com request, with " +
          "its _grabcad_session cookie in it, or that cookie's value.",
      );
    }
    let account: GrabcadMember | null = null;
    if (session) {
      // Who it is, to show beside the connection and to find their likes by; asked whether or not it's to be
      // verified, as Grab sends a new one only when it changes. Only a check asked for can turn it down.
      const check = await checkGrabcadAuth(session);
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "GrabCAD didn't accept this sign-in -- it may have expired. Copy it again from a signed-in grabcad.com tab " +
            "and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach GrabCAD to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserGrabcadSession(userId, session, account) };
  },
};
