import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import type { ConnectionSlot } from "../types";
import { checkVoxelshareAuth, voxelshareSiteHost, type VoxelshareRegion } from "./api";
import {
  clearVoxelshareSessionIf,
  getVoxelshareAccountName,
  getVoxelshareConnection,
  normalizeVoxelshareSession,
  setUserVoxelshareSession,
} from "./session";

const schema = z.object({
  token: z.string().max(10_000).nullable(),
  verify: z.boolean().optional(),
});

/** Each user's sign-in on a site, which Thingport Grab sends whenever the browser's changes. Each site has accounts of
 *  its own, so a sign-in is checked with the site it's for. */
function siteConnection(region: VoxelshareRegion): ConnectionSlot {
  const host = voxelshareSiteHost(region);
  return {
    status: async (userId) => ({
      status: await getVoxelshareConnection(userId, region),
      account: await getVoxelshareAccountName(userId, region),
    }),
    async save(userId, raw) {
      const body = parseBody(schema, raw);
      const token = normalizeVoxelshareSession(body.token);
      if ((body.token ?? "").trim() && !token) {
        throw new HttpError(
          422,
          `That doesn't look like a VoxelShare sign-in: paste the value of the token cookie from a signed-in ${host} ` +
            "tab, or the whole Cookie header of one of its requests.",
        );
      }
      let account: { id: string; name: string | null } | null = null;
      if (body.verify && token) {
        const check = await checkVoxelshareAuth(token, region);
        if (check === "rejected") {
          throw new HttpError(
            422,
            `VoxelShare didn't accept this sign-in -- it may have expired, or be another site's. Copy it again from a signed-in ${host} tab and try again.`,
          );
        }
        // 503, not 422: nothing is known to be wrong with the sign-in.
        if (check === "unreachable")
          throw new HttpError(503, "Couldn't reach VoxelShare to check this sign-in. Try again in a moment.");
        account = { id: check.userId, name: check.name };
      }
      return { configured: await setUserVoxelshareSession(userId, token, account, region) };
    },
    // Grab saw the browser sign out: the token it sent goes, while it's still the one stored. One pasted in Thingport
    // since is someone's own choice, and stays.
    async signOut(userId, lastSent) {
      const sent = normalizeVoxelshareSession(lastSent);
      if (sent) await clearVoxelshareSessionIf(userId, sent, region);
      return { configured: (await getVoxelshareConnection(userId, region)) !== "disconnected" };
    },
  };
}

export const voxelshareConnection = siteConnection(null);
export const voxelshareChinaConnection = siteConnection("cn");
