import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { type MakerworldCookieCheck, verifyMakerworldCookie } from "./api";
import { getMakerworldConnection, setUserMakerworldCookie } from "./session";

const UNVERIFIABLE_MESSAGES: Record<Extract<MakerworldCookieCheck, { result: "unverifiable" }>["reason"], string> = {
  provider:
    "Couldn't check this cookie: MakerWorld's verification service is unavailable or returned an unexpected response. Try again later.",
  network:
    "Couldn't check this cookie: MakerWorld didn't respond. Check this server's internet connection and try again.",
};

// `verify` is opt-in: the extension's background sync sends a cookie it already knows works.
const schema = z.object({ cookie: z.string().nullable(), verify: z.boolean().optional() });

/** Each user's own cookie, unlike the instance-wide Thingiverse token. */
export const makerworldConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getMakerworldConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const trimmed = (body.cookie ?? "").trim();
    let verified = false;
    if (body.verify && trimmed) {
      const check = await verifyMakerworldCookie(trimmed);
      if (check.result === "invalid") {
        throw new HttpError(
          422,
          "MakerWorld rejected this cookie -- it may be invalid or expired. Copy a fresh Cookie header from a logged-in makerworld.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the cookie.
      if (check.result === "unverifiable") throw new HttpError(503, UNVERIFIABLE_MESSAGES[check.reason]);
      verified = true;
    }
    return { configured: await setUserMakerworldCookie(userId, body.cookie, { verified }) };
  },
};
