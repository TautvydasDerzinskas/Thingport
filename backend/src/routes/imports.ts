import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { prisma } from "../db";
import { normalizeImportUrl } from "../utils/urlUtils";
import { assertUrlProviderEnabled } from "../services/providerSettingsService";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { requireCaptcha } from "../services/captchaService";
import {
  SNAPMAKER_SESSION_CODE,
  CREALITYCLOUD_SESSION_CODE,
  NEXPRINT_SESSION_CODE,
  THANGS_SESSION_CODE,
  CULTS3D_SESSION_CODE,
  checkImportStatus,
  downloadImportToTemp,
  findImportedExternalIds,
  inspectImportLink,
} from "../services/importService";
import { findLibraryPrints } from "../services/collectionSyncService";
import { resolveMakerworldCookie } from "../services/importResolvers";
import {
  extractMakerworldBearerToken,
  MakerworldAuthError,
  MakerworldCaptchaError,
  parseMakerworldModelUrl,
} from "../services/makerworldCloudApi";
import {
  fetchMakerworldCollectionEntries,
  fetchMakerworldCollectionTitle,
  parseMakerworldCollectionUrl,
} from "../services/makerworldCollections";
import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../config";
import {
  fetchThingiverseCollectionThings,
  fetchThingiverseCollectionTitle,
  fetchThingiverseUserLikes,
  parseThingiverseCollectionUrl,
  parseThingiverseLikesUrl,
} from "../services/thingiverseApi";
import { fetchPrintablesCollectionEntries, parsePrintablesCollectionUrl } from "../services/printablesApi";
import { getMyminifactoryApiKey, getThingiverseAccessToken } from "../services/settingsService";
import {
  fetchMyminifactoryCollectionObjects,
  MyminifactoryAuthError,
  MyminifactoryRateLimitError,
  parseMyminifactoryCollectionUrl,
} from "../services/myminifactoryApi";
import {
  fetchSnapmakerList,
  parseSnapmakerListUrl,
  parseSnapmakerModelUrl,
  SnapmakerAuthError,
  snapmakerListName,
} from "../services/snapmakerApi";
import {
  getUserSnapmakerToken,
  markSnapmakerTokenRejected,
  SNAPMAKER_CONNECT,
} from "../services/snapmakerSessionService";
import {
  fetchMakeronlineCollection,
  fetchMakeronlineCollectionInfo,
  fetchMakeronlineLikes,
  isMakeronlineLikesUrl,
  MakeronlineAuthError,
  MAKERONLINE_LIKES_NAME,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
  type MakeronlineListing,
} from "../services/makeronlineApi";
import {
  getUserMakeronlineToken,
  MAKERONLINE_CONNECT,
  markMakeronlineTokenRejected,
} from "../services/makeronlineSessionService";
import {
  clearGrabImport,
  getGrabImport,
  listGrabImports,
  notifyGrabImportsQueued,
  planMakeronlineDownloads,
  queueGrabImport,
  recordGrabImportFailure,
} from "../services/grabImportService";
import {
  CREALITYCLOUD_LIKES_NAME,
  CrealitycloudAuthError,
  type CrealitycloudListing,
  fetchCrealitycloudCollection,
  fetchCrealitycloudLikes,
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
} from "../services/crealitycloudApi";
import {
  CREALITYCLOUD_CONNECT,
  getUserCrealitycloudAuth,
  markCrealitycloudSessionRejected,
} from "../services/crealitycloudSessionService";
import {
  fetchNexprintCollection,
  NexprintAuthError,
  parseNexprintCollectionUrl,
  parseNexprintModelUrl,
} from "../services/nexprintApi";
import { markNexprintSessionRejected } from "../services/nexprintSessionService";
import {
  fetchThangsCollection,
  fetchThangsLikes,
  fetchThangsPurchases,
  isThangsLikesUrl,
  parseThangsCollectionUrl,
  ThangsAuthError,
  ThangsBlockedError,
  type ThangsListing,
  THANGS_LIKES_NAME,
  ThangsPrivateCollectionError,
} from "../services/thangsApi";
import {
  getUserThangsId,
  getUserThangsToken,
  markThangsSessionRejected,
  THANGS_CONNECT,
  withThangsToken,
} from "../services/thangsSessionService";
import {
  Cults3dAuthError,
  cults3dLikesName,
  type Cults3dListing,
  Cults3dRateLimitError,
  fetchCults3dLikes,
  fetchCults3dOrders,
  fetchCults3dPrintlist,
  parseCults3dLikesUrl,
  parseCults3dPrintlistUrl,
} from "../services/cults3dApi";
import { CULTS3D_CONNECT, getUserCults3dCredentials, markCults3dApiRejected } from "../services/cults3dSessionService";
import { addPrintsToCollection, findOrCreateCollectionByName } from "../services/collectionService";
import { listZipEntries } from "../services/zipService";
import { createJob, createJobItems, getActiveJob, getJob, listJobItems } from "../services/importJobService";
import { queueLink, startLinksJob } from "../services/importQueueService";
import { getImportTask, startImportTask } from "../services/importTaskService";
import {
  runCollectionImportJob,
  runCrealitycloudListImportJob,
  runCrealitycloudProfilesImportJob,
  runNexprintCollectionImportJob,
  runNexprintProfilesImportJob,
  runThangsListImportJob,
  runCults3dListImportJob,
  runLinksImportJob,
  runMakerworldProfilesImportJob,
  runMyminifactoryCollectionImportJob,
  runPrintablesCollectionImportJob,
  runSnapmakerListImportJob,
  runSnapmakerProfilesImportJob,
  runThingiverseCollectionImportJob,
  runThingiverseLikesImportJob,
  runZipImportJob,
} from "../services/importJobRunner";
import { notifyImportRun } from "../services/modelNotifications";
import { toImportJobItemOut, toImportJobOut } from "../dto";
import type { Prisma } from "@prisma/client";
import { importAndDescribe, prepareSingleImport, withStoredMakerworldCookie } from "../services/singleImport";

const router = Router();
router.use(requireAuth);

const importRequestSchema = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  category_id: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  makerworld_cookie: z.string().nullable().optional(),
  // Resolved by the extension in the page itself. Skips the backend's own resolution, which is
  // what trips MakerWorld's CAPTCHA.
  resolved_download_url: z.string().nullable().optional(),
  resolved_instance_id: z.string().nullable().optional(),
  // MakerOnline's files, their links signed by Thingport Grab on the site's own page.
  resolved_files: z
    .array(z.object({ url: z.string().url(), name: z.string().max(500), profile_id: z.string().nullable().optional() }))
    .max(200)
    .nullable()
    .optional(),
  makerworld_design: z.record(z.unknown()).nullable().optional(),
  // False for each model of a run the client drives itself; the run sends one summary at the end.
  notify: z.boolean().optional(),
});

/** The link, normalized, unless it's from a provider an admin has turned off. */
async function enabledImportUrl(raw: string): Promise<string> {
  const url = await normalizeImportUrl(raw);
  await assertUrlProviderEnabled(url);
  return url;
}

// `?async=1` answers 202 with a task id to poll at /import/tasks/:id (see importTaskService.ts).
router.post(
  "/import",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const { url, body } = await prepareSingleImport(req.userId!, parseBody(importRequestSchema, req.body));
    if (req.query.async === "1") {
      const taskId = startImportTask(req.userId!, () => importAndDescribe(req.userId!, url, body));
      res.status(202).json({ task_id: taskId });
      return;
    }
    res.json(await importAndDescribe(req.userId!, url, body));
  }),
);

// The end of a run the client drove one model at a time (the extension's guided MakerWorld import).
const importSummarySchema = z.object({
  source_url: z.string().url(),
  total: z.number().int().min(1).max(10_000),
  print_ids: z.array(z.string()).max(10_000),
  collection_id: z.string().nullable().optional(),
  // Why the run stopped early, if it did.
  stopped: z.string().max(500).nullable().optional(),
});
router.post(
  "/import/summary",
  asyncHandler(async (req, res) => {
    const body = parseBody(importSummarySchema, req.body);
    const prints = await prisma.print.findMany({
      where: { id: { in: body.print_ids }, userId: req.userId! },
      select: { id: true, name: true, title: true },
    });
    const collection = body.collection_id
      ? await prisma.collection.findFirst({
          where: { id: body.collection_id, userId: req.userId! },
          select: { id: true },
        })
      : null;
    await notifyImportRun(req.userId!, {
      sourceUrl: body.source_url,
      total: body.total,
      prints: prints.map((p) => ({ id: p.id, name: p.title || p.name })),
      collectionId: collection?.id ?? null,
      stopped: body.stopped ?? null,
    });
    res.json({ ok: true });
  }),
);

router.get(
  "/import/tasks/:id",
  asyncHandler(async (req, res) => {
    const task = getImportTask(req.params.id, req.userId!);
    if (!task) throw new HttpError(404, "Import task not found -- it may have expired or the server restarted");
    res.json(task);
  }),
);

router.post(
  "/import/inspect",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await enabledImportUrl(body.url);
    const result = await inspectImportLink(url, body);
    res.json(result);
  }),
);

// Never fetches the URL, so it skips the SSRF check. Called by the extension on every page load.
router.get(
  "/import/status",
  asyncHandler(async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) throw new HttpError(400, "url is required");
    res.json(await checkImportStatus(req.userId!, url));
  }),
);

const statusBatchSchema = z.object({
  provider: z.enum([
    "makerworld",
    "thingiverse",
    "printables",
    "myminifactory",
    "snapmaker",
    "makeronline",
    "crealitycloud",
    "nexprint",
    "thangs",
    "cults3d",
  ]),
  // Creality Cloud's ids are its models' aliases, made of their titles.
  external_ids: z.array(z.string().max(200)).max(10_000),
});

// One query for a whole collection page; per-model /import/status calls bog down on big ones.
router.post(
  "/import/status/batch",
  asyncHandler(async (req, res) => {
    const body = parseBody(statusBatchSchema, req.body);
    const prints = await findLibraryPrints(req.userId!, body.provider, body.external_ids);
    res.json({ print_ids: Object.fromEntries(prints) });
  }),
);

router.post(
  "/import/zip/entries",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await enabledImportUrl(body.url);
    const { tempPath, filename } = await downloadImportToTemp(url, body);
    try {
      if (path.extname(filename).toLowerCase() !== ".zip") throw new HttpError(415, "Imported file is not a zip");
      const entries = await listZipEntries(tempPath);
      if (!entries.length) throw new HttpError(400, "No files found in zip");
      res.json({ filename, entries });
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }),
);

router.post(
  "/import/collection/entries",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await enabledImportUrl(body.url);
    const parsed = parseMakerworldCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a MakerWorld collection URL");
    const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));

    // Sequential: fetching both at once is an unpaced burst.
    let title: string | null;
    let listing: Awaited<ReturnType<typeof fetchMakerworldCollectionEntries>>;
    try {
      title = await fetchMakerworldCollectionTitle(parsed.collectionId, bearerToken);
      listing = await fetchMakerworldCollectionEntries(
        parsed.collectionId,
        bearerToken,
        undefined,
        IMPORT_MAKERWORLD_CALL_DELAY_MS,
      );
    } catch (err) {
      if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      if (err instanceof MakerworldAuthError) throw new HttpError(400, err.message);
      throw err;
    }
    if (!listing.entries.length) throw new HttpError(400, "Could not load this collection's models");

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "makerworld",
      listing.entries.map((e) => e.designId),
    );
    res.json({
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.designId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.designId),
      })),
    });
  }),
);

router.post(
  "/import/thingiverse-likes/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const parsed = parseThingiverseLikesUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Thingiverse Likes URL");
    const accessToken = await getThingiverseAccessToken();
    if (!accessToken) {
      throw new HttpError(
        503,
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an App Token in Administration > Providers.",
      );
    }

    const listing = await fetchThingiverseUserLikes(parsed.username, accessToken);
    if (!listing.entries.length)
      throw new HttpError(400, "Could not load this user's likes -- check the username and try again");

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "thingiverse",
      listing.entries.map((e) => e.thingId),
    );
    res.json({
      title: `${parsed.username}'s Thingiverse Likes`,
      total: listing.entries.length,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.thingId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.thingId),
      })),
    });
  }),
);

router.post(
  "/import/thingiverse-collection/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const parsed = parseThingiverseCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Thingiverse Collection URL");
    const accessToken = await getThingiverseAccessToken();
    if (!accessToken) {
      throw new HttpError(
        503,
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an App Token in Administration > Providers.",
      );
    }

    const [title, listing] = await Promise.all([
      fetchThingiverseCollectionTitle(parsed.collectionId, accessToken),
      fetchThingiverseCollectionThings(parsed.collectionId, accessToken),
    ]);
    if (!listing.entries.length) throw new HttpError(400, "Could not load this collection's models");

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "thingiverse",
      listing.entries.map((e) => e.thingId),
    );
    res.json({
      title,
      total: listing.entries.length,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.thingId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.thingId),
      })),
    });
  }),
);

router.post(
  "/import/printables-collection/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const parsed = parsePrintablesCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Printables Collection URL");

    const listing = await fetchPrintablesCollectionEntries(parsed.collectionId);
    if (!listing.entries.length) throw new HttpError(400, "Could not load this collection's models");

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "printables",
      listing.entries.map((e) => e.modelId),
    );
    res.json({
      title: listing.title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

const MYMINIFACTORY_NOT_CONFIGURED =
  "MyMiniFactory import isn't configured for this instance yet -- ask an admin to add an API key in Administration > Providers.";

router.post(
  "/import/myminifactory-collection/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const parsed = parseMyminifactoryCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a MyMiniFactory collection URL");
    const apiKey = await getMyminifactoryApiKey();
    if (!apiKey) throw new HttpError(503, MYMINIFACTORY_NOT_CONFIGURED);

    let listing: Awaited<ReturnType<typeof fetchMyminifactoryCollectionObjects>>;
    try {
      listing = await fetchMyminifactoryCollectionObjects(parsed.username, parsed.slug, apiKey);
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

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "myminifactory",
      listing.entries.map((e) => e.objectId),
    );
    res.json({
      title: listing.title,
      total: listing.entries.length,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.objectId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.objectId),
      })),
    });
  }),
);

/** The user's likes or bookmarks, from a link Thingport Grab or the app made (`?tab=interactions&list=...`). */
function snapmakerListOf(url: string) {
  const parsed = parseSnapmakerListUrl(url);
  if (!parsed?.list) throw new HttpError(400, "Not a link to your Snapmaker Space likes or bookmarks");
  return { ...parsed, list: parsed.list };
}

router.post(
  "/import/snapmaker-list/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const { list } = snapmakerListOf(url);
    const token = await getUserSnapmakerToken(req.userId!);
    if (!token) throw new HttpError(400, SNAPMAKER_CONNECT, SNAPMAKER_SESSION_CODE);

    let listing: Awaited<ReturnType<typeof fetchSnapmakerList>>;
    try {
      listing = await fetchSnapmakerList(list, token);
    } catch (err) {
      if (err instanceof SnapmakerAuthError) {
        await markSnapmakerTokenRejected(req.userId!);
        // 400, not 401: the frontend treats any 401 as an expired Thingport session.
        throw new HttpError(400, err.message, SNAPMAKER_SESSION_CODE);
      }
      throw err;
    }
    if (!listing.entries.length) throw new HttpError(400, `Your ${snapmakerListName(list)} are empty`);

    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "snapmaker",
      listing.entries.map((e) => e.modelId),
    );
    res.json({
      title: snapmakerListName(list),
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

/** The user's likes, or a collection, from a Creality Cloud link. Likes are their owner's only; collections are read
 *  without a sign-in. */
async function crealitycloudListOf(
  userId: string,
  url: string,
): Promise<{ title: string; listing: CrealitycloudListing }> {
  try {
    const likes = parseCrealitycloudLikesUrl(url);
    if (likes) {
      const auth = await getUserCrealitycloudAuth(userId);
      if (!auth) throw new HttpError(400, CREALITYCLOUD_CONNECT, CREALITYCLOUD_SESSION_CODE);
      if (auth.userId !== likes.userId) {
        throw new HttpError(400, "Creality Cloud shows likes to their owner only, so only your own can be imported");
      }
      return { title: CREALITYCLOUD_LIKES_NAME, listing: await fetchCrealitycloudLikes(auth) };
    }
    const parsed = parseCrealitycloudCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a link to a Creality Cloud collection or your likes");
    const collection = await fetchCrealitycloudCollection(parsed.collectionId);
    if (!collection) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
    return { title: collection.info.name, listing: collection };
  } catch (err) {
    if (err instanceof CrealitycloudAuthError) {
      await markCrealitycloudSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, CREALITYCLOUD_SESSION_CODE);
    }
    throw err;
  }
}

router.post(
  "/import/crealitycloud-list/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const { title, listing } = await crealitycloudListOf(req.userId!, url);
    if (!listing.entries.length) throw new HttpError(400, `"${title}" is empty`);
    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "crealitycloud",
      listing.entries.map((e) => e.modelId),
    );
    res.json({
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

/** A NexPrint collection from its link; even private ones read without a sign-in. */
async function nexprintCollectionOf(userId: string, url: string) {
  const parsed = parseNexprintCollectionUrl(url);
  if (!parsed) throw new HttpError(400, "Not a link to a NexPrint collection");
  try {
    const collection = await fetchNexprintCollection(parsed.collectionId);
    if (!collection) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
    return collection;
  } catch (err) {
    if (err instanceof NexprintAuthError) {
      await markNexprintSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, NEXPRINT_SESSION_CODE);
    }
    throw err;
  }
}

router.post(
  "/import/nexprint-collection/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const collection = await nexprintCollectionOf(req.userId!, url);
    const title = collection.info.name;
    if (!collection.entries.length) throw new HttpError(400, `"${title}" is empty`);
    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "nexprint",
      collection.entries.map((e) => e.modelId),
    );
    res.json({
      title,
      total: collection.total,
      truncated: collection.truncated,
      entries: collection.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

/** The user's likes, or a collection, from a Thangs link, read with their sign-in: every file needs it anyway, and it
 *  says which paid models they own, which the listing keeps. */
async function thangsListOf(userId: string, url: string): Promise<{ title: string; listing: ThangsListing }> {
  const likes = isThangsLikesUrl(url);
  const collection = likes ? null : parseThangsCollectionUrl(url);
  if (!likes && !collection) throw new HttpError(400, "Not a link to a Thangs collection or your likes");
  try {
    const [token, thangsId] = await Promise.all([getUserThangsToken(userId), getUserThangsId(userId)]);
    if (!token || !thangsId) throw new HttpError(400, THANGS_CONNECT, THANGS_SESSION_CODE);
    const owned = await withThangsToken(userId, token, fetchThangsPurchases);
    if (likes) return { title: THANGS_LIKES_NAME, listing: await fetchThangsLikes(thangsId, owned) };
    const found = await withThangsToken(userId, token, (fresh) =>
      fetchThangsCollection(collection!.collectionId, fresh, owned),
    );
    if (!found) throw new HttpError(404, "That collection can't be found. It may have been deleted.");
    return { title: found.info.name, listing: found };
  } catch (err) {
    if (err instanceof ThangsAuthError) {
      await markThangsSessionRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, THANGS_SESSION_CODE);
    }
    if (err instanceof ThangsPrivateCollectionError) throw new HttpError(403, err.message);
    if (err instanceof ThangsBlockedError) throw new HttpError(429, err.message);
    throw err;
  }
}

router.post(
  "/import/thangs-list/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const { title, listing } = await thangsListOf(req.userId!, url);
    if (!listing.entries.length) throw new HttpError(400, `"${title}" has no models Thingport can import`);
    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "thangs",
      listing.entries.map((e) => e.modelId),
    );
    res.json({
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

/** A user's likes, or one of the user's own printlists, from a Cults3D link, read with their API key. Their orders say
 *  which paid models they own, which the listing keeps. */
async function cults3dListOf(userId: string, url: string): Promise<{ title: string; listing: Cults3dListing }> {
  const likes = parseCults3dLikesUrl(url);
  const printlist = likes ? null : parseCults3dPrintlistUrl(url);
  if (!likes && !printlist) throw new HttpError(400, "Not a link to Cults3D likes or one of your printlists");
  const credentials = await getUserCults3dCredentials(userId);
  if (!credentials) throw new HttpError(400, CULTS3D_CONNECT, CULTS3D_SESSION_CODE);
  try {
    const owned = new Set((await fetchCults3dOrders(credentials)).keys());
    if (likes) {
      const listing = await fetchCults3dLikes(credentials, likes.nick, owned);
      if (!listing) throw new HttpError(404, `There's no Cults3D user called "${likes.nick}".`);
      return { title: cults3dLikesName(likes.nick), listing };
    }
    if (printlist!.nick.toLowerCase() !== credentials.nick.toLowerCase()) {
      throw new HttpError(403, "Only your own Cults3D printlists can be imported: Cults3D's API shows no one else's.");
    }
    const found = await fetchCults3dPrintlist(credentials, printlist!.key, owned);
    if (!found) throw new HttpError(404, "That printlist can't be found. It may have been deleted.");
    return { title: found.info.name, listing: found };
  } catch (err) {
    if (err instanceof Cults3dAuthError) {
      await markCults3dApiRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message, CULTS3D_SESSION_CODE);
    }
    if (err instanceof Cults3dRateLimitError) throw new HttpError(429, err.message);
    throw err;
  }
}

router.post(
  "/import/cults3d-list/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const { title, listing } = await cults3dListOf(req.userId!, url);
    if (!listing.entries.length) throw new HttpError(400, `"${title}" has no models Thingport can import`);
    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "cults3d",
      listing.entries.map((e) => e.slug),
    );
    res.json({
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.slug,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.slug),
      })),
    });
  }),
);

// ---- MakerOnline: files only through Thingport Grab ----
// MakerOnline signs its download links only for a page its own anti-bot script runs on. Grab asks what a model needs
// (plan), gets it signed on makeronline.com, and imports with the signed links; imports started anywhere else wait
// for it (see grabImportService.ts).

const makeronlineScopeSchema = z.enum(["url", "designer", "all"]).default("url");

router.post(
  "/import/makeronline/plan",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ url: z.string(), scope: makeronlineScopeSchema }), req.body);
    const url = await enabledImportUrl(body.url);
    res.json(await planMakeronlineDownloads(url, body.scope));
  }),
);

/** A link pasted in the app: it waits for Grab's next visit to makeronline.com. */
router.post(
  "/import/makeronline/queue",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      importRequestSchema.extend({ scope: makeronlineScopeSchema, collection_id: z.string().nullable().optional() }),
      req.body,
    );
    const url = await enabledImportUrl(body.url);
    if (!parseMakeronlineModelUrl(url)) throw new HttpError(400, "Not a MakerOnline model link");
    await queueGrabImport(req.userId!, url, {
      scope: body.scope,
      collectionId: body.collection_id ?? null,
      categoryId: body.category_id ?? null,
      tags: body.tags,
      notes: body.notes ?? null,
    });
    res.status(202).json({ queued: 1 });
  }),
);

router.get(
  "/import/makeronline/waiting",
  asyncHandler(async (req, res) => {
    res.json(await listGrabImports(req.userId!));
  }),
);

const grabFilesSchema = z.object({
  files: z
    .array(z.object({ url: z.string().url(), name: z.string().max(500), profile_id: z.string().nullable().optional() }))
    .min(1)
    .max(200),
});

/** Grab signed a waiting model's files: imported like any link, then filed where it was meant to go. Asynchronous
 *  with `?async=1`, as /import is, since a model of many files outlasts an extension worker's fetch. */
router.post(
  "/import/makeronline/waiting/:id",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = parseBody(grabFilesSchema, req.body);
    const row = await getGrabImport(userId, req.params.id);
    const run = async () => {
      let described;
      try {
        described = await importAndDescribe(
          userId,
          row.url,
          {
            url: row.url,
            tags: row.tags,
            notes: row.notes,
            category_id: row.categoryId,
            resolved_files: body.files,
            notify: false,
          },
          // Only this row is cleared, once it's filed, so a failed filing keeps the collection to try again with.
          { keepGrabImports: true },
        );
        if (row.collectionId) {
          const collection = await prisma.collection.findFirst({ where: { id: row.collectionId, userId } });
          if (collection) await addPrintsToCollection(collection.id, [described.id]);
        }
      } catch (err) {
        await recordGrabImportFailure(row, err instanceof Error ? err.message : "Import failed").catch(() => undefined);
        throw err;
      }
      await clearGrabImport(row).catch(() => undefined);
      return described;
    };
    if (req.query.async === "1") {
      res.status(202).json({ task_id: startImportTask(userId, run) });
      return;
    }
    res.json(await run());
  }),
);

/** Grab couldn't get a waiting model's files signed, e.g. MakerOnline asked for a captcha. */
router.post(
  "/import/makeronline/waiting/:id/failed",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ error: z.string().max(1000) }), req.body);
    await recordGrabImportFailure(await getGrabImport(req.userId!, req.params.id), body.error);
    res.json({ ok: true });
  }),
);

/** The user's likes, or any collection they can see, from a MakerOnline link. */
async function makeronlineListOf(userId: string, url: string): Promise<{ title: string; listing: MakeronlineListing }> {
  const token = await getUserMakeronlineToken(userId);
  try {
    if (isMakeronlineLikesUrl(url)) {
      if (!token) throw new HttpError(400, MAKERONLINE_CONNECT);
      return { title: MAKERONLINE_LIKES_NAME, listing: await fetchMakeronlineLikes(token) };
    }
    const parsed = parseMakeronlineCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a link to a MakerOnline collection or your likes");
    const [info, listing] = await Promise.all([
      fetchMakeronlineCollectionInfo(parsed.collectionId, token),
      fetchMakeronlineCollection(parsed.collectionId, token),
    ]);
    if (!info || !listing) throw new HttpError(404, "That collection can't be found. It may be private or deleted.");
    return { title: info.name, listing };
  } catch (err) {
    if (err instanceof MakeronlineAuthError) {
      await markMakeronlineTokenRejected(userId);
      // 400, not 401: the frontend treats any 401 as an expired Thingport session.
      throw new HttpError(400, err.message);
    }
    throw err;
  }
}

router.post(
  "/import/makeronline-list/entries",
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema, req.body);
    const url = await enabledImportUrl(body.url);
    const { title, listing } = await makeronlineListOf(req.userId!, url);
    if (!listing.entries.length) throw new HttpError(400, `"${title}" is empty`);
    const alreadyImported = await findImportedExternalIds(
      req.userId!,
      "makeronline",
      listing.entries.map((e) => e.modelId),
    );
    res.json({
      title,
      total: listing.total,
      truncated: listing.truncated,
      entries: listing.entries.map((e) => ({
        design_id: e.modelId,
        title: e.title,
        cover: e.cover,
        already_imported: alreadyImported.has(e.modelId),
      })),
    });
  }),
);

/** The picked models of a list wait for Grab, filed into a collection named after the list. */
router.post(
  "/import/makeronline-list",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      importRequestSchema.extend({ model_ids: z.array(z.string().regex(/^\d+$/)).min(1).max(1000) }),
      req.body,
    );
    const url = await enabledImportUrl(body.url);
    const { title } = await makeronlineListOf(req.userId!, url);
    const collection = await findOrCreateCollectionByName(req.userId!, title);
    for (const modelId of body.model_ids) {
      await queueGrabImport(req.userId!, `https://www.makeronline.com/en/model/${modelId}`, {
        collectionId: collection.id,
        categoryId: body.category_id ?? null,
        tags: body.tags,
        notes: body.notes ?? null,
      });
    }
    await notifyGrabImportsQueued(req.userId!, body.model_ids.length, {
      label: title,
      externalUrl: url,
      internalPath: `/models/collections/${collection.id}`,
    });
    res.status(202).json({ queued: body.model_ids.length, collection_id: collection.id });
  }),
);

// Batch imports run in the background and are polled via GET /import/jobs/:id. One RUNNING job
// per user doubles as the "already in progress" lock.

async function assertNoActiveJob(userId: string): Promise<void> {
  const active = await getActiveJob(userId);
  if (active) throw new HttpError(409, "An import is already in progress");
}

const makerworldProfilesImportRequestSchema = importRequestSchema.extend({ scope: z.enum(["designer", "all"]) });

router.post(
  "/import/makerworld-profiles",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(
      req.userId!,
      parseBody(makerworldProfilesImportRequestSchema, req.body),
    );
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    if (!parseMakerworldModelUrl(url)) throw new HttpError(400, "Not a MakerWorld model link");
    const job = await createJob(req.userId!, "PROFILES", { sourceUrl: url, provider: "makerworld" });
    void runMakerworldProfilesImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

router.post(
  "/import/snapmaker-profiles",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldProfilesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    if (!parseSnapmakerModelUrl(url)) throw new HttpError(400, "Not a Snapmaker model link");
    const job = await createJob(req.userId!, "PROFILES", { sourceUrl: url, provider: "snapmaker" });
    void runSnapmakerProfilesImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

router.post(
  "/import/crealitycloud-profiles",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldProfilesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    if (!parseCrealitycloudModelUrl(url)) throw new HttpError(400, "Not a Creality Cloud model link");
    const job = await createJob(req.userId!, "PROFILES", { sourceUrl: url, provider: "crealitycloud" });
    void runCrealitycloudProfilesImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

router.post(
  "/import/nexprint-profiles",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldProfilesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    if (!parseNexprintModelUrl(url)) throw new HttpError(400, "Not a NexPrint model link");
    const job = await createJob(req.userId!, "PROFILES", { sourceUrl: url, provider: "nexprint" });
    void runNexprintProfilesImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

const collectionImportRequestSchema = importRequestSchema.extend({ design_ids: z.array(z.string()).min(1) });

router.post(
  "/import/collection",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(collectionImportRequestSchema, req.body));
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "makerworld",
      total: body.design_ids.length,
    });
    void runCollectionImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

const thingiverseLikesImportRequestSchema = importRequestSchema.extend({ thing_ids: z.array(z.string()).min(1) });

router.post(
  "/import/thingiverse-likes",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(thingiverseLikesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const parsed = parseThingiverseLikesUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Thingiverse Likes URL");
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "thingiverse",
      total: body.thing_ids.length,
    });
    void runThingiverseLikesImportJob(job.id, req.userId!, { ...body, url, username: parsed.username });
    res.status(202).json({ job_id: job.id });
  }),
);

router.post(
  "/import/thingiverse-collection",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(thingiverseLikesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const parsed = parseThingiverseCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Thingiverse Collection URL");
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "thingiverse",
      total: body.thing_ids.length,
    });
    void runThingiverseCollectionImportJob(job.id, req.userId!, { ...body, url, collectionId: parsed.collectionId });
    res.status(202).json({ job_id: job.id });
  }),
);

const printablesCollectionImportRequestSchema = importRequestSchema.extend({
  model_ids: z.array(z.string()).min(1),
  // As Thingport Grab read it: the instance can't read a private collection's name itself.
  collection_title: z.string().max(300).nullable().optional(),
});

router.post(
  "/import/printables-collection",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(printablesCollectionImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const parsed = parsePrintablesCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a Printables Collection URL");
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "printables",
      total: body.model_ids.length,
    });
    void runPrintablesCollectionImportJob(job.id, req.userId!, { ...body, url, collectionId: parsed.collectionId });
    res.status(202).json({ job_id: job.id });
  }),
);

const myminifactoryCollectionImportRequestSchema = importRequestSchema.extend({
  object_ids: z.array(z.string()).min(1),
});

router.post(
  "/import/myminifactory-collection",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(myminifactoryCollectionImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const parsed = parseMyminifactoryCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a MyMiniFactory collection URL");
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "myminifactory",
      total: body.object_ids.length,
    });
    void runMyminifactoryCollectionImportJob(job.id, req.userId!, { ...body, url, ...parsed });
    res.status(202).json({ job_id: job.id });
  }),
);

const snapmakerListImportRequestSchema = importRequestSchema.extend({ model_ids: z.array(z.string()).min(1) });

router.post(
  "/import/snapmaker-list",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(snapmakerListImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const { list } = snapmakerListOf(url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "snapmaker",
      total: body.model_ids.length,
    });
    void runSnapmakerListImportJob(job.id, req.userId!, { ...body, url, list });
    res.status(202).json({ job_id: job.id });
  }),
);

const crealitycloudListImportRequestSchema = importRequestSchema.extend({
  model_ids: z
    .array(
      z
        .string()
        .regex(/^[\w-]+$/)
        .max(200),
    )
    .min(1)
    .max(1000),
});

router.post(
  "/import/crealitycloud-list",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(crealitycloudListImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const { title } = await crealitycloudListOf(req.userId!, url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "crealitycloud",
      total: body.model_ids.length,
    });
    void runCrealitycloudListImportJob(job.id, req.userId!, { ...body, url, title });
    res.status(202).json({ job_id: job.id });
  }),
);

const nexprintCollectionImportRequestSchema = importRequestSchema.extend({
  model_ids: z
    .array(
      z
        .string()
        .regex(/^G\d+$/i)
        .max(32),
    )
    .min(1)
    .max(1000),
});

router.post(
  "/import/nexprint-collection",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(nexprintCollectionImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const { info } = await nexprintCollectionOf(req.userId!, url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "nexprint",
      total: body.model_ids.length,
    });
    void runNexprintCollectionImportJob(job.id, req.userId!, {
      ...body,
      model_ids: body.model_ids.map((id) => id.toUpperCase()),
      url,
      title: info.name,
    });
    res.status(202).json({ job_id: job.id });
  }),
);

const thangsListImportRequestSchema = importRequestSchema.extend({
  model_ids: z.array(z.string().regex(/^\d+$/).max(20)).min(1).max(1000),
});

router.post(
  "/import/thangs-list",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(thangsListImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const { title } = await thangsListOf(req.userId!, url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "thangs",
      total: body.model_ids.length,
    });
    void runThangsListImportJob(job.id, req.userId!, { ...body, url, title });
    res.status(202).json({ job_id: job.id });
  }),
);

const cults3dListImportRequestSchema = importRequestSchema.extend({
  model_ids: z
    .array(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]*$/i)
        .max(200),
    )
    .min(1)
    .max(1000),
});

router.post(
  "/import/cults3d-list",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(cults3dListImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const { title } = await cults3dListOf(req.userId!, url);
    const job = await createJob(req.userId!, "COLLECTION", {
      sourceUrl: url,
      provider: "cults3d",
      total: body.model_ids.length,
    });
    void runCults3dListImportJob(job.id, req.userId!, { ...body, url, title });
    res.status(202).json({ job_id: job.id });
  }),
);

const zipExtractRequestSchema = importRequestSchema.extend({ entries: z.array(z.string()) });

router.post(
  "/import/zip",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(zipExtractRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await enabledImportUrl(body.url);
    const job = await createJob(req.userId!, "ZIP", {
      sourceUrl: url,
      total: body.entries.length,
    });
    void runZipImportJob(job.id, req.userId!, { ...body, url });
    res.status(202).json({ job_id: job.id });
  }),
);

router.get(
  "/import/jobs/active",
  asyncHandler(async (req, res) => {
    const job = await getActiveJob(req.userId!);
    res.json(job ? toImportJobOut(job) : null);
  }),
);

const linksImportRequestSchema = importRequestSchema.extend({
  // The queue carries its own urls; this one is only there so the shared body shape still fits.
  url: z.string().optional(),
  urls: z.array(z.string()).min(1).max(500),
  scope: z.enum(["url", "designer", "all"]).default("url"),
});

/** The shared request body a LINKS job reruns on a retry -- never the cookie or the captcha. */
function linksJobPayload(body: z.infer<typeof linksImportRequestSchema>): Prisma.InputJsonValue {
  return {
    notes: body.notes ?? null,
    tags: body.tags,
    category_id: body.category_id ?? null,
    scope: body.scope,
  };
}

router.post(
  "/import/links",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(linksImportRequestSchema, req.body));
    await assertNoActiveJob(req.userId!);
    const urls: string[] = [];
    for (const raw of body.urls) {
      const url = await enabledImportUrl(raw.trim());
      if (url && !urls.includes(url)) urls.push(url);
    }
    if (!urls.length) throw new HttpError(400, "No links to import");
    const job = await createJob(req.userId!, "LINKS", {
      sourceUrl: urls[0],
      total: urls.length,
      payload: linksJobPayload(body),
    });
    await createJobItems(job.id, urls);
    void runLinksImportJob(job.id, req.userId!, { ...body, url: urls[0] });
    res.status(202).json({ job_id: job.id });
  }),
);

/** Reruns just the links that failed, so a CAPTCHA cooloff or a cookie fix is enough to finish a
 * batch. */
router.post(
  "/import/jobs/:id/retry",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const job = await getJob(req.params.id, req.userId!);
    if (!job) throw new HttpError(404, "Import job not found");
    await startLinksJob(job, { retryFailed: true, manual: true });
    res.status(202).json({ job_id: job.id });
  }),
);

const queueLinkRequestSchema = z.object({
  url: z.string().min(1),
  collection_id: z.string().nullable().optional(),
  scope: z.enum(["url", "designer", "all"]).optional(),
  title: z.string().max(500).nullable().optional(),
});

/** The extension's "Add to the queue": the link waits, paused, in the user's queue until it's started
 *  from the admin import queue. Nothing is fetched now, so this is quick and never trips a CAPTCHA. */
router.post(
  "/import/queue",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(queueLinkRequestSchema, req.body);
    const url = await enabledImportUrl(body.url.trim());
    if (!url) throw new HttpError(400, "No link to queue");
    const result = await queueLink(req.userId!, url, {
      collection_id: body.collection_id ?? null,
      scope: body.scope,
      title: body.title?.trim() || null,
    });
    res.status(result.duplicate ? 200 : 201).json({
      job_id: result.job.id,
      item_id: result.itemId,
      duplicate: result.duplicate,
      waiting: result.waiting,
    });
  }),
);

router.get(
  "/import/jobs/:id/items",
  asyncHandler(async (req, res) => {
    const job = await getJob(req.params.id, req.userId!);
    if (!job) throw new HttpError(404, "Import job not found");
    res.json((await listJobItems(job.id)).map(toImportJobItemOut));
  }),
);

router.get(
  "/import/jobs/:id",
  asyncHandler(async (req, res) => {
    const job = await getJob(req.params.id, req.userId!);
    if (!job) throw new HttpError(404, "Import job not found");
    res.json(toImportJobOut(job));
  }),
);

export default router;
