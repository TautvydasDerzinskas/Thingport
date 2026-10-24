// MakerOnline's bundle: this folder, providers/makeronline/ at the repository's root (its manifest and links, which
// all three packages share), the app's frontend/src/providers/makeronline/ and Grab's
// extension/src/providers/makeronline/. Wired in by providers/registry.ts and providers/routes.ts here,
// frontend/src/providers/collectionTiles.ts in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - prisma/schema.prisma: its User columns (makeronlineToken, makeronlineTokenExpires, makeronlineUserId,
//   makeronlineRejectedAt, and its GrabImport rows) and Category's makeronlineCatIds, a column apiece until Phase 7 of
//   docs/rfc/provider-modules.md moves them into tables of their own. dto.ts, routes/categories.ts,
//   services/categoryService.ts and seedData/defaultCategories.ts name its category ids for the same reason.
// - routes/importRequest.ts: resolved_files, its files as Grab signed them, on the import body every import route
//   takes.
// - services/apiTokenScopes.ts: its waiting imports' path, as every scope is listed there for apps that read with a
//   token.
// - services/importJobRunner.ts: the links job's notification names it for models parked for Grab.
// - Grab: content/panels/single.ts imports its models through its own message within every provider's panel flow.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { ImportRequestBody } from "../../services/importService";
import type { NewPlateInput } from "../../services/printCreation";
import type { CustomImport, ImportKit, ProviderTrending, ProviderList, ProviderLists, ProviderDetails } from "../types";
import { MANIFESTS } from "../_generated";
import {
  isMakeronlineFileHost,
  resolveMakeronlineModel,
  fetchMakeronlineTrending,
  fetchMakeronlineCollection,
  fetchMakeronlineCollectionInfo,
  fetchMakeronlineLikes,
  isMakeronlineLikesUrl,
  MakeronlineAuthError,
  MAKERONLINE_LIKES_NAME,
  parseMakeronlineCollectionUrl,
} from "./api";
import { z } from "zod";
import { getUserMakeronlineToken, MAKERONLINE_CONNECT, markMakeronlineTokenRejected } from "./session";
import { detailsOf } from "../details";

/** A MakerOnline import that came without the signed file links only Thingport Grab can get. */
const NEEDS_GRAB_CODE = MANIFESTS.makeronline.errorCodes.needsGrab;
const NEEDS_GRAB =
  "MakerOnline only gives its files to its own pages: import it with Thingport Grab on makeronline.com.";
const BLOCKED =
  "MakerOnline blocked the file download (rate limit). This usually clears after a while -- wait, then try again.";

/** MakerOnline's files as Grab signed them: a profile's 3MF tagged with the profile, a model's own files untagged.
 *  Throws once nothing came down, since the signed links run out quickly. */
async function downloadFiles(
  files: NonNullable<ImportRequestBody["resolved_files"]>,
  kit: ImportKit,
): Promise<NewPlateInput[]> {
  const downloaded: NewPlateInput[] = [];
  try {
    for (const file of files) {
      const inputs = (await kit.downloadSignedFile(file, isMakeronlineFileHost, BLOCKED)) ?? [];
      if (!file.profile_id) {
        downloaded.push(...inputs);
        continue;
      }
      // A profile is one 3MF; anything else it unpacked to is dropped.
      await Promise.all(
        inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)),
      );
      if (inputs[0]) downloaded.push({ ...inputs[0], sourceInstanceId: file.profile_id });
    }
  } catch (err) {
    await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
    throw err;
  }
  if (!downloaded.length) {
    throw new HttpError(
      400,
      "Couldn't download this model's files from MakerOnline: the signed links may have run out. Try again from its page.",
    );
  }
  return downloaded;
}

/** Like Snapmaker: a model is one print, each print profile its 3MF on a plate of its own, tagged with the profile,
 *  and a model without profiles brings its model files. The details come from MakerOnline's public API; the files
 *  only with links Grab signed (see services/grabImportService.ts), which come with the request. */
export const makeronlineImport: CustomImport = {
  async importModel(userId, source, body, kit) {
    if (!body.resolved_files?.length) throw new HttpError(409, NEEDS_GRAB, NEEDS_GRAB_CODE);
    const resolved = await resolveMakeronlineModel(source.externalId);
    if (!resolved) throw new HttpError(404, "This MakerOnline model could not be found, or isn't public.");
    const downloaded = await downloadFiles(body.resolved_files, kit);
    return kit.createPrint(userId, source, body, resolved, downloaded, kit.profileDetails(resolved.profiles));
  },
  /** Each print profile the request brings that the print hasn't got becomes another plate; anything else is
   *  already in the library, and needs no download. */
  async addToExisting(existing, body, kit) {
    const have = new Set(existing.plates.map((plate) => plate.sourceInstanceId));
    const wanted = (body.resolved_files ?? []).filter((file) => file.profile_id && !have.has(file.profile_id));
    if (!wanted.length) return { ...existing, alreadyImported: true };
    const inputs = await downloadFiles(wanted, kit);
    // Its public details name and picture the profiles; without them the files still come in.
    const model = await resolveMakeronlineModel(existing.print.sourceExternalId!).catch(() => null);
    return kit.addProfiles(existing, inputs, model ? kit.profileDetails(model.profiles) : {});
  },
};

export const makeronlineTrending: ProviderTrending = { fetch: (_userId, limit) => fetchMakeronlineTrending(limit) };

/** The user's likes, or any collection they can see, from a MakerOnline link. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const token = await getUserMakeronlineToken(userId);
  try {
    let title: string;
    let listing: Awaited<ReturnType<typeof fetchMakeronlineLikes>>;
    if (isMakeronlineLikesUrl(url)) {
      if (!token) throw new HttpError(400, MAKERONLINE_CONNECT);
      title = MAKERONLINE_LIKES_NAME;
      listing = await fetchMakeronlineLikes(token);
    } else {
      const parsed = parseMakeronlineCollectionUrl(url);
      if (!parsed) throw new HttpError(400, "Not a link to a MakerOnline collection or your likes");
      const [info, found] = await Promise.all([
        fetchMakeronlineCollectionInfo(parsed.collectionId, token),
        fetchMakeronlineCollection(parsed.collectionId, token),
      ]);
      if (!info || !found) throw new HttpError(404, "That collection can't be found. It may be private or deleted.");
      title = info.name;
      listing = found;
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof MakeronlineAuthError) {
      await markMakeronlineTokenRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message);
    }
    throw err;
  }
}

/** The picked models of a list wait for Grab (services/grabImportService.ts), filed into a collection named after
 *  the list. */
export const makeronlineLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" is empty`);
    return list;
  },
  modelIds: z.array(z.string().regex(/^\d+$/)).min(1).max(1000),
  async start(userId, url) {
    return { waitForGrab: { title: (await listOf(userId, url)).title } };
  },
  waitsForGrab: true,
};

/** Its models' details read without a sign-in, which only their files need. */
export const makeronlineDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveMakeronlineModel(modelId)),
  missingMessage: `This ${MANIFESTS.makeronline.name} model could not be found, or isn't public.`,
};
