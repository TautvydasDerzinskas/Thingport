// Makerables' bundle: this folder, providers/makerables/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/makerables/ and Grab's extension/src/providers/makerables/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.

import fs from "node:fs/promises";
import { z } from "zod";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { detailsOf } from "../details";
import { MANIFESTS } from "../index.generated";
import type { ProviderDetails, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import {
  fetchMakerablesModelFiles,
  fetchMakerablesPopular,
  fetchMakerablesSaved,
  isMakerablesFileHost,
  isMakerablesProjectId,
  MAKERABLES_SAVED_NAME,
  MakerablesAuthError,
  MakerablesForbiddenError,
  MakerablesRateLimitError,
  type MakerablesModelResolution,
  parseMakerablesSavedUrl,
  resolveMakerablesProject,
} from "./api";
import {
  getUserMakerablesAccount,
  MAKERABLES_CONNECT,
  makerablesToken,
  markMakerablesSessionRejected,
} from "./session";

const SESSION_CODE = MANIFESTS.makerables.errorCodes.session;
const BLOCKED =
  "Makerables blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** Makerables' errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function makerablesFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof MakerablesAuthError) {
    await markMakerablesSessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof MakerablesRateLimitError) return new HttpError(429, err.message);
  if (err instanceof MakerablesForbiddenError) return new HttpError(403, err.message);
  return err;
}

/** A project is one print of its Model Files -- the CAD and mesh files it was cut from, which its page keeps on a tab
 *  of their own. They sit on Makerables' CDN open to anyone, so nothing about an import needs a sign-in. */
export const makerablesImport: SourcedImport<null, MakerablesModelResolution> = {
  requireAuth: async () => null,
  resolveModel: (projectId) => resolveMakerablesProject(projectId),
  // A link may name a project by its id; the slug its page gives as canonical is what it's kept under.
  canonicalId: (resolved) => resolved.slug,
  mapError: makerablesFailure,
  missingMessage: "This Makerables project could not be found, or isn't public.",
  noFilesMessage: "This Makerables project has no model files Thingport can import.",
  async downloadModel(_target, resolved, _auth, _requested, kit) {
    const files = await fetchMakerablesModelFiles(resolved.projectId);
    // Only what a plate takes, or a zip to unpack: its tab also holds pictures and the odd native CAD file.
    const wanted = files.filter((file) => kit.isImportableFile(file.name) || /\.zip$/i.test(file.name));
    const downloaded: NewPlateInput[] = [];
    try {
      for (const file of wanted) {
        downloaded.push(...((await kit.downloadSignedFile(file, isMakerablesFileHost, BLOCKED)) ?? []));
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

/** The id a project is kept under, for a link that names it by its id instead. A slug is already it, so only the
 *  rarer id form costs a call. */
export async function makerablesKeptId(externalId: string): Promise<string> {
  if (!isMakerablesProjectId(externalId)) return externalId;
  const resolved = await resolveMakerablesProject(externalId).catch(() => null);
  return resolved?.slug ?? externalId;
}

export const makerablesTrending: ProviderTrending = { fetch: (_userId, limit) => fetchMakerablesPopular(limit) };

/** The user's own saved projects, read with their sign-in; Makerables shows nobody else's. */
async function savedOf(userId: string, url: string) {
  const parsed = parseMakerablesSavedUrl(url);
  if (!parsed) throw new HttpError(400, "Not a link to someone's saved Makerables projects");
  const connected = await getUserMakerablesAccount(userId);
  if (!connected) throw new HttpError(400, MAKERABLES_CONNECT, SESSION_CODE);
  if (connected.account.userId.toUpperCase() !== parsed.userId.toUpperCase()) {
    throw new HttpError(400, "Makerables shows saved projects to their owner only: this list is someone else's.");
  }
  const token = await makerablesToken(userId, connected.cookie);
  return fetchMakerablesSaved(connected.account.userId, token);
}

export const makerablesLists: ProviderLists = {
  async read(userId, url) {
    let listing;
    try {
      listing = await savedOf(userId, url);
    } catch (err) {
      throw await makerablesFailure(userId, err);
    }
    if (!listing.entries.length) throw new HttpError(400, `"${MAKERABLES_SAVED_NAME}" is empty`);
    return {
      title: MAKERABLES_SAVED_NAME,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((entry) => ({ externalId: entry.slug, title: entry.title, cover: entry.cover })),
    };
  },
  modelIds: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9][\w.-]{0,150}$/i)
        .transform((id) => id.toLowerCase()),
    )
    .min(1)
    .max(1000),
  async start(userId, url) {
    if (!parseMakerablesSavedUrl(url)) throw new HttpError(400, "Not a link to someone's saved Makerables projects");
    return {
      batch: {
        async ready() {
          if (!(await getUserMakerablesAccount(userId))) throw new HttpError(503, MAKERABLES_CONNECT);
        },
        title: async () => MAKERABLES_SAVED_NAME,
      },
    };
  },
};

/** Its projects are anyone's to read, files and all. */
export const makerablesDetails: ProviderDetails = {
  read: async (_userId, projectId) => detailsOf(await resolveMakerablesProject(projectId)),
  missingMessage: makerablesImport.missingMessage,
  mapError: makerablesFailure,
};
