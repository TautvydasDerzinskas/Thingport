import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkSnapmakerToken, snapmakerSiteHost, type SnapmakerRegion } from "./api";
import { getSnapmakerConnection, normalizeSnapmakerToken, setUserSnapmakerToken } from "./session";

// `verify` is opt-in, as for MyMiniFactory: Thingport Grab sends a token it just read from a signed-in browser.
const schema = z.object({
  token: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's access token on a site, which Thingport Grab keeps sending as the browser's login is refreshed. Each
 *  site has accounts of its own, so a token is checked with the site it's for. */
function siteConnection(region: SnapmakerRegion): ConnectionSlot {
  const host = snapmakerSiteHost(region);
  return {
    status: async (userId) => ({ status: await getSnapmakerConnection(userId, region) }),
    async save(userId, raw) {
      const body = parseBody(schema, raw);
      const token = normalizeSnapmakerToken(body.token);
      if ((body.token ?? "").trim() && !token) {
        throw new HttpError(
          422,
          "That doesn't look like a Snapmaker sign-in: paste the login_access_token cookie's value.",
        );
      }
      if (token?.expiresAt && token.expiresAt.getTime() <= Date.now()) {
        throw new HttpError(422, "This Snapmaker sign-in has already expired. Copy a fresh one from a signed-in tab.");
      }
      if (body.verify && token) {
        const check = await checkSnapmakerToken(token.token, region);
        if (check === "rejected") {
          throw new HttpError(
            422,
            `Snapmaker didn't accept this sign-in -- it may have expired, or be another site's. Copy a fresh login_access_token from a signed-in ${host} tab and try again.`,
          );
        }
        // 503, not 422: nothing is known to be wrong with the token.
        if (check === "unreachable")
          throw new HttpError(503, "Couldn't reach Snapmaker to check this sign-in. Try again in a moment.");
      }
      return { configured: await setUserSnapmakerToken(userId, token, region) };
    },
  };
}

export const snapmakerConnection = siteConnection(null);
export const snapmakerChinaConnection = siteConnection("cn");
