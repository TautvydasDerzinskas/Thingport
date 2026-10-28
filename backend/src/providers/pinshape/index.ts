// Pinshape's bundle: this folder, providers/pinshape/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/pinshape/ and Grab's extension/src/providers/pinshape/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - How its likes are named after whose they are, by its profile addresses (`/users/<id>-<name>`), in
//   syncLikesUsername (providers/names.ts), which reads every provider's.

import fs from "node:fs/promises";
import { z } from "zod";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { MANIFESTS } from "../index.generated";
import { detailsOf } from "../details";
import type { ProviderDetails, ProviderList, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import {
  fetchPinshapeCollection,
  fetchPinshapeLikes,
  fetchPinshapePopular,
  isPinshapeFileHost,
  parsePinshapeCollectionUrl,
  parsePinshapeLikesUrl,
  PinshapeAuthError,
  PinshapeBlockedError,
  pinshapeLikesName,
  type PinshapeListing,
  type PinshapeModelResolution,
  PinshapeRateLimitError,
  resolvePinshapeDownload,
  resolvePinshapeModel,
} from "./api";
import { getUserPinshapeCookie, markPinshapeSessionRejected, PINSHAPE_CONNECT } from "./session";

const SESSION_CODE = MANIFESTS.pinshape.errorCodes.session;
const BLOCKED =
  "Pinshape blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** Pinshape's errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function pinshapeFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof PinshapeAuthError) {
    await markPinshapeSessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof PinshapeRateLimitError) return new HttpError(429, err.message);
  // Its own code, so a sync waits rather than failing the model.
  if (err instanceof PinshapeBlockedError) return new HttpError(403, err.message, CLOUDFLARE_BLOCKED_CODE);
  return err;
}

/** A model's details are anyone's to read, from its page; its files need the user's sign-in, each file's download
 *  link redirecting to a signed link to it. Its files one by one, or the zip of them all where it lists none. */
export const pinshapeImport: SourcedImport<string, PinshapeModelResolution> = {
  async requireAuth(userId) {
    const cookie = await getUserPinshapeCookie(userId);
    if (!cookie) throw new HttpError(400, PINSHAPE_CONNECT, SESSION_CODE);
    return cookie;
  },
  resolveModel: (modelId) => resolvePinshapeModel(modelId),
  mapError: pinshapeFailure,
  missingMessage: "This Pinshape model could not be found, or isn't public.",
  noFilesMessage: "This Pinshape model has no files Thingport can import.",
  async downloadModel(_target, resolved, cookie, _requested, kit) {
    if (!resolved.files.length && !resolved.zipPath && resolved.price) {
      throw new HttpError(403, `This is a paid Pinshape model (${resolved.price}): Thingport can't download it.`);
    }
    // Only what a plate takes, or a zip to unpack: no point asking for the rest.
    const wanted = resolved.files.filter((file) => kit.isImportableFile(file.name) || /\.zip$/i.test(file.name));
    const files =
      resolved.files.length || !resolved.zipPath
        ? wanted
        : [{ name: `pinshape-${resolved.modelId}.zip`, path: resolved.zipPath }];
    const downloaded: NewPlateInput[] = [];
    try {
      for (const file of files) {
        const url = await resolvePinshapeDownload(file.path, cookie);
        downloaded.push(
          ...((await kit.downloadSignedFile({ url, name: file.name }, isPinshapeFileHost, BLOCKED)) ?? []),
        );
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const pinshapeTrending: ProviderTrending = { fetch: (_userId, limit) => fetchPinshapePopular(limit) };

/** A collection, or someone's likes, from a Pinshape link; anyone's to read. A collection's first `maxItems`. */
async function listOf(url: string, maxItems?: number): Promise<ProviderList & { title: string }> {
  const likes = parsePinshapeLikesUrl(url);
  const collection = likes ? null : parsePinshapeCollectionUrl(url);
  if (!likes && !collection) throw new HttpError(400, "Not a link to a Pinshape collection or someone's likes");
  try {
    let title: string;
    let listing: PinshapeListing;
    if (likes) {
      const found = await fetchPinshapeLikes(likes.userId, likes.name);
      if (!found) throw new HttpError(404, "There's no such Pinshape user.");
      title = pinshapeLikesName(found.owner);
      listing = found;
    } else {
      const found = await fetchPinshapeCollection(collection!.collectionId, maxItems);
      if (!found) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
      title = found.info.name;
      listing = found;
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof PinshapeRateLimitError) throw new HttpError(429, err.message);
    if (err instanceof PinshapeBlockedError) throw new HttpError(503, err.message);
    throw err;
  }
}

export const pinshapeLists: ProviderLists = {
  async read(_userId, url) {
    const list = await listOf(url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models Thingport can import`);
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,12}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    // Only its title: the first page has it.
    const { title } = await listOf(url, 1);
    return {
      batch: {
        // Each model's import reads the sign-in itself.
        async ready() {
          if (!(await getUserPinshapeCookie(userId))) throw new HttpError(503, PINSHAPE_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need. */
export const pinshapeDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolvePinshapeModel(modelId)),
  missingMessage: pinshapeImport.missingMessage,
  mapError: pinshapeFailure,
};
