import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
import type { SourcedImport } from "../types";
import { MANIFESTS } from "../_generated";
import {
  Cults3dAuthError,
  Cults3dBlockedError,
  type Cults3dCredentials,
  type Cults3dModelResolution,
  Cults3dNoFreeDownloadError,
  Cults3dRateLimitError,
  Cults3dSessionError,
  fetchCults3dOrders,
  isCults3dFileHost,
  placeCults3dFreeOrder,
  resolveCults3dDownload,
  resolveCults3dModel,
} from "./api";
import {
  CULTS3D_CONNECT,
  CULTS3D_NO_CLEARANCE,
  CULTS3D_SIGN_IN,
  getUserCults3dBrowser,
  getUserCults3dCredentials,
  markCults3dApiRejected,
  markCults3dSessionRejected,
} from "./session";
import type { ProviderTrending } from "../types";
import { fetchCults3dPopular } from "./api";

const SESSION_CODE = MANIFESTS.cults3d.errorCodes.session;

function cults3dPaid(resolved: Cults3dModelResolution): HttpError {
  return new HttpError(
    403,
    `This is a paid Cults3D model (${resolved.priceText}), so it downloads only once bought. Buy it on Cults3D with ` +
      "the account connected to Thingport, then import it again.",
  );
}

/** Metadata from the API; the files from the user's Cults3D library, where every model they ordered, bought or free,
 *  stays. A free model not in it yet is ordered first, as its Download button does; a paid one is refused. The order
 *  and download pages need the browser's sign-in and clearance, which Thingport Grab sends. */
export const cults3dImport: SourcedImport<Cults3dCredentials, Cults3dModelResolution> = {
  async requireAuth(userId) {
    const credentials = await getUserCults3dCredentials(userId);
    if (!credentials) throw new HttpError(400, CULTS3D_CONNECT, SESSION_CODE);
    return credentials;
  },
  resolveModel: (slug, credentials) => resolveCults3dModel(slug, credentials),
  /** A rejected key or sign-in is remembered, so the app can say so. */
  async mapError(userId, err) {
    if (err instanceof Cults3dAuthError) {
      await markCults3dApiRejected(userId);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    if (err instanceof Cults3dSessionError) {
      await markCults3dSessionRejected(userId);
      return new HttpError(400, err.message, SESSION_CODE);
    }
    // Its own code, so a sync waits for the next visit with Grab rather than failing the model.
    if (err instanceof Cults3dBlockedError) return new HttpError(403, err.message, CLOUDFLARE_BLOCKED_CODE);
    if (err instanceof Cults3dRateLimitError) return new HttpError(429, err.message);
    if (err instanceof Cults3dNoFreeDownloadError) return new HttpError(403, err.message);
    return err;
  },
  missingMessage: "This Cults3D model could not be found, or isn't public.",
  noFilesMessage: "This Cults3D model has no files Thingport can import.",
  async downloadModel({ userId }, resolved, credentials, _requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      let downloadUrl = (await fetchCults3dOrders(credentials)).get(resolved.slug) ?? null;
      if (!downloadUrl && resolved.priceCents > 0) throw cults3dPaid(resolved);
      const browser = await getUserCults3dBrowser(userId);
      if (!browser) throw new HttpError(400, CULTS3D_SIGN_IN, SESSION_CODE);
      // Without it every site page is a Cloudflare challenge.
      if (!browser.clearance) throw new HttpError(400, CULTS3D_NO_CLEARANCE, SESSION_CODE);
      if (!downloadUrl) {
        await placeCults3dFreeOrder(resolved.slug, browser);
        downloadUrl = (await fetchCults3dOrders(credentials)).get(resolved.slug) ?? null;
        if (!downloadUrl) throw new HttpError(502, "Cults3D took the free order, but it isn't in your downloads yet.");
      }
      const file = await resolveCults3dDownload(downloadUrl, browser);
      downloaded.push(
        ...((await kit.downloadSignedFile(
          file,
          isCults3dFileHost,
          "Cults3D blocked the file download (rate limit). This usually clears after a while -- wait, then retry.",
        )) ?? []),
      );
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

/** Cults3D's API answers only the user's own key, so each user reads their own list. */
export const cults3dTrending: ProviderTrending = {
  async fetch(userId, limit) {
    const credentials = await getUserCults3dCredentials(userId);
    return credentials ? fetchCults3dPopular(limit, credentials) : "cults3dKey";
  },
  perUser: true,
};
