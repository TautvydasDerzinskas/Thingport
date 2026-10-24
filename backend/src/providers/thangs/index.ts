import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { SourcedImport, ProviderTrending, ProviderList, ProviderLists, ProviderDetails } from "../types";
import { MANIFESTS } from "../_generated";
import {
  fetchThangsDownload,
  isThangsFileHost,
  resolveThangsModel,
  ThangsAuthError,
  ThangsBlockedError,
  ThangsDownloadLimitError,
  type ThangsModelResolution,
  fetchThangsTrending,
  fetchThangsCollection,
  fetchThangsLikes,
  fetchThangsPurchases,
  isThangsLikesUrl,
  parseThangsCollectionUrl,
  THANGS_LIKES_NAME,
  ThangsPrivateCollectionError,
} from "./api";
import {
  getUserThangsToken,
  markThangsSessionRejected,
  THANGS_CONNECT,
  withThangsToken,
  getUserThangsId,
} from "./session";
import { z } from "zod";
import { detailsOf } from "../details";

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

/** The user's likes, or a collection, from a Thangs link, read with their sign-in: every file needs it anyway, and it
 *  says which paid models they own, which the listing keeps. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const likes = isThangsLikesUrl(url);
  const collection = likes ? null : parseThangsCollectionUrl(url);
  if (!likes && !collection) throw new HttpError(400, "Not a link to a Thangs collection or your likes");
  try {
    const [token, thangsId] = await Promise.all([getUserThangsToken(userId), getUserThangsId(userId)]);
    if (!token || !thangsId) throw new HttpError(400, THANGS_CONNECT, SESSION_CODE);
    const owned = await withThangsToken(userId, token, fetchThangsPurchases);
    let title: string;
    let listing: Awaited<ReturnType<typeof fetchThangsLikes>>;
    if (likes) {
      title = THANGS_LIKES_NAME;
      listing = await fetchThangsLikes(thangsId, owned);
    } else {
      const found = await withThangsToken(userId, token, (fresh) =>
        fetchThangsCollection(collection!.collectionId, fresh, owned),
      );
      if (!found) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
      title = found.info.name;
      listing = found;
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof ThangsAuthError) {
      await markThangsSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, SESSION_CODE);
    }
    if (err instanceof ThangsPrivateCollectionError) throw new HttpError(403, err.message);
    if (err instanceof ThangsBlockedError) throw new HttpError(429, err.message);
    throw err;
  }
}

export const thangsLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models Thingport can import`);
    return list;
  },
  modelIds: z.array(z.string().regex(/^\d+$/).max(20)).min(1).max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return {
      batch: {
        async ready() {
          if (!(await getUserThangsToken(userId))) throw new HttpError(503, THANGS_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details read without a sign-in, which only their files need. */
export const thangsDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveThangsModel(modelId)),
  missingMessage: thangsImport.missingMessage,
  mapError: thangsFailure,
};
