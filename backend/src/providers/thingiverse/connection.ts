import { z } from "zod";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../../services/settingsService";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { verifyThingiverseAccessToken } from "./api";

const schema = z.object({ access_token: z.string().nullable() });

/** One App Token for the whole instance. Every user may see whether it's set, so the UI can tell whether imports will
 *  work; never the token. */
export const thingiverseConnection: ConnectionSlot = {
  status: async () => ({ status: (await getThingiverseAccessToken()) ? "connected" : "disconnected" }),
  async save(_userId, raw) {
    const body = parseBody(schema, raw);
    const trimmed = (body.access_token ?? "").trim();
    if (trimmed && !(await verifyThingiverseAccessToken(trimmed))) {
      throw new HttpError(
        422,
        "Couldn't verify this Thingiverse App Token -- it may be invalid, revoked, or Thingiverse is rate-limiting this instance right now. Double-check the token at thingiverse.com/apps/create and try again.",
      );
    }
    await setThingiverseAccessToken(body.access_token);
    return { configured: Boolean(trimmed) };
  },
};
