import { HttpError } from "../../utils/fileUtils";
import { mapWithConcurrency } from "../../utils/concurrency";
import type { NewPlateInput } from "../../services/printCreation";
import type { ResolvedModel, SourcedImport } from "../types";
import { getThingiverseAccessToken } from "../../services/settingsService";
import {
  resolveThingiverseThing,
  ThingiverseAuthError,
  ThingiverseRateLimitError,
  type ThingiversePlateFile,
  type ThingiverseThingResolution,
} from "./api";

const DOWNLOAD_CONCURRENCY = 2;

type Thing = ResolvedModel & { plateFiles: ThingiversePlateFile[] };

/** Every model file bundled with the Thing becomes its own plate on one print. Read and downloaded with the
 *  instance's App Token, which an admin sets. */
export const thingiverseImport: SourcedImport<string, Thing> = {
  async requireAuth() {
    const accessToken = await getThingiverseAccessToken();
    if (!accessToken) {
      throw new HttpError(
        503,
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an App Token in Administration > Providers.",
      );
    }
    return accessToken;
  },
  async resolveModel(thingId, accessToken) {
    const resolved: ThingiverseThingResolution | null = await resolveThingiverseThing(thingId, accessToken);
    return (
      resolved && {
        meta: resolved.meta,
        plateFiles: resolved.plateFiles,
        galleryImages: resolved.galleryImages.map((img) => ({ url: img.url, filename: img.name })),
      }
    );
  },
  async mapError(_userId, err) {
    if (err instanceof ThingiverseRateLimitError) return new HttpError(429, err.message);
    // 400, not 401: see tryMakerworldCloudApi.
    if (err instanceof ThingiverseAuthError) return new HttpError(400, err.message);
    return err;
  },
  missingMessage: "This Thingiverse Thing could not be found, or isn't accessible with the configured App Token.",
  noFilesMessage: "None of this Thing's files could be downloaded.",
  nameHint: (thingId) => `thing-${thingId}`,
  async downloadModel(_target, thing, _token, _requested, kit) {
    const modelFiles = thing.plateFiles.filter((file) => kit.isModelFile(file.name));
    const results = await mapWithConcurrency(modelFiles, DOWNLOAD_CONCURRENCY, (file) =>
      kit.downloadFile(file.url, file.name),
    );
    const downloaded = results
      .filter((result): result is { input: NewPlateInput } => result !== null && "input" in result)
      .map((result) => result.input);
    if (!downloaded.length && results.some((result) => result !== null && "rateLimited" in result)) {
      throw new HttpError(
        429,
        "Thingiverse blocked a file download with a rate-limit challenge (Cloudflare). This usually clears after a while -- wait, then retry the same import.",
      );
    }
    return downloaded;
  },
};
