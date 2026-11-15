// Snapmaker Space's bundle: this folder, providers/snapmaker/ at the repository's root (its manifest and links, which
// all three packages share), the app's frontend/src/providers/snapmaker/ and Grab's
// extension/src/providers/snapmaker/. Wired in by providers/registry.ts and providers/routes.ts here,
// frontend/src/providers/collectionTiles.ts in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - Grab: content/panels/batch.ts switches between its likes and bookmarks, which share one page, within every
//   provider's batch panel (shared/urls.ts reads which); scripts/manifest.ts asks for the alarms permission its sign-
//   in's renewal needs.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type { ImportKit, SourcedImport, ProviderTrending, ProviderLists, ProviderDetails } from "../types";
import { MANIFESTS } from "../index.generated";
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
  fetchSnapmakerFeatured,
  fetchSnapmakerList,
  parseSnapmakerListUrl,
  snapmakerListName,
  snapmakerSiteIdOf,
} from "./api";
import {
  getSnapmakerConnection,
  getUserSnapmakerToken,
  markSnapmakerTokenRejected,
  snapmakerConnectText,
} from "./session";
import { detailsOf } from "../details";
import { regionalId } from "../index.generated";

const SESSION_CODE = MANIFESTS.snapmaker.errorCodes.session;
const BLOCKED =
  "Snapmaker blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";
const MISSING = "This Snapmaker model could not be found, or isn't public.";

/** One of a Snapmaker model's signed files; a zip is unpacked into its model files. Null when it didn't download. */
function downloadFile(file: SnapmakerFile, kit: ImportKit): Promise<NewPlateInput[] | null> {
  return kit.downloadSignedFile(file, isSnapmakerFileHost, BLOCKED);
}

/** Downloads one print profile's 3MF, tagged with the profile; null when the profile isn't among the downloads.
 *  `externalId` is the id Thingport keeps, and `token` its site's. */
async function downloadProfile(
  externalId: string,
  profileId: string,
  token: string,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const downloads = await fetchSnapmakerDownloads(externalId, token);
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
 *  its model files instead. Files only download as the user, so everything needs their sign-in on the model's site. */
export const snapmakerImport: SourcedImport<string, SnapmakerModelResolution> = {
  async requireAuth(userId, externalId) {
    const { region } = snapmakerSiteIdOf(externalId);
    const token = await getUserSnapmakerToken(userId, region);
    if (!token) throw new HttpError(400, snapmakerConnectText(region), SESSION_CODE);
    return token;
  },
  resolveModel: (externalId) => resolveSnapmakerModel(externalId),
  async mapError(userId, err, token) {
    if (err instanceof SnapmakerAuthError) {
      await markSnapmakerTokenRejected(userId, token, err.region);
      // 400, not 401: see tryMakerworldCloudApi.
      return new HttpError(400, err.message, SESSION_CODE);
    }
    return err;
  },
  missingMessage: MISSING,
  noFilesMessage: "This Snapmaker model has no files Thingport can import.",
  async downloadModel({ externalId }, resolved, token, requested, kit) {
    const downloaded: NewPlateInput[] = [];
    try {
      const [profileId] = selectSnapmakerProfiles(resolved, "url", requested);
      if (profileId) {
        const profile = await downloadProfile(externalId, profileId, token, kit);
        if (profile) downloaded.push(profile);
      }
      if (!downloaded.length) {
        const downloads = await fetchSnapmakerDownloads(externalId, token);
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
      const externalId = regionalId(parsed.region, parsed.modelId);
      const resolved = await resolveSnapmakerModel(externalId);
      if (!resolved) throw new HttpError(404, MISSING);
      const profileIds = selectSnapmakerProfiles(resolved, scope, parsed.requestedProfileId);
      if (!profileIds.length) throw new HttpError(400, "This model has no print profiles to import");
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => snapmakerModelUrl(externalId, profileId)),
      };
    },
  },
};

/** Its homepage's featured models: the China site's for someone signed in there and not on the main site, who's likely
 *  in China and sees that one there, else the main site's. */
export const snapmakerTrending: ProviderTrending = {
  async region(userId) {
    const [main, china] = await Promise.all([getSnapmakerConnection(userId), getSnapmakerConnection(userId, "cn")]);
    return main === "disconnected" && china !== "disconnected" ? "cn" : null;
  },
  fetch: (_userId, limit, region) => fetchSnapmakerFeatured(limit, region),
};

/** The user's likes or bookmarks on a site, from a link Thingport Grab or the app made (`?tab=interactions&list=...`). */
function listOf(url: string) {
  const parsed = parseSnapmakerListUrl(url);
  if (!parsed?.list) throw new HttpError(400, "Not a link to your Snapmaker Space likes or bookmarks");
  return { list: parsed.list, region: parsed.region };
}

/** The user's own likes and bookmarks, read as them: Snapmaker shows them to their owner only. */
export const snapmakerLists: ProviderLists = {
  async read(userId, url) {
    const { list, region } = listOf(url);
    const token = await getUserSnapmakerToken(userId, region);
    if (!token) throw new HttpError(400, snapmakerConnectText(region), SESSION_CODE);
    let listing: Awaited<ReturnType<typeof fetchSnapmakerList>>;
    try {
      listing = await fetchSnapmakerList(list, token, undefined, region);
    } catch (err) {
      if (err instanceof SnapmakerAuthError) {
        await markSnapmakerTokenRejected(userId, token, region);
        // 400, not 401: the frontend treats any 401 as an expired Thingport session.
        throw new HttpError(400, err.message, SESSION_CODE);
      }
      throw err;
    }
    if (!listing.entries.length) throw new HttpError(400, `Your ${snapmakerListName(list, region)} are empty`);
    return {
      title: snapmakerListName(list, region),
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  },
  async start(userId, url) {
    const { list, region } = listOf(url);
    const name = snapmakerListName(list, region);
    return {
      batch: {
        async ready() {
          if (!(await getUserSnapmakerToken(userId, region))) throw new HttpError(503, snapmakerConnectText(region));
        },
        title: async () => name,
        label: () => `your ${name}`,
      },
    };
  },
};

/** Its models' details read without a sign-in, which only their files need. */
export const snapmakerDetails: ProviderDetails = {
  read: async (_userId, externalId) => detailsOf(await resolveSnapmakerModel(externalId)),
  missingMessage: MISSING,
};
