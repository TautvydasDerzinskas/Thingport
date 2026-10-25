import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import { resolveMakerworldCookie } from "./pageData";
import { HttpError } from "../../utils/fileUtils";
import type { ProviderLists } from "../types";
import { extractMakerworldBearerToken, MakerworldAuthError, MakerworldCaptchaError } from "./api";
import {
  fetchMakerworldCollectionEntries,
  fetchMakerworldCollectionTitle,
  parseMakerworldCollectionUrl,
} from "./collections";
import { withStoredMakerworldCookie } from "./session";

/** Collections, public or the user's own private ones, read with their cookie; imported by a job of MakerWorld's own,
 *  paced against its captcha. */
export const makerworldLists: ProviderLists = {
  async read(userId, url, body) {
    const parsed = parseMakerworldCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a MakerWorld collection URL");
    const bearerToken = extractMakerworldBearerToken(
      resolveMakerworldCookie(await withStoredMakerworldCookie(userId, body)),
    );
    // Sequential: fetching both at once is an unpaced burst.
    try {
      const title = await fetchMakerworldCollectionTitle(parsed.collectionId, bearerToken);
      const listing = await fetchMakerworldCollectionEntries(
        parsed.collectionId,
        bearerToken,
        undefined,
        IMPORT_MAKERWORLD_CALL_DELAY_MS,
      );
      if (!listing.entries.length) throw new HttpError(400, "Could not load this collection's models");
      return {
        title,
        total: listing.total,
        truncated: listing.truncated,
        entries: listing.entries.map((e) => ({ externalId: e.designId, title: e.title, cover: e.cover })),
      };
    } catch (err) {
      if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      if (err instanceof MakerworldAuthError) throw new HttpError(400, err.message);
      throw err;
    }
  },
  async start(userId, url, body) {
    const withCookie = await withStoredMakerworldCookie(userId, body);
    return {
      async run(jobId) {
        // Loaded when it runs: the import runner it shares reaches the registry this module is part of.
        const { runCollectionImportJob } = await import("./jobs");
        await runCollectionImportJob(jobId, userId, { ...withCookie, url, design_ids: body.model_ids });
      },
    };
  },
};
