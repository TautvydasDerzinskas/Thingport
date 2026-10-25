// 3DPrint.social's bundle: this folder, providers/threedprintsocial/ at the repository's root (its manifest and links,
// which all three packages share), the app's frontend/src/providers/threedprintsocial/ and its empty entry in Grab's
// extension/src/providers/content.ts. Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts
// in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import { z } from "zod";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { detailsOf } from "../details";
import type { ProviderDetails, ProviderList, ProviderLists, SourcedImport } from "../types";
import {
  fetchPrintSocialList,
  isPrintSocialFileHost,
  PrintSocialBlockedError,
  printSocialCreatorListName,
  printSocialListFromUrl,
  type PrintSocialModelResolution,
  PrintSocialRateLimitError,
  resolvePrintSocialModel,
} from "./api";

const BLOCKED =
  "3DPrint.social blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** Its errors as the HttpErrors an import reports. */
async function printSocialFailure(_userId: string, err: unknown): Promise<unknown> {
  if (err instanceof PrintSocialRateLimitError) return new HttpError(429, err.message);
  // Its own code, so a sync waits rather than failing the model.
  if (err instanceof PrintSocialBlockedError) return new HttpError(403, err.message, CLOUDFLARE_BLOCKED_CODE);
  return err;
}

/** A public model is anyone's to read and download: its files one by one, by their download links. */
export const printSocialImport: SourcedImport<null, PrintSocialModelResolution> = {
  requireAuth: async () => null,
  resolveModel: (modelId) => resolvePrintSocialModel(modelId),
  mapError: printSocialFailure,
  missingMessage: "This 3DPrint.social model could not be found, or isn't public.",
  noFilesMessage: "This 3DPrint.social model has no files Thingport can import.",
  async downloadModel(_target, resolved, _auth, _requested, kit) {
    // Only what a plate takes, or a zip to unpack: no point asking for the rest.
    const wanted = resolved.files.filter((file) => kit.isModelFile(file.name) || /\.zip$/i.test(file.name));
    const downloaded: NewPlateInput[] = [];
    try {
      for (const file of wanted) {
        downloaded.push(...((await kit.downloadSignedFile(file, isPrintSocialFileHost, BLOCKED)) ?? []));
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

/** A collection, or a creator's models, from its link; anyone's to read. Its first `maxItems`. */
async function listOf(url: string, maxItems?: number): Promise<ProviderList & { title: string }> {
  const list = printSocialListFromUrl(url);
  if (!list) throw new HttpError(400, "Not a link to a 3DPrint.social collection or creator");
  try {
    const found = await fetchPrintSocialList(list, maxItems);
    if (!found) {
      throw new HttpError(
        404,
        list.kind === "collection"
          ? "That collection can't be found, or isn't public. It may have been deleted."
          : "There's no such creator on 3DPrint.social, or their models aren't public.",
      );
    }
    return {
      title: list.kind === "creator" ? printSocialCreatorListName(found.info.name) : found.info.name,
      total: found.total,
      truncated: found.truncated,
      entries: found.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof PrintSocialRateLimitError) throw new HttpError(429, err.message);
    if (err instanceof PrintSocialBlockedError) throw new HttpError(503, err.message);
    throw err;
  }
}

export const printSocialLists: ProviderLists = {
  async read(_userId, url) {
    const list = await listOf(url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models Thingport can import`);
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^[a-z0-9]{12}$/))
    .min(1)
    .max(1000),
  async start(_userId, url) {
    // Only its title: the first page has it.
    const { title } = await listOf(url, 1);
    return { batch: { title: async () => title } };
  },
};

/** Its models' details, which need no sign-in. */
export const printSocialDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolvePrintSocialModel(modelId)),
  missingMessage: printSocialImport.missingMessage,
  mapError: printSocialFailure,
};
