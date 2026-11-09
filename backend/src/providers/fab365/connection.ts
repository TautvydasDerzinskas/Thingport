import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import type { Fab365Member } from "./api";
import { checkFab365Session, getFab365Connection, normalizeFab365Session, setUserFab365Session } from "./session";

// `token` is the access token a person pastes; `access_token`/`refresh_token` are what Grab reads from page storage and
// sends together. A paste without a refresh token works until the access token expires but can't be renewed.
const schema = z.object({
  token: z.string().max(20_000).nullable().optional(),
  access_token: z.string().max(20_000).nullable().optional(),
  refresh_token: z.string().max(20_000).nullable().optional(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const fab365Connection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getFab365Connection(userId);
    return { status: state, account: account?.name ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const access = body.access_token ?? body.token ?? null;
    let session = normalizeFab365Session(access, body.refresh_token);
    if ((access ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Fab365 sign-in: paste your fab365.net accessToken (the long JWT its page storage " +
          "keeps), or sign in with Thingport Grab, which sends it with the refresh token beside it.",
      );
    }
    let account: Fab365Member | null = null;
    if (session) {
      // Who it is, asked whether or not it's to be verified, as Grab sends a new token only when it changes. Only a
      // check asked for can turn it down.
      const check = await checkFab365Session(session);
      if (body.verify && check === null) {
        throw new HttpError(
          422,
          "Fab365 didn't accept this sign-in -- it may have expired. Copy it again from a signed-in fab365.net tab and " +
            "try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check && !check.reachable) {
        throw new HttpError(503, "Couldn't reach Fab365 to check this sign-in. Try again in a moment.");
      }
      if (check) {
        // A check that had to renew it spent the token it came with: only the renewed one works now.
        session = check.session;
        account = check.account;
      }
    }
    return { configured: await setUserFab365Session(userId, session, account) };
  },
};
