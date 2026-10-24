import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ImportKit, SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  fetchNexprintModelFiles,
  fetchNexprintProfileFile,
  isNexprintFileHost,
  NexprintAuthError,
  type NexprintFile,
  type NexprintModelResolution,
  nexprintModelUrl,
  parseNexprintModelUrl,
  resolveNexprintModel,
  selectNexprintProfiles,
} from "./api";
import { getUserNexprintToken, markNexprintSessionRejected, NEXPRINT_CONNECT } from "./session";

const SESSION_CODE = MANIFESTS.nexprint.errorCodes.session;
const BLOCKED =
  "NexPrint blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

function downloadFile(file: NexprintFile, kit: ImportKit): Promise<NewPlateInput[] | null> {
  return kit.downloadSignedFile(file, isNexprintFileHost, BLOCKED);
}

/** Downloads one print profile's 3MF, tagged with the profile; null when the model has no such profile. */
async function downloadProfile(
  resolved: NexprintModelResolution,
  profileId: string,
  token: string,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const profile = resolved.profiles.find((p) => p.id === profileId);
  const file = profile ? await fetchNexprintProfileFile(profile, token) : null;
  if (!file) return null;
  const inputs = await downloadFile(file, kit);
  if (!inputs?.length) throw new HttpError(400, "Couldn't download this print profile from NexPrint. Try again later.");
  // A profile is one 3MF; anything else it unpacked to is dropped.
  await Promise.all(inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  return { ...inputs[0], sourceInstanceId: profileId };
}

/** Like Creality Cloud: a model is one print, and each print profile its 3MF on a plate of its own, tagged with the
 *  profile. An import brings the profile the link names, else the designer's first; a model without profiles brings
 *  its model files instead. Files only download as the user, so everything needs their NexPrint sign-in. */
export const nexprintImport: SourcedImport<string, NexprintModelResolution> = {
  async requireAuth(userId) {
    const token = await getUserNexprintToken(userId);
    if (!token) throw new HttpError(400, NEXPRINT_CONNECT, SESSION_CODE);
    return token;
  },
  resolveModel: (modelId) => resolveNexprintModel(modelId),
  async mapError(userId, err) {
    if (err instanceof NexprintAuthError) {
      await markNexprintSessionRejected(userId);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    return err;
  },
  missingMessage: "This NexPrint model could not be found, or isn't public.",
  noFilesMessage: "This NexPrint model has no files Thingport can import.",
  async downloadModel(_target, resolved, token, requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      const [profileId] = selectNexprintProfiles(resolved, "url", requested);
      if (profileId) {
        const profile = await downloadProfile(resolved, profileId, token, kit);
        if (profile) downloaded.push(profile);
      }
      if (!downloaded.length) {
        for (const file of await fetchNexprintModelFiles(resolved, token)) {
          downloaded.push(...((await downloadFile(file, kit)) ?? []));
        }
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
  profiles: {
    download: (_target, resolved, profileId, token, kit) => downloadProfile(resolved!, profileId, token, kit),
    missingMessage: "This NexPrint model has no such print profile.",
    // Its profile files are named after their profiles already.
    namedAlike: false,
    async listUrls(url, scope) {
      const parsed = parseNexprintModelUrl(url);
      if (!parsed) throw new HttpError(400, "Not a NexPrint model link");
      const resolved = await resolveNexprintModel(parsed.modelId);
      if (!resolved) throw new HttpError(404, nexprintImport.missingMessage);
      const profileIds = selectNexprintProfiles(resolved, scope, parsed.requestedProfileId);
      if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => nexprintModelUrl(resolved.modelId, profileId)),
      };
    },
  },
};
