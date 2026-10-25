// MakerWorld guided collection import: navigates the tab to each model's page and imports it
// there, one at a time. Real page loads pace the requests the way no config value can, which
// keeps MakerWorld's account-wide CAPTCHA from tripping.
//
// State lives in chrome.storage because an MV3 background can be suspended between steps. For the
// same reason the wait between models is counted down by the next model's page (see overlays.ts),
// not slept here: the background is killed after 30s idle.

import type { ImportStatus } from "../../shared/api";
import type { MakerworldJob, MakerworldJobError } from "../../shared/messages";
import { sendToTab } from "../../shared/messages";
import { apiCall } from "../../background/api";
import { importSingle } from "../../background/importJobs";
import { type BackgroundMessages, type Handlers, senderTabId } from "../../shared/messages";

const JOB_STORAGE_KEY = "makerworldCollectionJob";
const JOB_ERROR_STORAGE_KEY = "makerworldJobError";
// tabs.sendMessage has no timeout; this is well above the content script's own worst case.
const DOWNLOAD_RESOLVE_TIMEOUT_MS = 30000;

async function getJob(): Promise<MakerworldJob | null> {
  const stored = await chrome.storage.local.get(JOB_STORAGE_KEY);
  return (stored[JOB_STORAGE_KEY] as MakerworldJob | undefined) ?? null;
}

async function setJob(job: MakerworldJob | null): Promise<void> {
  if (job) await chrome.storage.local.set({ [JOB_STORAGE_KEY]: job });
  else await chrome.storage.local.remove(JOB_STORAGE_KEY);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** Both the extension's and the backend's CAPTCHA messages say so; API errors carry only text. */
function isCaptchaMessage(message: string): boolean {
  return /captcha/i.test(message);
}

/** One notification for the whole run, instead of one per model. Best-effort: an older backend has
 *  no summary endpoint. */
async function sendRunSummary(job: MakerworldJob, stopped: string | null): Promise<void> {
  await apiCall("POST", "/import/summary", {
    source_url: job.originalUrl,
    total: job.total,
    print_ids: job.printIds ?? [],
    collection_id: job.collectionId,
    stopped,
  }).catch(() => undefined);
}

/** `urls` are the not-yet-imported designs. tabs.onUpdated drives every step after the first. */
export async function startJob(
  tabId: number,
  {
    urls,
    collectionId,
    originalUrl,
    stepDelayMs,
  }: { urls: string[]; collectionId: string | null; originalUrl: string; stepDelayMs: number },
): Promise<null> {
  if (!urls.length) return null;
  await setJob({
    tabId,
    originalUrl,
    collectionId: collectionId || null,
    urls,
    index: 0,
    imported: 0,
    total: urls.length,
    awaitingLoad: true,
    stepDelayMs,
    startAt: 0,
    paused: false,
    printIds: [],
  });
  await chrome.tabs.update(tabId, { url: urls[0] });
  return null;
}

/** Returns the tab to where the run started. Nothing already imported is undone. */
export async function abortJob(tabId: number): Promise<null> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return null;
  await setJob(null);
  void sendRunSummary(job, "you stopped the import.");
  await chrome.tabs.update(tabId, { url: job.originalUrl });
  return null;
}

/** Retries the model the run paused on, once the user has solved MakerWorld's CAPTCHA. */
export async function resumeJob(tabId: number): Promise<null> {
  const job = await getJob();
  if (!job || job.tabId !== tabId || !job.paused) return null;
  await setJob({ ...job, paused: false, awaitingLoad: true, startAt: 0 });
  await chrome.tabs.update(tabId, { url: job.urls[job.index] });
  return null;
}

/** A just-stopped job's error is read-and-clear, so it's shown exactly once. */
export async function getJobForTab(
  tabId: number | undefined,
): Promise<{ job: MakerworldJob | null; error: MakerworldJobError | null }> {
  const job = tabId != null ? await getJob() : null;
  if (job && job.tabId === tabId) return { job, error: null };
  const stored = await chrome.storage.local.get(JOB_ERROR_STORAGE_KEY);
  const error = (stored[JOB_ERROR_STORAGE_KEY] as MakerworldJobError | undefined) ?? null;
  if (error) await chrome.storage.local.remove(JOB_ERROR_STORAGE_KEY);
  return { job: null, error };
}

/** Keeps a late automatic completion from double-advancing a step "Import next" already moved past. */
async function isStillAtStep(tabId: number, stepIndex: number): Promise<boolean> {
  const current = await getJob();
  return Boolean(current && current.tabId === tabId && current.index === stepIndex);
}

/** The next model's page counts down `stepDelayMs` before its step starts. */
async function moveForward(tabId: number, job: MakerworldJob): Promise<void> {
  job.index += 1;
  if (job.index >= job.urls.length) {
    await setJob(null);
    void sendRunSummary(job, null);
    await chrome.tabs.update(tabId, { url: job.originalUrl });
    return;
  }
  await setJob({ ...job, awaitingLoad: true, startAt: Date.now() + job.stepDelayMs });
  await chrome.tabs.update(tabId, { url: job.urls[job.index] });
}

let claimQueue: Promise<unknown> = Promise.resolve();

/** Takes the current step if it's due. Serialized: the page load and the page's countdown can both
 *  ask at once, and the check-then-set on storage would otherwise let both through. */
function claimStep(tabId: number): Promise<MakerworldJob | null> {
  const claimed = claimQueue.then(async () => {
    const job = await getJob();
    if (!job || job.tabId !== tabId || !job.awaitingLoad || job.paused || Date.now() < job.startAt) return null;
    job.awaitingLoad = false;
    await setJob(job);
    return job;
  });
  claimQueue = claimed.catch(() => undefined);
  return claimed;
}

/** A CAPTCHA pauses the run on this model for the user to solve; any other failure, the daily
 *  download limit included, stops it, since it almost always means MakerWorld rejected the
 *  request, and more requests would make it worse. */
export async function advanceJob(tabId: number): Promise<void> {
  const job = await claimStep(tabId);
  if (!job) return;
  const stepIndex = job.index;

  const currentUrl = job.urls[stepIndex];
  // The content script resolves the download itself with the page's session. Best-effort: null
  // lets the backend resolve it.
  let resolved = null;
  let resolveError: string | null = null;
  try {
    const reply = await withTimeout(sendToTab(tabId, "RESOLVE_MAKERWORLD_DOWNLOAD_URL"), DOWNLOAD_RESOLVE_TIMEOUT_MS);
    // The content script only replies with an error for a CAPTCHA or the daily download limit;
    // the backend would hit it too.
    if (reply && reply.ok) resolved = reply.data;
    else if (reply) resolveError = reply.error;
  } catch {}

  try {
    if (resolveError) throw new Error(resolveError);
    const print = await importSingle({ url: currentUrl, collectionId: job.collectionId, resolved }, { notify: false });
    if (print?.id) job.printIds = [...(job.printIds ?? []), print.id];
  } catch (err) {
    // A manual "Import next" may have moved past this step while the request was in flight.
    if (!(await isStillAtStep(tabId, stepIndex))) return;
    const message = err instanceof Error ? err.message : String(err);
    if (isCaptchaMessage(message)) {
      // Stays on this page: the CAPTCHA has to be solved here, in MakerWorld's own UI.
      await setJob({ ...job, paused: true });
      await sendToTab(tabId, "MAKERWORLD_JOB_UPDATED").catch(() => undefined);
      return;
    }
    await setJob(null);
    void sendRunSummary(job, message);
    const error: MakerworldJobError = { message, imported: job.imported, total: job.total };
    await chrome.storage.local.set({ [JOB_ERROR_STORAGE_KEY]: error });
    await chrome.tabs.update(tabId, { url: job.originalUrl });
    return;
  }

  if (!(await isStillAtStep(tabId, stepIndex))) return;
  job.imported += 1;
  await moveForward(tabId, job);
}

/** Manual escape hatch: MV3 can kill the background mid-request on a large import. Confirms the
 *  stuck step actually landed in Thingport before continuing. */
export async function forceAdvanceJob(tabId: number): Promise<null> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return null;
  const currentUrl = job.urls[job.index];
  try {
    const status = await apiCall<ImportStatus>("GET", `/import/status?url=${encodeURIComponent(currentUrl)}`);
    if (status.already_imported) {
      job.imported += 1;
      if (status.print_id) job.printIds = [...(job.printIds ?? []), status.print_id];
      if (job.collectionId && status.print_id) {
        await apiCall("POST", `/collection/${job.collectionId}/items/${status.print_id}`).catch(() => undefined);
      }
    }
  } catch {
    // Status check failed: proceed anyway, the user saw it land before clicking.
  }
  await moveForward(tabId, job);
  return null;
}

/** Closing the tab ends the run; its summary still goes out. A model still importing when the tab
 *  closed lands, but isn't counted in it. */
export async function dropJobIfForTab(tabId: number): Promise<void> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return;
  await setJob(null);
  await sendRunSummary(job, "the MakerWorld tab was closed.");
}

export const makerworldHandlers: Partial<Handlers<BackgroundMessages>> = {
  START_MAKERWORLD_COLLECTION_JOB: (payload, sender) => startJob(senderTabId(sender), payload),
  ABORT_MAKERWORLD_COLLECTION_JOB: (_payload, sender) => abortJob(senderTabId(sender)),
  FORCE_ADVANCE_MAKERWORLD_JOB: (_payload, sender) => forceAdvanceJob(senderTabId(sender)),
  RESUME_MAKERWORLD_JOB: (_payload, sender) => resumeJob(senderTabId(sender)),
  // Not awaited: the step runs for as long as the import takes.
  MAKERWORLD_JOB_STEP_DUE: (_payload, sender) => {
    void advanceJob(senderTabId(sender));
    return null;
  },
  GET_MAKERWORLD_JOB: (_payload, sender) => getJobForTab(sender.tab?.id),
};
