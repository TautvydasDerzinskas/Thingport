import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkPixup3dAuth, type Pixup3dMember } from "./api";
import { getPixup3dConnection, normalizePixup3dSession, setUserPixup3dSession } from "./session";

const schema = z.object({
  session: z.string().max(20_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const pixup3dConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getPixup3dConnection(userId);
    return { status: state, account: account?.name ?? account?.username ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizePixup3dSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a PIXUP sign-in: paste the Cookie header of a signed-in pixup3d.com request, with " +
          "its _phrozen_session cookie in it, or that cookie's value.",
      );
    }
    let account: Pixup3dMember | null = null;
    if (session) {
      // Who it is, to show beside the connection and to find their lists by; asked whether or not it's to be
      // verified, as Grab sends a new one only when it changes. Only a check asked for can turn it down.
      const check = await checkPixup3dAuth(session);
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "PIXUP didn't accept this sign-in -- it may have expired. Copy it again from a signed-in pixup3d.com tab " +
            "and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach PIXUP to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserPixup3dSession(userId, session, account) };
  },
};
