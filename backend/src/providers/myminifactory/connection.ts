import { z } from "zod";
import { getMyminifactoryApiKey, setMyminifactoryApiKey } from "./apiKey";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkMyminifactoryApiKey, checkMyminifactorySession } from "./api";
import { getMyminifactoryConnection, normalizeMyminifactoryCookie, setUserMyminifactoryCookie } from "./session";

const KEY_PROBLEMS = {
  rejected: "MyMiniFactory rejected this API key. Check it in your MyMiniFactory account settings and try again.",
  blocked:
    "MyMiniFactory blocked the check (rate limit or Cloudflare challenge), so the key couldn't be verified. Wait a while and try again.",
  unreachable: "Couldn't reach MyMiniFactory to verify this API key. Try again in a moment.",
} as const;

const keySchema = z.object({ api_key: z.string().nullable() });

/** The instance's API key, like Thingiverse's token: every user may see whether one is set. */
export const myminifactoryKeyConnection: ConnectionSlot = {
  status: async () => ({ status: (await getMyminifactoryApiKey()) ? "connected" : "disconnected" }),
  async save(_userId, raw) {
    const body = parseBody(keySchema, raw);
    const trimmed = (body.api_key ?? "").trim();
    if (trimmed) {
      const result = await checkMyminifactoryApiKey(trimmed);
      if (result !== "ok") throw new HttpError(422, KEY_PROBLEMS[result]);
    }
    await setMyminifactoryApiKey(body.api_key);
    return { configured: Boolean(trimmed) };
  },
};

// `verify` is opt-in, as for MakerWorld: Thingport Grab sends a session it just read from a signed-in browser.
const sessionSchema = z.object({
  cookie: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's own, beside the instance's API key: the session that downloads paid and login-only models. */
export const myminifactorySessionConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getMyminifactoryConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(sessionSchema, raw);
    const cookie = normalizeMyminifactoryCookie(body.cookie);
    if ((body.cookie ?? "").trim() && !cookie) {
      throw new HttpError(422, "That doesn't look like a MyMiniFactory session: paste the PHPSESSID cookie's value.");
    }
    let verified = false;
    if (body.verify && cookie) {
      const check = await checkMyminifactorySession(cookie);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "MyMiniFactory didn't accept this session -- it may have expired. Copy a fresh PHPSESSID from a signed-in myminifactory.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the session.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach MyMiniFactory to check this session. Try again in a moment.");
      verified = true;
    }
    return { configured: await setUserMyminifactoryCookie(userId, cookie, { verified }) };
  },
};
