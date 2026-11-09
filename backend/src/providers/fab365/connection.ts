import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import type { Fab365Member } from "./api";
import {
  checkFab365Session,
  getFab365Connection,
  normalizeFab365Session,
  readFab365Paste,
  setUserFab365Session,
} from "./session";

// `token` is what a person pastes: the accessToken and refreshToken values from the site's local storage, each after its
// name, or the access token's value alone, which works until it expires but can't be renewed. `access_token`/
// `refresh_token` are what Grab reads from page storage and sends together.
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
    const pasted = readFab365Paste(body.token);
    let session = normalizeFab365Session(body.access_token ?? pasted.access, body.refresh_token ?? pasted.refresh);
    if ((body.access_token ?? body.token ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Fab365 sign-in: paste the accessToken and refreshToken values from a signed-in " +
          "fab365.net tab's local storage, each on its own line after its name (accessToken: … and refreshToken: …), " +
          "or sign in with Thingport Grab, which sends them for you.",
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
      // Turned down, and not asked to be checked: a stale capture, such as the sign-in an open tab still held when Grab
      // read it after Thingport had renewed its own. Whatever is stored stays, rather than swapped for a pair known not
      // to work; one that can't be checked just now is saved as it came.
      if (check === null) return { configured: (await getFab365Connection(userId)).state === "connected" };
      if (check) {
        // A check that had to renew it spent the token it came with: only the renewed one works now.
        session = check.session;
        account = check.account;
      }
    }
    return { configured: await setUserFab365Session(userId, session, account) };
  },
};
