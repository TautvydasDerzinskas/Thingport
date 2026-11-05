import fs from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency, sleep } from "../utils/concurrency";
import {
  detectProvider,
  isProviderId,
  MANIFESTS,
  manifestOf,
  type ProviderId,
  URLS,
} from "../providers/index.generated";
import {
  DOWNLOAD_LIMIT_CODES,
  LINK_PROVIDER,
  type ProviderBackend,
  PROVIDERS,
  SESSION_CODES,
} from "../providers/registry";
import type { ListBatch, ListImportBody, ProfileScope, SourcedImport, StopTexts } from "../providers/types";
import { IMPORT_COLLECTION_DELAY_MS, IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../config";
import { syncSchedulerEnabled } from "./collectionSyncSchedule";
import {
  countJobItems,
  getJob,
  getJobStatus,
  isImportingFrom,
  jobPayload,
  jobProgress,
  jobTakenFromRunner,
  linkTotals,
  listJobItems,
  QUEUE_ATTENTION_PATH,
  QUEUE_WAITING_PATH,
  saveFailureSummary,
  updateJob,
  updateJobItem,
} from "./importJobService";
import { noteImportActivity } from "./importActivity";
import { type ImportOutcome, notifySingleImport } from "./modelNotifications";
import { createNotification } from "./notificationService";
import { addPrintsToCollection, findOrCreateCollectionByName } from "./collectionService";
import { modelIdFromUrl, providerName, syncedCollectionFor } from "./collectionSyncService";
import { siteHost } from "../providers/names";
// MakerWorld's link import (importService.ts) throws its own sign-in error rather than an HttpError with a session code.
import { MakerworldAuthError } from "../providers/makerworld/api";
import { downloadImportToTemp, importPrintFromUrl, type ImportRequestBody } from "./importService";
import { upsertAuthorFromImport } from "./authorService";
import { extractZipEntriesToPrints } from "./zipService";
import { createLog } from "./auditLog";
import { CLOUDFLARE_BLOCKED_CODE } from "./flaresolverr";
import { PROVIDER_DISABLED_CODE } from "./providerSettingsService";
import { HttpError } from "../utils/fileUtils";
import { prisma } from "../db";
import type { ImportJob, Prisma } from "@prisma/client";
import { createLogger } from "../logger";

const log = createLogger("import");
const syncLog = createLogger("sync");

type ZipImportJobBody = ImportRequestBody & { entries: string[] };
export type ProfilesImportJobBody = ImportRequestBody & { scope: Exclude<ProfileScope, "url"> };

// Why a design failed, so a batch reads as one clear cause instead of "N failed". Once a CAPTCHA
// ("rateLimited"), the daily download limit, an auth failure or a Cloudflare block ("blocked")
// hits, every remaining item fails the same way. "disabled": an admin turned the provider off.
// One at a time: bursts of calls trip providers' rate limits, MakerWorld's CAPTCHA first.
const COLLECTION_IMPORT_CONCURRENCY = 1;

export type ImportFailureReason =
  "unavailable" | "rateLimited" | "downloadLimit" | "auth" | "blocked" | "disabled" | "other";
export type StopReason = "rateLimited" | "downloadLimit" | "auth" | "blocked";

const BLOCKED_RETRY_TEXT =
  "Cloudflare blocked the request and FlareSolverr couldn't help: it only covers supported provider pages. Check it in Administration → Connections, then retry";

/** A provider's own words for why it stopped, where it has them. */
function stopTexts(provider: string | null): StopTexts {
  return (provider && isProviderId(provider) && PROVIDERS[provider].stopTexts) || {};
}

/** A Cloudflare block, as a link's failure, by its provider. */
function blockedRetryText(url: string | null): string {
  const own = stopTexts(url && detectProvider(url)).blocked;
  return own ? `${own}, then retry` : BLOCKED_RETRY_TEXT;
}

/** A Cloudflare block, as a sync's. */
function blockedText(provider: string): string {
  return stopTexts(provider).blocked ?? `Cloudflare blocked ${providerName(provider)} and FlareSolverr couldn't help`;
}

export const PROVIDER_OFF_TEXT = (name: string) =>
  `${name} was turned off on this Thingport; an admin can turn it back on in Administration → Providers`;

export function classifyImportFailure(err: unknown): ImportFailureReason {
  if (err instanceof MakerworldAuthError) return "auth";
  if (err instanceof HttpError) {
    if (err.code && SESSION_CODES.has(err.code)) return "auth";
    if (err.code === CLOUDFLARE_BLOCKED_CODE) return "blocked";
    if (err.code === PROVIDER_DISABLED_CODE) return "disabled";
    if (err.status === 403 || err.status === 404) return "unavailable";
    if (err.status === 429) {
      return err.code && DOWNLOAD_LIMIT_CODES.has(err.code) ? "downloadLimit" : "rateLimited";
    }
    if (err.status === 401) return "auth";
  }
  return "other";
}

function asStopReason(reason: ImportFailureReason): StopReason | null {
  return reason === "rateLimited" || reason === "downloadLimit" || reason === "auth" || reason === "blocked"
    ? reason
    : null;
}

/** All undici says when a connection drops partway through a body. */
function isDownloadCutOff(err: unknown): boolean {
  return err instanceof TypeError && err.message === "terminated";
}

const DOWNLOAD_CUT_OFF_TEXT = "The download was cut off.";

export async function markJobFailed(jobId: string, err: unknown): Promise<void> {
  const message = isDownloadCutOff(err) ? DOWNLOAD_CUT_OFF_TEXT : err instanceof Error ? err.message : "Import failed";
  log.error("job failed", { job: jobId, error: err });
  await updateJob(jobId, { status: "ERROR", errorMessage: message }).catch(() => undefined);
}

/** What a batch's notification says went wrong, as a line of its own for its card. Best effort, as a notification is. */
export async function noteFailureSummary(jobId: string, parts: string[]): Promise<void> {
  if (!parts.length) return;
  const text = parts.join(", ");
  await saveFailureSummary(jobId, `${text.charAt(0).toUpperCase()}${text.slice(1)}.`).catch((err) =>
    log.warn("couldn't save why a job's models failed", { job: jobId, error: err }),
  );
}

export type ProfileImportTotals = {
  processed: number;
  imported: number;
  alreadyInLibrary: number;
  failed: number;
  printId: string | null;
  stopReason: StopReason | null;
  /** `shouldStop` said so: the profiles left weren't tried. */
  stopped: boolean;
};

/** Imports each profile URL onto one print, in order. Once a CAPTCHA, download-limit or auth
 * failure hits, every remaining profile fails the same way without another MakerWorld call. */
export async function importProfileUrlsSequentially(
  userId: string,
  profileUrls: string[],
  body: ImportRequestBody,
  onProgress?: (totals: ProfileImportTotals) => void,
  shouldStop?: () => Promise<boolean>,
): Promise<ProfileImportTotals> {
  const totals: ProfileImportTotals = {
    processed: 0,
    imported: 0,
    alreadyInLibrary: 0,
    failed: 0,
    printId: null,
    stopReason: null,
    stopped: false,
  };
  for (const profileUrl of profileUrls) {
    noteImportActivity();
    if (await shouldStop?.()) {
      totals.stopped = true;
      break;
    }
    if (totals.stopReason) {
      totals.failed++;
    } else {
      try {
        const result = await importPrintFromUrl(userId, profileUrl, {
          ...body,
          url: profileUrl,
          makerworldPaceMs: IMPORT_MAKERWORLD_CALL_DELAY_MS,
        });
        totals.printId = result.print.id;
        if (result.alreadyImported) totals.alreadyInLibrary++;
        else totals.imported++;
      } catch (err) {
        totals.failed++;
        totals.stopReason = asStopReason(classifyImportFailure(err));
        log.warn("profile import failed", { url: profileUrl, reason: classifyImportFailure(err), error: err });
      }
    }
    totals.processed++;
    onProgress?.(totals);
  }
  return totals;
}

/** Imports several print profiles of one model as one model with a file per profile. */
async function runProfilesImportJob(
  jobId: string,
  userId: string,
  provider: ProviderId,
  profileUrls: NonNullable<SourcedImport["profiles"]>["listUrls"],
  body: ProfilesImportJobBody,
): Promise<void> {
  const name = MANIFESTS[provider].name;
  try {
    const { title, urls } = await profileUrls(body.url, body.scope);
    await updateJob(jobId, { total: urls.length, sourceLabel: title });
    log.info(`${provider} profiles job started`, { job: jobId, url: body.url, profiles: urls.length });
    const progress = jobProgress(jobId);
    const totals = await importProfileUrlsSequentially(
      userId,
      urls,
      body,
      (t) =>
        progress.write({
          processed: t.processed,
          imported: t.imported,
          alreadyInLibrary: t.alreadyInLibrary,
          failedCount: t.failed,
        }),
      () => jobTakenFromRunner(jobId),
    );
    await progress.settled();
    if (totals.stopped) {
      log.info(`${provider} profiles job stopped`, { job: jobId, processed: totals.processed });
      return;
    }
    const { imported, alreadyInLibrary, failed, stopReason, printId } = totals;
    await updateJob(jobId, {
      status: "DONE",
      // A stalled job that got there after all: the watchdog's words are no longer true.
      errorMessage: null,
      resultPrintId: printId,
      processed: totals.processed,
      imported,
      alreadyInLibrary,
      failedCount: failed,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: printId,
      details: { provider: provider, sourceLabel: title, imported, alreadyInLibrary, failed },
    });
    const failureParts: string[] = [];
    if (stopReason === "auth") failureParts.push(`the rest failed because ${PROVIDERS[provider].authStopText}`);
    else if (failed) failureParts.push(`${failed} failed`);
    await noteFailureSummary(jobId, failureParts);
    const bodyParts = [...(alreadyInLibrary ? [`${alreadyInLibrary} already on the model`] : []), ...failureParts];
    const label = title ? `"${title}"` : `a ${name} model`;
    await createNotification(userId, {
      type: "import",
      title: `Imported ${imported} of ${urls.length} print profiles from ${name}`,
      body: bodyParts.length ? `Of ${label} — ${bodyParts.join(", ")}.` : `Of ${label}.`,
      externalUrl: body.url,
      internalPath: printId ? `/models/${printId}` : failed ? QUEUE_ATTENTION_PATH : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

/** How a model's print profiles import as one model, in a job; null for a provider whose profiles don't. */
export function profilesImportJob(
  provider: ProviderId,
): ((jobId: string, userId: string, body: ProfilesImportJobBody) => Promise<void>) | null {
  const own = PROVIDERS[provider].profilesJob;
  if (own) return own;
  const listUrls = PROVIDERS[provider].sourcedImport?.profiles?.listUrls;
  return listUrls ? (jobId, userId, body) => runProfilesImportJob(jobId, userId, provider, listUrls, body) : null;
}

/** The picked models of a list, imported one by one into a collection named after it, for every provider but
 * MakerWorld, whose collections import by a job of their own. Once the provider's daily download limit is reached, the
 * rest aren't asked for. */
export async function runListImportJob(
  jobId: string,
  userId: string,
  provider: ProviderId,
  batch: ListBatch,
  body: ListImportBody,
): Promise<void> {
  const name = MANIFESTS[provider].name;
  const lists = PROVIDERS[provider].lists;
  const ids = body.model_ids;
  try {
    await batch.ready?.();

    let imported = 0;
    let alreadyInLibrary = 0;
    let processed = 0;
    let unavailable = 0;
    let providerOff = 0;
    let rateLimited = 0;
    let authFailed = 0;
    let downloadLimited = 0;
    const failed: string[] = [];
    const successPrintIds: string[] = [];
    let stopped = false;
    log.info(`${provider} job started`, { job: jobId, url: body.url, models: ids.length });

    await mapWithConcurrency(ids, COLLECTION_IMPORT_CONCURRENCY, async (modelId, index) => {
      stopped ||= await jobTakenFromRunner(jobId);
      if (stopped) return;
      const modelUrl = URLS[provider].modelUrl(modelId);
      if (downloadLimited) {
        // The limit is the account's for the day: every other download would meet it too.
        failed.push(modelId);
        downloadLimited++;
        processed++;
        await updateJob(jobId, { processed, failedCount: failed.length }).catch(() => undefined);
        return;
      }
      const itemBody: ImportRequestBody = {
        url: modelUrl,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        category_id: body.category_id ?? null,
      };
      try {
        const { print, alreadyImported } = await importPrintFromUrl(userId, modelUrl, itemBody);
        successPrintIds.push(print.id);
        if (alreadyImported) alreadyInLibrary++;
        else imported++;
      } catch (err) {
        failed.push(modelId);
        const reason = classifyImportFailure(err);
        log.warn("model import failed", { job: jobId, url: modelUrl, reason, error: err });
        if (reason === "unavailable") unavailable++;
        else if (reason === "rateLimited") rateLimited++;
        else if (reason === "auth") authFailed++;
        else if (reason === "disabled") providerOff++;
        else if (reason === "downloadLimit") downloadLimited++;
      } finally {
        processed++;
        await updateJob(jobId, { processed, imported, alreadyInLibrary, failedCount: failed.length }).catch(
          () => undefined,
        );
      }
      if (index < ids.length - 1 && !downloadLimited) await sleep(IMPORT_COLLECTION_DELAY_MS);
    });
    // Whatever took it keeps it. Its retry runs the whole request, which files what already came in.
    if (stopped) {
      log.info("collection job stopped", { job: jobId, processed, models: ids.length });
      return;
    }

    let resultCollectionId: string | null = null;
    const collectionTitle = await batch.title();
    if (successPrintIds.length) {
      const collection =
        (await syncedCollectionFor(userId, body.url)) ?? (await findOrCreateCollectionByName(userId, collectionTitle));
      await addPrintsToCollection(collection.id, successPrintIds);
      resultCollectionId = collection.id;
    }

    log.info("collection job done", {
      job: jobId,
      collection: collectionTitle,
      imported,
      already_in_library: alreadyInLibrary,
      failed: failed.length,
    });
    await updateJob(jobId, {
      status: "DONE",
      errorMessage: null,
      sourceLabel: collectionTitle,
      resultCollectionId,
      resultPrintId: successPrintIds.length === 1 ? successPrintIds[0] : null,
      processed,
      imported,
      alreadyInLibrary,
      failedCount: failed.length,
    });
    void createLog({
      userId,
      action: "import_completed",
      targetId: resultCollectionId,
      details: { provider, sourceLabel: collectionTitle, imported, alreadyInLibrary, failed: failed.length },
    });

    const failureParts: string[] = [];
    const otherFailed = failed.length - unavailable - rateLimited - authFailed - providerOff - downloadLimited;
    if (unavailable)
      failureParts.push(
        `${unavailable} ${lists?.unavailableText ?? "unavailable (private, deleted, paid, or hidden)"}`,
      );
    if (providerOff) failureParts.push(`${providerOff} skipped — ${PROVIDER_OFF_TEXT(name)}`);
    if (rateLimited) {
      const possessive = name.endsWith("s") ? `${name}'` : `${name}'s`;
      failureParts.push(
        `${rateLimited} ${lists?.rateLimitText ?? `blocked by ${possessive} rate limit — wait a while, then retry`}`,
      );
    }
    if (authFailed) {
      failureParts.push(`${authFailed} ${lists?.authText ?? `failed because ${PROVIDERS[provider].authStopText}`}`);
    }
    if (downloadLimited) {
      failureParts.push(
        `${downloadLimited} not downloaded — ${name}'s daily download limit was reached, retry the same collection tomorrow`,
      );
    }
    if (otherFailed) failureParts.push(`${otherFailed} failed`);
    await noteFailureSummary(jobId, failureParts);
    const bodyParts = [...(alreadyInLibrary ? [`${alreadyInLibrary} already in your library`] : []), ...failureParts];
    const label = batch.label?.(collectionTitle) ?? `"${collectionTitle}"`;
    await createNotification(userId, {
      type: "import",
      title: `Imported ${imported} of ${ids.length} models from ${name}`,
      body: bodyParts.length ? `From ${label} — ${bodyParts.join(", ")}.` : `From ${label}.`,
      externalUrl: body.url,
      internalPath: resultCollectionId
        ? `/models/collections/${resultCollectionId}`
        : failed.length
          ? QUEUE_ATTENTION_PATH
          : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

export async function runZipImportJob(jobId: string, userId: string, body: ZipImportJobBody): Promise<void> {
  let tempPath: string | null = null;
  try {
    const downloaded = await downloadImportToTemp(body.url, body);
    tempPath = downloaded.tempPath;
    const { filename, meta } = downloaded;
    if (path.extname(filename).toLowerCase() !== ".zip") throw new HttpError(415, "Imported file is not a zip");

    await updateJob(jobId, { sourceLabel: filename, total: body.entries.length });
    log.info("zip job started", { job: jobId, file: filename, entries: body.entries.length });

    const author = await upsertAuthorFromImport(meta.author);
    const progress = jobProgress(jobId);
    const { prints, failed } = await extractZipEntriesToPrints(
      userId,
      tempPath,
      body.entries,
      {
        title: body.title ?? meta.title,
        notes: body.notes ?? meta.description,
        tags: body.tags && body.tags.length ? body.tags : meta.tags,
        categoryId: body.category_id,
        creator: meta.creator,
        authorId: author?.id ?? null,
        previewImageUrl: meta.previewImageUrl,
        galleryImages: meta.galleryImages,
      },
      (processed, total, imported, failedSoFar) => {
        progress.write({ processed, total, imported, failedCount: failedSoFar });
      },
    );
    await progress.settled();

    log.info("zip job done", { job: jobId, file: filename, imported: prints.length, failed: failed.length });
    await updateJob(jobId, {
      status: "DONE",
      errorMessage: null,
      processed: body.entries.length,
      imported: prints.length,
      failedCount: failed.length,
      resultPrintId: prints.length === 1 ? prints[0].id : null,
    });
    void createLog({
      userId,
      action: "import_completed",
      details: { provider: "zip", sourceLabel: filename, imported: prints.length, failed: failed.length },
    });

    const bodyParts: string[] = [];
    if (failed.length) bodyParts.push(`${failed.length} failed`);
    await noteFailureSummary(jobId, bodyParts);
    await createNotification(userId, {
      type: "import",
      title: `Imported ${prints.length} of ${body.entries.length} models from ${filename}`,
      body: bodyParts.length ? `${bodyParts.join(", ")}.` : null,
      externalUrl: body.url,
      internalPath: null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  } finally {
    if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/** `itemDelayMs` waits between links; a collection sync's queue is paced that way. */
export type LinksImportJobBody = ImportRequestBody & { scope?: ProfileScope; itemDelayMs?: number };

/** What a link sent from the extension's "Add to the queue" carries on its own item, over the job's
 *  shared body: the panel's collection and profile scope, and the page title to list it by. */
export type QueuedLinkOptions = {
  collection_id?: string | null;
  scope?: ProfileScope;
  title?: string | null;
};

export function parseQueuedLinkOptions(payload: unknown): QueuedLinkOptions {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const p = payload as Record<string, unknown>;
  return {
    collection_id: typeof p.collection_id === "string" && p.collection_id ? p.collection_id : null,
    scope: p.scope === "designer" || p.scope === "all" || p.scope === "url" ? p.scope : undefined,
    title: typeof p.title === "string" && p.title ? p.title : null,
  };
}

// Runners alive in this process, by job: every LINKS job's, and whatever the worker runs. A PAUSED job's runner may
// still be finishing its current link, and a DONE one its notification; starting the job again before then would run
// it twice.
const liveRunners = new Map<string, Promise<void>>();

export function isRunnerLive(jobId: string): boolean {
  return liveRunners.has(jobId);
}

export function liveRunnerIds(): string[] {
  return [...liveRunners.keys()];
}

/** Settles when the job's runner stops, or right away when none is alive. */
export function runnerSettled(jobId: string): Promise<void> {
  return liveRunners.get(jobId) ?? Promise.resolve();
}

/** Makes `run` the job's runner until it settles, so the job counts as owned up to its last write. */
export function trackRunner(jobId: string, run: Promise<void>): Promise<void> {
  const tracked = run.finally(() => {
    if (liveRunners.get(jobId) === tracked) liveRunners.delete(jobId);
  });
  liveRunners.set(jobId, tracked);
  return tracked;
}

// Three tries for a network-ish failure; a provider's own 4xx answer won't change on a retry.
const LINKS_MAX_ATTEMPTS = 3;
const LINKS_RETRY_DELAY_MS = 2000;

/** The sign-in a link's provider turned down; LINK_PROVIDER's for a link of no provider's, imported with its session. */
function authStopText(url: string): string {
  return PROVIDERS[detectProvider(url) ?? LINK_PROVIDER].authStopText;
}

/** What stopped a link for too many requests: its provider's own words, or LINK_PROVIDER's for a link of none. */
function rateLimitText(url: string | null): string {
  const provider = (url && detectProvider(url)) || LINK_PROVIDER;
  return stopTexts(provider).rateLimited ?? `${providerName(provider)} is rate-limiting imports`;
}

/** Whose daily download limit a link met, of the providers that have one; LINK_PROVIDER's when the link says nothing. */
function downloadLimitSite(url: string | null): string {
  const provider = url ? detectProvider(url) : null;
  const limited = provider && manifestOf(provider).errorCodes.downloadLimit;
  return MANIFESTS[limited ? provider : LINK_PROVIDER].name;
}

function isTransientImportFailure(err: unknown): boolean {
  if (err instanceof MakerworldAuthError) return false;
  return !(err instanceof HttpError) || err.transient === true;
}

function failureMessage(err: unknown): string {
  if (isDownloadCutOff(err)) return DOWNLOAD_CUT_OFF_TEXT;
  return err instanceof Error && err.message.trim() ? err.message.trim() : "Import failed";
}

/** The links of the print profiles a scope picks from a model's, for a provider with them. */
function profileUrlsOf(provider: ProviderId): ProviderBackend["profileUrls"] | undefined {
  const backend = PROVIDERS[provider];
  const listUrls = backend.sourcedImport?.profiles?.listUrls;
  return backend.profileUrls ?? (listUrls && ((url, scope) => listUrls(url, scope)));
}

/** One queued link. A model with print profiles and a multi-profile scope imports each wanted profile onto one print,
 *  like the PROFILES job; anything else is a plain single import. `profiles` marks the former, whose totals count
 *  print profiles rather than models. */
async function importOneLink(
  userId: string,
  url: string,
  body: LinksImportJobBody,
): Promise<ProfileImportTotals & { profiles: boolean; outcome: ImportOutcome }> {
  const provider = detectProvider(url);
  const profileUrls = provider && profileUrlsOf(provider);
  if (profileUrls && URLS[provider!].parseModel(url) && body.scope && body.scope !== "url") {
    const { urls } = await profileUrls(url, body.scope, body);
    const totals = await importProfileUrlsSequentially(userId, urls, { ...body, url });
    return { ...totals, profiles: true, outcome: totals.imported ? "created" : "already_imported" };
  }
  const result = await importPrintFromUrl(userId, url, { ...body, url });
  return {
    processed: 1,
    imported: result.alreadyImported ? 0 : 1,
    alreadyInLibrary: result.alreadyImported ? 1 : 0,
    failed: 0,
    printId: result.print.id,
    stopReason: null,
    stopped: false,
    profiles: false,
    outcome: result.alreadyImported ? "already_imported" : result.profileAdded ? "profile_added" : "created",
  };
}

/** Imports a queued list of links, one at a time (parallel bursts trip MakerWorld's CAPTCHA).
 *  A transient failure is retried in place; what still fails stays FAILED on its item so
 *  POST /import/jobs/:id/retry can rerun just those. Also rerun by that route after a CAPTCHA
 *  cooloff or a cookie update. */
export function runLinksImportJob(jobId: string, userId: string, body: LinksImportJobBody): Promise<void> {
  if (liveRunners.has(jobId)) {
    log.warn("a runner is already working on this job, not starting another", { job: jobId });
    return Promise.resolve();
  }
  return trackRunner(jobId, runLinks(jobId, userId, body));
}

const SINGLE_FAILED_TEXT = "Something went wrong on the server.";

/** A one-link job's end, as any import of one link's (services/singleImport.ts): told by itself, not as a batch.
 *  `failure`: what went wrong in this run; a link cut off by a restart says it on its item. */
async function finishSingleJob(
  job: ImportJob,
  print: { id: string; name: string; title: string | null } | null,
  outcome: ImportOutcome | null,
  failure: string | null,
): Promise<void> {
  const url = job.sourceUrl;
  let result: Parameters<typeof notifySingleImport>[2];
  if (print && outcome) {
    void createLog({
      userId: job.userId,
      action: "model_imported",
      targetId: print.id,
      details: { name: print.name, url },
    });
    result = { printId: print.id, name: print.title || print.name, outcome };
  } else {
    const failed = (await listJobItems(job.id)).find((item) => item.status === "FAILED");
    result = { error: failure ?? failed?.errorMessage ?? SINGLE_FAILED_TEXT, internalPath: QUEUE_ATTENTION_PATH };
  }
  await notifySingleImport(job.userId, url, result).catch((err) =>
    log.error("couldn't notify about an import", { job: job.id, error: err }),
  );
}

async function runLinks(jobId: string, userId: string, body: LinksImportJobBody): Promise<void> {
  try {
    const job = await getJob(jobId, userId);
    if (!job) throw new HttpError(404, "Import job not found");
    const payload = jobPayload(job);
    const single = payload.single === true;
    // A one-link job's outcome, and why it failed, in the words a person is told.
    let outcome: ImportOutcome | null = null;
    let failure: string | null = null;
    const items = (await listJobItems(jobId)).filter((item) => item.status === "PENDING");
    const total = await countJobItems(jobId, { in: ["PENDING", "RUNNING", "DONE", "FAILED"] });
    log.info("links job running", { job: jobId, pending: items.length, total });

    let imported = 0;
    let alreadyInLibrary = 0;
    // This run's print profiles, from links with a profile scope; the counts above are models.
    let profilesImported = 0;
    let profilesProcessed = 0;
    let printId: string | null = null;
    let stopReason: StopReason | null = null;
    // The link the stop reason came from, so only its provider marks its sign-in rejected.
    let stopUrl: string | null = null;
    // A sync's links handed back to it by deferSyncRest.
    let deferred: SyncDeferral | null = null;
    // A link's provider was turned off; links from other providers carry on.
    let providerOff = false;
    let processed = (await countJobItems(jobId, "DONE")) + (await countJobItems(jobId, "FAILED"));
    // The models this job has brought in new, for a sync's notification: it comes at the end of the last run, and a job
    // that gave way or was held has had others before it.
    const newPrintIds: string[] = Array.isArray(payload.sync_new) ? (payload.sync_new as string[]).slice() : [];
    const filedBefore = syncFiled(job);
    // MakerOnline links, handed to Thingport Grab: only it can get their files.
    let waitingForGrab = 0;

    for (const [index, item] of items.entries()) {
      if (index > 0 && body.itemDelayMs) await sleep(body.itemDelayMs);
      // Pausing only flips the status; the link that's importing finishes and the rest wait. So it goes for anything
      // else that took the job from its runner: the watchdog, or its owner's account going with it.
      const status = await getJobStatus(jobId);
      if (status !== "RUNNING") {
        log.info("links job stopped", { job: jobId, status, processed, total });
        return;
      }
      const options = parseQueuedLinkOptions(item.payload);
      const itemBody: LinksImportJobBody = options.scope ? { ...body, scope: options.scope } : body;
      const itemProvider = detectProvider(item.url);
      // A sync gives way to an import from the same provider and hands the lane on, its links waiting for a later look.
      // A person's pause, just made, stays a pause.
      if (job.collectionSyncId && itemProvider && (await isImportingFrom(itemProvider, jobId))) {
        await prisma.importJob.updateMany({
          where: { id: jobId, status: "RUNNING" },
          data: { status: "PAUSED", errorMessage: SYNC_JOB_WAITING },
        });
        syncLog.info("job gave way", { job: jobId, provider: itemProvider });
        return;
      }
      const grabQueue = itemProvider ? PROVIDERS[itemProvider].grabQueue : undefined;
      if (grabQueue && URLS[itemProvider!].parseModel(item.url)) {
        await grabQueue.queue(userId, item.url, {
          scope: itemBody.scope,
          collectionId: options.collection_id,
          categoryId: body.category_id,
          tags: body.tags,
          notes: body.notes,
        });
        waitingForGrab++;
        await updateJobItem(item.id, { status: "DONE", errorMessage: null }).catch(() => undefined);
        processed++;
        await updateJob(jobId, { processed }).catch(() => undefined);
        continue;
      }
      await updateJobItem(item.id, { status: "RUNNING" }).catch(() => undefined);
      let attempts = item.attempts;
      let itemError: string | null = null;
      // Some of the link's print profiles got in, though others failed.
      let partlyIn = false;
      let settled = false;
      while (!settled) {
        attempts++;
        if (stopReason) {
          itemError = {
            rateLimited: `${rateLimitText(stopUrl ?? item.url)} — retry once it clears (usually 1-4 hours)`,
            downloadLimit: `${downloadLimitSite(stopUrl)}'s daily download limit was reached — retry tomorrow`,
            auth: authStopText(stopUrl ?? item.url),
            blocked: blockedRetryText(stopUrl ?? item.url),
          }[stopReason];
          settled = true;
          break;
        }
        try {
          const result = await importOneLink(userId, item.url, itemBody);
          outcome = result.outcome;
          // A link is one model however many of its profiles came in.
          if (result.imported && result.printId) newPrintIds.push(result.printId);
          if (result.imported) imported++;
          else if (result.alreadyInLibrary) alreadyInLibrary++;
          if (result.profiles) {
            profilesImported += result.imported;
            profilesProcessed += result.processed;
          }
          if (result.printId) printId = result.printId;
          if (result.printId && options.collection_id) {
            await fileIntoCollection(userId, options.collection_id, result.printId);
          }
          if (result.failed) {
            // Some of the model's profiles got in; the rest are a manual retry's job, since
            // rerunning right away would only re-meet the same CAPTCHA.
            itemError = `${result.failed} of ${result.processed} print profiles failed`;
            partlyIn = result.failed < result.processed;
            if (result.stopReason) {
              stopReason = result.stopReason;
              itemError += {
                rateLimited: ` (${rateLimitText(item.url)} — retry once it clears)`,
                downloadLimit: ` (${downloadLimitSite(item.url)}'s daily download limit — retry tomorrow)`,
                auth: ` (${authStopText(item.url)})`,
                blocked: ` (${blockedRetryText(item.url)})`,
              }[result.stopReason];
            }
            settled = true;
          } else {
            itemError = null;
            settled = true;
          }
        } catch (err) {
          itemError = failureMessage(err);
          failure = err instanceof HttpError ? err.message : isDownloadCutOff(err) ? itemError : SINGLE_FAILED_TEXT;
          stopReason = asStopReason(classifyImportFailure(err)) ?? stopReason;
          if (classifyImportFailure(err) === "disabled") providerOff = true;
          if (!isTransientImportFailure(err) || attempts >= LINKS_MAX_ATTEMPTS) {
            settled = true;
          } else {
            log.warn("link failed, retrying", {
              job: jobId,
              url: item.url,
              error: itemError,
              attempt: attempts + 1,
              attempts: LINKS_MAX_ATTEMPTS,
            });
            await sleep(LINKS_RETRY_DELAY_MS * attempts);
          }
        }
      }
      if (itemError) log.warn("link failed", { job: jobId, url: item.url, error: itemError, attempts });
      else log.info("link imported", { job: jobId, url: item.url });
      if (stopReason && !stopUrl) stopUrl = item.url;
      // The connection failed, not the models: the rest go back to unseen, for the next sync to find
      // again once it works. A link that got some of its profiles in is done.
      // A sync's provider turned off: they come in once it's back on. Thangs' daily download limit resets by itself,
      // so its models wait for a later sync too, rather than for someone to start them again.
      const deferReason = providerOff
        ? "disabled"
        : stopReason === "auth" || stopReason === "blocked"
          ? stopReason
          : stopReason === "downloadLimit" && downloadLimitSite(stopUrl) === "Thangs"
            ? "downloadLimit"
            : null;
      if (job.collectionSyncId && deferReason) {
        const nothingIn = itemError !== null && !partlyIn;
        if (!nothingIn) {
          await updateJobItem(item.id, { status: "FAILED", attempts, errorMessage: itemError }).catch(() => undefined);
          processed++;
        }
        deferred = { count: await deferSyncRest(job, nothingIn ? item.id : null, deferReason), reason: deferReason };
        break;
      }
      // A sync can't ask anyone to retry, so a rate limit pauses it instead of failing the rest. A
      // link that got nothing in waits with them; one that got some of its profiles in is done.
      if (job.collectionSyncId && stopReason) {
        await updateJobItem(item.id, {
          status: itemError !== null && !partlyIn ? "PENDING" : "FAILED",
          attempts,
          errorMessage: itemError,
        }).catch(() => undefined);
        await pauseSyncJob(job, stopReason, newPrintIds);
        return;
      }
      await updateJobItem(item.id, {
        status: itemError ? "FAILED" : "DONE",
        attempts,
        errorMessage: itemError,
      }).catch(() => undefined);
      processed++;
      await updateJob(jobId, {
        processed,
        imported: job.imported + imported,
        alreadyInLibrary: job.alreadyInLibrary + alreadyInLibrary,
        failedCount: await countJobItems(jobId, "FAILED"),
        // With every link: a sync's run can end at any of them, by giving way, a person's pause or a restart.
        ...(job.collectionSyncId
          ? {
              payload: {
                ...payload,
                sync_filed: filedBefore + alreadyInLibrary,
                sync_new: newPrintIds,
              } as Prisma.InputJsonValue,
            }
          : {}),
      }).catch(() => undefined);
    }

    const totalImported = job.imported + imported;
    const failedCount = await countJobItems(jobId, "FAILED");
    log.info("links job done", {
      job: jobId,
      imported: totalImported,
      already_in_library: job.alreadyInLibrary + alreadyInLibrary,
      failed: failedCount,
    });
    // A link handed to Grab hasn't imported anything yet, and one with nothing to tell (cut off after it finished) has
    // no model to name: both end as any job does.
    const singlePrint =
      single && !waitingForGrab && !failedCount && printId
        ? await prisma.print.findUnique({ where: { id: printId }, select: { id: true, name: true, title: true } })
        : null;
    const singleTrail = single && !waitingForGrab && (failedCount > 0 || singlePrint !== null);
    await updateJob(jobId, {
      status: "DONE",
      errorMessage: null,
      processed,
      imported: totalImported,
      alreadyInLibrary: job.alreadyInLibrary + alreadyInLibrary,
      failedCount,
      // A model already in the library must still open.
      resultPrintId: totalImported === 1 || singleTrail ? (printId ?? job.resultPrintId) : null,
      ...(singlePrint && outcome
        ? {
            sourceLabel: singlePrint.title || singlePrint.name,
            payload: { ...jobPayload(job), outcome } as Prisma.InputJsonValue,
          }
        : {}),
    });
    if (!singleTrail) {
      void createLog({
        userId,
        action: "import_completed",
        targetId: printId ?? job.resultPrintId,
        details: { provider: "links", imported, alreadyInLibrary, failed: failedCount },
      });
    }

    const stopProvider = stopReason === "auth" && stopUrl ? detectProvider(stopUrl) : null;
    if (stopProvider) {
      // Scheduled syncs then wait for a new sign-in instead of meeting the same refusal.
      await PROVIDERS[stopProvider]
        .markRejected?.(userId)
        .catch((err) =>
          log.error("couldn't mark the sign-in rejected", { user: userId, provider: stopProvider, error: err }),
        );
    }
    if (job.collectionSyncId && (await notifySyncJobDone(job, newPrintIds, alreadyInLibrary, failedCount, deferred))) {
      return;
    }
    if (singleTrail) {
      await finishSingleJob(job, singlePrint, outcome, failure);
      return;
    }

    const failureParts: string[] = [];
    if (stopReason === "rateLimited") {
      failureParts.push(
        `the rest not imported: ${rateLimitText(stopUrl ?? job.sourceUrl)} — this usually clears in 1-4 hours, then retry the failed links`,
      );
    } else if (stopReason === "downloadLimit") {
      failureParts.push(
        `the rest not downloaded — ${downloadLimitSite(stopUrl)}'s daily download limit was reached, retry the failed links tomorrow`,
      );
    } else if (stopReason === "auth") {
      failureParts.push(`the rest failed because ${authStopText(stopUrl ?? job.sourceUrl)}`);
    } else if (stopReason === "blocked") {
      failureParts.push(`the rest failed: ${blockedRetryText(stopUrl ?? job.sourceUrl)}`);
    } else if (failedCount) {
      failureParts.push(`${failedCount} failed — retry them from the import queue`);
    }
    await noteFailureSummary(jobId, failureParts);
    const bodyParts: string[] = [];
    if (profilesProcessed) bodyParts.push(`${profilesImported} of ${profilesProcessed} print profiles imported`);
    if (waitingForGrab) {
      bodyParts.push(
        `${waitingForGrab} from ${MANIFESTS.makeronline.name} wait for Thingport Grab, which imports them the next time you open ${siteHost("makeronline")}`,
      );
    }
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    bodyParts.push(...failureParts);
    await createNotification(userId, {
      type: "import",
      title: `Imported ${totalImported} of ${total} models`,
      body: bodyParts.length ? `${bodyParts.join(", ")}.` : null,
      externalUrl: job.sourceUrl,
      internalPath: failedCount
        ? QUEUE_ATTENTION_PATH
        : totalImported === 1 && (printId ?? job.resultPrintId)
          ? `/models/${printId ?? job.resultPrintId}`
          : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

// ---- Collection sync jobs ----

/** The pause reason a restart leaves on a sync job, so the next sync picks it up again by itself.
 *  A rate-limited one waits for someone to start it. */
export const SYNC_JOB_INTERRUPTED = "Interrupted by server restart";
/** A sync job a person started, or one that gave way, waiting for the sync lane. */
export const SYNC_JOB_WAITING = "Waiting for its turn among the synced collections";
export const SYNC_RESUME_MARKS = [SYNC_JOB_INTERRUPTED, SYNC_JOB_WAITING];

type SyncJobState = Pick<ImportJob, "status" | "collectionSyncId" | "errorMessage">;

/** A sync job that carries on when the lane gets to its collection, whatever brought the lane there. */
export function hasResumeMark(job: SyncJobState): boolean {
  return job.status === "PAUSED" && Boolean(job.collectionSyncId) && SYNC_RESUME_MARKS.includes(job.errorMessage ?? "");
}

/** A sync job the lane picks up by itself. Any other PAUSED job waits for a person, and so does one a restart cut off
 *  with scheduled sync off, where nothing comes round to it, as it always has. */
export function isWaitingSyncJob(job: SyncJobState): boolean {
  return hasResumeMark(job) && (syncSchedulerEnabled() || job.errorMessage === SYNC_JOB_WAITING);
}

/** How many models a sync's job has filed as already in the library, over its earlier runs. */
function syncFiled(job: Pick<ImportJob, "payload">): number {
  const filed = jobPayload(job).sync_filed;
  return typeof filed === "number" ? filed : 0;
}

const SYNC_NAMES_SHOWN = 3;

async function syncOfJob(job: ImportJob) {
  if (!job.collectionSyncId) return null;
  return prisma.collectionSync.findUnique({ where: { id: job.collectionSyncId }, include: { collection: true } });
}

/** "A, B and 3 more", by the models' titles. */
async function modelNames(printIds: string[]): Promise<string> {
  const prints = await prisma.print.findMany({
    where: { id: { in: printIds.slice(0, SYNC_NAMES_SHOWN) } },
    select: { id: true, name: true, title: true },
  });
  const byId = new Map(prints.map((p) => [p.id, p.title?.trim() || p.name]));
  const names = printIds.slice(0, SYNC_NAMES_SHOWN).flatMap((id) => (byId.has(id) ? [`"${byId.get(id)}"`] : []));
  const more = printIds.length - names.length;
  if (!names.length) return `${printIds.length} model${printIds.length === 1 ? "" : "s"}`;
  if (!more) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.join(", ")} and ${more} more`;
}

function syncStopText(reason: StopReason, provider: string): string {
  if (reason === "downloadLimit") return `${providerName(provider)}'s daily download limit was reached`;
  if (reason === "blocked") return blockedText(provider);
  const own = stopTexts(provider);
  if (reason === "auth") return own.auth?.paused ?? `${providerName(provider)} rejected Thingport's credentials`;
  return own.rateLimited ?? `${providerName(provider)} is rate-limiting imports`;
}

/** The rest of the job waits, paused, in the import queue. */
async function pauseSyncJob(job: ImportJob, reason: StopReason, newPrintIds: string[]): Promise<void> {
  const sync = await syncOfJob(job);
  const provider = sync?.provider ?? job.provider ?? LINK_PROVIDER;
  const stopText = syncStopText(reason, provider);
  const waiting = await countJobItems(job.id, "PENDING");
  await updateJob(job.id, {
    status: "PAUSED",
    errorMessage: stopText.charAt(0).toUpperCase() + stopText.slice(1),
    ...(await linkTotals(job.id)),
  });
  syncLog.warn("job paused", { job: job.id, reason: stopText, waiting });
  const name = sync?.collection.name ?? job.sourceLabel ?? "a synced collection";
  const parts: string[] = [];
  if (newPrintIds.length) parts.push(`${await modelNames(newPrintIds)} came in first.`);
  parts.push(
    `${waiting} new model${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} in the import queue, paused because ${stopText}.`,
  );
  parts.push("Start it again from the import queue once that clears.");
  await createNotification(job.userId, {
    type: "sync",
    title: `Syncing "${name}" is paused`,
    body: parts.join(" "),
    externalUrl: sync?.sourceUrl ?? job.sourceUrl,
    internalPath: QUEUE_WAITING_PATH,
  });
}

type SyncDeferral = { count: number; reason: "auth" | "blocked" | "disabled" | "downloadLimit" };

/** Takes the sync job's links that haven't run (and `currentItemId`'s, which got nothing in) out of
 *  the job, and out of the sync's seen ids, so its next check queues them again. How many. */
async function deferSyncRest(job: ImportJob, currentItemId: string | null, reason: SyncDeferral["reason"]) {
  // One transaction: links gone from the job but still seen by the sync would never come in.
  const handedBack = await prisma.$transaction(async (tx) => {
    const items = await tx.importJobItem.findMany({
      where: { jobId: job.id, OR: [{ status: "PENDING" }, ...(currentItemId ? [{ id: currentItemId }] : [])] },
      select: { id: true, url: true },
    });
    await tx.importJobItem.deleteMany({ where: { id: { in: items.map((item) => item.id) } } });
    await tx.importJob.update({
      where: { id: job.id },
      data: { total: await tx.importJobItem.count({ where: { jobId: job.id } }) },
    });
    const sync = job.collectionSyncId
      ? await tx.collectionSync.findUnique({ where: { id: job.collectionSyncId } })
      : null;
    if (sync) {
      const unseen = new Set(items.flatMap((item) => modelIdFromUrl(sync.provider, item.url) ?? []));
      await tx.collectionSync.update({
        where: { id: sync.id },
        data: {
          knownIds: sync.knownIds.filter((id) => !unseen.has(id)),
          // Where the provider has words of its own, the sync is already held, so holdProvider leaves it out of the
          // notification about the others.
          lastError:
            reason === "disabled"
              ? `${providerName(sync.provider)} is turned off on this Thingport`
              : reason === "blocked"
                ? blockedText(sync.provider)
                : reason === "downloadLimit"
                  ? `${providerName(sync.provider)}'s daily download limit was reached`
                  : (stopTexts(sync.provider).auth?.handedBack ??
                    `${providerName(sync.provider)} turned Thingport's sign-in down`),
        },
      });
    }
    return items;
  });
  syncLog.warn("links handed back to the sync", { job: job.id, links: handedBack.length, reason });
  return handedBack.length;
}

/** Says which new models came in. False when the sync is gone, for the plain notification. */
async function notifySyncJobDone(
  job: ImportJob,
  newPrintIds: string[],
  alreadyInLibrary: number,
  failedCount: number,
  deferred: SyncDeferral | null,
): Promise<boolean> {
  const sync = await syncOfJob(job);
  if (!sync) return false;
  const filed = syncFiled(job) + alreadyInLibrary;
  const name = sync.collection.name;
  const parts: string[] = [];
  if (newPrintIds.length) parts.push(`${await modelNames(newPrintIds)} from ${providerName(sync.provider)}.`);
  if (filed) {
    parts.push(
      `${filed} model${filed === 1 ? " that was" : "s that were"} already in your library ${filed === 1 ? "was" : "were"} added to it too.`,
    );
  }
  if (deferred) {
    const own = stopTexts(sync.provider);
    const more = `${deferred.count} more model${deferred.count === 1 ? "" : "s"}`;
    parts.push(
      deferred.reason === "auth" && own.auth
        ? `${more} ${own.auth.deferred}`
        : deferred.reason === "disabled"
          ? `${more} will come in on a later sync: ${PROVIDER_OFF_TEXT(providerName(sync.provider))}.`
          : deferred.reason === "downloadLimit"
            ? `${more} will come in on a later sync: ${providerName(sync.provider)}'s daily download limit for your account was reached.`
            : deferred.reason === "auth"
              ? `${more} will come in on a later sync: ${providerName(sync.provider)} turned Thingport's sign-in down.`
              : own.blocked
                ? `${more} will come in on a later sync: ${own.blocked}.`
                : `${more} will come in on a later sync: Cloudflare blocked ${providerName(sync.provider)} and FlareSolverr couldn't help. An admin can check FlareSolverr in Administration → Connections.`,
    );
  }
  if (failedCount) {
    parts.push(
      `${failedCount} couldn't be imported (private, deleted, or failed); retry ${failedCount === 1 ? "it" : "them"} from the import queue.`,
    );
  }
  const count = newPrintIds.length;
  await createNotification(job.userId, {
    type: "sync",
    title: count
      ? `${count} new model${count === 1 ? "" : "s"} synced into "${name}"`
      : `Couldn't sync new models into "${name}"${deferred ? " yet" : ""}`,
    body: parts.join(" ") || null,
    externalUrl: sync.sourceUrl,
    internalPath: `/models/collections/${sync.collectionId}`,
  });
  return true;
}

/** The collection picked in the extension's panel. Checked against the owner at run time, since
 *  it may have been deleted while the link waited in the queue; a miss doesn't fail the link. */
async function fileIntoCollection(userId: string, collectionId: string, printId: string): Promise<void> {
  try {
    const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } });
    if (collection) await addPrintsToCollection(collection.id, [printId]);
  } catch (err) {
    log.warn("couldn't add the model to its collection", { print: printId, collection: collectionId, error: err });
  }
}
