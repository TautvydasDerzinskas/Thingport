import fs from "node:fs/promises";
import path from "node:path";
import { type Request, type Response, Router } from "express";
import { z, type ZodType, type ZodTypeDef } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { prisma } from "../db";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { requireCaptcha } from "../services/captchaService";
import { enabledImportUrl, importRequestSchema, mustRunNow } from "./importRequest";
import {
  checkImportStatus,
  downloadImportToTemp,
  findImportedExternalIds,
  inspectImportLink,
} from "../services/importService";
import { findLibraryPrints } from "../services/collectionSyncService";
import { listZipEntries } from "../services/zipService";
import { createJob, createJobItems, getActiveJob, getJob, listJobItems } from "../services/importJobService";
import {
  type EnqueuedJob,
  enqueueLinksImport,
  enqueueListImport,
  enqueueProfilesImport,
  enqueueSingleImport,
  enqueueZipImport,
  queueLink,
  startQueueJob,
} from "../services/importQueueService";
import { getImportTask, startImportTask } from "../services/importTaskService";
import { profilesImportJob, runLinksImportJob, runListImportJob, runZipImportJob } from "../services/importJobRunner";
import { notifyImportRun } from "../services/modelNotifications";
import { maskQueued, toImportJobItemOut, toImportJobOut } from "../dto";
import type { Prisma } from "@prisma/client";
import { importAndDescribe, prepareSingleImport } from "../services/singleImport";
import { previewSourceLink } from "../services/modelLinkService";
import {
  isProviderId,
  type LegacyIdsField,
  type ListKind,
  MANIFESTS,
  parseListUrl,
  parseModelUrl,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderManifest,
} from "../providers/index.generated";
import { PROVIDERS, withLinkAuth } from "../providers/registry";
import type { ProviderLists } from "../providers/types";

const router = Router();
router.use(requireAuth);

// The line is opt-in. `?queue=1` is a client saying it knows what a job waiting there reads like; one that doesn't
// (Thingport Grab from before it, a tab left open, a script) gets what these routes have always done, 409s included.

/** The request, when it asked for the line and can wait there. */
function lineRequest<T extends Parameters<typeof mustRunNow>[0]>(
  req: Request,
  schema: ZodType<T, ZodTypeDef, unknown>,
): T | null {
  if (req.query.queue !== "1") return null;
  const body = parseBody(schema, req.body);
  return mustRunNow(body) ? null : body;
}

/** Never the key `queued`: that's a list waiting for Grab. */
function answerInLine(res: Response, { job, position }: EnqueuedJob): void {
  res.status(202).json({ job_id: job.id, status: "QUEUED", position });
}

// `?async=1` answers 202 with a task id to poll at /import/tasks/:id (see importTaskService.ts).
router.post(
  "/import",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const forLine = lineRequest(req, importRequestSchema);
    if (forLine) {
      const { url } = await prepareSingleImport(req.userId!, forLine);
      answerInLine(res, await enqueueSingleImport(req.userId!, url, forLine));
      return;
    }
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
    const body = await withLinkAuth(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await enabledImportUrl(body.url);
    const result = await inspectImportLink(url, body);
    res.json(result);
  }),
);

// What linking an existing model to this link would bring (services/modelLinkService.ts).
router.post(
  "/import/preview",
  asyncHandler(async (req, res) => {
    const { url } = parseBody(z.object({ url: z.string() }), req.body);
    res.json(await previewSourceLink(req.userId!, url));
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
  provider: z.enum(PROVIDER_IDS),
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
    const body = await withLinkAuth(req.userId!, parseBody(importRequestSchema, req.body));
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

// ---- Lists and print profiles, the same way for every provider ----
// /import/<provider>/list/entries reads a collection, likes or bookmarks to pick from, /import/<provider>/list imports
// the picked models, and /import/<provider>/profiles a model's print profiles as one model. The endpoints each
// provider had before them stay as aliases (its manifest's `legacy`), for clients that still call them.

const listImportSchema = importRequestSchema.extend({
  model_ids: z.array(z.string()).min(1),
  // As Thingport Grab read it: the instance can't read a private Printables collection's name itself.
  collection_title: z.string().max(300).nullable().optional(),
});

const profilesImportSchema = importRequestSchema.extend({ scope: z.enum(["designer", "all"]) });

function providerParam(req: Request): ProviderId {
  if (!isProviderId(req.params.provider)) throw new HttpError(404, "Unknown provider");
  return req.params.provider;
}

function listsOf(provider: ProviderId): ProviderLists {
  const lists = PROVIDERS[provider].lists;
  if (!lists) throw new HttpError(404, `${MANIFESTS[provider].name} has no lists to import`);
  return lists;
}

/** The link, normalized, unless it isn't one of the provider's lists (of the kinds given). */
async function listUrlOf(provider: ProviderId, raw: string, kinds?: readonly ListKind[]): Promise<string> {
  const url = await enabledImportUrl(raw);
  const list = parseListUrl(url);
  if (list?.provider !== provider || (kinds && !kinds.includes(list.kind))) {
    const name = MANIFESTS[provider].name;
    throw new HttpError(400, kinds ? `Not a link to a ${name} ${kinds.join(" or ")}` : `Not a link to a ${name} list`);
  }
  return url;
}

async function listEntries(req: Request, res: Response, provider: ProviderId, kinds?: readonly ListKind[]) {
  const lists = listsOf(provider);
  const body = parseBody(importRequestSchema, req.body);
  const url = await listUrlOf(provider, body.url, kinds);
  const list = await lists.read(req.userId!, url, body);
  const alreadyImported = await findImportedExternalIds(
    req.userId!,
    provider,
    list.entries.map((e) => e.externalId),
  );
  res.json({
    title: list.title,
    total: list.total,
    truncated: list.truncated,
    entries: list.entries.map((e) => ({
      design_id: e.externalId,
      title: e.title,
      cover: e.cover,
      already_imported: alreadyImported.has(e.externalId),
    })),
  });
}

async function importList(
  req: Request,
  res: Response,
  provider: ProviderId,
  kinds?: readonly ListKind[],
  idsField: LegacyIdsField = "model_ids",
) {
  const userId = req.userId!;
  const lists = listsOf(provider);
  const raw: unknown = req.body;
  const renamed =
    idsField !== "model_ids" && raw && typeof raw === "object"
      ? { ...raw, model_ids: (raw as Record<string, unknown>)[idsField] }
      : raw;
  const body = parseBody(
    listImportSchema.extend({ model_ids: lists.modelIds ?? listImportSchema.shape.model_ids }),
    renamed,
  );
  if (req.query.queue === "1" && !lists.waitsForGrab && !mustRunNow(body)) {
    const url = await listUrlOf(provider, body.url, kinds);
    answerInLine(res, await enqueueListImport(userId, provider, url, body));
    return;
  }
  if (!lists.waitsForGrab) await assertNoActiveJob(userId);
  const url = await listUrlOf(provider, body.url, kinds);
  const start = await lists.start(userId, url, { ...body, url });
  if ("waitForGrab" in start) {
    const grabQueue = PROVIDERS[provider].grabQueue;
    if (!grabQueue) throw new Error(`${provider} waits for Grab without a queue for it`);
    const { queued, collectionId } = await grabQueue.queueList(userId, start.waitForGrab.title, { ...body, url });
    res.status(202).json({ queued, collection_id: collectionId });
    return;
  }
  const job = await createJob(userId, "COLLECTION", { sourceUrl: url, provider, total: body.model_ids.length });
  void ("run" in start ? start.run(job.id) : runListImportJob(job.id, userId, provider, start.batch, { ...body, url }));
  res.status(202).json({ job_id: job.id });
}

async function importProfiles(req: Request, res: Response, provider: ProviderId) {
  const userId = req.userId!;
  const name = MANIFESTS[provider].name;
  const run = profilesImportJob(provider);
  if (!run) throw new HttpError(404, `${name} has no print profiles to import together`);
  const body = parseBody(profilesImportSchema, req.body);
  if (req.query.queue === "1" && !mustRunNow(body)) {
    const url = await enabledImportUrl(body.url);
    if (parseModelUrl(url)?.provider !== provider) throw new HttpError(400, `Not a ${name} model link`);
    answerInLine(res, await enqueueProfilesImport(userId, provider, url, body));
    return;
  }
  await assertNoActiveJob(userId);
  const url = await enabledImportUrl(body.url);
  if (parseModelUrl(url)?.provider !== provider) throw new HttpError(400, `Not a ${name} model link`);
  const job = await createJob(userId, "PROFILES", { sourceUrl: url, provider });
  void run(job.id, userId, { ...body, url });
  res.status(202).json({ job_id: job.id });
}

router.post(
  "/import/:provider/list/entries",
  asyncHandler((req, res) => listEntries(req, res, providerParam(req))),
);
router.post(
  "/import/:provider/list",
  requireCaptcha("import"),
  asyncHandler((req, res) => importList(req, res, providerParam(req))),
);
router.post(
  "/import/:provider/profiles",
  requireCaptcha("import"),
  asyncHandler((req, res) => importProfiles(req, res, providerParam(req))),
);

for (const provider of PROVIDER_IDS) {
  // Widened: providers added since the generic routes have none.
  const { legacy } = MANIFESTS[provider] as ProviderManifest;
  for (const { path: listPath, kinds, idsField } of legacy?.lists ?? []) {
    router.post(
      `/import/${listPath}/entries`,
      asyncHandler((req, res) => listEntries(req, res, provider, kinds)),
    );
    router.post(
      `/import/${listPath}`,
      requireCaptcha("import"),
      asyncHandler((req, res) => importList(req, res, provider, kinds, idsField)),
    );
  }
  if (legacy?.profiles) {
    router.post(
      `/import/${legacy.profiles}`,
      requireCaptcha("import"),
      asyncHandler((req, res) => importProfiles(req, res, provider)),
    );
  }
}

// Without ?queue=1, a batch import runs in the background at once and is polled via GET /import/jobs/:id.
// One RUNNING job per user doubles as the "already in progress" lock.

async function assertNoActiveJob(userId: string): Promise<void> {
  const active = await getActiveJob(userId);
  if (active) throw new HttpError(409, "An import is already in progress");
}

const zipExtractRequestSchema = importRequestSchema.extend({ entries: z.array(z.string()) });

router.post(
  "/import/zip",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const forLine = lineRequest(req, zipExtractRequestSchema);
    if (forLine) {
      const url = await enabledImportUrl(forLine.url);
      if (!forLine.entries.length) throw new HttpError(400, "No files to import");
      answerInLine(res, await enqueueZipImport(req.userId!, url, forLine));
      return;
    }
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
    const forLine = lineRequest(req, linksImportRequestSchema);
    if (forLine) {
      const urls: string[] = [];
      for (const raw of forLine.urls) {
        const url = await enabledImportUrl(raw.trim());
        if (!urls.includes(url)) urls.push(url);
      }
      answerInLine(res, await enqueueLinksImport(req.userId!, urls, forLine));
      return;
    }
    const body = await withLinkAuth(req.userId!, parseBody(linksImportRequestSchema, req.body));
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
 * batch. It joins the line, which someone following the job reads as still running. */
router.post(
  "/import/jobs/:id/retry",
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const job = await getJob(req.params.id, req.userId!);
    if (!job) throw new HttpError(404, "Import job not found");
    await startQueueJob(job, { retryFailed: true, manual: true });
    res.status(202).json({ job_id: job.id });
  }),
);

const queueLinkRequestSchema = z.object({
  url: z.string().min(1),
  collection_id: z.string().nullable().optional(),
  scope: z.enum(["url", "designer", "all"]).optional(),
  title: z.string().max(500).nullable().optional(),
});

/** The extension's "Add to the queue": the link waits, paused, in the user's queue until they start it from the import
 *  queue, or joins the line by itself if they've asked for that (`started`). Nothing is fetched now, so this is quick
 *  and never trips a CAPTCHA. */
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
      started: result.started,
      position: result.position,
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
    const out = toImportJobOut(job);
    res.json(req.query.queue === "1" ? out : maskQueued(out));
  }),
);

export default router;
