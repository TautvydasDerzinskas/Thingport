// VoxelShare's bundle: this folder, providers/voxelshare/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/voxelshare/ and Grab's extension/src/providers/voxelshare/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ and extension/src/content/adapted/sites.ts in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - Its look for Download adapted's button, in extension/src/content/styles/adapted.scss with every site's.

import fs from "node:fs/promises";
import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { joinFolders } from "../../utils/fileFolder";
import type { NewPlateInput } from "../../services/printCreation";
import type {
  ImportKit,
  ProviderDetails,
  ProviderList,
  ProviderLists,
  ProviderTrending,
  SourcedImport,
} from "../types";
import { MANIFESTS, regionalId } from "../index.generated";
import { detailsOf } from "../details";
import {
  VoxelshareAuthError,
  type VoxelshareModelResolution,
  fetchVoxelshareLikes,
  fetchVoxelshareTrending,
  isVoxelshareFileHost,
  parseVoxelshareModelUrl,
  resolveVoxelshareModel,
  selectVoxelshareProfiles,
  voxelshareLikesName,
  voxelshareListOf,
  voxelshareModelUrl,
  voxelshareSiteHost,
} from "./api";
import { readVoxelshareCollection } from "./lists";
import {
  getUserVoxelshareToken,
  getVoxelshareConnection,
  markVoxelshareSessionRejected,
  voxelshareConnectText,
} from "./session";

const SESSION_CODE = MANIFESTS.voxelshare.errorCodes.session;
const BLOCKED =
  "VoxelShare blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";
const FILE_FAILED = "VoxelShare didn't hand over one of this model's files. Try the import again in a while.";

/** One print profile's 3MF, tagged with the profile; null when the model has no such profile. */
async function downloadProfile(
  resolved: VoxelshareModelResolution,
  profileId: string,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const profile = resolved.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  const inputs = await kit.downloadSignedFile(profile, isVoxelshareFileHost, BLOCKED);
  if (!inputs?.length)
    throw new HttpError(400, "Couldn't download this print profile from VoxelShare. Try again later.");
  // A profile is one 3MF; anything else it unpacked to is dropped.
  await Promise.all(inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  return { ...inputs[0], sourceInstanceId: profileId };
}

/** The model's own files, which only a model without print profiles needs, each in the folder the designer put it in.
 *  Those kept zipped one by one are unpacked. One that doesn't download fails the import, rather than leave the model
 *  in the library without it, looking whole. */
async function downloadModelFiles(resolved: VoxelshareModelResolution, kit: ImportKit): Promise<NewPlateInput[]> {
  const inputs: NewPlateInput[] = [];
  try {
    for (const file of resolved.files) {
      if (!kit.isImportableFile(file.name) && !/\.zip$/i.test(file.name)) continue;
      // Null when it didn't download at all, as against a zip with nothing in it worth importing.
      const downloaded = await kit.downloadSignedFile(file, isVoxelshareFileHost, BLOCKED);
      if (downloaded === null) throw new HttpError(502, FILE_FAILED);
      for (const input of downloaded) {
        input.folder = joinFolders(file.folder, input.folder);
        inputs.push(input);
      }
    }
  } catch (err) {
    await Promise.all(inputs.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
    throw err;
  }
  return inputs;
}

/** A model is one print, and each print profile, a Flashforge slicer's project, its 3MF on a plate of its own, tagged
 *  with the profile. An import brings the profile the link names, else the designer's first; a model without profiles
 *  brings its own files. Everything is a public signed link, so nothing needs a sign-in. */
export const voxelshareImport: SourcedImport<null, VoxelshareModelResolution> = {
  requireAuth: async () => null,
  resolveModel: (modelId) => resolveVoxelshareModel(modelId),
  mapError: async (_userId, err) => err,
  missingMessage: "This VoxelShare model could not be found, or isn't public.",
  noFilesMessage: "This VoxelShare model has no files Thingport can import.",
  async downloadModel(_target, resolved, _auth, requested, kit) {
    const [profileId] = selectVoxelshareProfiles(resolved, "url", requested);
    const profile = profileId ? await downloadProfile(resolved, profileId, kit) : null;
    return profile ? [profile] : downloadModelFiles(resolved, kit);
  },
  profiles: {
    download: (_target, resolved, profileId, _auth, kit) => downloadProfile(resolved!, profileId, kit),
    missingMessage: "This VoxelShare model has no such print profile.",
    // Every profile's file is named after the model, so several on one print are named after their profiles.
    namedAlike: true,
    async listUrls(url, scope) {
      const parsed = parseVoxelshareModelUrl(url);
      if (!parsed) throw new HttpError(400, "Not a VoxelShare model link");
      const resolved = await resolveVoxelshareModel(regionalId(parsed.region, parsed.modelId));
      if (!resolved) throw new HttpError(404, voxelshareImport.missingMessage);
      // None for a model without profiles: a queued link of it imports its own files, a job for its profiles fails.
      const profileIds = selectVoxelshareProfiles(resolved, scope, parsed.requestedProfileId);
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => voxelshareModelUrl(resolved.modelId, profileId)),
      };
    },
  },
};

/** Its home page's Trending feed: the China site's for someone signed in there and not on the main site, who's likely
 *  in China and sees that one there, else the main site's. */
export const voxelshareTrending: ProviderTrending = {
  async region(userId) {
    const [main, china] = await Promise.all([getVoxelshareConnection(userId), getVoxelshareConnection(userId, "cn")]);
    return main === "disconnected" && china !== "disconnected" ? "cn" : null;
  },
  fetch: (_userId, limit, region) => fetchVoxelshareTrending(limit, region),
};

/** The user's likes, or a collection, from its link. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const list = voxelshareListOf(url);
  if (!list) throw new HttpError(400, "Not a link to a VoxelShare collection, or to your likes");
  if ("likes" in list) {
    const token = await getUserVoxelshareToken(userId, list.region);
    if (!token) throw new HttpError(400, voxelshareConnectText(list.region), SESSION_CODE);
    try {
      const likes = await fetchVoxelshareLikes(token, undefined, list.region);
      return { ...likes, title: voxelshareLikesName(list.region), entries: entriesOf(likes.entries) };
    } catch (err) {
      if (err instanceof VoxelshareAuthError) {
        await markVoxelshareSessionRejected(userId, token, list.region);
        // 400, not 401: the frontend treats any 401 as an expired Thingport session.
        throw new HttpError(400, err.message, SESSION_CODE);
      }
      throw err;
    }
  }
  const collection = await readVoxelshareCollection(userId, regionalId(list.region, list.collectionId));
  if (collection === "signIn") {
    throw new HttpError(
      400,
      `That collection is private: if it's one of yours, connect VoxelShare${list.region ? " China" : ""} first, ` +
        `or visit ${voxelshareSiteHost(list.region)} with Thingport Grab.`,
      SESSION_CODE,
    );
  }
  if (!collection) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
  return { ...collection, title: collection.info.name, entries: entriesOf(collection.entries) };
}

function entriesOf(entries: { modelId: string; title: string; cover: string | null }[]) {
  return entries.map((entry) => ({ externalId: entry.modelId, title: entry.title, cover: entry.cover }));
}

export const voxelshareLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" is empty`);
    return list;
  },
  // Its models' ids, the China site's kept as `cn-<id>`.
  modelIds: z
    .array(z.string().regex(/^(?:cn-)?\d{1,20}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return { batch: { title: async () => title } };
  },
};

/** Its models' details, which need no sign-in. */
export const voxelshareDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveVoxelshareModel(modelId)),
  missingMessage: voxelshareImport.missingMessage,
};
