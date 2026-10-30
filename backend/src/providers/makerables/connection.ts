import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { fetchMakerablesAccount, MakerablesAuthError, mintMakerablesToken, type MakerablesAccount } from "./api";
import { getMakerablesConnection, normalizeMakerablesSession, setUserMakerablesSession } from "./session";

const schema = z.object({
  session: z.string().max(40_000).nullable(),
  verify: z.boolean().optional(),
});

/** Who the cookie signs in, and the cookie to keep -- Makerables hands back a new one when the check made it renew
 *  the session. Null when it turned the cookie down; "unreachable" when it couldn't be asked. */
async function checkSession(
  cookie: string,
): Promise<{ account: MakerablesAccount | null; cookie: string } | null | "unreachable"> {
  try {
    const minted = await mintMakerablesToken(cookie);
    return { account: await fetchMakerablesAccount(minted.token), cookie: minted.cookie ?? cookie };
  } catch (err) {
    return err instanceof MakerablesAuthError ? null : "unreachable";
  }
}

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const makerablesConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getMakerablesConnection(userId);
    return { status: state, account: account?.name ?? account?.userId ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeMakerablesSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Makerables sign-in: paste the Cookie header of a signed-in makerables.com " +
          "request, with its __session cookie in it.",
      );
    }
    let account: MakerablesAccount | null = null;
    let keep = session;
    if (session) {
      // Who it is, which the saved projects can't be read without; asked whether or not it's to be verified, as Grab
      // sends a new cookie only when it changes. Only a check asked for can turn it down.
      const check = await checkSession(session);
      if (body.verify && check === null) {
        throw new HttpError(
          422,
          "Makerables didn't accept this sign-in -- it may have expired. Copy it again from a signed-in " +
            "makerables.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach Makerables to check this sign-in. Try again in a moment.");
      if (check && check !== "unreachable") {
        account = check.account;
        keep = check.cookie;
      }
    }
    return { configured: await setUserMakerablesSession(userId, keep, account) };
  },
};
