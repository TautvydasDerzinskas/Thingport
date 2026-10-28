import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkCults3dCredentials, fetchCults3dSignedInNick } from "./api";
import {
  getCults3dConnection,
  normalizeCults3dBrowser,
  setUserCults3dBrowser,
  setUserCults3dCredentials,
} from "./session";

const credentialsSchema = z.object({
  nick: z.string().trim().max(100).nullable(),
  api_key: z.string().trim().max(200).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's API credentials: their nickname and an API key made on the site. */
export const cults3dApiConnection: ConnectionSlot = {
  async status(userId) {
    const connection = await getCults3dConnection(userId);
    return { status: connection.api, account: connection.nick };
  },
  async save(userId, raw) {
    const body = parseBody(credentialsSchema, raw);
    if (!body.nick || !body.api_key) {
      if (body.nick || body.api_key) throw new HttpError(422, "Enter both your Cults3D nickname and the API key.");
      await setUserCults3dCredentials(userId, null);
      return { configured: false, nick: null };
    }
    let nick = body.nick.replace(/^@/, "");
    if (body.verify) {
      const check = await checkCults3dCredentials({ nick, apiKey: body.api_key });
      if (check === "rejected") {
        throw new HttpError(
          422,
          "Cults3D didn't accept this nickname and API key. Check both -- the nickname's capitals count -- or make a " +
            "new key at cults3d.com/en/api/keys.",
        );
      }
      // 503, not 422: nothing is known to be wrong with them.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach Cults3D to check them. Try again in a moment.");
      nick = check.nick;
    }
    await setUserCults3dCredentials(userId, { nick, apiKey: body.api_key });
    return { configured: true, nick };
  },
  // The browser's sign-in came along with the API credentials, before it was a connection of its own.
  async legacyStatus(userId) {
    const connection = await getCults3dConnection(userId);
    return {
      configured: connection.api !== "disconnected",
      expired: connection.api === "expired",
      nick: connection.nick,
      session_configured: connection.site !== "disconnected",
      session_expired: connection.site === "expired",
    };
  },
};

// `session`: a Cookie header with _session_id (and cf_clearance), or a signed-in cults3d.com request's copied headers;
// `user_agent` the browser's, when `session` doesn't carry it. Null forgets it.
const browserSchema = z.object({
  session: z.string().max(20_000).nullable(),
  user_agent: z.string().max(1000).nullable().optional(),
});

/** The browser's sign-in, which the downloads need besides the API key, and which Thingport Grab sends whenever it
 *  changes. */
export const cults3dBrowserConnection: ConnectionSlot = {
  async status(userId) {
    const connection = await getCults3dConnection(userId);
    return { status: connection.site, account: connection.siteNick };
  },
  async save(userId, raw) {
    const body = parseBody(browserSchema, raw);
    const browser = normalizeCults3dBrowser(body.session, body.user_agent);
    if (body.session?.trim() && !browser) {
      throw new HttpError(
        422,
        "That doesn't look like a Cults3D sign-in: paste the request headers of a signed-in cults3d.com page, with its _session_id cookie.",
      );
    }
    // Which account it is decides whether the downloads work at all, so it's read now rather than at the first import.
    // Best effort: a sign-in the site won't say anything about is still kept, and an import tells the user if it turns
    // out to be another account's. Grab sends a sign-in whenever the browser's changes, so this keeps up with it.
    const nick = browser ? await fetchCults3dSignedInNick(browser).catch(() => null) : null;
    await setUserCults3dBrowser(userId, browser, nick);
    return { configured: !!browser, account: nick };
  },
};
