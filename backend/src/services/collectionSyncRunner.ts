// The scheduled side of synced collections. Each collection is checked on its own interval: its
// provider listing is compared with the ids it has seen, new models already in the library are
// filed into the collection, and the rest go into a paced import queue job of the sync's own.
// Scheduled and "Sync now" checks share one lane, one collection at a time across every user,
// since they all reach the providers from the same IP. A sync's job only ever runs in this lane, a
// person's Start included, and never joins the import line. It gives way to whatever else is
// importing from the same provider by returning, not by waiting: the line never waits for the lane
// nor the lane for the line, so nothing can deadlock and other providers' syncs carry on.

import type { Collection, CollectionSync, ImportJob, Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  isSyncDue,
  markSchedulerStarted,
  SYNC_STARTUP_DELAY_MS,
  SYNC_TICK_MS,
  syncSchedulerEnabled,
} from "./collectionSyncSchedule";
import { COLLECTION_SYNC_ITEM_DELAY_MS, IMPORT_COLLECTION_DELAY_MS } from "../config";
import { sleep } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { addPrintsToCollection } from "./collectionService";
import { findLibraryPrints, hasProfiles, modelUrlFor, providerName, sourceDescription } from "./collectionSyncService";
import { isImportingFrom, jobPayload } from "./importJobService";
import {
  hasResumeMark,
  type LinksImportJobBody,
  runLinksImportJob,
  SYNC_JOB_WAITING,
  SYNC_RESUME_MARKS,
} from "./importJobRunner";
import { importWorkerTuning, isDatabaseSwitching, launchLinksJob } from "./importWorker";
import { isProviderId } from "../providers/index.generated";
import { PROVIDERS, withLinkAuth } from "../providers/registry";
import { SyncHeldError, type SyncProblem } from "../providers/syncProblem";
import type { ProviderSync, SyncedList } from "../providers/types";
import { syncLikesUsername } from "../providers/names";
import { createNotification } from "./notificationService";
import { createLog } from "./auditLog";
import { getDisabledProviders, isProviderEnabled, type Provider } from "./providerSettingsService";

// Checks in a row that must find the provider's collection gone before it's unsynced.
const MISSING_CHECKS_TO_UNSYNC = 2;

type SyncWithCollection = CollectionSync & { collection: Collection };

/** How the provider's synced lists are checked; every provider with lists has it. */
const syncOf = (provider: string): ProviderSync | undefined =>
  isProviderId(provider) ? PROVIDERS[provider].sync : undefined;

/** The one list a provider's problem holds, where only it needs the sign-in; all of the provider's otherwise. */
const heldAlone = (sync: Pick<CollectionSync, "provider" | "externalId">) =>
  syncOf(sync.provider)?.signInOnly?.(sync.externalId) ? sync.externalId : undefined;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The provider collection's model ids, or null when the provider says it no longer exists. Throws
 *  when there's no clear answer, so an outage never unsyncs anything. */
export async function fetchListing(sync: SyncedList & Pick<CollectionSync, "provider">): Promise<string[] | null> {
  const provider = syncOf(sync.provider);
  if (!provider) throw new Error(`Unknown provider "${sync.provider}"`);
  return provider.fetchListing(sync);
}

export type SyncOutcome =
  | "missing" // the sync was removed before its turn
  | "busy" // its job is running, or an import from its provider is; tried again next time
  | "resumed" // a job waiting for its turn was picked up again
  | "error" // the provider couldn't be read
  | "disconnected" // the provider isn't connected, or turned the login down; not checked till it is
  | "disabled" // an admin turned the provider off for the instance
  | "gone" // the provider's collection wasn't found, not yet often enough to unsync
  | "unsynced"
  | "unchanged"
  | "filed" // new models were all in the library already
  | "queued";

// Syncs waiting in the lane or running, so one collection is never in it twice.
const syncing = new Set<string>();
// Every sync, scheduled or "Sync now", runs after the one before it.
let lane: Promise<unknown> = Promise.resolve();

/** Claims the collection's place, synchronously, so two requests checking at once can't both get
 *  it. False when it's already taken. Pass `reserved` to syncCollection, or release it. */
export function reserveSync(syncId: string): boolean {
  if (syncing.has(syncId) || isDatabaseSwitching()) return false;
  syncing.add(syncId);
  return true;
}

export function releaseSync(syncId: string): void {
  syncing.delete(syncId);
}

/** A sync reserved, in the lane or running, or a round going through them. */
export function hasActiveCollectionSync(): boolean {
  return syncing.size > 0 || currentRound !== null;
}

/** One collection's sync, once the lane gets to it. Resolves once anything it started has finished
 *  importing, or has given way. `reserved`: the caller already holds the collection's place (see
 *  reserveSync). `resumeOnly`: it's here for a job waiting for the lane, which by its turn may have
 *  gone or been held; it isn't a check of the provider. */
export function syncCollection(syncId: string, { reserved = false, resumeOnly = false } = {}): Promise<SyncOutcome> {
  if (!reserved && !reserveSync(syncId)) return Promise.resolve("busy");
  const run = lane.then(() => runSync(syncId, resumeOnly)).finally(() => syncing.delete(syncId));
  lane = run.catch(() => undefined);
  return run;
}

/** `"A"`, `"A" and "B"`, or the first few and how many more. */
function listNames(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length <= 3) return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
  return `${quoted.slice(0, 2).join(", ")} and ${quoted.length - 2} more`;
}

/** One notification for every collection the problem holds. */
async function notifyHeld(
  userId: string,
  provider: string,
  problem: SyncProblem,
  syncs: SyncWithCollection[],
): Promise<void> {
  if (!syncs.length) return;
  const one = syncs.length === 1 ? syncs[0] : null;
  await createNotification(userId, {
    type: "sync",
    title: one
      ? `Couldn't sync "${one.collection.name}"`
      : `Couldn't sync ${syncs.length} ${providerName(provider)} collections`,
    body: `${problem.reason} ${listNames(syncs.map((sync) => sync.collection.name))} won't sync until ${problem.fix} in Configuration → Providers. ${one ? "It stays synced, and its models stay." : "They stay synced, and their models stay."}`,
    externalUrl: one?.sourceUrl ?? null,
    internalPath: one ? `/models/collections/${one.collectionId}` : "/models/collections",
  });
}

/** Why the provider can't be reached for this sync right now, or null when it can. Checked before
 *  any provider call, so a sync with nothing to sign in with waits instead of failing every round. */
async function connectionProblem(sync: SyncedList & Pick<CollectionSync, "provider">): Promise<SyncProblem | null> {
  return (await syncOf(sync.provider)?.connectionProblem?.(sync)) ?? null;
}

/** Holds every one of the user's syncs with this provider at once (or only the one with `externalId`),
 *  with one notification for the ones not already held; later rounds find the error saved and stay
 *  quiet. Last check times are left alone, so they're due again as soon as the provider is connected. */
async function holdProvider(
  userId: string,
  provider: string,
  problem: SyncProblem,
  externalId?: string,
): Promise<void> {
  const fresh = await prisma.collectionSync.findMany({
    where: { userId, provider, externalId, OR: [{ lastError: null }, { lastError: { not: problem.error } }] },
    include: { collection: true },
    orderBy: { createdAt: "asc" },
  });
  if (!fresh.length) return;
  await prisma.collectionSync.updateMany({
    where: { id: { in: fresh.map((sync) => sync.id) } },
    data: { lastError: problem.error },
  });
  console.warn(`[sync] ${fresh.length} ${provider} collection(s) of user ${userId} held: ${problem.error}`);
  await notifyHeld(userId, provider, problem, fresh);
}

/** Runs a waiting job until it ends or stops. False when it changed since it was read: a Hold made meanwhile stays a
 *  hold, and whatever it is now gets looked at again next time. */
async function resumeJob(job: ImportJob): Promise<boolean> {
  try {
    const { run } = await launchLinksJob(job);
    await run;
    return true;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return false;
    throw err;
  }
}

async function runSync(syncId: string, resumeOnly: boolean): Promise<SyncOutcome> {
  const sync = await prisma.collectionSync.findUnique({ where: { id: syncId }, include: { collection: true } });
  if (!sync) return "missing";
  const { userId } = sync;
  const problem = await connectionProblem(sync);
  if (problem) {
    await holdProvider(userId, sync.provider, problem, heldAlone(sync));
    return "disconnected";
  }

  const openJobs = await prisma.importJob.findMany({
    where: { collectionSyncId: sync.id, status: { in: ["RUNNING", "PAUSED"] } },
    orderBy: { createdAt: "asc" },
  });
  if (openJobs.some((job) => job.status === "RUNNING")) return "busy";
  // Whatever else is importing from this provider goes first. Nothing is marked seen, so a later look finds it all.
  if (await isImportingFrom(sync.provider)) return "busy";
  // Before a job on hold: a retry can open an older job while a newer one sits held. A second waiting job gets its turn
  // on a later look.
  const waiting = openJobs.find(hasResumeMark);
  if (waiting) {
    const left = await prisma.importJobItem.count({
      where: { jobId: waiting.id, status: { in: ["PENDING", "RUNNING"] } },
    });
    // With none left it still runs, to its end, if it has models to tell of.
    const untold = jobPayload(waiting).sync_new;
    if (left || (Array.isArray(untold) && untold.length)) return (await resumeJob(waiting)) ? "resumed" : "busy";
    // Cut off after its last link: nothing to pick up again.
    await prisma.importJob.update({ where: { id: waiting.id }, data: { status: "DONE", errorMessage: null } });
  }
  if (resumeOnly) return "unchanged";
  // A job on hold takes the new links.
  const openJob = openJobs.find((job) => !hasResumeMark(job)) ?? null;

  let listing: string[] | null;
  try {
    listing = await fetchListing(sync);
  } catch (err) {
    if (err instanceof SyncHeldError) {
      await holdProvider(userId, sync.provider, err.problem, sync.externalId);
      return "disconnected";
    }
    const rejected = syncOf(sync.provider)?.rejected;
    if (rejected?.is(err)) {
      await rejected.mark(userId);
      await holdProvider(userId, sync.provider, rejected.problem, rejected.onlyThis ? sync.externalId : undefined);
      return "disconnected";
    }
    const message = err instanceof Error && err.message.trim() ? err.message.trim() : "Sync failed";
    console.warn(`[sync] "${sync.collection.name}" (${sync.provider} ${sync.externalId}): ${message}`);
    await prisma.collectionSync
      .update({ where: { id: sync.id }, data: { lastCheckedAt: new Date(), lastError: message } })
      .catch(() => undefined);
    return "error";
  }

  if (!listing) {
    const missingChecks = sync.missingChecks + 1;
    if (missingChecks >= MISSING_CHECKS_TO_UNSYNC) {
      await unsyncGone(sync);
      return "unsynced";
    }
    await prisma.collectionSync.update({
      where: { id: sync.id },
      data: {
        missingChecks,
        lastCheckedAt: new Date(),
        lastError: `${capitalize(sourceDescription(sync))} couldn't be found`,
      },
    });
    return "gone";
  }

  const known = new Set(sync.knownIds);
  const fresh = [...new Set(listing)].filter((id) => !known.has(id));
  // Seen ids are only ever added: a listing that comes back short, or a model the user deleted from
  // their library, mustn't bring anything back in.
  const markChecked = () =>
    prisma.collectionSync.update({
      where: { id: sync.id },
      data: { knownIds: [...known, ...fresh], missingChecks: 0, lastCheckedAt: new Date(), lastError: null },
    });
  if (!fresh.length) {
    await markChecked();
    return "unchanged";
  }

  const inLibrary = await findLibraryPrints(userId, sync.provider, fresh);
  const toImport = fresh.filter((id) => !inLibrary.has(id));
  const itemPayload: Prisma.InputJsonValue = {
    collection_id: sync.collectionId,
    scope: hasProfiles(sync.provider) ? sync.profileScope : "url",
    title: null,
  };

  const grabQueue = isProviderId(sync.provider) ? PROVIDERS[sync.provider].grabQueue : undefined;
  if (toImport.length && grabQueue) {
    // Its files only come through Thingport Grab: the new models wait for its next visit there.
    for (const id of toImport) {
      await grabQueue.queue(userId, modelUrlFor(sync.provider, id), {
        scope: sync.profileScope === "designer" || sync.profileScope === "all" ? sync.profileScope : "url",
        collectionId: sync.collectionId,
      });
    }
    await addPrintsToCollection(sync.collectionId, [...inLibrary.values()]);
    await markChecked();
    await grabQueue.notifyQueued(userId, toImport.length, {
      label: sync.collection.name,
      externalUrl: sync.sourceUrl,
      internalPath: `/models/collections/${sync.collectionId}`,
    });
    return "queued";
  }

  if (toImport.length && openJob) {
    // The sync's paused job waits for someone to start it; new models wait with it.
    const queued = new Set(
      (await prisma.importJobItem.findMany({ where: { jobId: openJob.id }, select: { url: true } })).map((i) => i.url),
    );
    const urls = toImport.map((id) => modelUrlFor(sync.provider, id)).filter((url) => !queued.has(url));
    await prisma.importJobItem.createMany({
      data: urls.map((url) => ({ jobId: openJob.id, url, payload: itemPayload })),
    });
    await prisma.importJob.update({
      where: { id: openJob.id },
      data: { total: await prisma.importJobItem.count({ where: { jobId: openJob.id } }) },
    });
    await addPrintsToCollection(sync.collectionId, [...inLibrary.values()]);
    await markChecked();
    if (inLibrary.size) await notifyFiled(sync, [...inLibrary.values()]);
    return "queued";
  }

  if (toImport.length) {
    const job = await prisma.importJob.create({
      data: {
        userId,
        type: "LINKS",
        status: "RUNNING",
        sourceUrl: sync.sourceUrl,
        sourceLabel: `Sync: ${sync.collection.name}`,
        provider: sync.provider,
        total: toImport.length,
        collectionSyncId: sync.id,
        payload: {
          notes: null,
          tags: [],
          category_id: null,
          scope: "url",
          item_delay_ms: COLLECTION_SYNC_ITEM_DELAY_MS,
          sync_filed: inLibrary.size,
        },
      },
    });
    await prisma.importJobItem.createMany({
      data: toImport.map((id) => ({ jobId: job.id, url: modelUrlFor(sync.provider, id), payload: itemPayload })),
    });
    await addPrintsToCollection(sync.collectionId, [...inLibrary.values()]);
    await markChecked();
    // As every LINKS job runs, with LINK_PROVIDER's stored sign-in (see importWorker.ts).
    await runLinksImportJob(
      job.id,
      userId,
      await withLinkAuth<LinksImportJobBody>(userId, {
        url: sync.sourceUrl,
        notes: null,
        tags: [],
        category_id: null,
        scope: "url",
        itemDelayMs: COLLECTION_SYNC_ITEM_DELAY_MS,
      }),
    );
    return "queued";
  }

  await addPrintsToCollection(sync.collectionId, [...inLibrary.values()]);
  await markChecked();
  await notifyFiled(sync, [...inLibrary.values()]);
  return "filed";
}

/** New on the provider, but already in the library: only filed into the collection. */
async function notifyFiled(sync: SyncWithCollection, printIds: string[]): Promise<void> {
  const n = printIds.length;
  await createNotification(sync.userId, {
    type: "sync",
    title: `${n} model${n === 1 ? "" : "s"} added to "${sync.collection.name}"`,
    body: syncLikesUsername(sync)
      ? `${n === 1 ? "It was" : "They were"} liked on ${providerName(sync.provider)} and already in your library.`
      : `${n === 1 ? "It was" : "They were"} added to the ${providerName(sync.provider)} collection and already in your library.`,
    externalUrl: sync.sourceUrl,
    internalPath: `/models/collections/${sync.collectionId}`,
  });
}

async function unsyncGone(sync: SyncWithCollection): Promise<void> {
  await prisma.collectionSync.delete({ where: { id: sync.id } });
  const name = sync.collection.name;
  const provider = providerName(sync.provider);
  console.warn(`[sync] "${name}": the ${provider} collection is gone, unsynced`);
  void createLog({
    userId: sync.userId,
    action: "collection_sync_disabled",
    targetId: sync.collectionId,
    details: { name, provider: sync.provider, url: sync.sourceUrl, reason: "source_gone" },
  });
  await createNotification(sync.userId, {
    type: "sync",
    title: `"${name}" is no longer synced`,
    body: `${capitalize(sourceDescription(sync))} can't be found any more, so new models won't come in. The models already in "${name}" stay.`,
    externalUrl: sync.sourceUrl,
    internalPath: `/models/collections/${sync.collectionId}`,
  });
}

/** "Sync now" from the collection's menu. The outcomes that don't send a notification of their own
 *  get one here, so a manual sync always answers, "nothing new" included. Never rejects: the route
 *  starts it without waiting, so failures are logged and answered with "error". With `reserved`,
 *  the collection's place is released however it ends. */
export async function runManualSync(syncId: string, { reserved = false } = {}): Promise<SyncOutcome> {
  // Once syncCollection has the reservation, it releases it; until then, it's this function's.
  let handedOver = !reserved;
  try {
    const before = await prisma.collectionSync.findUnique({ where: { id: syncId }, include: { collection: true } });
    if (!before) return "missing";
    let outcome: SyncOutcome;
    try {
      // Gives way out here, so a click doesn't hold up other providers' syncs in the lane. The collection's place stays
      // taken: a second click is refused, and a scheduled check finds it busy.
      while (await isImportingFrom(before.provider)) {
        await sleep(Math.max(COLLECTION_SYNC_ITEM_DELAY_MS, importWorkerTuning.syncGiveWayMs));
      }
      handedOver = true;
      // Turned off since the click was accepted: told, as any other outcome is.
      outcome = (await isProviderEnabled(before.provider)) ? await syncCollection(syncId, { reserved }) : "disabled";
      if (outcome === "disabled") releaseSync(syncId);
    } catch (err) {
      console.error(`[sync] manual sync of ${syncId} failed:`, err);
      outcome = "error";
    }
    await notifyManualOutcome(before, outcome);
    return outcome;
  } catch (err) {
    console.error(`[sync] manual sync of ${syncId} failed:`, err);
    return "error";
  } finally {
    if (!handedOver) releaseSync(syncId);
  }
}

/** The answer to "Sync now" for the outcomes that send no notification of their own. */
async function notifyManualOutcome(before: SyncWithCollection, outcome: SyncOutcome): Promise<void> {
  const after = await prisma.collectionSync.findUnique({ where: { id: before.id } });
  // holdProvider only notifies the first time; a click after that still gets an answer.
  if (outcome === "disconnected" && after?.lastError === before.lastError) {
    const problem = syncOf(before.provider)?.problems.find((p) => p.error === after?.lastError);
    if (problem) await notifyHeld(before.userId, before.provider, problem, [before]);
    return;
  }
  const name = before.collection.name;
  const provider = providerName(before.provider);
  const message: Partial<Record<SyncOutcome, { title: string; body: string }>> = {
    unchanged: { title: `"${name}" is up to date`, body: `No new models in ${sourceDescription(before)}.` },
    busy: {
      title: `Couldn't sync "${name}" yet`,
      body: `An import from ${provider} is running. Try Sync now again once it's done.`,
    },
    error: {
      title: `Couldn't sync "${name}"`,
      body: `${after?.lastError ?? `${provider} couldn't be read`}. The sync tries again on its next round.`,
    },
    disabled: {
      title: `Couldn't sync "${name}"`,
      body: `${provider} is turned off on this Thingport, so its collections don't sync. An admin can turn it back on in Administration > Providers.`,
    },
    gone: {
      title: `Couldn't find "${name}" on ${provider}`,
      body: `${capitalize(sourceDescription(before))} may have been deleted. If it's still missing on the next check, "${name}" is unsynced; its models stay.`,
    },
  };
  const note = message[outcome];
  if (!note) return;
  await createNotification(before.userId, {
    type: "sync",
    ...note,
    externalUrl: before.sourceUrl,
    internalPath: `/models/collections/${before.collectionId}`,
  });
}

let currentRound: Promise<void> | null = null;

/** The collections with a job waiting for the lane, which can't wait for their interval. A job a restart cut off only
 *  counts with scheduled sync on: off, it waits for a person, as it always has. */
async function syncsWithWaitingJobs(): Promise<Set<string | null>> {
  const jobs = await prisma.importJob.findMany({
    where: {
      status: "PAUSED",
      collectionSyncId: { not: null },
      errorMessage: { in: syncSchedulerEnabled() ? SYNC_RESUME_MARKS : [SYNC_JOB_WAITING] },
    },
    select: { collectionSyncId: true },
  });
  return new Set(jobs.map((job) => job.collectionSyncId));
}

/** The synced collections that are due, the longest unchecked first, and those with a job waiting
 *  for the lane. With scheduled sync off, only those. A round still going when the next tick comes
 *  is left to finish instead. */
export function runSyncRound(): Promise<void> {
  if (currentRound) return currentRound;
  if (isDatabaseSwitching()) return Promise.resolve();
  currentRound = (async () => {
    const waiting = await syncsWithWaitingJobs();
    const syncs = await prisma.collectionSync.findMany({
      orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
      select: {
        id: true,
        userId: true,
        provider: true,
        externalId: true,
        sourceUrl: true,
        lastCheckedAt: true,
        intervalHours: true,
      },
    });
    const due: string[] = [];
    // A provider an admin turned off: its syncs wait, quietly, until it's back on.
    const disabled = await getDisabledProviders();
    // Each user's connection to each provider, looked up once a round.
    const problems = new Map<string, SyncProblem | null>();
    const scheduled = new Set(syncSchedulerEnabled() ? syncs.filter((s) => isSyncDue(s)).map((s) => s.id) : []);
    const isDue = (s: (typeof syncs)[number]) => scheduled.has(s.id) || waiting.has(s.id);
    for (const sync of syncs.filter((s) => isDue(s) && !disabled.has(s.provider as Provider))) {
      const only = heldAlone(sync);
      const key = `${sync.userId} ${sync.provider}${only ? ` ${only}` : ""}`;
      if (problems.has(key)) {
        if (!problems.get(key)) due.push(sync.id);
        continue;
      }
      const problem = await connectionProblem(sync);
      problems.set(key, problem);
      if (!problem) {
        due.push(sync.id);
        continue;
      }
      // Held here rather than in the lane: there's no provider call to pace.
      await holdProvider(sync.userId, sync.provider, problem, only).catch((err) =>
        console.error(`[sync] holding ${key} failed:`, err),
      );
    }
    for (const [index, id] of due.entries()) {
      if (index > 0) await sleep(IMPORT_COLLECTION_DELAY_MS);
      try {
        const outcome = await syncCollection(id, { resumeOnly: !scheduled.has(id) });
        if (outcome !== "unchanged" && outcome !== "missing") console.log(`[sync] ${id}: ${outcome}`);
      } catch (err) {
        console.error(`[sync] ${id} failed:`, err);
      }
    }
  })()
    .catch((err) => console.error("[sync] round failed:", err))
    .finally(() => {
      currentRound = null;
    });
  return currentRound;
}

/** With scheduled sync off the tick still runs, for jobs a person started or that gave way: nothing else would come back
 *  to them. No collection gets a next check. */
export function startCollectionSyncScheduler(): void {
  if (syncSchedulerEnabled()) markSchedulerStarted();
  setTimeout(() => {
    void runSyncRound();
    setInterval(() => void runSyncRound(), SYNC_TICK_MS);
  }, SYNC_STARTUP_DELAY_MS);
}
