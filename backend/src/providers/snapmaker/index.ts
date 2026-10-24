import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ImportKit, SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  fetchSnapmakerDownloads,
  isSnapmakerFileHost,
  parseSnapmakerModelUrl,
  resolveSnapmakerModel,
  selectSnapmakerProfiles,
  SnapmakerAuthError,
  type SnapmakerFile,
  type SnapmakerModelResolution,
  snapmakerModelUrl,
} from "./api";
import { getUserSnapmakerToken, markSnapmakerTokenRejected, SNAPMAKER_CONNECT } from "./session";

const SESSION_CODE = MANIFESTS.snapmaker.errorCodes.session;
const BLOCKED =
  "Snapmaker blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";
const MISSING = "This Snapmaker model could not be found, or isn't public.";

/** One of a Snapmaker model's signed files; a zip is unpacked into its model files. Null when it didn't download. */
function downloadFile(file: SnapmakerFile, kit: ImportKit): Promise<NewPlateInput[] | null> {
  return kit.downloadSignedFile(file, isSnapmakerFileHost, BLOCKED);
}

/** Downloads one print profile's 3MF, tagged with the profile; null when the profile isn't among the downloads. */
async function downloadProfile(
  modelId: string,
  profileId: string,
  token: string,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const downloads = await fetchSnapmakerDownloads(modelId, token);
  if (!downloads) throw new HttpError(404, MISSING);
  const file = downloads.profiles.find((profile) => profile.profileId === profileId);
  if (!file) return null;
  const inputs = await downloadFile(file, kit);
  if (!inputs?.length) {
    throw new HttpError(400, "Couldn't download this print profile from Snapmaker. Try again later.");
  }
  // A profile is one 3MF; anything else it unpacked to is dropped.
  await Promise.all(inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  return { ...inputs[0], sourceInstanceId: profileId };
}

/** Like MakerWorld: a model is one print, and each print profile its 3MF on a plate of its own, tagged with the
 *  profile. An import brings the profile the link names, else the designer's first; a model without profiles brings
 *  its model files instead. Files only download as the user, so everything needs their Snapmaker sign-in. */
export const snapmakerImport: SourcedImport<string, SnapmakerModelResolution> = {
  async requireAuth(userId) {
    const token = await getUserSnapmakerToken(userId);
    if (!token) throw new HttpError(400, SNAPMAKER_CONNECT, SESSION_CODE);
    return token;
  },
  resolveModel: (modelId) => resolveSnapmakerModel(modelId),
  async mapError(userId, err) {
    if (err instanceof SnapmakerAuthError) {
      await markSnapmakerTokenRejected(userId);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    return err;
  },
  missingMessage: MISSING,
  noFilesMessage: "This Snapmaker model has no files Thingport can import.",
  async downloadModel({ externalId: modelId }, resolved, token, requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      const [profileId] = selectSnapmakerProfiles(resolved, "url", requested);
      if (profileId) {
        const profile = await downloadProfile(modelId, profileId, token, kit);
        if (profile) downloaded.push(profile);
      }
      if (!downloaded.length) {
        const downloads = await fetchSnapmakerDownloads(modelId, token);
        if (!downloads) throw new HttpError(404, MISSING);
        for (const file of downloads.modelFiles) downloaded.push(...((await downloadFile(file, kit)) ?? []));
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
  profiles: {
    download: ({ externalId }, _resolved, profileId, token, kit) => downloadProfile(externalId, profileId, token, kit),
    // Its public details name and picture the profiles; without them the file still comes in.
    downloadsWithoutModel: true,
    missingMessage: "This Snapmaker model has no such print profile.",
    namedAlike: true,
    async listUrls(url, scope) {
      const parsed = parseSnapmakerModelUrl(url);
      if (!parsed) throw new HttpError(400, "Not a Snapmaker model link");
      const resolved = await resolveSnapmakerModel(parsed.modelId);
      if (!resolved) throw new HttpError(404, MISSING);
      const profileIds = selectSnapmakerProfiles(resolved, scope, parsed.requestedProfileId);
      if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => snapmakerModelUrl(parsed.modelId, profileId)),
      };
    },
  },
};
