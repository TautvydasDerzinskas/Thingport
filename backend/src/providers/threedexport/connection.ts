import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkThreedexportAuth, type ThreedexportAccount } from "./api";
import {
  clearThreedexportSessionIf,
  getThreedexportConnection,
  normalizeThreedexportSession,
  setUserThreedexportSession,
} from "./session";

const schema = z.object({
  session: z.string().max(20_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const threedexportConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getThreedexportConnection(userId);
    return { status: state, account: account?.username ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const session = normalizeThreedexportSession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a 3DExport sign-in: paste the Cookie header of a signed-in 3dexport.com request, " +
          "with its nm_userid and nm_hash cookies in it.",
      );
    }
    let account: ThreedexportAccount | null = null;
    if (session) {
      // Who it is, to show beside the connection and to find their collections by; asked whether or not it's to be
      // verified, as Grab sends a new one only when it changes. Only a check asked for can turn it down.
      const check = await checkThreedexportAuth(session);
      if (body.verify && check === "rejected") {
        throw new HttpError(
          422,
          "3DExport didn't accept this sign-in -- signing out of 3dexport.com ends it. Copy it again from a " +
            "signed-in 3dexport.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable")
        throw new HttpError(503, "Couldn't reach 3DExport to check this sign-in. Try again in a moment.");
      if (typeof check === "object") account = check;
    }
    return { configured: await setUserThreedexportSession(userId, session, account) };
  },
  // Grab saw the browser sign out: the sign-in it sent goes, while it's still the one stored. Signing out there revokes
  // it anyway, but one pasted in Thingport since is someone's own choice, and stays.
  async signOut(userId, lastSent) {
    const sent = normalizeThreedexportSession(lastSent);
    if (sent) await clearThreedexportSessionIf(userId, sent.hash);
    return { configured: (await getThreedexportConnection(userId)).state !== "disconnected" };
  },
};
