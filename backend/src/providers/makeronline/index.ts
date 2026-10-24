import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { ImportRequestBody } from "../../services/importService";
import type { NewPlateInput } from "../../services/printCreation";
import type { CustomImport, ImportKit } from "../types";
import { MANIFESTS } from "../_generated";
import { isMakeronlineFileHost, resolveMakeronlineModel } from "./api";
import type { ProviderTrending } from "../types";
import { fetchMakeronlineTrending } from "./api";

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
