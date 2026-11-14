// QIDI Maker's bundle: this folder, providers/qidimaker/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/qidimaker/ and Grab's extension/src/providers/qidimaker/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ and extension/src/content/adapted/sites.ts in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - Its look for Download adapted's button, in extension/src/content/styles/adapted.scss with every site's.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import type { NewPlateInput } from "../../services/printCreation";
import type {
  ImportKit,
  ProviderDetails,
  ProviderList,
  ProviderLists,
  ProviderTrending,
  SourcedImport,
} from "../types";
import { MANIFESTS } from "../index.generated";
import { detailsOf } from "../details";
import {
  QIDIMAKER_LIKES_NAME,
  QidimakerAuthError,
  type QidimakerModelResolution,
  fetchQidimakerLikes,
  fetchQidimakerTrending,
  isQidimakerFileHost,
  parseQidimakerModelUrl,
  qidimakerListOf,
  qidimakerModelUrl,
  resolveQidimakerModel,
  selectQidimakerProfiles,
} from "./api";
import { readQidimakerCollection } from "./lists";
import { getUserQidimakerToken, markQidimakerSessionRejected, QIDIMAKER_CONNECT } from "./session";
import { repairZipDirectory } from "./zipRepair";

const SESSION_CODE = MANIFESTS.qidimaker.errorCodes.session;
const BLOCKED =
  "QIDI Maker blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** One print profile's 3MF, tagged with the profile; null when the model has no such profile. */
async function downloadProfile(
  resolved: QidimakerModelResolution,
  profileId: string,
  kit: ImportKit,
): Promise<NewPlateInput | null> {
  const profile = resolved.profiles.find((p) => p.id === profileId);
  if (!profile) return null;
  const inputs = await kit.downloadSignedFile(profile, isQidimakerFileHost, BLOCKED);
  if (!inputs?.length)
    throw new HttpError(400, "Couldn't download this print profile from QIDI Maker. Try again later.");
  // A profile is one 3MF; anything else it unpacked to is dropped.
  await Promise.all(inputs.slice(1).map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  return { ...inputs[0], sourceInstanceId: profileId };
}

// The names the site gives the files it zips up: the day they were uploaded and a hash, the designer's own names lost.
const UPLOAD_NAME = /^\d{4}-\d{2}-\d{2}_[0-9a-f]{8,}$/i;

/** The model's files named after it, where the site's zip has them only by when they were uploaded: "Clip.stl",
 *  "Clip (2).stl". Names a designer gave them, inside an archive of their own, stay. */
export function namedAfterModel(inputs: NewPlateInput[], title: string): NewPlateInput[] {
  const taken = new Map<string, number>();
  return inputs.map((input) => {
    const ext = path.extname(input.filename);
    if (!UPLOAD_NAME.test(path.basename(input.filename, ext))) return input;
    const key = `${input.folder ?? ""}\0${ext.toLowerCase()}`;
    const count = (taken.get(key) ?? 0) + 1;
    taken.set(key, count);
    return { ...input, filename: `${title}${count > 1 ? ` (${count})` : ""}${ext}` };
  });
}

/** The model's own files, from the zip of them the site makes, which only a model without print profiles needs. The
 *  site writes most of them without the directory a zip reader needs (zipRepair.ts), so it's put back first. */
async function downloadModelFiles(resolved: QidimakerModelResolution, kit: ImportKit): Promise<NewPlateInput[]> {
  const zip = resolved.filesZip;
  if (!zip || !isQidimakerFileHost(new URL(zip.url).hostname)) return [];
  const result = await kit.downloadFile(zip.url, zip.name);
  if (result && "rateLimited" in result) throw new HttpError(429, BLOCKED);
  const zipPath = result?.input.tempFilePath;
  if (!zipPath) return [];
  try {
    try {
      await repairZipDirectory(zipPath);
    } catch {
      throw new HttpError(400, "QIDI Maker's zip of this model's files can't be opened. Try again later.");
    }
    // Loaded when it's needed: the import service loads the providers' registry, which loads this module.
    const { modelFilesFromZip, parametricSourcesFromZip } = await import("../../services/importService");
    const plates = await modelFilesFromZip(zipPath);
    let sources: NewPlateInput[];
    try {
      sources = await parametricSourcesFromZip(zipPath);
    } catch (err) {
      await Promise.all(plates.map((plate) => fs.rm(plate.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return namedAfterModel([...plates, ...sources], resolved.meta.title ?? resolved.modelId);
  } finally {
    await fs.rm(zipPath, { force: true }).catch(() => undefined);
  }
}

/** A model is one print, and each print profile, a QIDI Studio project, its 3MF on a plate of its own, tagged with the
 *  profile. An import brings the profile the link names, else the designer's first; a model without profiles brings
 *  its own files. Everything is public, on the site's CDN, so nothing needs a sign-in. */
export const qidimakerImport: SourcedImport<null, QidimakerModelResolution> = {
  requireAuth: async () => null,
  resolveModel: (modelId) => resolveQidimakerModel(modelId),
  mapError: async (_userId, err) => err,
  missingMessage: "This QIDI Maker model could not be found, or isn't public.",
  noFilesMessage: "This QIDI Maker model has no files Thingport can import.",
  async downloadModel(_target, resolved, _auth, requested, kit) {
    const [profileId] = selectQidimakerProfiles(resolved, "url", requested);
    const profile = profileId ? await downloadProfile(resolved, profileId, kit) : null;
    return profile ? [profile] : downloadModelFiles(resolved, kit);
  },
  profiles: {
    download: (_target, resolved, profileId, _auth, kit) => downloadProfile(resolved!, profileId, kit),
    missingMessage: "This QIDI Maker model has no such print profile.",
    // Every profile's file is named after the model, so several on one print are named after their profiles.
    namedAlike: true,
    async listUrls(url, scope) {
      const parsed = parseQidimakerModelUrl(url);
      if (!parsed) throw new HttpError(400, "Not a QIDI Maker model link");
      const resolved = await resolveQidimakerModel(parsed.modelId);
      if (!resolved) throw new HttpError(404, qidimakerImport.missingMessage);
      // None for a model without profiles: a queued link of it imports its own files, a job for its profiles fails.
      const profileIds = selectQidimakerProfiles(resolved, scope, parsed.requestedProfileId);
      return {
        title: resolved.meta.title ?? null,
        urls: profileIds.map((profileId) => qidimakerModelUrl(resolved.modelId, profileId)),
      };
    },
  },
};

export const qidimakerTrending: ProviderTrending = { fetch: (_userId, limit) => fetchQidimakerTrending(limit) };

/** The user's likes, or a collection, from its link. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const list = qidimakerListOf(url);
  if (!list) throw new HttpError(400, "Not a link to a QIDI Maker collection, or to your likes");
  if ("likes" in list) {
    const token = await getUserQidimakerToken(userId);
    if (!token) throw new HttpError(400, QIDIMAKER_CONNECT, SESSION_CODE);
    try {
      const likes = await fetchQidimakerLikes(token);
      return { ...likes, title: QIDIMAKER_LIKES_NAME, entries: entriesOf(likes.entries) };
    } catch (err) {
      if (err instanceof QidimakerAuthError) {
        await markQidimakerSessionRejected(userId, token);
        // 400, not 401: the frontend treats any 401 as an expired Thingport session.
        throw new HttpError(400, err.message, SESSION_CODE);
      }
      throw err;
    }
  }
  const collection = await readQidimakerCollection(userId, list.collectionId);
  if (collection === "signIn") {
    throw new HttpError(
      400,
      "That collection can't be found, or it's private: if it's one of yours, connect QIDI Maker first, or visit it " +
        "with Thingport Grab.",
      SESSION_CODE,
    );
  }
  if (!collection)
    throw new HttpError(404, "That collection can't be found. It may have been deleted, or made private.");
  return { ...collection, title: collection.info.name, entries: entriesOf(collection.entries) };
}

function entriesOf(entries: { modelId: string; title: string; cover: string | null }[]) {
  return entries.map((entry) => ({ externalId: entry.modelId, title: entry.title, cover: entry.cover }));
}

export const qidimakerLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" is empty`);
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,20}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return { batch: { title: async () => title } };
  },
};

/** Its models' details, which need no sign-in. */
export const qidimakerDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveQidimakerModel(modelId)),
  missingMessage: qidimakerImport.missingMessage,
};
