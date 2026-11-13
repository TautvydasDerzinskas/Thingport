// MakerOnline: the user's sign-in, and its files. Its download call wants a Risk-Token that only MakerOnline's own
// anti-bot script makes, in a real makeronline.com page, so Grab asks the instance which files a model needs, has the
// page sign each one, the same way its own Download button does, and hands the signed links to the instance. Imports
// started anywhere else wait on the instance until Grab sees a makeronline.com page (runWaitingImports).

import { CREDENTIAL_HOSTS } from "../_lib/credentialHosts.generated";
import type { Print } from "../../shared/api";
import type { MakeronlineSignedFile } from "../../shared/messages";
import { apiCall } from "../../background/api";
import { importSingle } from "../../background/importJobs";
import { recordRecentImport } from "../../background/recentImports";
import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS } from "../index.generated";
import { type BackgroundMessages, type Handlers, senderTabId } from "../../shared/messages";
import { type DownloadRequest, type SignAnswer, signInPage } from "./signInPage";

const SITE = MANIFESTS.makeronline.site;
const ACCESS_COOKIE = MANIFESTS.makeronline.sessionCookies.token;
const TASK_POLL_INTERVAL_MS = 1000;
// A burst of downloads looks automated to MakerOnline too.
const SIGN_GAP_MS = 1500;
// How long the user has to solve the puzzle MakerOnline shows before it hands over a file.
const PUZZLE_MS = 3 * 60_000;

function tokenUserId(token: string): string | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part)) as { sub?: unknown; id?: unknown };
    return typeof payload.sub === "string" ? payload.sub : typeof payload.id === "string" ? payload.id : null;
  } catch {
    return null;
  }
}

export const makeronlineSession: SessionSource = {
  async read() {
    const cookie = await chrome.cookies.get({ url: SITE, name: ACCESS_COOKIE });
    const token = cookie?.value ? decodeURIComponent(cookie.value) : null;
    return token ? { value: token, body: { token }, userId: tokenUserId(token) } : undefined;
  },
};

// MakerOnline's own answer codes for the download call.
const CODE_OK = 0;
const CODE_SIGNED_OUT = -1;
const CODE_CAPTCHA = 1003;

/** The signed link in a download answer: the page treats `data` as the link itself; an object is read leniently. */
function signedUrl(data: unknown): string | null {
  if (typeof data === "string" && /^https:\/\//i.test(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["url", "download_url", "downloadUrl", "file_url"]) {
      const value = record[key];
      if (typeof value === "string" && /^https:\/\//i.test(value)) return value;
    }
  }
  return null;
}

/** The tab or the instance failed, not the model: every later one would fail the same way, through no fault of its
 *  own. */
class RunStoppedError extends Error {}

/** The files a link needs, signed in `tabId`, a makeronline.com tab. Throws with a reason the user can act on.
 *  `puzzles` where the user just asked for them on that page: then a puzzle MakerOnline wants solved first is shown
 *  there, as its own Download shows it, rather than turning the import down. */
export async function resolveMakeronlineFiles(
  tabId: number,
  url: string,
  scope: "url" | "designer" | "all",
  { puzzles = false } = {},
): Promise<MakeronlineSignedFile[]> {
  let plan: { requests: DownloadRequest[] };
  try {
    plan = await apiCall<{ requests: DownloadRequest[] }>("POST", `/import/${MANIFESTS.makeronline.id}/plan`, {
      url,
      scope,
    });
  } catch (err) {
    // fetch rejects with a TypeError when the instance can't be reached; an answer it gave is about the model.
    if (err instanceof TypeError)
      throw new RunStoppedError(`Couldn't reach Thingport (${err.message})`, { cause: err });
    throw err;
  }
  return signRequests(tabId, plan.requests, puzzles);
}

async function signRequests(
  tabId: number,
  requests: DownloadRequest[],
  puzzles: boolean,
): Promise<MakeronlineSignedFile[]> {
  let answers: SignAnswer[];
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: signInPage,
      args: [requests, SIGN_GAP_MS, ACCESS_COOKIE, CREDENTIAL_HOSTS["makeronline-site"].exact, puzzles ? PUZZLE_MS : 0],
    });
    answers = (result?.result as SignAnswer[] | undefined) ?? [];
  } catch (err) {
    throw new RunStoppedError(
      `Couldn't ask MakerOnline for the files on this page (${err instanceof Error ? err.message : String(err)}). ` +
        "Reload it and try again; Firefox needs version 128 or newer for this.",
      { cause: err },
    );
  }
  const files: MakeronlineSignedFile[] = [];
  for (const [index, answer] of answers.entries()) {
    const request = requests[index];
    if (answer.code === CODE_CAPTCHA && answer.unsolved) {
      throw new Error(
        "MakerOnline hands over its files once its puzzle is solved. Try again, and solve the puzzle it shows.",
      );
    }
    if (answer.code === CODE_CAPTCHA) {
      throw new Error(
        "MakerOnline wants a captcha before it hands over files. Download one file from a model page by hand, " +
          "solve the puzzle, then try again.",
      );
    }
    if (answer.code === CODE_SIGNED_OUT) throw new Error("Sign in to MakerOnline in this browser, then try again.");
    const link = answer.code === CODE_OK ? signedUrl(answer.data) : null;
    if (!link)
      throw new Error(`MakerOnline didn't hand over "${request.name}"${answer.message ? `: ${answer.message}` : ""}`);
    files.push({ url: link, name: request.name, profile_id: request.profile_id });
  }
  return files;
}

type WaitingImport = { id: string; url: string; scope: string; collection_id: string | null };
type TaskState = { status: "running" } | { status: "done"; result: Print } | { status: "error"; detail: string };

async function pollTask(taskId: string): Promise<Print> {
  for (;;) {
    const task = await apiCall<TaskState>("GET", `/import/tasks/${taskId}`);
    if (task.status === "done") return task.result;
    if (task.status === "error") throw new Error(task.detail);
    await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS));
  }
}

let waitingRun: Promise<number> | null = null;
// A tab that asked while a run was going: what it queued may have come after that run read the list.
let rerunTabId: number | null = null;

/** Imports what waits on the instance for Grab, using `tabId`'s makeronline.com page to sign the files. One run at a
 *  time, whichever tab asks, and one more after it for anyone who asked meanwhile; resolves to how many came in
 *  altogether. Never throws: what fails is recorded on the instance. */
export function runWaitingImports(tabId: number): Promise<number> {
  if (waitingRun) {
    rerunTabId = tabId;
    return waitingRun;
  }
  waitingRun = (async () => {
    let total = 0;
    for (let next: number | null = tabId; next !== null;) {
      rerunTabId = null;
      total += await runWaiting(next);
      next = rerunTabId;
    }
    return total;
  })().finally(() => {
    waitingRun = null;
    rerunTabId = null;
  });
  return waitingRun;
}

async function runWaiting(tabId: number): Promise<number> {
  const waiting = await apiCall<WaitingImport[]>("GET", `/import/${MANIFESTS.makeronline.id}/waiting`).catch(() => []);
  if (!waiting.length) return 0;
  const printIds: string[] = [];
  for (const item of waiting) {
    const scope = item.scope === "designer" || item.scope === "all" ? item.scope : "url";
    let files: MakeronlineSignedFile[];
    try {
      files = await resolveMakeronlineFiles(tabId, item.url, scope);
    } catch (err) {
      // Not the model's fault: it waits for the next run as it is.
      if (err instanceof RunStoppedError) break;
      const error = err instanceof Error ? err.message : "Couldn't get the files signed";
      await apiCall("POST", `/import/${MANIFESTS.makeronline.id}/waiting/${item.id}/failed`, { error }).catch(
        () => undefined,
      );
      // A captcha or a lost sign-in fails every later one too.
      if (/captcha|sign in/i.test(error)) break;
      continue;
    }
    try {
      const started = await apiCall<Print | { task_id: string }>(
        "POST",
        `/import/${MANIFESTS.makeronline.id}/waiting/${item.id}?async=1`,
        { files },
      );
      const print = "task_id" in started ? await pollTask(started.task_id) : started;
      if (print?.id) {
        printIds.push(print.id);
        if (print.import_outcome !== "already_imported")
          await recordRecentImport(print, null, item.url).catch(() => undefined);
      }
    } catch {
      // The instance recorded why.
    }
  }
  if (printIds.length) {
    await apiCall("POST", "/import/summary", {
      source_url: `${SITE}/`,
      total: waiting.length,
      print_ids: printIds,
    }).catch(() => undefined);
  }
  return printIds.length;
}

/** A single page's import: the files it needs, signed here, then imported like any other model. */
export async function importMakeronlineModel(
  tabId: number,
  payload: { url: string; scope: "url" | "designer" | "all"; collectionId: string | null; title: string | null },
): Promise<Print | null> {
  const files = await resolveMakeronlineFiles(tabId, payload.url, payload.scope, { puzzles: true });
  return importSingle({ url: payload.url, collectionId: payload.collectionId, title: payload.title, files });
}

export const makeronlineHandlers: Partial<Handlers<BackgroundMessages>> = {
  IMPORT_MAKERONLINE_MODEL: (payload, sender) => importMakeronlineModel(senderTabId(sender), payload),
  RUN_MAKERONLINE_WAITING: (_payload, sender) => runWaitingImports(senderTabId(sender)),
};
