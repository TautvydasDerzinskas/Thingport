import { IMPORT_COLLECTION_DELAY_MS } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { sleep } from "../utils/concurrency";
import { isProviderId, type ProviderId } from "../providers/index.generated";
import { PROVIDERS, withLinkAuth } from "../providers/registry";
import { siteHost } from "../providers/names";
import { createLog } from "./auditLog";
import { createNotification } from "./notificationService";
import {
  downloadLinkedModelFiles,
  downloadSourcedModelFiles,
  replaceModelFiles,
  type ImportRequestBody,
} from "./importService";
import { classifyImportFailure, type ImportFailureReason, type StopReason } from "./importJobRunner";
import { forgetMissingFilesScan, missingFilesScan, type BrokenModel } from "./missingFilesService";
import { deletePrint, pruneWhatModelsLeft } from "./printEditService";
import { assertUrlProviderEnabled } from "./providerSettingsService";

// Putting a library back together once its files are gone (what missingFilesService.ts found): either fetching
// every broken model's files from the site it came from, or deleting the models whose files aren't coming back.
// One run per user at a time, in the background with a bar at the bottom of the app, like the AI runs.
//
// A re-import keeps the row and replaces only its files, so everything the owner curated -- tags, collections,
// favourites, the name -- survives, and a provider that can't be reached leaves the model exactly as broken as it
// was rather than deleted. Models whose files only Thingport Grab can fetch are parked for its next visit to the
// site, where the files it brings replace theirs the same way (see providers/makeronline, providers/owlcad).

const log = createLogger("model-repair");

/** Between models, so a library's worth of re-imports doesn't read as an attack to the provider. */
const ITEM_DELAY_MS = IMPORT_COLLECTION_DELAY_MS;
/** A provider failing this many times in a row has stopped answering; the rest would only fail too. */
const FAILURE_LIMIT = 5;

export type RepairAction = "reimport" | "delete";

export type ModelRepairRun = {
  action: RepairAction;
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  /** Models whose files came back. */
  repaired: number;
  /** Models parked for Thingport Grab's next visit to their site. */
  queued: number;
  deleted: number;
  /** Models with nothing to fetch from: an upload, or a provider an admin turned off. */
  skipped: number;
  failed: number;
  cancelled: boolean;
  /** Why it left the rest: a rate limit, the day's download allowance, a sign-in or a block. */
  stopReason: StopReason | null;
  lastError: string | null;
};

const runs = new Map<string, ModelRepairRun>();

export function currentModelRepairRun(userId: string): ModelRepairRun | null {
  return runs.get(userId) ?? null;
}

/** Null when one is already going for this user. */
export function startModelRepairRun(userId: string, action: RepairAction): ModelRepairRun | null {
  if (runs.get(userId)?.running) return null;
  const run: ModelRepairRun = {
    action,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    repaired: 0,
    queued: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
    stopReason: null,
    lastError: null,
  };
  runs.set(userId, run);
  log.info("run started", { user: userId, action });
  void (action === "delete" ? deleteBroken(userId, run) : reimportBroken(userId, run))
    .catch((error) => {
      run.failed++;
      run.lastError = messageOf(error);
      log.error("run crashed", { user: userId, error });
    })
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      // What the run left behind is what the next look should report.
      forgetMissingFilesScan(userId);
      const summary = { user: userId, ...run, lastError: run.lastError ?? undefined };
      if (run.failed) log.warn("run finished with failures", summary);
      else log.info("run finished", summary);
      void createLog({ userId, action: "models_repaired", details: { ...run } });
      void notifyRunFinished(userId, run).catch((error) =>
        log.warn("could not notify the repair run", { user: userId, error }),
      );
    });
  return run;
}

export function cancelModelRepairRun(userId: string): ModelRepairRun | null {
  const run = runs.get(userId);
  if (!run) return null;
  run.cancelled = true;
  return run;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The models to work through: scanned afresh, so a run never acts on a list that has moved on. */
async function brokenNow(userId: string, run: ModelRepairRun): Promise<BrokenModel[]> {
  const scan = await missingFilesScan(userId, { refresh: true });
  run.total = scan.broken.length;
  return scan.broken;
}

// ---- Deleting ----

async function deleteBroken(userId: string, run: ModelRepairRun): Promise<void> {
  const broken = await brokenNow(userId, run);
  // Authors and tags left with nothing are read once at the end: after every model it would be a scan of the
  // library per deletion.
  const went: { authorId: string | null; tags: string[] }[] = [];
  for (const model of broken) {
    if (run.cancelled) break;
    try {
      const print = await prisma.print.findFirst({
        where: { id: model.id, userId },
        select: { authorId: true, tags: true },
      });
      if (!print) {
        run.skipped++;
      } else {
        await deletePrint(userId, model.id, { quiet: true, prune: false });
        went.push(print);
        run.deleted++;
      }
    } catch (error) {
      run.failed++;
      run.lastError = messageOf(error);
      log.warn("couldn't delete a model", { user: userId, print: model.id, error });
    }
    run.done++;
  }
  if (went.length) await pruneWhatModelsLeft(userId, went).catch(() => undefined);
}

// ---- Re-importing ----

async function reimportBroken(userId: string, run: ModelRepairRun): Promise<void> {
  const broken = await brokenNow(userId, run);
  /** Parked models per provider, so one heads-up names each site once. */
  const parked = new Map<ProviderId, number>();
  let consecutiveFailures = 0;

  for (const model of broken) {
    if (run.cancelled) break;
    const provider = model.provider;
    if (model.route === "none" || !model.sourceUrl || !model.externalId || !provider || !isProviderId(provider)) {
      run.skipped++;
      run.done++;
      continue;
    }
    if (run.done) await sleep(ITEM_DELAY_MS);
    try {
      if (await repairModel(userId, provider, model)) {
        run.repaired++;
      } else {
        run.queued++;
        parked.set(provider, (parked.get(provider) ?? 0) + 1);
      }
      consecutiveFailures = 0;
    } catch (error) {
      const reason = classifyImportFailure(error);
      run.lastError = messageOf(error);
      // A provider an admin turned off is nothing this model did: there was never going to be a fetch.
      if (reason === "disabled") {
        run.skipped++;
      } else {
        run.failed++;
        consecutiveFailures++;
      }
      log.warn("couldn't repair a model", { user: userId, print: model.id, reason, error });
      const stop = stopReasonOf(reason);
      if (stop || consecutiveFailures >= FAILURE_LIMIT) {
        run.stopReason = stop;
        if (!stop) run.lastError = `stopped after ${FAILURE_LIMIT} models in a row failed: ${run.lastError}`;
        run.done++;
        break;
      }
    }
    run.done++;
  }

  for (const [provider, count] of parked) {
    try {
      await PROVIDERS[provider].grabQueue?.notifyQueued(userId, count, {
        externalUrl: `https://${siteHost(provider)}/`,
        internalPath: "/models",
      });
    } catch (error) {
      log.warn("could not say what waits for Grab", { user: userId, provider, error });
    }
  }
}

/** Once a provider turns the sign-in down, runs out of downloads for the day or blocks us, the models after this
 *  one would only fail the same way, so the run stops and says which of the four it was. */
function stopReasonOf(reason: ImportFailureReason): StopReason | null {
  const stopping: ImportFailureReason[] = ["rateLimited", "downloadLimit", "auth", "blocked"];
  return stopping.includes(reason) ? (reason as StopReason) : null;
}

/** One model's files, fetched and put in place of the missing ones. False when only Thingport Grab can fetch them
 *  and the import was parked for its next visit to the site. */
async function repairModel(userId: string, provider: ProviderId, model: BrokenModel): Promise<boolean> {
  const url = model.sourceUrl!;
  await assertUrlProviderEnabled(url);
  const backend = PROVIDERS[provider];
  if (backend.grabQueue) {
    await backend.grabQueue.queue(userId, url);
    return false;
  }
  // The provider's own pick of files, as a fresh import of the model's page would get: a model that had several of
  // its print profiles comes back with that pick, and the others are added by importing their links again.
  const files = backend.sourcedImport
    ? await downloadSourcedModelFiles(userId, model.externalId!, backend.sourcedImport)
    : await downloadLinkedModelFiles(url, await withLinkAuth<ImportRequestBody>(userId, { url }));
  await replaceModelFiles(userId, model.id, files);
  return true;
}

// ---- Telling the owner ----

const models = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function notifyRunFinished(userId: string, run: ModelRepairRun): Promise<void> {
  if (!run.total) return;
  const deleting = run.action === "delete";
  const parts = [
    run.repaired && models(run.repaired, "model got its files back", "models got their files back"),
    run.queued &&
      `${models(run.queued, "model waits", "models wait")} for Thingport Grab to visit the site its files come from`,
    run.deleted && models(run.deleted, "model was deleted", "models were deleted"),
    run.skipped && models(run.skipped, "model had nothing to fetch from", "models had nothing to fetch from"),
    run.failed && models(run.failed, "model couldn't be repaired", "models couldn't be repaired"),
  ].filter(Boolean);
  const stopped = run.stopReason ? ` ${stopText(run.stopReason)}` : "";
  const lastError = run.failed && run.lastError ? ` Last error: ${run.lastError}` : "";
  await createNotification(userId, {
    type: deleting ? "general" : "import",
    title: run.cancelled
      ? `Repairing models stopped after ${run.done} of ${run.total}`
      : deleting
        ? "Deleted the models whose files were missing"
        : `Fetching missing files finished ${run.total} ${run.total === 1 ? "model" : "models"}`,
    body: parts.length ? `${parts.join(". ")}.${stopped}${lastError}` : null,
    internalPath: "/models",
  });
}

function stopText(reason: StopReason): string {
  if (reason === "downloadLimit") return "The rest were left: the day's download allowance ran out.";
  if (reason === "auth") return "The rest were left: the site turned the sign-in down.";
  if (reason === "blocked") return "The rest were left: the site blocked the requests.";
  return "The rest were left: the site asked for a pause. Try them again later.";
}
