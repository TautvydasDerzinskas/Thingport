// MakerWorld's own import jobs: its collections and a model's print profiles, imported one link at a time, paced
// against its CAPTCHA. Loaded only when one runs, as the import runner they share reaches the registry.

import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import { createLogger } from "../../logger";
import { createLog } from "../../services/auditLog";
import { addPrintsToCollection, findOrCreateCollectionByName } from "../../services/collectionService";
import { syncedCollectionFor } from "../../services/collectionSyncService";
import { updateJob } from "../../services/importJobService";
import {
  classifyImportFailure,
  importProfileUrlsSequentially,
  markJobFailed,
  PROVIDER_OFF_TEXT,
  type ProfilesImportJobBody,
} from "../../services/importJobRunner";
import { resolveMakerworldCookie } from "./pageData";
import { importPrintFromUrl, type ImportRequestBody } from "../../services/importService";
import { createNotification } from "../../services/notificationService";
import { mapWithConcurrency } from "../../utils/concurrency";
import { HttpError } from "../../utils/fileUtils";
import manifest from "../_generated/makerworld/manifest";
import { makerworldModelUrl } from "../_generated/makerworld/urls";
import { extractMakerworldBearerToken, MAKERWORLD_DOWNLOAD_LIMIT_CODE, MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE } from "./api";
import { fetchMakerworldCollectionTitle, parseMakerworldCollectionUrl } from "./collections";
import { listMakerworldProfileUrls } from "./profiles";
import { markMakerworldCookieRejected, withStoredMakerworldCookie } from "./session";

const log = createLogger("import");
const NAME = manifest.name;

// Sequential on purpose: parallel bursts of api.bambulab.com calls trip MakerWorld's CAPTCHA.
const COLLECTION_IMPORT_CONCURRENCY = 1;

type CollectionImportJobBody = ImportRequestBody & { design_ids: string[] };

/** A model's print profiles, imported with the user's stored cookie where the request gave none. */
export async function runMakerworldProfilesJob(
  jobId: string,
  userId: string,
  body: ProfilesImportJobBody,
): Promise<void> {
  let withCookie: ProfilesImportJobBody;
  try {
    withCookie = await withStoredMakerworldCookie(userId, body);
  } catch (err) {
    return markJobFailed(jobId, err);
  }
  return runMakerworldProfilesImportJob(jobId, userId, withCookie);
}

/** Imports several print profiles of one MakerWorld model as one model with a file per profile. */
async function runMakerworldProfilesImportJob(
  jobId: string,
  userId: string,
  body: ProfilesImportJobBody,
): Promise<void> {
  try {
    const { title, urls: profileUrls, rawFiles } = await listMakerworldProfileUrls(body.url, body.scope, body);
    await updateJob(jobId, { total: profileUrls.length, sourceLabel: title });
    log.info("makerworld profiles job started", { job: jobId, url: body.url, profiles: profileUrls.length });

    const totals = await importProfileUrlsSequentially(
      userId,
      profileUrls,
      body,
      (t) =>
        void updateJob(jobId, {
          processed: t.processed,
          imported: t.imported,
          alreadyInLibrary: t.alreadyInLibrary,
          failedCount: t.failed,
        }).catch(() => undefined),
    );
    const { imported, alreadyInLibrary, failed, stopReason } = totals;
    const printId = totals.printId;
    log.info("makerworld profiles job done", {
      job: jobId,
      imported,
      already_in_library: alreadyInLibrary,
      failed,
      stop_reason: stopReason ?? undefined,
    });

    await updateJob(jobId, {
      status: "DONE",
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
      details: { provider: manifest.id, sourceLabel: title, imported, alreadyInLibrary, failed },
    });

    if (stopReason === "auth") await noteMakerworldRejected(userId);
    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already on the model`);
    if (stopReason === "rateLimited") {
      bodyParts.push(
        `the rest blocked by a ${NAME} CAPTCHA challenge — this usually clears in 1-4 hours, then import the model again to add the missing profiles`,
      );
    } else if (stopReason === "downloadLimit") {
      bodyParts.push(
        `the rest not downloaded — ${NAME}'s daily download limit was reached, import the model again tomorrow to add the missing profiles`,
      );
    } else if (stopReason === "auth") {
      bodyParts.push(
        `the rest failed because your ${NAME} session expired — update the cookie in Settings and import again`,
      );
    } else if (failed) {
      bodyParts.push(`${failed} failed`);
    }
    const label = title ? `"${title}"` : `a ${NAME} model`;
    await createNotification(userId, {
      type: "import",
      // A model with no print profiles comes in as its raw files, all at once.
      title: rawFiles
        ? `Imported ${imported} of 1 model from ${NAME}`
        : `Imported ${imported} of ${profileUrls.length} print profiles from ${NAME}`,
      body: bodyParts.length ? `Of ${label} — ${bodyParts.join(", ")}.` : `Of ${label}.`,
      externalUrl: body.url,
      internalPath: printId ? `/models/${printId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

export async function runCollectionImportJob(
  jobId: string,
  userId: string,
  body: CollectionImportJobBody,
): Promise<void> {
  try {
    let imported = 0;
    let alreadyInLibrary = 0;
    let processed = 0;
    let unavailable = 0;
    let providerOff = 0;
    let rateLimited = 0;
    let downloadLimited = 0;
    let authFailed = 0;
    const failed: string[] = [];
    const successPrintIds: string[] = [];
    log.info("makerworld collection job started", { job: jobId, url: body.url, models: body.design_ids.length });

    await mapWithConcurrency(body.design_ids, COLLECTION_IMPORT_CONCURRENCY, async (designId) => {
      const modelUrl = makerworldModelUrl(designId);
      const itemBody: ImportRequestBody = {
        url: modelUrl,
        notes: body.notes ?? null,
        tags: body.tags ?? [],
        category_id: body.category_id ?? null,
        makerworld_cookie: body.makerworld_cookie,
        makerworldPaceMs: IMPORT_MAKERWORLD_CALL_DELAY_MS,
      };
      try {
        // Every later download would hit the same limit, so don't spend more requests on it.
        if (downloadLimited) {
          throw new HttpError(429, MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE, MAKERWORLD_DOWNLOAD_LIMIT_CODE);
        }
        const { print, alreadyImported } = await importPrintFromUrl(userId, modelUrl, itemBody);
        successPrintIds.push(print.id);
        if (alreadyImported) alreadyInLibrary++;
        else imported++;
      } catch (err) {
        failed.push(designId);
        const reason = classifyImportFailure(err);
        log.warn("model import failed", { job: jobId, url: modelUrl, reason, error: err });
        if (reason === "unavailable") unavailable++;
        else if (reason === "rateLimited") rateLimited++;
        else if (reason === "downloadLimit") downloadLimited++;
        else if (reason === "auth") authFailed++;
        else if (reason === "disabled") providerOff++;
      } finally {
        processed++;
        // A progress-write failure mustn't fail the whole batch.
        await updateJob(jobId, { processed, imported, alreadyInLibrary, failedCount: failed.length }).catch(
          () => undefined,
        );
      }
    });

    let resultCollectionId: string | null = null;
    let collectionTitle: string | null = null;
    const synced = successPrintIds.length ? await syncedCollectionFor(userId, body.url) : null;
    if (synced) {
      await addPrintsToCollection(synced.id, successPrintIds);
      resultCollectionId = synced.id;
      collectionTitle = synced.name;
    } else if (successPrintIds.length) {
      const url = body.url;
      const parsed = parseMakerworldCollectionUrl(url);
      if (parsed) {
        const bearerToken = extractMakerworldBearerToken(resolveMakerworldCookie(body));
        collectionTitle = await fetchMakerworldCollectionTitle(
          parsed.collectionId,
          bearerToken,
          IMPORT_MAKERWORLD_CALL_DELAY_MS,
        );
        if (collectionTitle) {
          const collection = await findOrCreateCollectionByName(userId, collectionTitle);
          await addPrintsToCollection(collection.id, successPrintIds);
          resultCollectionId = collection.id;
        }
      }
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
      details: {
        provider: manifest.id,
        sourceLabel: collectionTitle,
        imported,
        alreadyInLibrary,
        failed: failed.length,
      },
    });

    if (authFailed) await noteMakerworldRejected(userId);
    const label = collectionTitle ? `"${collectionTitle}"` : `a ${NAME} collection`;
    const bodyParts: string[] = [];
    if (alreadyInLibrary) bodyParts.push(`${alreadyInLibrary} already in your library`);
    const otherFailed = failed.length - unavailable - rateLimited - downloadLimited - authFailed - providerOff;
    if (unavailable) bodyParts.push(`${unavailable} unavailable (private, deleted, or hidden)`);
    if (providerOff) bodyParts.push(`${providerOff} skipped — ${PROVIDER_OFF_TEXT(NAME)}`);
    if (rateLimited) {
      bodyParts.push(
        `${rateLimited} blocked by a ${NAME} CAPTCHA challenge (too many requests at once) — this usually clears in 1-4 hours, then retry the same collection`,
      );
    }
    if (downloadLimited) {
      bodyParts.push(
        `${downloadLimited} not downloaded — ${NAME}'s daily download limit was reached, retry the same collection tomorrow`,
      );
    }
    if (authFailed)
      bodyParts.push(
        `${authFailed} failed because your ${NAME} session expired — update the cookie in Settings and retry`,
      );
    if (otherFailed) bodyParts.push(`${otherFailed} failed`);
    await createNotification(userId, {
      type: "import",
      title: `Imported ${imported} of ${body.design_ids.length} models from ${NAME}`,
      body: bodyParts.length ? `From ${label} — ${bodyParts.join(", ")}.` : `From ${label}.`,
      externalUrl: body.url,
      internalPath: resultCollectionId ? `/models/collections/${resultCollectionId}` : null,
    });
  } catch (err) {
    await markJobFailed(jobId, err);
  }
}

/** Scheduled MakerWorld syncs then wait for a new cookie instead of meeting the same refusal. */
async function noteMakerworldRejected(userId: string): Promise<void> {
  await markMakerworldCookieRejected(userId).catch((err) =>
    log.error("couldn't mark the MakerWorld cookie rejected", { user: userId, error: err }),
  );
}
