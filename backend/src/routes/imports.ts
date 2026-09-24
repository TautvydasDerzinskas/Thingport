import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { normalizeImportUrl } from "../utils/urlUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { checkImportStatus, downloadImportToTemp, findImportedExternalIds, importPrintFromUrl, inspectImportLink } from "../services/importService";
import { resolveMakerworldCookie } from "../services/importResolvers";
import { extractMakerworldBearerToken, MakerworldAuthError, MakerworldCaptchaError } from "../services/makerworldCloudApi";
import { fetchMakerworldCollectionEntries, fetchMakerworldCollectionTitle, parseMakerworldCollectionUrl } from "../services/makerworldCollections";
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
import { createJob, getActiveJob, getJob } from "../services/importJobService";
import {
  runCollectionImportJob,
  runPrintablesCollectionImportJob,
  runThingiverseCollectionImportJob,
  runThingiverseLikesImportJob,
  runZipImportJob,
} from "../services/importJobRunner";
import { createLog } from "../services/auditLog";
import { toImportJobOut, toPrintOut } from "../dto";

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
  // Set by the Thingport Grab browser extension for MakerWorld imports: it reads __NEXT_DATA__
  // off the live model page and resolves this itself via a fetch() made from that page's own
  // context (real cookies attached automatically, looks like organic browsing) -- see
  // openImportResponse's use of it in importService.ts. When present, the backend skips both of
  // its own resolution paths (the api.bambulab.com cloud API and the api/v1 HTML-scrape
  // fallback) entirely, since those are the only two call sites that can trip MakerWorld's
  // CAPTCHA and its 2-hour blanket cooloff (see makerworldCaptcha.ts).
  resolved_download_url: z.string().nullable().optional(),
  resolved_instance_id: z.string().nullable().optional(),
});

// The frontend normally sends the browser's own locally-stored MakerWorld cookie on every
// import request (see utils/settings.ts) -- this only kicks in when that's missing (a different
// browser/device, or the request just didn't include one), falling back to whatever the user
// last saved via Settings > Imports (see routes/settings.ts's PATCH /settings/makerworld).
async function withStoredMakerworldCookie<T extends { makerworld_cookie?: string | null }>(userId: string, body: T): Promise<T> {
  if (body.makerworld_cookie && body.makerworld_cookie.trim()) return body;
  const stored = await getUserMakerworldCookie(userId);
  return stored ? { ...body, makerworld_cookie: stored } : body;
}

router.post(
  "/import",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await normalizeImportUrl(body.url);
    const result = await importPrintFromUrl(req.userId!, url, body);
    const { print, plates, author, previewImages } = result;
    // Lets a client tell "added this MakerWorld profile to a model you already had" apart from
    // a fresh import and from a no-op (see importService.ts's addMakerworldProfileToPrint).
    const importOutcome = result.alreadyImported ? "already_imported" : result.profileAdded ? "profile_added" : "created";
    res.json({ ...toPrintOut(print, plates, [], null, author, previewImages), import_outcome: importOutcome });
    void createLog({ userId: req.userId!, action: "model_imported", targetId: print.id, details: { name: print.name, url } });
  }),
);

router.post(
  "/import/inspect",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await normalizeImportUrl(body.url);
    const result = await inspectImportLink(url, body);
    res.json(result);
  }),
);

// Deliberately GET + a plain query param, and skips normalizeImportUrl's DNS-resolution SSRF
// check (see urlUtils.ts) -- unlike every other import route, this never fetches the URL itself,
// so there's nothing to protect against and no reason to pay that latency. Called on every page
// load by the Thingport Grab browser extension to decide whether to show its floating icon on a
// single-model page (see checkImportStatus's own doc comment for why a listing page always comes
// back not-already-imported).
router.get(
  "/import/status",
  asyncHandler(async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) throw new HttpError(400, "url is required");
    res.json(await checkImportStatus(req.userId!, url));
  }),
);

router.post(
  "/import/zip/entries",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(importRequestSchema, req.body));
    const url = await normalizeImportUrl(body.url);
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
    const url = await normalizeImportUrl(body.url);
    const parsed = parseMakerworldCollectionUrl(url);
    if (!parsed) throw new HttpError(400, "Not a MakerWorld collection URL");
    const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));

    // Sequential, not Promise.all: firing the title fetch and the (paginated, up to 15-page)
    // entries listing at once was its own unpaced burst -- see IMPORT_MAKERWORLD_CALL_DELAY_MS's
    // comment in config.ts. The entries call paces its own pages via that same constant, which
    // also covers the gap after this title call since it's always the first request in the pair.
    let title: string | null;
    let listing: Awaited<ReturnType<typeof fetchMakerworldCollectionEntries>>;
    try {
      title = await fetchMakerworldCollectionTitle(parsed.collectionId, bearerToken);
      listing = await fetchMakerworldCollectionEntries(parsed.collectionId, bearerToken, undefined, IMPORT_MAKERWORLD_CALL_DELAY_MS);
    } catch (err) {
      if (err instanceof MakerworldCaptchaError) throw new HttpError(429, err.message);
      // 400, not 401: this is MakerWorld's own session rejecting our request, not the caller's
      // Thingport session -- the frontend's generic API client treats any 401 as "your
      // Thingport session expired" and force-logs-out, which would be exactly wrong here. See
      // the same reasoning at importService.ts's tryMakerworldCloudApi/importThingiverseThing.
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
    const url = await normalizeImportUrl(body.url);
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
    if (!listing.entries.length) throw new HttpError(400, "Could not load this user's likes -- check the username and try again");

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
    const url = await normalizeImportUrl(body.url);
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
    const url = await normalizeImportUrl(body.url);
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

// ---- Background batch imports (MakerWorld/Thingiverse collections, Thingiverse Likes, zip) ----
//
// All three of these can involve downloading dozens to hundreds of files, which used to happen
// synchronously inside the request -- long enough to run past reverse-proxy read timeouts with
// no feedback. They now just register an ImportJob and return immediately; the actual work runs
// in the background (importJobRunner.ts) and is polled via GET /import/jobs/:id. At most one
// job may be RUNNING per user at a time -- that's both the "already in progress" guard and what
// lets the frontend restore its progress bar after a page refresh via GET /import/jobs/active.

async function assertNoActiveJob(userId: string): Promise<void> {
  const active = await getActiveJob(userId);
  if (active) throw new HttpError(409, "An import is already in progress");
}

const collectionImportRequestSchema = importRequestSchema.extend({ design_ids: z.array(z.string()).min(1) });

router.post(
  "/import/collection",
  asyncHandler(async (req, res) => {
    const body = await withStoredMakerworldCookie(req.userId!, parseBody(collectionImportRequestSchema, req.body));
    await assertNoActiveJob(req.userId!);
    const url = await normalizeImportUrl(body.url);
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
  asyncHandler(async (req, res) => {
    const body = parseBody(thingiverseLikesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await normalizeImportUrl(body.url);
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
  asyncHandler(async (req, res) => {
    const body = parseBody(thingiverseLikesImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await normalizeImportUrl(body.url);
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

const printablesCollectionImportRequestSchema = importRequestSchema.extend({ model_ids: z.array(z.string()).min(1) });

router.post(
  "/import/printables-collection",
  asyncHandler(async (req, res) => {
    const body = parseBody(printablesCollectionImportRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await normalizeImportUrl(body.url);
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
  asyncHandler(async (req, res) => {
    const body = parseBody(zipExtractRequestSchema, req.body);
    await assertNoActiveJob(req.userId!);
    const url = await normalizeImportUrl(body.url);
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

router.get(
  "/import/jobs/:id",
  asyncHandler(async (req, res) => {
    const job = await getJob(req.params.id, req.userId!);
    if (!job) throw new HttpError(404, "Import job not found");
    res.json(toImportJobOut(job));
  }),
);

export default router;
