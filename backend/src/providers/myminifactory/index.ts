// MyMiniFactory's bundle: this folder, providers/myminifactory/ at the repository's root (its manifest and links,
// which all three packages share), the app's frontend/src/providers/myminifactory/ and Grab's
// extension/src/providers/myminifactory/. Wired in by providers/registry.ts and providers/routes.ts here,
// frontend/src/providers/collectionTiles.ts in the app, and the tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - prisma/schema.prisma: its User columns (myminifactoryCookie, myminifactoryRejectedAt, myminifactoryUsername) and
//   Category's myminifactoryCatIds, a column apiece until Phase 7 of docs/rfc/provider-modules.md moves them into
//   tables of their own. dto.ts, routes/categories.ts, services/categoryService.ts and seedData/defaultCategories.ts
//   name its category ids for the same reason.
// - settings: its API key is the Setting row myminifactory_api_key (apiKey.ts), an instance-wide one.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.

import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../../utils/fileUtils";
import { maybeSleep } from "../../utils/concurrency";
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
import { MANIFESTS } from "../_generated";
import {
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
  const isModel = (name: string) => kit.isModelFile(name) || path.extname(name).toLowerCase() === ".zip";
  const downloaded: NewPlateInput[] = [];
  try {
    const files = await listMyminifactoryLibraryFiles(objectId, cookie, isModel);
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
      if (url) downloaded.push(...(await downloadFile(url, kit, file.name)));
    }
    if (!downloaded.length && files.length) {
      throw new HttpError(
        400,
        files.every((file) => !isModel(file.name))
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
    // Paid models, and free ones whose files are archives, only download as the user, from their library.
    const anonymous = object.paid || object.archives ? null : await resolveMyminifactoryDownload(externalId);
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
  unavailable: { check: async () => ((await getMyminifactoryApiKey()) ? null : "myminifactory_no_key") },
  problemOf(err) {
    if (err instanceof MyminifactoryAuthError) return { problem: "myminifactory_key_rejected" };
    if (err instanceof MyminifactoryRateLimitError) return { problem: "myminifactory_rate_limited" };
    return null;
  },
};

/** The instance's API key, tested against the API. */
export async function myminifactoryInstanceHealth(): Promise<InstanceHealth> {
  const apiKey = await getMyminifactoryApiKey();
  return apiKey ? checkMyminifactoryApiKey(apiKey) : "not_configured";
}
