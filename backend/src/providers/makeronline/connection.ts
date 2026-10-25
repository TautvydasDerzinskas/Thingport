import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkMakeronlineToken } from "./api";
import { getMakeronlineConnection, normalizeMakeronlineToken, setUserMakeronlineToken } from "./session";

const schema = z.object({
  token: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's access token, which Thingport Grab sends whenever the browser's changes. */
export const makeronlineConnection: ConnectionSlot = {
  status: async (userId) => ({ status: await getMakeronlineConnection(userId) }),
  async save(userId, raw) {
    const body = parseBody(schema, raw);
    const token = normalizeMakeronlineToken(body.token);
    if ((body.token ?? "").trim() && !token) {
      throw new HttpError(
        422,
        "That doesn't look like a MakerOnline sign-in: paste the mo_access_token cookie's value.",
      );
    }
    if (token?.expiresAt && token.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(422, "This MakerOnline sign-in has already expired. Copy a fresh one from a signed-in tab.");
    }
    if (body.verify && token) {
      const check = await checkMakeronlineToken(token.token);
      if (check === "rejected") {
        throw new HttpError(
          422,
          "MakerOnline didn't accept this sign-in -- it may have expired. Copy a fresh mo_access_token from a signed-in makeronline.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the token.
      if (check === "unreachable")
        throw new HttpError(503, "Couldn't reach MakerOnline to check this sign-in. Try again in a moment.");
      token.userId = check.userId;
    }
    return { configured: await setUserMakeronlineToken(userId, token) };
  },
};
