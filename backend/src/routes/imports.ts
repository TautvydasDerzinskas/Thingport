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
  assertCanImportUrl,
  checkImportStatus,
  downloadImportToTemp,
  findImportedExternalIds,
  importPrintFromUrl,
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
import { getThingiverseAccessToken } from "../services/settingsService";
import { getUserMakerworldCookie } from "../services/makerworldCookieService";
import { listZipEntries } from "../services/zipService";
import { createJob, createJobItems, getActiveJob, getJob, listJobItems } from "../services/importJobService";
import { queueLink, startLinksJob } from "../services/importQueueService";
import { getImportTask, startImportTask } from "../services/importTaskService";
import {
  runCollectionImportJob,
  runLinksImportJob,
  runMakerworldProfilesImportJob,
  runPrintablesCollectionImportJob,
  runThingiverseCollectionImportJob,
  runThingiverseLikesImportJob,
  runZipImportJob,
} from "../services/importJobRunner";
import { createLog } from "../services/auditLog";
import { notifyImportRun, notifySingleImport } from "../services/modelNotifications";
import { toImportJobItemOut, toImportJobOut, toPrintOut } from "../dto";
import type { Prisma } from "@prisma/client";

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
  makerworld_design: z.record(z.unknown()).nullable().optional(),
  // False for each model of a run the client drives itself; the run sends one summary at the end.
  notify: z.boolean().optional(),
});

// Falls back to the cookie saved in Settings when the request doesn't carry one.
async function withStoredMakerworldCookie<T extends { makerworld_cookie?: string | null }>(
  userId: string,
  body: T,
): Promise<T> {
  if (body.makerworld_cookie && body.makerworld_cookie.trim()) return body;
  const stored = await getUserMakerworldCookie(userId);
  return stored ? { ...body, makerworld_cookie: stored } : body;
}

/** The link, normalized, unless it's from a provider an admin has turned off. */
async function enabledImportUrl(raw: string): Promise<string> {
  const url = await normalizeImportUrl(raw);
  await assertUrlProviderEnabled(url);
  return url;
}

async function importAndDescribe(userId: string, url: string, body: z.infer<typeof importRequestSchema>) {
  let result;
  try {
    result = await importPrintFromUrl(userId, url, body);
  } catch (err) {
    if (body.notify !== false) {
      const error = err instanceof HttpError ? err.message : "Something went wrong on the server.";
      await notifySingleImport(userId, url, { error }).catch((e) => console.error("Import notification failed:", e));
    }
    throw err;
  }
  const { print, plates, author, previewImages } = result;
  const importOutcome = result.alreadyImported ? "already_imported" : result.profileAdded ? "profile_added" : "created";
  void createLog({ userId, action: "model_imported", targetId: print.id, details: { name: print.name, url } });
  if (body.notify !== false) {
    await notifySingleImport(userId, url, {
      printId: print.id,
      name: print.title || print.name,
      outcome: importOutcome,
    }).catch((e) => console.error("Import notification failed:", e));
  }
  return { ...toPrintOut(print, plates, [], null, author, previewImages), import_outcome: importOutcome };
}

// `?async=1` answers 202 with a task id to poll at /import/tasks/:id (see importTaskService.ts).
router.post(
  "/import",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await normalizeImportUrl(body.url);
    await assertCanImportUrl(req.userId!, url);
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
  provider: z.enum(["makerworld", "thingiverse", "printables"]),
  external_ids: z.array(z.string().max(64)).max(10_000),
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
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an Access Token in Admin Settings.",
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
        "Thingiverse import isn't configured for this instance yet -- ask an admin to add an Access Token in Admin Settings.",
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
