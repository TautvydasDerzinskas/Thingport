import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../utils/fileUtils";
import { maybeSleep } from "../../utils/concurrency";
import type { NewPlateInput } from "../../services/printCreation";
import { getMyminifactoryApiKey } from "../../services/settingsService";
import type { ImportKit, ResolvedModel, SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  isMyminifactoryFileHost,
  listMyminifactoryLibraryFiles,
  MyminifactoryAuthError,
  MyminifactoryRateLimitError,
  MyminifactorySessionExpiredError,
  resolveMyminifactoryDownload,
  resolveMyminifactoryLibraryDownload,
  resolveMyminifactoryObject,
} from "./api";
import { getUserMyminifactoryCookie, markMyminifactoryCookieRejected } from "./session";

const SESSION_CODE = MANIFESTS.myminifactory.errorCodes.session;
const BLOCKED =
  "MyMiniFactory blocked the file download (rate limit or Cloudflare challenge). This usually clears after a while -- wait, then retry the same import.";
const MISSING = "This MyMiniFactory object could not be found, or isn't public.";
const CONNECT =
  "Connect your MyMiniFactory account in Configuration > Providers (or visit myminifactory.com with Thingport Grab), then import it again.";
/** Every model file is its own request; spaced out a little, as the site's own pages would be. */
const FILE_DELAY_MS = 500;

type MyminifactoryObject = ResolvedModel & { paid: boolean; archives: boolean };

/** One signed MyMiniFactory download, unpacked into model files when it's a zip. */
async function downloadFile(url: string, kit: ImportKit, suggestedName?: string): Promise<NewPlateInput[]> {
  const name = suggestedName ?? decodeURIComponent(new URL(url).pathname.split("/").pop() || "myminifactory-file");
  return (await kit.downloadSignedFile({ url, name }, isMyminifactoryFileHost, BLOCKED)) ?? [];
}

/** As the user, from their MyMiniFactory library: what Thingport can't download anonymously. */
async function downloadFromLibrary(
  userId: string,
  objectId: string,
  paid: boolean,
  kit: ImportKit,
): Promise<NewPlateInput[]> {
  const cookie = await getUserMyminifactoryCookie(userId);
  if (!cookie) {
    throw new HttpError(
      403,
      paid
        ? `This is a paid MyMiniFactory model, so it downloads only from the account that bought it. ${CONNECT}`
        : `This MyMiniFactory model downloads only when signed in. ${CONNECT}`,
    );
  }
  const isModel = (name: string) => kit.isModelFile(name) || path.extname(name).toLowerCase() === ".zip";
  const downloaded: NewPlateInput[] = [];
  try {
    const files = await listMyminifactoryLibraryFiles(objectId, cookie, isModel);
    if (!files) {
      throw new HttpError(
        403,
        paid
          ? "This paid MyMiniFactory model isn't in your library: buy it on MyMiniFactory first, with the account connected to Thingport."
          : "MyMiniFactory doesn't let your account download this model.",
      );
    }
    for (const file of files) {
      await maybeSleep(FILE_DELAY_MS);
      const url = await resolveMyminifactoryLibraryDownload(file.path, cookie);
      if (url) downloaded.push(...(await downloadFile(url, kit, file.name)));
    }
    if (!downloaded.length && files.length) {
      throw new HttpError(
        400,
        files.every((file) => !isModel(file.name))
          ? "This model's files are in an archive Thingport can't open (such as RAR), and MyMiniFactory hasn't unpacked it."
          : "Couldn't download this model's files from your MyMiniFactory library. Try again later.",
      );
    }
    return downloaded;
  } catch (err) {
    await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
    if (err instanceof MyminifactorySessionExpiredError) {
      await markMyminifactoryCookieRejected(userId);
      throw new HttpError(400, err.message, SESSION_CODE);
    }
    throw err;
  }
}

/** Metadata from the API (the instance's key). Files from /download when anyone may have them: one file, or a zip
 *  whose model files each become a plate; else, paid and login-only ones, from the user's own library. */
export const myminifactoryImport: SourcedImport<string, MyminifactoryObject> = {
  async requireAuth() {
    const apiKey = await getMyminifactoryApiKey();
    if (!apiKey) {
      throw new HttpError(
        503,
        "MyMiniFactory import isn't configured for this instance yet -- ask an admin to add an API key in Administration > Providers.",
      );
    }
    return apiKey;
  },
  resolveModel: (objectId, apiKey) => resolveMyminifactoryObject(objectId, apiKey),
  async mapError(_userId, err) {
    if (err instanceof MyminifactoryRateLimitError) return new HttpError(429, err.message);
    // 400, not 401: see tryMakerworldCloudApi.
    if (err instanceof MyminifactoryAuthError) return new HttpError(400, err.message);
    return err;
  },
  missingMessage: MISSING,
  noFilesMessage: "This MyMiniFactory object has no model files Thingport can import.",
  async downloadModel({ userId, externalId }, object, _apiKey, _requested, kit) {
    // Paid models, and free ones whose files are archives, only download as the user, from their library.
    const anonymous = object.paid || object.archives ? null : await resolveMyminifactoryDownload(externalId);
    if (anonymous?.kind === "missing") throw new HttpError(404, MISSING);
    return anonymous?.kind === "file"
      ? downloadFile(anonymous.url, kit)
      : downloadFromLibrary(userId, externalId, object.paid, kit);
  },
};
