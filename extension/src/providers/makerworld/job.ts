// MakerWorld guided collection import: navigates the tab to each model's page and imports it
// there, one at a time. Real page loads pace the requests the way no config value can, which
// keeps MakerWorld's account-wide CAPTCHA from tripping.
//
// Beyond each model's own profile, its others come in as steps of their own on the same page: each
// is picked in the page's list and downloaded with its button, after the same wait as a model.
//
// State lives in chrome.storage because an MV3 background can be suspended between steps. For the
// same reason the wait between models is counted down by the next model's page (see overlays.ts),
// not slept here: the background is killed after 30s idle.

import type { ImportStatus } from "../../shared/api";
import type { MakerworldJob, MakerworldJobError, Reply, ResolvedDownload } from "../../shared/messages";
import { sendToTab } from "../../shared/messages";
import { apiCall } from "../../background/api";
import { importSingle } from "../../background/importJobs";
import { type BackgroundMessages, type Handlers, senderTabId } from "../../shared/messages";
import { makerworldModelUrl, parseMakerworldModelUrl } from "./urls.generated";
import { backgroundText } from "../../background/localize";

const JOB_STORAGE_KEY = "makerworldCollectionJob";
const JOB_ERROR_STORAGE_KEY = "makerworldJobError";
// tabs.sendMessage has no timeout; this is well above the content script's own worst case.
const DOWNLOAD_RESOLVE_TIMEOUT_MS = 30000;
// Before asking a model's page for its print profiles a second time.
const PROFILES_RETRY_MS = 2000;

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

/** `urls` are the designs to visit: the not-yet-imported ones, and with more than each page's own profile wanted, those
 *  already in the library too, for the profiles they lack. tabs.onUpdated drives every step after the first. */
export async function startJob(
  tabId: number,
  {
    urls,
    collectionId,
    originalUrl,
    stepDelayMs,
    profileScope,
  }: BackgroundMessages["START_MAKERWORLD_COLLECTION_JOB"]["payload"],
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
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    profileScope,
    profiles: null,
  });
  await chrome.tabs.update(tabId, { url: urls[0] });
  return null;
}

/** Returns the tab to where the run started. Nothing already imported is undone. */
export async function abortJob(tabId: number): Promise<null> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return null;
  await setJob(null);
  void sendRunSummary(job, await backgroundText("guidedImportAborted"));
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

/** Which run, which of its models, and how many of that model's profiles are behind it. */
type Step = { runId: string | undefined; index: number; profile: number };
const stepOf = (job: MakerworldJob): Step => ({
  runId: job.runId,
  index: job.index,
  profile: job.profiles?.done ?? 0,
});

/** Keeps a late automatic completion from double-advancing a step "Import next" already moved past, or from acting for
 *  a run aborted meanwhile whose tab has started another: that one's first step looks the same but for its id. */
async function isStillAtStep(tabId: number, step: Step): Promise<boolean> {
  const current = await getJob();
  return Boolean(
    current &&
    current.tabId === tabId &&
    current.runId === step.runId &&
    current.index === step.index &&
    (current.profiles?.done ?? 0) === step.profile,
  );
}

/** The next model's page counts down `stepDelayMs` before its step starts. */
async function moveForward(tabId: number, job: MakerworldJob): Promise<void> {
  job.index += 1;
  job.profiles = null;
  if (job.index >= job.urls.length) {
    await setJob(null);
    void sendRunSummary(job, null);
    await chrome.tabs.update(tabId, { url: job.originalUrl });
    return;
  }
  await setJob({ ...job, awaitingLoad: true, startAt: Date.now() + job.stepDelayMs });
  await chrome.tabs.update(tabId, { url: job.urls[job.index] });
}

/** The model's next profile waits as a model would, counted down on the page already open, which re-renders for it.
 *  Reloaded where it can't be told, so its countdown starts anyway. */
async function waitForNextProfile(tabId: number, job: MakerworldJob): Promise<void> {
  await setJob({ ...job, awaitingLoad: true, startAt: Date.now() + job.stepDelayMs });
  const reply = await sendToTab(tabId, "MAKERWORLD_JOB_UPDATED").catch(() => undefined);
  if (!reply?.ok) await chrome.tabs.reload(tabId).catch(() => undefined);
}

/** Past the current profile, to the model's next one or, with none left, the next model. */
async function finishProfile(tabId: number, job: MakerworldJob): Promise<void> {
  if (job.profiles) {
    job.profiles = { ...job.profiles, ids: job.profiles.ids.slice(1), done: job.profiles.done + 1 };
    if (job.profiles.ids.length) {
      await waitForNextProfile(tabId, job);
      return;
    }
  }
  job.imported += 1;
  await moveForward(tabId, job);
}

/** A model's link naming one of its profiles, as the page's own links do. */
function profileUrl(modelUrl: string, instanceId: string): string {
  const designId = parseMakerworldModelUrl(modelUrl)?.designId;
  return designId ? makerworldModelUrl(designId, instanceId) : `${modelUrl.split("#")[0]}#profileId-${instanceId}`;
}

/** Records a model the run brought in or added to, once. */
function notePrint(job: MakerworldJob, printId: string | undefined): void {
  if (printId && !(job.printIds ?? []).includes(printId)) job.printIds = [...(job.printIds ?? []), printId];
}

/** Ends a step the run has left while it waited on the page or the library -- aborted, or moved past with Import
 *  next -- so nothing more is clicked or imported for it. advanceJob lets the error go quietly. */
async function stayAtStep(tabId: number, job: MakerworldJob): Promise<void> {
  if (!(await isStillAtStep(tabId, stepOf(job)))) throw new Error("The run has moved on from this model.");
}

/** What the page resolved with its own session. Null lets the backend resolve it; the content script only answers
 *  with an error for a CAPTCHA or the daily download limit, which the backend would hit too, so those are thrown. */
async function resolvedInPage(
  reply: Promise<Reply<ResolvedDownload | null> | undefined>,
): Promise<ResolvedDownload | null> {
  const answer = await withTimeout(reply, DOWNLOAD_RESOLVE_TIMEOUT_MS).catch(() => null);
  if (answer && !answer.ok) throw new Error(answer.error);
  return answer?.ok ? answer.data : null;
}

/** The profile the page shows, as every model came in before profiles could be chosen. */
async function importPageProfile(tabId: number, job: MakerworldJob): Promise<void> {
  const resolved = await resolvedInPage(sendToTab(tabId, "RESOLVE_MAKERWORLD_DOWNLOAD_URL"));
  await stayAtStep(tabId, job);
  const print = await importSingle(
    { url: job.urls[job.index], collectionId: job.collectionId, resolved },
    { notify: false },
  );
  notePrint(job, print?.id);
}

/** Which of `ids` the library doesn't have on the model yet. One it can't tell about is imported: the instance won't
 *  add a profile twice. */
async function missingProfiles(modelUrl: string, ids: string[]): Promise<string[]> {
  const held = await Promise.all(
    ids.map((id) =>
      apiCall<ImportStatus>("GET", `/import/status?url=${encodeURIComponent(profileUrl(modelUrl, id))}`)
        .then((status) => status.already_imported)
        .catch(() => false),
    ),
  );
  return ids.filter((_, index) => !held[index]);
}

/** The page's profiles the scope brings: none for a design without any, null when the page couldn't say. */
async function readProfiles(tabId: number, job: MakerworldJob): Promise<string[] | null> {
  const scope = job.profileScope ?? "url";
  const reply = await withTimeout(
    sendToTab(tabId, "READ_MAKERWORLD_PROFILES", { scope }),
    DOWNLOAD_RESOLVE_TIMEOUT_MS,
  ).catch(() => null);
  return reply?.ok ? reply.data : null;
}

/** On a model's first visit, the profiles the scope brings less those the library has, the first of them imported
 *  straight away; on each later step the next. A design without profiles brings its own download, as before. */
async function importProfileStep(tabId: number, job: MakerworldJob): Promise<void> {
  const modelUrl = job.urls[job.index];
  if (!job.profiles) {
    // Asked again once, for a page still reading its data. After that the run stops rather than going on with only
    // the page's own profile, which would quietly leave the others out.
    const ids =
      (await readProfiles(tabId, job)) ??
      (await new Promise((resolve) => setTimeout(resolve, PROFILES_RETRY_MS)).then(() => readProfiles(tabId, job)));
    if (!ids) {
      throw new Error(
        await backgroundText("couldNotReadMakerworldProfiles"),
      );
    }
    await stayAtStep(tabId, job);
    if (!ids.length) {
      await importPageProfile(tabId, job);
      return;
    }
    const missing = await missingProfiles(modelUrl, ids);
    // Kept only for a run still here: saving it for one aborted meanwhile would bring that run back.
    await stayAtStep(tabId, job);
    job.profiles = { ids: missing, done: 0, total: missing.length };
    // Kept, so a CAPTCHA or a background woken afresh carries on with this plan rather than asking again.
    await setJob(job);
    if (!missing.length) return;
  }
  const instanceId = job.profiles.ids[0];
  const resolved = await resolvedInPage(sendToTab(tabId, "RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD", { instanceId }));
  await stayAtStep(tabId, job);
  const print = await importSingle(
    { url: profileUrl(modelUrl, instanceId), collectionId: job.collectionId, resolved },
    { notify: false },
  );
  notePrint(job, print?.id);
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
  const step = stepOf(job);

  try {
    if ((job.profileScope ?? "url") === "url") await importPageProfile(tabId, job);
    else await importProfileStep(tabId, job);
  } catch (err) {
    // A manual "Import next" may have moved past this step while the request was in flight.
    if (!(await isStillAtStep(tabId, step))) return;
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

  if (!(await isStillAtStep(tabId, step))) return;
  await finishProfile(tabId, job);
}

/** Manual escape hatch: MV3 can kill the background mid-request on a large import. Confirms the
 *  stuck step actually landed in Thingport before continuing, to the model's next profile if it has one. */
export async function forceAdvanceJob(tabId: number): Promise<null> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return null;
  const instanceId = job.profiles?.ids[0];
  const currentUrl = instanceId ? profileUrl(job.urls[job.index], instanceId) : job.urls[job.index];
  let landed = false;
  try {
    const status = await apiCall<ImportStatus>("GET", `/import/status?url=${encodeURIComponent(currentUrl)}`);
    landed = status.already_imported;
    if (landed) {
      notePrint(job, status.print_id ?? undefined);
      if (job.collectionId && status.print_id) {
        await apiCall("POST", `/collection/${job.collectionId}/items/${status.print_id}`).catch(() => undefined);
      }
    }
  } catch {
    // Status check failed: proceed anyway, the user saw it land before clicking.
  }
  // A model counts once whatever came of its profiles; without them, only once it's seen to have landed.
  if (!job.profiles && !landed) {
    await moveForward(tabId, job);
    return null;
  }
  await finishProfile(tabId, job);
  return null;
}

/** Closing the tab ends the run; its summary still goes out. A model still importing when the tab
 *  closed lands, but isn't counted in it. */
export async function dropJobIfForTab(tabId: number): Promise<void> {
  const job = await getJob();
  if (!job || job.tabId !== tabId) return;
  await setJob(null);
  await sendRunSummary(job, await backgroundText("makerworldTabClosed"));
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
