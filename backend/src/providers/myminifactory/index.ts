// MyMiniFactory's bundle: this folder, providers/myminifactory/ at the repository's root (its manifest and links,
// which all three packages share), the app's frontend/src/providers/myminifactory/ and Grab's
// extension/src/providers/myminifactory/. Wired in by providers/registry.ts and providers/routes.ts here,
// frontend/src/providers/collectionTiles.ts in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - settings: its API key is the Setting row myminifactory_api_key (apiKey.ts), an instance-wide one.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../utils/fileUtils";
import { maybeSleep } from "../../utils/concurrency";
import { joinFolders } from "../../utils/fileFolder";
import type { NewPlateInput } from "../../services/printCreation";
import { getMyminifactoryApiKey } from "./apiKey";
import type {
  ImportKit,
  ProviderLists,
  ResolvedModel,
  SourcedImport,
  ProviderTrending,
  ProviderDetails,
  InstanceHealth,
} from "../types";
import { MANIFESTS } from "../index.generated";
import {
  fetchMyminifactoryArchives,
  fetchMyminifactoryCollectionObjects,
  isMyminifactoryFileHost,
  listMyminifactoryLibraryFiles,
  MyminifactoryAuthError,
  MyminifactoryRateLimitError,
  MyminifactorySessionExpiredError,
  parseMyminifactoryCollectionUrl,
  resolveMyminifactoryDownload,
  resolveMyminifactoryLibraryDownload,
  resolveMyminifactoryObject,
  fetchMyminifactoryPopular,
  checkMyminifactoryApiKey,
} from "./api";
import { getUserMyminifactoryCookie, markMyminifactoryCookieRejected } from "./session";
import { detailsOf } from "../details";

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

const ARCHIVE_FAILED = "MyMiniFactory didn't hand over one of this model's archives. Try the import again in a while.";

/** A free object's archives, as anyone may download them from its page's Download button, each unpacked into its
 *  model files (each in a folder named after it when there are several). Null when they aren't for anyone: an
 *  archive the button sends to a sign-in, or archives Thingport can't open (RAR), which come from the user's library
 *  instead, where MyMiniFactory has unpacked them. Throws when one doesn't download, rather than make a model of the
 *  rest: a later import would find it and never fetch what's missing. */
async function downloadFreeArchives(objectId: string, kit: ImportKit): Promise<NewPlateInput[] | null> {
  const archives = await fetchMyminifactoryArchives(objectId);
  const zips = archives.filter((archive) => /\.zip$/i.test(archive.name));
  if (!zips.length || zips.length < archives.length) return null;
  const downloaded: NewPlateInput[] = [];
  const discard = () =>
    Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
  try {
    for (const archive of zips) {
      const download = await resolveMyminifactoryDownload(objectId, archive.id);
      if (download.kind !== "file") {
        await discard();
        return null;
      }
      await maybeSleep(FILE_DELAY_MS);
      const folder = zips.length > 1 ? archive.name.replace(/\.zip$/i, "") : null;
      // Null when it didn't download at all, as against a zip with nothing in it worth importing.
      const inputs = await kit.downloadSignedFile(
        { url: download.url, name: archive.name },
        isMyminifactoryFileHost,
        BLOCKED,
      );
      if (inputs === null) throw new HttpError(502, ARCHIVE_FAILED);
      downloaded.push(...inputs.map((input) => ({ ...input, folder: joinFolders(folder, input.folder) })));
    }
  } catch (err) {
    await discard();
    throw err;
  }
  if (downloaded.some((input) => kit.isModelFile(input.filename))) return downloaded;
  await discard();
  return null;
}

/** Whether `err` says MyMiniFactory is turning requests away for now, which holds for the user's library too. */
const isRateLimit = (err: unknown) =>
  err instanceof MyminifactoryRateLimitError || (err instanceof HttpError && err.status === 429);

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
  // Scripts come too, so a model published with the .scad it was generated from arrives generative.
  const isWanted = (name: string) => kit.isImportableFile(name) || path.extname(name).toLowerCase() === ".zip";
  const downloaded: NewPlateInput[] = [];
  try {
    const files = await listMyminifactoryLibraryFiles(objectId, cookie, isWanted);
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
      if (url) {
        const inputs = await downloadFile(url, kit, file.name);
        downloaded.push(...inputs.map((input) => ({ ...input, folder: joinFolders(file.folder, input.folder) })));
      }
    }
    if (!downloaded.length && files.length) {
      throw new HttpError(
        400,
        files.every((file) => !isWanted(file.name))
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
async function requireApiKey(): Promise<string> {
  const apiKey = await getMyminifactoryApiKey();
  if (!apiKey) {
    throw new HttpError(
      503,
      "MyMiniFactory import isn't configured for this instance yet -- ask an admin to add an API key in Administration > Providers.",
    );
  }
  return apiKey;
}

export const myminifactoryImport: SourcedImport<string, MyminifactoryObject> = {
  requireAuth: () => requireApiKey(),
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
    // A free model's archives are anyone's to download, as its page offers them; paid models, and free ones whose
    // archives aren't, download as the user, from their library.
    if (!object.paid && object.archives) {
      let free: NewPlateInput[] | null;
      try {
        free = await downloadFreeArchives(externalId, kit);
      } catch (err) {
        // The library may have them where the page didn't answer, for someone signed in; without a sign-in, what
        // went wrong is the answer, not a request to sign in.
        if (isRateLimit(err) || !(await getUserMyminifactoryCookie(userId))) throw err;
        free = null;
      }
      return free ?? downloadFromLibrary(userId, externalId, false, kit);
    }
    const anonymous = object.paid ? null : await resolveMyminifactoryDownload(externalId);
    if (anonymous?.kind === "missing") throw new HttpError(404, MISSING);
    return anonymous?.kind === "file"
      ? downloadFile(anonymous.url, kit)
      : downloadFromLibrary(userId, externalId, object.paid, kit);
  },
};

/** Read with the instance's API key. */
export const myminifactoryTrending: ProviderTrending = {
  async fetch(_userId, limit) {
    const key = await getMyminifactoryApiKey();
    return key ? fetchMyminifactoryPopular(limit, key) : "myminifactoryKey";
  },
};

function collectionOf(url: string): { username: string; slug: string } {
  const parsed = parseMyminifactoryCollectionUrl(url);
  if (!parsed) throw new HttpError(400, "Not a MyMiniFactory collection URL");
  return parsed;
}

/** Collections, read with the instance's API key; their paid models are left out. */
export const myminifactoryLists: ProviderLists = {
  async read(_userId, url) {
    const { username, slug } = collectionOf(url);
    const apiKey = await requireApiKey();
    let listing: Awaited<ReturnType<typeof fetchMyminifactoryCollectionObjects>>;
    try {
      listing = await fetchMyminifactoryCollectionObjects(username, slug, apiKey);
    } catch (err) {
      if (err instanceof MyminifactoryRateLimitError) throw new HttpError(429, err.message);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      if (err instanceof MyminifactoryAuthError) throw new HttpError(400, err.message);
      throw err;
    }
    if (listing && !listing.entries.length && listing.paid) {
      throw new HttpError(
        400,
        "Every model in this collection is paid, and Thingport can import MyMiniFactory's free models only.",
      );
    }
    if (!listing?.entries.length) throw new HttpError(400, "Could not load this collection's models");
    return {
      title: listing.title,
      total: listing.entries.length,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({ externalId: e.objectId, title: e.title, cover: e.cover })),
    };
  },
  async start(_userId, url) {
    const { username, slug } = collectionOf(url);
    return {
      batch: {
        ready: async () => void (await requireApiKey()),
        title: async () =>
          (await fetchMyminifactoryCollectionObjects(username, slug, await requireApiKey(), 1).catch(() => null))
            ?.title ?? `MyMiniFactory Collection ${slug}`,
      },
    };
  },
  rateLimitText: "blocked by MyMiniFactory's rate-limit protection — wait a while, then retry",
  authText: "failed because the configured API key was rejected",
};

/** Read with the instance's API key, as its imports are. */
export const myminifactoryDetails: ProviderDetails = {
  read: async (_userId, objectId) => detailsOf(await resolveMyminifactoryObject(objectId, await requireApiKey())),
  missingMessage: MISSING,
  mapError: myminifactoryImport.mapError,
};

/** The instance's API key, tested against the API. */
export async function myminifactoryInstanceHealth(): Promise<InstanceHealth> {
  const apiKey = await getMyminifactoryApiKey();
  return apiKey ? checkMyminifactoryApiKey(apiKey) : "not_configured";
}
