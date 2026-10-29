// GrabCAD's bundle: this folder, providers/grabcad/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/grabcad/ and Grab's extension/src/providers/grabcad/. Wired in by
// providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - How its likes are named after whose they are, by its member addresses (`/<member>/likes`), in syncLikesUsername
//   (providers/names.ts), which reads every provider's.

import fs from "node:fs/promises";
import { z } from "zod";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { MANIFESTS } from "../index.generated";
import { detailsOf } from "../details";
import type {
  ImportKit,
  ProviderDetails,
  ProviderList,
  ProviderLists,
  ProviderTrending,
  SourcedImport,
} from "../types";
import {
  fetchGrabcadFiles,
  fetchGrabcadLikes,
  fetchGrabcadPopular,
  GrabcadAuthError,
  grabcadLikesName,
  GrabcadRateLimitError,
  isGrabcadFileHost,
  parseGrabcadLikesUrl,
  resolveGrabcadFileUrl,
  resolveGrabcadModel,
  type GrabcadFile,
  type GrabcadModelResolution,
  type GrabcadSession,
} from "./api";
import { getUserGrabcadSession, GRABCAD_CONNECT, markGrabcadSessionRejected } from "./session";

const SESSION_CODE = MANIFESTS.grabcad.errorCodes.session;
const RATE_LIMITED = "GrabCAD rate-limited Thingport. Wait a while, then try again.";

/** GrabCAD's errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function grabcadFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof GrabcadAuthError) {
    await markGrabcadSessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof GrabcadRateLimitError) return new HttpError(429, err.message);
  return err;
}

// What its files' `system` says a zip holds, where that's something an import opens; a zip of a CAD system's own
// parts (SOLIDWORKS, Inventor, …) holds nothing it does, and an assembly's can run to hundreds of megabytes.
const OPENABLE_SYSTEMS = new Set(["stl", "step / iges", "obj", "wavefront obj", "3d manufacturing format", "other"]);

/** Which of a model's files to download: the ones a plate takes and the zips of formats it opens, first, and its OBJs
 *  and other zips only when those bring nothing. Most of its models are CAD parts, many with the same part as STEP,
 *  IGES, Parasolid and in their own CAD system's format, of which only the STEP imports. */
export function grabcadFilePicks(
  files: GrabcadFile[],
  kit: Pick<ImportKit, "isImportableFile">,
): { first: GrabcadFile[]; fallback: GrabcadFile[] } {
  const isObj = (file: GrabcadFile) => /\.obj$/i.test(file.name);
  const isZip = (file: GrabcadFile) => /\.zip$/i.test(file.name);
  const opens = (file: GrabcadFile) => !file.system || OPENABLE_SYSTEMS.has(file.system.toLowerCase());
  return {
    first: files.filter((file) => (kit.isImportableFile(file.name) && !isObj(file)) || (isZip(file) && opens(file))),
    fallback: files.filter((file) => isObj(file) || (isZip(file) && !opens(file))),
  };
}

async function download(
  files: GrabcadFile[],
  session: GrabcadSession,
  kit: ImportKit,
  into: NewPlateInput[],
): Promise<void> {
  for (const file of files) {
    const url = await resolveGrabcadFileUrl(file, session);
    into.push(...((await kit.downloadSignedFile({ url, name: file.name }, isGrabcadFileHost, RATE_LIMITED)) ?? []));
  }
}

/** A model's details and its file list are anyone's to read, from its API; downloading a file needs the user's
 *  sign-in, its download link answering them with where the file is. */
export const grabcadImport: SourcedImport<GrabcadSession, GrabcadModelResolution> = {
  async requireAuth(userId) {
    const session = await getUserGrabcadSession(userId);
    if (!session) throw new HttpError(400, GRABCAD_CONNECT, SESSION_CODE);
    return session;
  },
  resolveModel: (slug) => resolveGrabcadModel(slug),
  mapError: grabcadFailure,
  missingMessage: "This GrabCAD model could not be found, or isn't public.",
  noFilesMessage:
    "This GrabCAD model has no files Thingport can import: it takes STL, 3MF, STEP and OBJ files, not a CAD " +
    "system's own.",
  async downloadModel(_target, resolved, session, _requested, kit) {
    const files = await fetchGrabcadFiles(resolved.slug);
    if (files === null) throw new HttpError(404, grabcadImport.missingMessage);
    const { first, fallback } = grabcadFilePicks(files, kit);
    const downloaded: NewPlateInput[] = [];
    try {
      await download(first, session, kit, downloaded);
      if (!downloaded.some((input) => kit.isModelFile(input.filename)))
        await download(fallback, session, kit, downloaded);
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const grabcadTrending: ProviderTrending = { fetch: (_userId, limit) => fetchGrabcadPopular(limit) };

/** Someone's likes, from a GrabCAD link; anyone's to read. Their first `maxItems`. */
async function likesOf(url: string, maxItems?: number): Promise<ProviderList & { title: string }> {
  const likes = parseGrabcadLikesUrl(url);
  if (!likes) throw new HttpError(400, "Not a link to someone's GrabCAD likes");
  try {
    const found = await fetchGrabcadLikes(likes.member, maxItems);
    if (!found) throw new HttpError(404, "There's no such GrabCAD member.");
    return {
      title: grabcadLikesName(likes.member),
      total: found.total,
      truncated: found.truncated,
      entries: found.entries.map((entry) => ({ externalId: entry.slug, title: entry.title, cover: entry.cover })),
    };
  } catch (err) {
    if (err instanceof GrabcadRateLimitError) throw new HttpError(429, err.message);
    throw err;
  }
}

export const grabcadLists: ProviderLists = {
  async read(_userId, url) {
    const list = await likesOf(url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models yet`);
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^[a-z0-9_-]{1,200}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    // Only its title, which its link says.
    const likes = parseGrabcadLikesUrl(url);
    if (!likes) throw new HttpError(400, "Not a link to someone's GrabCAD likes");
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserGrabcadSession(userId))) throw new HttpError(503, GRABCAD_CONNECT);
        },
        title: async () => grabcadLikesName(likes.member),
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need. */
export const grabcadDetails: ProviderDetails = {
  read: async (_userId, slug) => detailsOf(await resolveGrabcadModel(slug)),
  missingMessage: grabcadImport.missingMessage,
  mapError: grabcadFailure,
};
