import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkQidimakerAuth } from "./api";
import {
  clearQidimakerSessionIf,
  getQidimakerConnection,
  normalizeQidimakerSession,
  setUserQidimakerSession,
} from "./session";

const schema = z.object({
  token: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const qidimakerConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getQidimakerConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const token = normalizeQidimakerSession(body.token);
    if ((body.token ?? "").trim() && !token) {
      throw new HttpError(
        422,
        "That doesn't look like a QIDI Maker sign-in: paste the value of the token cookie from a signed-in " +
          "www.qidimaker.com tab, or the whole Cookie header of one of its requests.",
      );
    }
    let account: { id: string; name: string | null } | null = null;
    if (body.verify && token) {
      const check = await checkQidimakerAuth(token);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "QIDI Maker didn't accept this sign-in -- it may have expired. Copy it again from a signed-in www.qidimaker.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach QIDI Maker to check this sign-in. Try again in a moment.");
      account = { id: check.userId, name: check.name };
    }
    return { configured: await setUserQidimakerSession(userId, token, account) };
  },
  // Grab saw the browser sign out: the token it sent goes, while it's still the one stored. One pasted in Thingport
  // since is someone's own choice, and stays.
  async signOut(userId, lastSent) {
    const sent = normalizeQidimakerSession(lastSent);
    if (sent) await clearQidimakerSessionIf(userId, sent);
    return { configured: (await getQidimakerConnection(userId)) !== "disconnected" };
  },
};
