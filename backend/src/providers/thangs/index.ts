import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  fetchThangsDownload,
  isThangsFileHost,
  resolveThangsModel,
  ThangsAuthError,
  ThangsBlockedError,
  ThangsDownloadLimitError,
  type ThangsModelResolution,
} from "./api";
import { getUserThangsToken, markThangsSessionRejected, THANGS_CONNECT, withThangsToken } from "./session";
import type { ProviderTrending } from "../types";
import { fetchThangsTrending } from "./api";

const { session: SESSION_CODE, downloadLimit: DOWNLOAD_LIMIT_CODE } = MANIFESTS.thangs.errorCodes;
const BLOCKED =
  "Thangs blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** Thangs' errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function thangsFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof ThangsAuthError) {
    await markThangsSessionRejected(userId);
    // 400, not 401: see tryMakerworldCloudApi.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof ThangsDownloadLimitError) return new HttpError(429, err.message, DOWNLOAD_LIMIT_CODE);
  if (err instanceof ThangsBlockedError) return new HttpError(429, err.message);
  return err;
}

/** The user's access token, renewed when it's out, or the HttpError that says to connect Thangs. */
async function requireToken(userId: string): Promise<string> {
  let token: string | null;
  try {
    token = await getUserThangsToken(userId);
  } catch (err) {
    throw await thangsFailure(userId, err);
  }
  if (!token) throw new HttpError(400, THANGS_CONNECT, SESSION_CODE);
  return token;
}

/** Why Thangs won't hand over a model's files, by what kind of model it is. */
function thangsUnavailable(resolved: ThangsModelResolution): HttpError {
  if (resolved.access === "printOnly") {
    return new HttpError(403, "This Thangs model is sold only as a print: its designer doesn't offer its files.");
  }
  if (resolved.access === "paid") {
    const price = resolved.price !== null ? ` ($${resolved.price})` : "";
    return new HttpError(
      403,
      `This is a paid Thangs model${price}, so it downloads only for an account that bought it, or a member of a ` +
        "designer membership that includes it. Get it on Thangs with the account connected to Thingport, then import it again.",
    );
  }
  if (resolved.access === "membership") {
    return new HttpError(
      403,
      "This Thangs model is for members of its designer's membership only: join it on Thangs with the account " +
        "connected to Thingport, then import it again.",
    );
  }
  return new HttpError(403, "Thangs doesn't let your account download this model.");
}

/** Like MyMiniFactory: metadata from the public API, then the files as the user, in one download -- the model file, or
 *  a zip whose model files each become a plate. Every download counts towards the account's daily ones, so a model
 *  that can't be had (print-only) is refused before asking, and before the sign-in is looked at. */
export const thangsImport: SourcedImport<null, ThangsModelResolution> = {
  // The model is read without a sign-in; the token is only fetched to download.
  requireAuth: async () => null,
  resolveModel: (modelId) => resolveThangsModel(modelId),
  mapError: thangsFailure,
  missingMessage: "This Thangs model could not be found, or isn't public.",
  noFilesMessage: "This Thangs model has no files Thingport can import.",
  async downloadModel({ userId, externalId: modelId }, resolved, _auth, _requested, kit) {
    if (resolved.access === "printOnly") throw thangsUnavailable(resolved);
    const token = await requireToken(userId);
    const downloaded: NewPlateInput[] = [];
    try {
      const file = await withThangsToken(userId, token, (fresh) => fetchThangsDownload(modelId, fresh));
      if (!file) throw thangsUnavailable(resolved);
      downloaded.push(...((await kit.downloadSignedFile(file, isThangsFileHost, BLOCKED)) ?? []));
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const thangsTrending: ProviderTrending = { fetch: (_userId, limit) => fetchThangsTrending(limit) };
