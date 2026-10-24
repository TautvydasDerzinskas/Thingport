import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ImportKit, SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  CrealitycloudAuthError,
  type CrealitycloudAuth,
  type CrealitycloudFile,
  type CrealitycloudModelResolution,
  crealitycloudModelUrl,
  fetchCrealitycloudModelFiles,
  fetchCrealitycloudProfileFile,
  isCrealitycloudFileHost,
  parseCrealitycloudModelUrl,
  resolveCrealitycloudModel,
  selectCrealitycloudProfiles,
} from "./api";
import { CREALITYCLOUD_CONNECT, getUserCrealitycloudAuth, markCrealitycloudSessionRejected } from "./session";

const SESSION_CODE = MANIFESTS.crealitycloud.errorCodes.session;
const BLOCKED =
  "Creality Cloud blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";
const MISSING = "This Creality Cloud model could not be found, or isn't public.";

function downloadFile(file: CrealitycloudFile, kit: ImportKit): Promise<NewPlateInput[] | null> {
  return kit.downloadSignedFile(file, isCrealitycloudFileHost, BLOCKED);
}

/** Downloads one print profile's 3MF, tagged with the profile; null when the model has no such profile. */
async function downloadProfile(
  resolved: CrealitycloudModelResolution,
  profileId: string,
  auth: CrealitycloudAuth,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const profile = resolved.profiles.find((p) => p.id === profileId);
  const file = profile ? await fetchCrealitycloudProfileFile(profile, auth) : null;
  if (!file) return null;
  const inputs = await downloadFile(file, kit);
  if (!inputs?.length) {
    throw new HttpError(400, "Couldn't download this print profile from Creality Cloud. Try again later.");
  }
  // A profile is one 3MF; anything else it unpacked to is dropped.
  await Promise.all(inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  return { ...inputs[0], sourceInstanceId: profileId };
}

/** Like Snapmaker: a model is one print, and each print profile its 3MF on a plate of its own, tagged with the
 *  profile. An import brings the profile the link names, else the designer's first; a model without profiles brings
 *  its model files instead. Files only download as the user, so everything needs their Creality Cloud sign-in. A link
 *  by id is kept under the model's alias, the id the site's own links have. */
export const crealitycloudImport: SourcedImport<CrealitycloudAuth, CrealitycloudModelResolution> = {
  async requireAuth(userId) {
    const auth = await getUserCrealitycloudAuth(userId);
    if (!auth) throw new HttpError(400, CREALITYCLOUD_CONNECT, SESSION_CODE);
    return auth;
  },
  resolveModel: (modelId) => resolveCrealitycloudModel(modelId),
  canonicalId: (resolved) => resolved.alias,
  async mapError(userId, err) {
    if (err instanceof CrealitycloudAuthError) {
      await markCrealitycloudSessionRejected(userId);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    return err;
  },
  missingMessage: MISSING,
  noFilesMessage: "This Creality Cloud model has no files Thingport can import.",
  async downloadModel(_alias, resolved, auth, requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      const [profileId] = selectCrealitycloudProfiles(resolved, "url", requested);
      if (profileId) {
        const profile = await downloadProfile(resolved, profileId, auth, kit);
        if (profile) downloaded.push(profile);
      }
      if (!downloaded.length) {
        const files = await fetchCrealitycloudModelFiles(resolved.groupId, auth);
        if (!files) throw new HttpError(404, MISSING);
        for (const file of files) downloaded.push(...((await downloadFile(file, kit)) ?? []));
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
  profiles: {
    download: (_alias, resolved, profileId, auth, kit) => downloadProfile(resolved!, profileId, auth, kit),
    missingMessage: "This Creality Cloud model has no such print profile.",
    // Its profile files are named after their profiles already.
    namedAlike: false,
    async listUrls(url, scope) {
      const parsed = parseCrealitycloudModelUrl(url);
      if (!parsed) throw new HttpError(400, "Not a Creality Cloud model link");
      const resolved = await resolveCrealitycloudModel(parsed.modelId);
      if (!resolved) throw new HttpError(404, MISSING);
      const profileIds = selectCrealitycloudProfiles(resolved, scope, parsed.requestedProfileId);
      if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => crealitycloudModelUrl(resolved.alias, profileId)),
      };
    },
  },
};
