// Meshy's bundle: this folder, providers/meshy/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/meshy/ and Grab's extension/src/providers/meshy/. Wired in by
// providers/registry.ts here, frontend/src/providers/collectionTiles.ts in the app, and the tables in
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
import type { ProviderDetails, ProviderList, ProviderLists, ProviderTrending, SourcedImport } from "../types";
import {
  fetchMeshyCollection,
  fetchMeshyCollectionPosts,
  fetchMeshyGenerations,
  fetchMeshyPopular,
  isMeshyFileHost,
  MeshyAccountChangedError,
  markMeshyDownloaded,
  MESHY_GENERATIONS_NAME,
  MeshyAuthError,
  MeshyBlockedError,
  meshyDownloadUrl,
  MeshyDownloadLimitError,
  MeshyPlanError,
  MeshyRateLimitError,
  MeshyRefusedError,
  meshyTaskIdOf,
  parseMeshyCollectionUrl,
  parseMeshyGenerationsUrl,
  resolveMeshyPost,
  resolveMeshyTask,
  type MeshyAccount,
  type MeshyAuth,
  type MeshyModelResolution,
} from "./api";
import { getUserMeshyAuth, markMeshySessionRejected, MESHY_CONNECT, withMeshyAuth } from "./session";

const { session: SESSION_CODE, downloadLimit: DOWNLOAD_LIMIT_CODE } = MANIFESTS.meshy.errorCodes;
const BLOCKED =
  "Meshy blocked the file download (rate limit). This usually clears after a while -- wait, then retry the same import.";

/** Meshy's errors as the HttpErrors an import reports; a rejected sign-in is remembered, so the app can say so. */
async function meshyFailure(userId: string, err: unknown): Promise<unknown> {
  if (err instanceof MeshyAuthError) {
    await markMeshySessionRejected(userId);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session.
    return new HttpError(400, err.message, SESSION_CODE);
  }
  if (err instanceof MeshyDownloadLimitError) return new HttpError(429, err.message, DOWNLOAD_LIMIT_CODE);
  if (err instanceof MeshyPlanError || err instanceof MeshyRefusedError) return new HttpError(403, err.message);
  if (err instanceof MeshyRateLimitError) return new HttpError(429, err.message);
  if (err instanceof MeshyBlockedError) return new HttpError(503, err.message);
  if (err instanceof MeshyAccountChangedError) return new HttpError(409, err.message);
  return err;
}

type Connected = { userId: string; auth: MeshyAuth; account: MeshyAccount };

/** The user's sign-in, renewed when it's out, or the HttpError that says to connect Meshy. */
async function requireMeshy(userId: string): Promise<Connected> {
  let connected: Awaited<ReturnType<typeof getUserMeshyAuth>>;
  try {
    connected = await getUserMeshyAuth(userId);
  } catch (err) {
    throw await meshyFailure(userId, err);
  }
  if (!connected) throw new HttpError(400, MESHY_CONNECT, SESSION_CODE);
  return { userId, ...connected };
}

/** A post, or one of the user's own generations -- which only they can read. */
function resolve(externalId: string, connected: Connected): Promise<MeshyModelResolution | null> {
  const taskId = meshyTaskIdOf(externalId);
  if (!taskId) return resolveMeshyPost(externalId);
  return withMeshyAuth(connected.userId, connected.auth, (auth) => resolveMeshyTask(taskId, auth, connected.account));
}

/** A post's meshes, or a generation's one, each converted by Meshy for the user's account into a print-ready 3MF.
 *  Every download counts against the account's own, so a model that can't be had stops the import at its first. */
export const meshyImport: SourcedImport<Connected, MeshyModelResolution> = {
  requireAuth: requireMeshy,
  resolveModel: resolve,
  mapError: meshyFailure,
  missingMessage: "This Meshy model could not be found, or isn't public.",
  noFilesMessage: "This Meshy post has no 3D model Thingport can import, only pictures.",
  nameHint: (externalId) => `meshy-${meshyTaskIdOf(externalId) ?? externalId}`,
  async downloadModel(target, resolved, connected, _requested, kit) {
    let auth = connected.auth;
    // The user's own post is their own generation to Meshy, which a free plan downloads; as a community model it doesn't.
    const own = resolved.type === "Showcase" && resolved.meta.author?.externalId === connected.account.userId;
    const type = own ? "Task" : resolved.type;
    const downloaded: NewPlateInput[] = [];
    try {
      for (const mesh of resolved.meshes) {
        const url = await withMeshyAuth(target.userId, auth, (fresh) => {
          auth = fresh;
          return meshyDownloadUrl(mesh, type, fresh);
        });
        if (!url) continue;
        const inputs = (await kit.downloadSignedFile({ url, name: mesh.name }, isMeshyFileHost, BLOCKED)) ?? [];
        downloaded.push(...inputs);
        if (inputs.length) await markMeshyDownloaded(mesh.taskId, auth);
      }
    } catch (err) {
      await Promise.all(downloaded.map((input) => fs.rm(input.tempFilePath!, { force: true }).catch(() => undefined)));
      throw err;
    }
    return downloaded;
  },
};

export const meshyTrending: ProviderTrending = { fetch: (_userId, limit) => fetchMeshyPopular(limit) };

/** A collection, anyone's to read, or the user's own generations, read with their sign-in. Either way every file
 *  needs the sign-in, so a list is only offered with one. */
async function listOf(userId: string, url: string): Promise<ProviderList & { title: string }> {
  const collection = parseMeshyCollectionUrl(url);
  const generations = collection ? null : parseMeshyGenerationsUrl(url);
  if (!collection && !generations) throw new HttpError(400, "Not a link to a Meshy collection or your generations");
  try {
    const connected = await requireMeshy(userId);
    let title: string;
    let listing: Awaited<ReturnType<typeof fetchMeshyCollectionPosts>>;
    if (collection) {
      const found = await fetchMeshyCollection(collection.collectionId);
      if (!found) throw new HttpError(404, "That Meshy collection can't be found. It may have been deleted.");
      title = found.name;
      listing = await fetchMeshyCollectionPosts(found.id);
    } else {
      if (connected.account.userId !== generations!.userId) {
        throw new HttpError(400, "Those are another Meshy account's generations: only your own can be imported.");
      }
      title = MESHY_GENERATIONS_NAME;
      listing = await withMeshyAuth(userId, connected.auth, (auth) => fetchMeshyGenerations(auth));
    }
    return {
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((entry) => ({
        externalId: entry.externalId,
        title: entry.title,
        cover: entry.cover,
      })),
    };
  } catch (err) {
    throw await meshyFailure(userId, err);
  }
}

export const meshyLists: ProviderLists = {
  async read(userId, url) {
    const list = await listOf(userId, url);
    if (!list.entries.length) throw new HttpError(400, `"${list.title}" has no models Thingport can import`);
    return list;
  },
  modelIds: z
    .array(
      z
        .string()
        .regex(/^(?:task-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
        .transform((id) => id.toLowerCase()),
    )
    .min(1)
    .max(1000),
  async start(userId, url) {
    const { title } = await listOf(userId, url);
    return {
      batch: {
        async ready() {
          if (!(await getUserMeshyAuth(userId).catch(() => null))) throw new HttpError(503, MESHY_CONNECT);
        },
        title: async () => title,
      },
    };
  },
};

/** A post's details are anyone's to read; a generation's only its owner's. */
export const meshyDetails: ProviderDetails = {
  async read(userId, externalId) {
    if (!meshyTaskIdOf(externalId)) return detailsOf(await resolveMeshyPost(externalId));
    return detailsOf(await resolve(externalId, await requireMeshy(userId)));
  },
  missingMessage: meshyImport.missingMessage,
  mapError: meshyFailure,
};
