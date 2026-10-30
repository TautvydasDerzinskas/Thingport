// OwlCAD: exporting its CAD projects. A library part is a stored mesh the instance fetches by itself, but a CAD
// project has no file anywhere -- its document is a script, and OwlCAD's own kernel is what turns it into geometry.
// So Grab opens the model in OwlCAD's editor and asks the page to export it.
//
// The editor ships an automation bridge for exactly this: `window.owlcadAgent` (v3), which it installs on every
// /app page and whose `exportMesh` hands back the file as base64. Only its *writing* methods are gated behind
// `?agent=1`; exporting works on a read-only shared model, which is what a gallery link opens.
//
// Imports started anywhere else wait on the instance until Grab sees an owlcad.com page (runWaitingExports).

import type { Print } from "../../shared/api";
import { apiCall } from "../../background/api";
import { importSingle } from "../../background/importJobs";
import { recordRecentImport } from "../../background/recentImports";
import { MANIFESTS } from "../index.generated";
import type { BackgroundMessages, Handlers } from "../../shared/messages";
import { owlcadEditorUrl, parseOwlcadModelUrl } from "./urls.generated";

const ID = MANIFESTS.owlcad.id;
const SITE = MANIFESTS.owlcad.site;
const TASK_POLL_INTERVAL_MS = 1000;
/** The editor loads a kernel and the model before it can export; dense ones take a few seconds. */
const EXPORT_TIMEOUT_MS = 90_000;
/** How long to wait for the tab we opened to finish loading before giving up on it. */
const TAB_LOAD_TIMEOUT_MS = 60_000;

type ExportResult = { file: string } | { error: string };

/** Runs in the page itself (world: "MAIN"), where OwlCAD's bridge lives, so it must stand on its own.
 *
 *  `ready()` only waits for the editor's session, which settles before the shared model has loaded, so the model's
 *  own arrival is what we wait for: a document with nodes in it. */
async function exportInPage(timeoutMs: number): Promise<ExportResult> {
  type Doc = { nodes?: unknown[] };
  type Agent = {
    ready(): Promise<void>;
    getDocument(): Doc;
    exportMesh(format: string): Promise<{ base64: string; byteLength: number }>;
  };
  // Defined inside on purpose: this whole function is serialized into the page, so it can close over nothing.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + timeoutMs;
  const agent = () => (window as unknown as { owlcadAgent?: Agent }).owlcadAgent;

  while (!agent() && Date.now() < deadline) await sleep(200);
  const bridge = agent();
  if (!bridge) return { error: "OwlCAD's editor didn't start in this tab." };
  try {
    await bridge.ready();
  } catch {
    // Its session never settled; the model may still arrive, so this isn't fatal on its own.
  }
  let doc: Doc = {};
  while (Date.now() < deadline) {
    try {
      doc = bridge.getDocument();
      if (doc.nodes?.length) break;
    } catch {
      // The editor is still putting itself together.
    }
    await sleep(300);
  }
  if (!doc.nodes?.length) return { error: "OwlCAD didn't open this model -- it may no longer be shared." };
  try {
    const out = await bridge.exportMesh("3mf");
    if (!out?.base64) return { error: "OwlCAD's editor exported nothing." };
    return { file: out.base64 };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** The tab or the instance failed, not the model: every later one would fail the same way. */
class RunStoppedError extends Error {}

function onceLoaded(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new RunStoppedError("OwlCAD's editor took too long to load."));
    }, TAB_LOAD_TIMEOUT_MS);
    const listener = (changedId: number, info: { status?: string }) => {
      if (changedId !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Opens the model in OwlCAD's editor in a background tab, exports it there and closes the tab again. A tab of its
 *  own, rather than the one the user is on: the editor has to be the page, and taking over their tab would throw
 *  away whatever they were looking at. */
async function exportModel(modelId: string): Promise<{ file: string }> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: owlcadEditorUrl(modelId), active: false });
    tabId = tab.id;
    if (tabId === undefined) throw new RunStoppedError("Couldn't open an OwlCAD tab.");
    await onceLoaded(tabId);
    let result: ExportResult | undefined;
    try {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: exportInPage,
        args: [EXPORT_TIMEOUT_MS],
      });
      result = frame?.result as ExportResult | undefined;
    } catch (err) {
      throw new RunStoppedError(
        `Couldn't reach OwlCAD's editor in that tab (${err instanceof Error ? err.message : String(err)}). ` +
          "Firefox needs version 128 or newer for this.",
        { cause: err },
      );
    }
    if (!result) throw new Error("OwlCAD's editor didn't answer.");
    if ("error" in result) throw new Error(result.error);
    return result;
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

type WaitingExport = { id: string; url: string; editor_url: string; model_id: string; collection_id: string | null };
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
let rerunAsked = false;

/** Exports what waits on the instance for Grab. One run at a time, whichever tab asks, and one more after it for
 *  anyone who asked meanwhile; resolves to how many came in altogether. Never throws: what fails is recorded on the
 *  instance. */
export function runWaitingExports(): Promise<number> {
  if (waitingRun) {
    rerunAsked = true;
    return waitingRun;
  }
  waitingRun = (async () => {
    let total = 0;
    for (let again = true; again;) {
      rerunAsked = false;
      total += await runWaiting();
      again = rerunAsked;
    }
    return total;
  })().finally(() => {
    waitingRun = null;
    rerunAsked = false;
  });
  return waitingRun;
}

async function runWaiting(): Promise<number> {
  const waiting = await apiCall<WaitingExport[]>("GET", `/import/${ID}/waiting`).catch(() => []);
  if (!waiting.length) return 0;
  const printIds: string[] = [];
  for (const item of waiting) {
    let exported: { file: string };
    try {
      exported = await exportModel(item.model_id);
    } catch (err) {
      // Not the model's fault: it waits for the next run as it is.
      if (err instanceof RunStoppedError) break;
      const error = err instanceof Error ? err.message : "Couldn't export the model";
      await apiCall("POST", `/import/${ID}/waiting/${item.id}/failed`, { error }).catch(() => undefined);
      continue;
    }
    try {
      const started = await apiCall<Print | { task_id: string }>("POST", `/import/${ID}/waiting/${item.id}?async=1`, {
        file: exported.file,
      });
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

/** A single page's import. A library part needs nothing from the page -- the instance fetches its mesh itself -- so
 *  only a CAD project is opened in the editor and exported. */
export async function importOwlcadModel(payload: {
  url: string;
  collectionId: string | null;
  title: string | null;
}): Promise<Print | null> {
  const parsed = parseOwlcadModelUrl(payload.url);
  if (!parsed) throw new Error("That isn't an OwlCAD model link.");
  const plan = await apiCall<{ needs_grab: boolean }>(
    "GET",
    `/import/${ID}/plan?url=${encodeURIComponent(payload.url)}`,
  ).catch(() => null);
  if (plan && !plan.needs_grab) {
    // The instance can build this one itself; importing it here would only open a tab for nothing.
    return importSingle({ url: payload.url, collectionId: payload.collectionId, title: payload.title });
  }
  const exported = await exportModel(parsed.modelId);
  return apiCall<Print>("POST", `/import/${ID}/export`, {
    url: payload.url,
    collection_id: payload.collectionId,
    title: payload.title,
    file: exported.file,
  });
}

export const owlcadHandlers: Partial<Handlers<BackgroundMessages>> = {
  IMPORT_OWLCAD_MODEL: (payload) => importOwlcadModel(payload),
  // No tab is taken from the sender: the export runs in one Grab opens on the model's editor link.
  RUN_OWLCAD_WAITING: () => runWaitingExports(),
};
