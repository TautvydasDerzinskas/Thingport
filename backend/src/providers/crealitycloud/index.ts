// Creality Cloud's bundle: this folder, providers/crealitycloud/ at the repository's root (its manifest and links,
// which all three packages share), the app's frontend/src/providers/crealitycloud/ and Grab's
// extension/src/providers/crealitycloud/. Wired in by providers/registry.ts and providers/routes.ts here,
// frontend/src/providers/collectionTiles.ts in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type {
  ImportKit,
  SourcedImport,
  ProviderTrending,
  ProviderList,
  ProviderLists,
  ProviderDetails,
} from "../types";
import { MANIFESTS } from "../index.generated";
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
  isCrealitycloudModelId,
  selectCrealitycloudProfiles,
  fetchCrealitycloudRecommended,
  CREALITYCLOUD_LIKES_NAME,
  fetchCrealitycloudCollection,
  fetchCrealitycloudLikes,
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
} from "./api";
import { CREALITYCLOUD_CONNECT, getUserCrealitycloudAuth, markCrealitycloudSessionRejected } from "./session";
import { detailsOf } from "../details";

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
  async downloadModel(_target, resolved, auth, requested, kit) {
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
    download: (_target, resolved, profileId, auth, kit) => downloadProfile(resolved!, profileId, auth, kit),
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

export const crealitycloudTrending: ProviderTrending = {
  fetch: (_userId, limit) => fetchCrealitycloudRecommended(limit),
};

/** The user's likes, or a collection, from a Creality Cloud link. Likes are their owner's only; collections are read
 *  without a sign-in. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  try {
    const likes = parseCrealitycloudLikesUrl(url);
    let title: string;
    let listing: Awaited<ReturnType<typeof fetchCrealitycloudLikes>>;
    if (likes) {
      const auth = await getUserCrealitycloudAuth(userId);
      if (!auth) throw new HttpError(400, CREALITYCLOUD_CONNECT, SESSION_CODE);
      if (auth.userId !== likes.userId) {
        throw new HttpError(400, "Creality Cloud shows likes to their owner only, so only your own can be imported");
      }
      title = CREALITYCLOUD_LIKES_NAME;
      listing = await fetchCrealitycloudLikes(auth);
    } else {
      const parsed = parseCrealitycloudCollectionUrl(url);
      if (!parsed) throw new HttpError(400, "Not a link to a Creality Cloud collection or your likes");
      const collection = await fetchCrealitycloudCollection(parsed.collectionId);
      if (!collection) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
      title = collection.info.name;
      listing = collection;
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.modelId, title: e.title, cover: e.cover })),
    };
  } catch (err) {
    if (err instanceof CrealitycloudAuthError) {
      await markCrealitycloudSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, SESSION_CODE);
    }
    throw err;
  }
}

export const crealitycloudLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" is empty`);
    return list;
  },
  modelIds: z
    .array(
      z
        .string()
        .regex(/^[\w-]+$/)
        .max(200),
    )
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return {
      batch: {
        async ready() {
          if (!(await getUserCrealitycloudAuth(userId))) throw new HttpError(503, CREALITYCLOUD_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details read without a sign-in, which only their files need. */
export const crealitycloudDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveCrealitycloudModel(modelId)),
  missingMessage: MISSING,
};

// Creality Cloud model id -> the alias its print is kept under, so a status check asks the site once per model.
const crealitycloudAliases = new Map<string, string>();
const CREALITYCLOUD_ALIAS_CACHE_SIZE = 500;

/** The alias an import keeps a Creality Cloud model under; the id itself when the site can't tell. */
async function crealitycloudAliasOf(modelId: string): Promise<string> {
  const cached = crealitycloudAliases.get(modelId);
  if (cached) return cached;
  const alias = (await resolveCrealitycloudModel(modelId).catch(() => null))?.alias;
  if (!alias) return modelId;
  if (crealitycloudAliases.size >= CREALITYCLOUD_ALIAS_CACHE_SIZE) {
    crealitycloudAliases.delete(crealitycloudAliases.keys().next().value!);
  }
  crealitycloudAliases.set(modelId, alias);
  return alias;
}

/** The id an import keeps a model under: its alias, for a link by id. */
export async function crealitycloudKeptId(externalId: string): Promise<string> {
  return isCrealitycloudModelId(externalId) ? crealitycloudAliasOf(externalId) : externalId;
}
