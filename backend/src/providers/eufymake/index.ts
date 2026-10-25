// eufyMake's bundle: this folder, providers/eufymake/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/eufymake/ and Grab's extension/src/providers/eufymake/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.

import fs from "node:fs/promises";
import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ProviderDetails, ProviderList, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import { MANIFESTS } from "../index.generated";
import { detailsOf } from "../details";
import {
  EUFYMAKE_LIKES_NAME,
  EufymakeAuthError,
  type EufymakeModelResolution,
  fetchEufymakeFeatured,
  fetchEufymakeLikes,
  isEufymakeFileHost,
  isEufymakeLikesUrl,
  resolveEufymakeModel,
} from "./api";
import { EUFYMAKE_CONNECT, getUserEufymakeAuth, markEufymakeSessionRejected } from "./session";

const SESSION_CODE = MANIFESTS.eufymake.errorCodes.session;
const BLOCKED =
  "eufyMake blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** A model is one print of its files, which come with its details as links signed for anyone, so nothing needs a
 *  sign-in. Where it lists its files only as one zip, the zip is unpacked. */
export const eufymakeImport: SourcedImport<null, EufymakeModelResolution> = {
  requireAuth: async () => null,
  resolveModel: (modelId) => resolveEufymakeModel(modelId),
  mapError: async (_userId, err) => err,
  missingMessage: "This eufyMake model could not be found, or isn't public.",
  noFilesMessage: "This eufyMake model has no files Thingport can import.",
  async downloadModel(_target, resolved, _auth, _requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      for (const file of resolved.files) {
        downloaded.push(...((await kit.downloadSignedFile(file, isEufymakeFileHost, BLOCKED)) ?? []));
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const eufymakeTrending: ProviderTrending = { fetch: (_userId, limit) => fetchEufymakeFeatured(limit) };

/** The user's likes, the only list eufyMake has. */
async function likesOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  if (!isEufymakeLikesUrl(url)) throw new HttpError(400, "Not a link to your eufyMake likes");
  const auth = await getUserEufymakeAuth(userId);
  if (!auth) throw new HttpError(400, EUFYMAKE_CONNECT, SESSION_CODE);
  try {
    const listing = await fetchEufymakeLikes(auth);
    return {
      title: EUFYMAKE_LIKES_NAME,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof EufymakeAuthError) {
      await markEufymakeSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, SESSION_CODE);
    }
    throw err;
  }
}

export const eufymakeLists: ProviderLists = {
  async read(userId, url) {
    const list = await likesOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" is empty`);
    return list;
  },
  modelIds: z
    .array(
      z
        .string()
        .regex(/^[0-9a-f]{32}$/i)
        .transform((id) => id.toLowerCase()),
    )
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await likesOf(userId, url);
    return { batch: { title: async () => title } };
  },
};

/** Its models' details, which need no sign-in. */
export const eufymakeDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveEufymakeModel(modelId)),
  missingMessage: eufymakeImport.missingMessage,
};
