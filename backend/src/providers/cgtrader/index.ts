// CGTrader's bundle: this folder, providers/cgtrader/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/cgtrader/ and Grab's extension/src/providers/cgtrader/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - Getting a token for AWS's bot check from FlareSolverr, which takes the cookies FlareSolverr's browser ends up
//   with rather than the page: cookiesViaFlaresolverr in services/flaresolverr.ts.

import fs from "node:fs/promises";
import { z } from "zod";
import { CLOUDFLARE_BLOCKED_CODE } from "../../services/flaresolverr";
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
  CgtraderAuthError,
  CgtraderBlockedError,
  CgtraderDownloadLimitError,
  CgtraderRateLimitError,
  CGTRADER_LISTS,
  checkCgtraderDownloadLimit,
  fetchCgtraderFiles,
  fetchCgtraderList,
  fetchCgtraderProduct,
  fetchCgtraderTrending,
  isCgtraderFileHost,
  isCgtraderModelId,
  parseCgtraderListUrl,
  resolveCgtraderFileUrl,
  resolveCgtraderModel,
  type CgtraderFile,
  type CgtraderModelResolution,
  type CgtraderSession,
} from "./api";
import { CGTRADER_CONNECT, getUserCgtraderSession, markCgtraderSessionRejected } from "./session";

const { session: SESSION_CODE, downloadLimit: DOWNLOAD_LIMIT_CODE } = MANIFESTS.cgtrader.errorCodes;
const RATE_LIMITED = "CGTrader rate-limited Thingport. Wait a while, then try again.";

/** CGTrader's errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function cgtraderFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof CgtraderAuthError) {
    await markCgtraderSessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof CgtraderDownloadLimitError) return new HttpError(429, err.message, DOWNLOAD_LIMIT_CODE);
  if (err instanceof CgtraderRateLimitError) return new HttpError(429, err.message);
  // Its own code, so a sync waits rather than failing the model.
  if (err instanceof CgtraderBlockedError) return new HttpError(403, err.message, CLOUDFLARE_BLOCKED_CODE);
  return err;
}

// Archives Thingport can't open: a model whose files are only these has nothing it can import.
const UNOPENABLE_ARCHIVE = /\.(rar|7z|tar|gz|tgz)$/i;
// A zip its name says is of a format nothing prints from -- a CG model's Blender scene, its textures -- isn't worth
// downloading at all; it can run to gigabytes.
const NON_PRINT_ZIP =
  /(?:^|[\s._-])(blend|blender|fbx|max|3dsmax|c4d|maya|ma|mb|3ds|dae|gltf|glb|usdz?|skp|ztl|zbrush|unity|unitypackage|uasset|unreal|textures?)(?:[\s._-]|$)/i;

/** Which of a model's files to download: the ones a plate takes and the zips that may hold some, first, and its OBJs
 *  only when those bring nothing. A CG model comes with the same mesh in a dozen formats, its OBJ often the largest,
 *  and a print model with an STL has nothing to gain from it. */
export function cgtraderFilePicks(
  files: CgtraderFile[],
  kit: Pick<ImportKit, "isImportableFile">,
): { first: CgtraderFile[]; fallback: CgtraderFile[] } {
  const isObj = (file: CgtraderFile) => /\.obj$/i.test(file.name);
  const isZip = (file: CgtraderFile) => /\.zip$/i.test(file.name);
  return {
    first: files.filter(
      (file) =>
        (kit.isImportableFile(file.name) && !isObj(file)) ||
        (isZip(file) && !NON_PRINT_ZIP.test(file.name.replace(/\.zip$/i, ""))),
    ),
    fallback: files.filter(isObj),
  };
}

async function download(
  files: CgtraderFile[],
  auth: CgtraderSession,
  kit: ImportKit,
  into: NewPlateInput[],
): Promise<void> {
  for (const file of files) {
    const url = await resolveCgtraderFileUrl(file.path, auth);
    into.push(...((await kit.downloadSignedFile({ url, name: file.name }, isCgtraderFileHost, RATE_LIMITED)) ?? []));
  }
}

/** A model's details are anyone's to read, from its page; its files need the user's sign-in, each file's download
 *  redirecting to a signed link to it -- a free model's, or one they bought. */
export const cgtraderImport: SourcedImport<CgtraderSession, CgtraderModelResolution> = {
  async requireAuth(userId) {
    const session = await getUserCgtraderSession(userId);
    if (!session) throw new HttpError(400, CGTRADER_CONNECT, SESSION_CODE);
    return session;
  },
  resolveModel: (slug, auth) => resolveCgtraderModel(slug, auth),
  // A link by the model's number is kept under its slug, as every other link to it is.
  canonicalId: (resolved) => resolved.slug,
  mapError: cgtraderFailure,
  missingMessage: "This CGTrader model could not be found, or isn't on sale any more.",
  noFilesMessage: "This CGTrader model has no files Thingport can import.",
  async downloadModel(_target, resolved, auth, _requested, kit) {
    if (resolved.price && !resolved.purchased) {
      throw new HttpError(
        403,
        `This is a paid CGTrader model (${resolved.price}) you haven't bought: Thingport imports the ones you own.`,
      );
    }
    const files = await fetchCgtraderFiles(resolved.itemId, auth);
    if (files === null) throw new HttpError(404, cgtraderImport.missingMessage);
    const { first, fallback } = cgtraderFilePicks(files, kit);
    if (!first.length && !fallback.length && files.some((file) => UNOPENABLE_ARCHIVE.test(file.name))) {
      throw new HttpError(
        400,
        "This CGTrader model's files come only in archives Thingport can't open (.rar, .7z). Download them from " +
          "CGTrader and upload the models inside.",
      );
    }
    if (!first.length && !fallback.length) return [];
    // As the site asks before every download: its free downloads are limited.
    await checkCgtraderDownloadLimit(resolved.itemId, auth);
    const downloaded: NewPlateInput[] = [];
    try {
      await download(first, auth, kit, downloaded);
      if (!downloaded.some((input) => kit.isModelFile(input.filename))) await download(fallback, auth, kit, downloaded);
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

/** The slug a model is kept under, for a link that names it by its number. */
export async function cgtraderKeptId(externalId: string): Promise<string> {
  if (!isCgtraderModelId(externalId)) return externalId;
  const product = await fetchCgtraderProduct(externalId).catch(() => null);
  return product?.slug ?? externalId;
}

export const cgtraderTrending: ProviderTrending = { fetch: (_userId, limit) => fetchCgtraderTrending(limit) };

/** One of the user's own lists from its link: their liked models or their wishlist, read with their sign-in. */
async function listOf(userId: string, url: string, maxItems?: number): Promise<ProviderList & { title: string }> {
  const list = parseCgtraderListUrl(url);
  if (!list) throw new HttpError(400, "Not a link to your CGTrader liked models or wishlist");
  const session = await getUserCgtraderSession(userId);
  if (!session) throw new HttpError(400, CGTRADER_CONNECT, SESSION_CODE);
  try {
    const listing = await fetchCgtraderList(list, session, maxItems);
    return {
      title: CGTRADER_LISTS[list].name,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((entry) => ({ externalId: entry.slug, title: entry.title, cover: entry.cover })),
    };
  } catch (err) {
    throw await cgtraderFailure(userId, err);
  }
}

export const cgtraderLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `Your ${list.title} has no models yet`);
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,200}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    const list = parseCgtraderListUrl(url);
    if (!list) throw new HttpError(400, "Not a link to your CGTrader liked models or wishlist");
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserCgtraderSession(userId))) throw new HttpError(503, CGTRADER_CONNECT);
        },
        title: async () => CGTRADER_LISTS[list].name,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need -- though one the user has is sent, its
 *  bot-check token getting a CG model's page past the check where FlareSolverr isn't set up. */
export const cgtraderDetails: ProviderDetails = {
  read: async (userId, slug) => detailsOf(await resolveCgtraderModel(slug, await getUserCgtraderSession(userId))),
  missingMessage: cgtraderImport.missingMessage,
  mapError: cgtraderFailure,
};
