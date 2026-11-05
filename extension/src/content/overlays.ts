// Full-page overlays for the guided MakerWorld import and the collection scan. They cover the whole
// page on purpose: there's nothing to do meanwhile but wait or abort.

import type { MakerworldJob } from "../shared/messages";
import { send } from "../shared/messages";
import { fillIcons } from "../shared/icon";

// Long enough never to show during a normal step, short enough for a stuck one.
const JOB_STUCK_REVEAL_MS = 20000;

function overlayHtml(title: string, countHtml: string, extra = ""): string {
  return `
    <div class="tg-overlay__card">
      <span class="tg-overlay__icon" data-icon></span>
      <div class="tg-overlay__title">${title}</div>
      ${countHtml}
      ${extra}
    </div>
  `;
}

function formatWait(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function progressHtml(job: MakerworldJob): string {
  const percent = job.total ? Math.round((job.imported / job.total) * 100) : 0;
  const profiles = job.profiles?.total
    ? `<div class="tg-overlay__count">Print profile ${Math.min(job.profiles.done + 1, job.profiles.total)} of ${job.profiles.total}</div>`
    : "";
  return `<div class="tg-overlay__count">${job.imported} / ${job.total} models done (${percent}%)</div>
     <div class="tg-progress"><div class="tg-progress__bar" style="width:${percent}%"></div></div>${profiles}`;
}

function wireAbort(overlay: HTMLElement): void {
  const abortBtn = overlay.querySelector<HTMLButtonElement>("[data-action=abort]")!;
  abortBtn.addEventListener("click", () => {
    abortBtn.disabled = true;
    abortBtn.textContent = "Aborting…";
    void send("ABORT_MAKERWORLD_COLLECTION_JOB");
  });
}

/** Counts down the wait between models, then asks the background to start this one. */
export function mountJobOverlay(root: ShadowRoot, job: MakerworldJob): void {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.innerHTML = overlayHtml(
    "Importing from MakerWorld…",
    progressHtml(job),
    `<div class="tg-overlay__count" data-role="wait" hidden></div>
     <button class="tg-btn tg-btn--danger" type="button" data-action="abort">Abort</button>
     <button class="tg-btn tg-btn--secondary" type="button" data-action="next" hidden>Import next</button>`,
  );
  fillIcons(overlay);
  root.appendChild(overlay);
  wireAbort(overlay);

  const nextBtn = overlay.querySelector<HTMLButtonElement>("[data-action=next]")!;
  nextBtn.addEventListener("click", () => {
    nextBtn.disabled = true;
    nextBtn.textContent = "Checking…";
    void send("FORCE_ADVANCE_MAKERWORLD_JOB");
  });
  // Normally the page navigates on first, tearing this timer down.
  const startStep = () => {
    if (job.awaitingLoad) void send("MAKERWORLD_JOB_STEP_DUE");
    setTimeout(() => {
      nextBtn.hidden = false;
    }, JOB_STUCK_REVEAL_MS);
  };

  const waitEl = overlay.querySelector<HTMLElement>("[data-role=wait]")!;
  if (!job.awaitingLoad || Date.now() >= job.startAt) {
    startStep();
    return;
  }
  waitEl.hidden = false;
  const tick = () => {
    const remaining = job.startAt - Date.now();
    waitEl.textContent = `${job.profiles?.ids.length ? "Next print profile" : "Next model"} in ${formatWait(remaining)}`;
    if (remaining > 0) return;
    clearInterval(timer);
    waitEl.hidden = true;
    startStep();
  };
  const timer = setInterval(tick, 1000);
  tick();
}

/** Docked rather than full-page: the user has to reach MakerWorld's own CAPTCHA underneath. */
export function mountPausedJobOverlay(root: ShadowRoot, job: MakerworldJob): void {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay tg-overlay--docked";
  overlay.innerHTML = overlayHtml(
    "Paused: MakerWorld wants a CAPTCHA",
    progressHtml(job),
    `<div class="tg-overlay__text">Solve the puzzle on this page. If none is showing, click the arrow
       next to "Open in Bambu Studio" and choose "Download 3MF" to bring it up. Then resume -- the
       run continues from this model.</div>
     <button class="tg-btn" type="button" data-action="resume">Resume</button>
     <button class="tg-btn tg-btn--danger" type="button" data-action="abort">Abort</button>`,
  );
  fillIcons(overlay);
  root.appendChild(overlay);
  wireAbort(overlay);
  const resumeBtn = overlay.querySelector<HTMLButtonElement>("[data-action=resume]")!;
  resumeBtn.addEventListener("click", () => {
    resumeBtn.disabled = true;
    resumeBtn.textContent = "Resuming…";
    void send("RESUME_MAKERWORLD_JOB");
  });
}

export type ScanOverlay = { update(count: number, total?: number | null): void; remove(): void };

export function mountScanOverlay(root: ShadowRoot): ScanOverlay {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.innerHTML = overlayHtml(
    "Scanning collection models…",
    `<div class="tg-overlay__count" data-role="count">0 found so far</div>`,
  );
  fillIcons(overlay);
  root.appendChild(overlay);
  const countEl = overlay.querySelector<HTMLElement>('[data-role="count"]')!;
  return {
    update: (count, total) => {
      countEl.textContent = total ? `${count} of ${total} found` : `${count} found so far`;
    },
    remove: () => overlay.remove(),
  };
}
