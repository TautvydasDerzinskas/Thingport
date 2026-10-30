// Toymakr3D's bundle: this folder, providers/toymakr3d/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/toymakr3d/ and Grab's extension/src/providers/toymakr3d/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.

import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import { MANIFESTS } from "../index.generated";
import { detailsOf } from "../details";
import type { ProviderDetails, ProviderList, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import {
  fetchToymakr3dLikes,
  fetchToymakr3dPopular,
  isToymakr3dFileHost,
  isToymakr3dLikesUrl,
  resolveToymakr3dDownload,
  resolveToymakr3dModel,
  TOYMAKR3D_LIKES_NAME,
  Toymakr3dAuthError,
  Toymakr3dPreparingError,
  Toymakr3dRateLimitError,
  type Toymakr3dModelResolution,
} from "./api";
import { getUserToymakr3dCookie, markToymakr3dSessionRejected, TOYMAKR3D_CONNECT } from "./session";

const SESSION_CODE = MANIFESTS.toymakr3d.errorCodes.session;
const RATE_LIMITED = "Toymakr3D rate-limited Thingport. Wait a while, then try again.";

/** Toymakr3D's errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function toymakr3dFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof Toymakr3dAuthError) {
    await markToymakr3dSessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof Toymakr3dRateLimitError) return new HttpError(429, err.message);
  // 409: nothing is wrong, the files just aren't built yet, so the same import works a minute later.
  if (err instanceof Toymakr3dPreparingError) return new HttpError(409, err.message);
  return err;
}

/** A model's details are anyone's to read, from its page; its files need the user's sign-in, the download page
 *  redirecting to a signed link to one zip of them all. */
export const toymakr3dImport: SourcedImport<string, Toymakr3dModelResolution> = {
  async requireAuth(userId) {
    const cookie = await getUserToymakr3dCookie(userId);
    if (!cookie) throw new HttpError(400, TOYMAKR3D_CONNECT, SESSION_CODE);
    return cookie;
  },
  resolveModel: (modelId) => resolveToymakr3dModel(modelId),
  mapError: toymakr3dFailure,
  missingMessage: "This Toymakr3D model could not be found, or isn't on sale any more.",
  noFilesMessage: "This Toymakr3D model has no files Thingport can import.",
  async downloadModel(_target, resolved, cookie, _requested, kit) {
    const url = await resolveToymakr3dDownload(resolved.slug, cookie);
    const name = `${resolved.slug.replace(/-$/, "")}.zip`;
    return (await kit.downloadSignedFile({ url, name }, isToymakr3dFileHost, RATE_LIMITED)) ?? [];
  },
};

export const toymakr3dTrending: ProviderTrending = { fetch: (_userId, limit) => fetchToymakr3dPopular(limit) };

/** The user's liked products, the only list Toymakr3D has. */
async function likesOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  if (!isToymakr3dLikesUrl(url)) throw new HttpError(400, "Not a link to your Toymakr3D liked products");
  const cookie = await getUserToymakr3dCookie(userId);
  if (!cookie) throw new HttpError(400, TOYMAKR3D_CONNECT, SESSION_CODE);
  try {
    const likes = await fetchToymakr3dLikes(cookie);
    return {
      title: TOYMAKR3D_LIKES_NAME,
      total: likes.total,
      truncated: likes.truncated,
      entries: likes.entries.map((entry) => ({ externalId: entry.modelId, title: entry.title, cover: entry.cover })),
    };
  } catch (err) {
    throw await toymakr3dFailure(userId, err);
  }
}

export const toymakr3dLists: ProviderLists = {
  async read(userId, url) {
    const list = await likesOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, "You haven't liked anything on Toymakr3D yet");
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,12}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await likesOf(userId, url);
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserToymakr3dCookie(userId))) throw new HttpError(503, TOYMAKR3D_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need. */
export const toymakr3dDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveToymakr3dModel(modelId)),
  missingMessage: toymakr3dImport.missingMessage,
  mapError: toymakr3dFailure,
};
