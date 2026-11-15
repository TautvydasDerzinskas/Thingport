// Imports MakerWorld's CAPTCHA stopped on the Thingport instance, waiting for Grab to clear it with MakerWorld's own
// puzzle (backend providers/makerworld/grabImports.ts). Grab offers them by its icon on any makerworld.com page, and
// opens nothing until asked: Solve brings up the puzzle where MakerWorld still wants it, resolves each one's file on
// this page, as Download 3MF would, and hands it to the instance. An older instance has none to list.

import type { ResolvedDownload } from "../../shared/messages";
import { send } from "../../shared/messages";
import { t } from "../../shared/i18n";
import { MANIFESTS } from "../index.generated";
import { mountCallout } from "../../content/callout";
import {
  closedOverlay,
  doneOverlay,
  overlaySwitcher,
  progressOverlay,
  PUZZLE_SOLVED_MS,
  solvedOverlay,
  spotlightOverlay,
  type StopButton,
} from "../../content/overlays";
import { providerEnabled } from "../../content/providerSettings";
import { api, sleep } from "../../content/runtime";
import { removeSideHost, sideHost } from "../../content/shell";
import { MakerworldCaptchaError, resolveMakerworldViaApi } from "./downloadResolver";
import { solveMakerworldPuzzle } from "./puzzle";
import { parseMakerworldModelUrl } from "./urls.generated";

const PROVIDER = MANIFESTS.makerworld.id;
// "Later" holds the offer back for this long, across pages and tabs.
const LATER_MS = 4 * 60 * 60 * 1000;
const LATER_KEY = "makerworldWaitingLaterUntil";
// Between two of MakerWorld's downloads, as the instance paces its own.
const GAP_MS = 4000;
const TASK_POLL_MS = 1500;
// How long the run's last word stays before it goes by itself.
const DONE_MS = 8000;

type WaitingImport = { id: string; url: string; scope: string; collection_id: string | null; attempts: number };
type TaskState = { status: "running" } | { status: "done" } | { status: "error"; detail?: string };

let offered = false;
let running = false;

async function laterUntil(): Promise<number> {
  const stored = await chrome.storage.local.get(LATER_KEY).catch(() => ({}) as Record<string, unknown>);
  const until = (stored as Record<string, unknown>)[LATER_KEY];
  return typeof until === "number" ? until : 0;
}

/** Once per tab, on any makerworld.com page with Grab set up: the offer, if anything waits and it wasn't put off. */
export async function offerMakerworldWaiting(): Promise<void> {
  if (offered || running) return;
  offered = true;
  if (!(await providerEnabled(PROVIDER))) return;
  if ((await laterUntil()) > Date.now()) return;
  const waiting = await api<WaitingImport[]>("GET", `/import/${PROVIDER}/waiting`).catch(() => null);
  if (!Array.isArray(waiting) || !waiting.length) return;
  showOffer(waiting);
}

function showOffer(waiting: WaitingImport[]): void {
  const root = sideHost();
  root.querySelector(".tg-callout")?.remove();
  const callout = mountCallout(root, {
    title: t(waiting.length === 1 ? "waitingOfferTitle_one" : "waitingOfferTitle_other", { count: waiting.length }),
    sub: t("waitingOfferSub"),
    primary: {
      label: t("waitingSolve"),
      onClick: () => {
        callout.remove();
        void run(waiting);
      },
    },
    secondary: {
      label: t("waitingLater"),
      onClick: () => {
        callout.remove();
        void chrome.storage.local.set({ [LATER_KEY]: Date.now() + LATER_MS }).catch(() => undefined);
      },
    },
  });
}

/** Hands a resolved file to the instance, and waits for its import: true once it's in. */
async function bringIn(row: WaitingImport, resolved: ResolvedDownload): Promise<boolean> {
  try {
    const { task_id } = await api<{ task_id: string }>("POST", `/import/${PROVIDER}/waiting/${row.id}?async=1`, {
      resolved_download_url: resolved.downloadUrl,
      resolved_instance_id: resolved.instanceId,
      makerworld_design: resolved.design ?? null,
    });
    for (;;) {
      const task = await api<TaskState>("GET", `/import/tasks/${task_id}`);
      if (task.status === "done") return true;
      if (task.status === "error") return false;
      await sleep(TASK_POLL_MS);
    }
  } catch {
    return false;
  }
}

/** Couldn't resolve it here: the instance counts the try, and drops the model after its last. */
function reportFailed(row: WaitingImport, error: string): void {
  void api("POST", `/import/${PROVIDER}/waiting/${row.id}/failed`, { error }).catch(() => undefined);
}

/** Works through what waits, one at a time, opening MakerWorld's puzzle where it still wants one solved. Stopped, or
 *  with the puzzle closed, the rest go on waiting for a later visit. */
async function run(waiting: WaitingImport[]): Promise<void> {
  if (running) return;
  running = true;
  const root = sideHost();
  // A card an earlier try left, the closed puzzle's say.
  for (const old of root.querySelectorAll(".tg-overlay")) old.remove();
  const overlays = overlaySwitcher(root);
  let stopped = false;
  const stop: StopButton = {
    label: t("waitingStop"),
    busyLabel: t("waitingStopping"),
    onClick: () => {
      stopped = true;
      removeSideHost();
    },
  };
  let imported = 0;
  let failed = 0;
  const finish = async () => {
    running = false;
    overlays.current()?.remove();
    if (stopped || (!imported && !failed)) return;
    const state = await send("GET_STATE").catch(() => undefined);
    const instanceUrl = state?.ok ? state.data.instanceUrl : "";
    const card = doneOverlay(
      imported
        ? t(imported === 1 ? "waitingDone_one" : "waitingDone_other", { count: imported })
        : t("waitingNoneDone"),
      failed ? t("waitingFailed", { count: failed }) : t("waitingDoneSub"),
      instanceUrl && imported
        ? { href: `${instanceUrl.replace(/\/+$/, "")}/models`, label: t("openInThingport") }
        : null,
    );
    card.classList.add("tg-overlay--by-fab");
    overlays.show(card);
    setTimeout(() => card.remove(), DONE_MS);
  };
  try {
    for (const [index, row] of waiting.entries()) {
      if (stopped) return;
      if (index > 0) await sleep(GAP_MS);
      const progress = progressOverlay(
        t("waitingImportingTitle"),
        t("waitingImportingLine", { current: index + 1, total: waiting.length }),
        (index / waiting.length) * 100,
      );
      progress.classList.add("tg-overlay--by-fab");
      overlays.show(progress);
      const instanceId = parseMakerworldModelUrl(row.url)?.requestedInstanceId ?? null;
      let resolved: ResolvedDownload | null = null;
      try {
        resolved = await resolveMakerworldViaApi(row.url, instanceId);
      } catch (err) {
        if (!(err instanceof MakerworldCaptchaError)) {
          // The daily download limit, say: the rest would only meet it too.
          reportFailed(row, err instanceof Error ? err.message : String(err));
          failed++;
          return;
        }
        if (!err.puzzle) return;
        const left = waiting.length - index;
        overlays.show(
          // Its puzzle never showing leaves nothing to solve here: the rest wait for a later visit.
          spotlightOverlay(t(left === 1 ? "waitingPuzzleLine_one" : "waitingPuzzleLine_other", { count: left }), {
            stop,
            askAgain: stop.onClick,
          }),
        );
        const outcome = await solveMakerworldPuzzle(err.puzzle).catch(() => ({ kind: "unavailable" as const }));
        if (stopped) return;
        if (outcome.kind === "closed") {
          overlays.show(
            closedOverlay({
              extraHtml: "",
              text: t("waitingPuzzleWaits"),
              again: () => {
                running = false;
                void run(waiting.slice(index));
              },
              stop,
            }),
          );
          running = false;
          return;
        }
        if (outcome.kind === "unavailable") return;
        resolved = outcome.resolved;
        if (outcome.kind === "solved") {
          overlays.show(solvedOverlay(""));
          await sleep(PUZZLE_SOLVED_MS);
        }
      }
      if (!resolved) {
        reportFailed(row, t("waitingNoFile"));
        failed++;
        continue;
      }
      if (await bringIn(row, resolved)) imported++;
      else failed++;
    }
  } finally {
    if (running) await finish();
  }
}
