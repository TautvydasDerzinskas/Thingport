import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import type { MeshyAccount } from "./api";
import { checkMeshySession, getMeshyConnection, normalizeMeshySession, setUserMeshySession } from "./session";

const schema = z.object({
  session: z.string().max(40_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in, which Thingport Grab sends whenever the browser's changes. */
export const meshyConnection: ConnectionSlot = {
  async status(userId) {
    const { state, account } = await getMeshyConnection(userId);
    return { status: state, account: account?.name ?? account?.handle ?? null };
  },
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    let session = normalizeMeshySession(body.session);
    if ((body.session ?? "").trim() && !session) {
      throw new HttpError(
        422,
        "That doesn't look like a Meshy sign-in: paste the Cookie header of a signed-in meshy.ai request, with its " +
          "sb-auth-auth-token cookies in it.",
      );
    }
    let account: MeshyAccount | null = null;
    if (session) {
      // Who it is, asked whether or not it's to be verified, as Grab sends a new cookie only when it changes. Only a
      // check asked for can turn it down.
      const check = await checkMeshySession(session);
      if (body.verify && check === null) {
        throw new HttpError(
          422,
          "Meshy didn't accept this sign-in -- it may have ended. Copy it again from a signed-in meshy.ai tab and try " +
            "again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the sign-in.
      if (body.verify && check === "unreachable") {
        throw new HttpError(503, "Couldn't reach Meshy to check this sign-in. Try again in a moment.");
      }
      if (check && check !== "unreachable") {
        // A check that had to renew it spent the refresh token it came with: only the renewed one works now.
        session = check.session;
        account = check.account;
      }
    }
    return { configured: await setUserMeshySession(userId, session, account) };
  },
};
