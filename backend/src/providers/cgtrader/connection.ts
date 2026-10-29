import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkCgtraderAuth } from "./api";
import {
  getCgtraderConnection,
  normalizeCgtraderSession,
  setUserCgtraderSession,
  type CgtraderAccount,
} from "./session";

const schema = z.object({
  session: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const cgtraderConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getCgtraderConnection(userId);
    return { status: state, account: account?.username ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeCgtraderSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a CGTrader sign-in: paste the Cookie header of a signed-in cgtrader.com request, " +
          "with its _cgtrader_session_id cookie in it.",
      );
    }
    let account: CgtraderAccount | null = null;
    if (session) {
      // Who it is, to show beside the connection; asked whether or not it's to be verified, as Grab sends a new one
      // only when it changes. Only a check asked for can turn it down.
      const check = await checkCgtraderAuth(session);
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "CGTrader didn't accept this sign-in -- it may have expired. Copy it again from a signed-in cgtrader.com " +
            "tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach CGTrader to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserCgtraderSession(userId, session, account) };
  },
};
