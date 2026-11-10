// 3DExport's bundle: this folder, providers/threedexport/ at the repository's root (its manifest and links, which all
// three packages share), the app's frontend/src/providers/threedexport/ and Grab's extension/src/providers/threedexport/.
// Wired in by providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
// extension/src/providers/ in Grab.
//
// Outside them, and why:
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
// - Its category names, in frontend/src/components/categoryMapping/providerCategories.json with every provider's.
// - Its licences, in services/licenseCatalog.ts with every site's own.

import fs from "node:fs/promises";
import { z } from "zod";
import type { NewPlateInput } from "../../services/printCreation";
import { HttpError } from "../../utils/fileUtils";
import { detailsOf } from "../details";
import { MANIFESTS } from "../index.generated";
import type {
  ImportKit,
  ProviderDetails,
  ProviderList,
  ProviderLists,
  ProviderTrending,
  SourcedImport,
} from "../types";
import {
  fetchThreedexportCollection,
  fetchThreedexportDefault,
  fetchThreedexportTrending,
  isThreedexportDefaultUrl,
  isThreedexportFileHost,
  parseThreedexportCollectionUrl,
  resolveThreedexportDownload,
  resolveThreedexportModel,
  ThreedexportAuthError,
  type ThreedexportCollection,
  type ThreedexportFile,
  threedexportFilePicks,
  type ThreedexportModelResolution,
  threedexportPriceText,
  ThreedexportRateLimitError,
  type ThreedexportVisit,
  threedexportVisit,
} from "./api";
import { getUserThreedexportSession, THREEDEXPORT_CONNECT, threedexportRejection } from "./session";

const SESSION_CODE = MANIFESTS.threedexport.errorCodes.session;
const RATE_LIMITED = "3DExport rate-limited Thingport. Wait a while, then try again.";

/** 3DExport's errors as the HttpErrors an import reports. A turned-down sign-in is remembered as such, only while it's
 *  still the one stored (`threedexportRejection`), so the app can say so. */
async function threedexportFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof ThreedexportAuthError) {
    const reported = await threedexportRejection(userId, null, err);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return reported === err ? new HttpError(400, err.message, SESSION_CODE) : reported;
  }
  if (err instanceof ThreedexportRateLimitError) return new HttpError(429, err.message);
  return err;
}

async function download(
  files: ThreedexportFile[],
  visit: ThreedexportVisit,
  kit: ImportKit,
  into: NewPlateInput[],
): Promise<void> {
  for (const file of files) {
    const url = await resolveThreedexportDownload(file, visit);
    const name = new URL(url).pathname.split("/").pop() || `3dexport-${file.ext ?? "files"}.zip`;
    into.push(...((await kit.downloadSignedFile({ url, name }, isThreedexportFileHost, RATE_LIMITED)) ?? []));
  }
}

/** A model's page, read with the user's sign-in, links each of its formats' downloads when it's free or theirs: a zip
 *  of that format's files, each from a signed link. The formats a plate takes come first, an OBJ or GLB only when
 *  those bring nothing. A paid model they haven't bought links none, and is refused: Thingport never buys anything. */
export const threedexportImport: SourcedImport<ThreedexportVisit, ThreedexportModelResolution> = {
  async requireAuth(userId) {
    const session = await getUserThreedexportSession(userId);
    if (!session) throw new HttpError(400, THREEDEXPORT_CONNECT, SESSION_CODE);
    return threedexportVisit(session);
  },
  resolveModel: (itemId, visit) => resolveThreedexportModel(itemId, visit),
  mapError: threedexportFailure,
  missingMessage: "This 3DExport model could not be found, or isn't on sale any more.",
  noFilesMessage:
    "This 3DExport model has no files Thingport can import: none of its formats is one a slicer or LightBurn opens " +
    "(STL, 3MF, STEP, LightBurn, OBJ or GLB).",
  async downloadModel(_target, resolved, visit, _requested, kit) {
    if (!resolved.files.length) {
      if (resolved.price > 0) {
        throw new HttpError(
          403,
          `This is a paid 3DExport model (${threedexportPriceText(resolved.price)}) you haven't bought: Thingport ` +
            "imports the ones you own. Buy it on 3dexport.com first.",
        );
      }
      return [];
    }
    const { first, fallback } = threedexportFilePicks(resolved.files);
    const downloaded: NewPlateInput[] = [];
    try {
      await download(first, visit, kit, downloaded);
      if (!downloaded.some((input) => kit.isModelFile(input.filename)))
        await download(fallback, visit, kit, downloaded);
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const threedexportTrending: ProviderTrending = { fetch: (_userId, limit) => fetchThreedexportTrending(limit) };

/** A collection from a 3DExport link: the user's Default Collection, with their sign-in, or any numbered one, read with
 *  their sign-in where there is one, as a private one shows only to its owner. Its first `maxItems`. */
export async function threedexportListOf(
  userId: string,
  url: string,
  maxItems?: number,
): Promise<ThreedexportCollection> {
  const isDefault = isThreedexportDefaultUrl(url);
  const collection = isDefault ? null : parseThreedexportCollectionUrl(url);
  if (!isDefault && !collection) throw new HttpError(400, "Not a link to a 3DExport collection");
  const session = await getUserThreedexportSession(userId);
  if (isDefault && !session) throw new HttpError(400, THREEDEXPORT_CONNECT, SESSION_CODE);
  try {
    const visit = threedexportVisit(session);
    if (isDefault) return await fetchThreedexportDefault(visit, maxItems);
    const found = await fetchThreedexportCollection(collection!.collectionId, visit, maxItems);
    if (!found) throw new HttpError(404, "That collection can't be found. It may have been deleted, or be private.");
    return found;
  } catch (err) {
    throw await threedexportFailure(userId, err);
  }
}

export const threedexportLists: ProviderLists = {
  async read(userId, url) {
    const collection = await threedexportListOf(userId, url);
    if (!collection.entries.length) throw new HttpError(400, `"${collection.title}" has no models yet`);
    const list: ProviderList = {
      title: collection.title,
      total: collection.total,
      truncated: collection.truncated,
      entries: collection.entries.map((entry) => ({
        externalId: entry.itemId,
        title: entry.title,
        cover: entry.cover,
      })),
    };
    return list;
  },
  modelIds: z
    .array(z.string().regex(/^\d{1,12}$/))
    .min(1)
    .max(1000),
  async start(userId, url) {
    // Only its title, which the first page has.
    const { title } = await threedexportListOf(userId, url, 1);
    return {
      batch: {
        // Each model's import reads the sign-in itself, which has to still be there when the job runs.
        async ready() {
          if (!(await getUserThreedexportSession(userId))) throw new HttpError(503, THREEDEXPORT_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** Its models' details, read without a sign-in, which only their files need. */
export const threedexportDetails: ProviderDetails = {
  read: async (_userId, itemId) => detailsOf(await resolveThreedexportModel(itemId)),
  missingMessage: threedexportImport.missingMessage,
  mapError: threedexportFailure,
};
