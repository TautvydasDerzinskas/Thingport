// Full-page overlays for the guided MakerWorld import and the collection scan. They cover the whole
// page on purpose: there's nothing to do meanwhile but wait or abort, or solve MakerWorld's puzzle, which shows above.

import type { MakerworldJob, ResolvedDownload } from "../shared/messages";
import { send } from "../shared/messages";
import { type PuzzleOutcome, solvePausedStep } from "../providers/makerworld/puzzle";
import { puzzleBox } from "../providers/makerworld/puzzleBox";
import { fillIcons } from "../shared/icon";
import { t } from "../shared/i18n";
import { escapeHtml } from "./runtime";

// Long enough never to show during a normal step, short enough for a stuck one.
const JOB_STUCK_REVEAL_MS = 20000;
// How long "Solved" shows before the step carries on.
const SOLVED_MS = 900;
// Between the card and MakerWorld's puzzle, and from the window's edge.
const SPOTLIGHT_GAP = 14;
const SPOTLIGHT_MARGIN = 16;
// Where the puzzle isn't showing yet: its box is about this tall, centred on the page.
const PUZZLE_HEIGHT = 390;

function overlayHtml(title: string, countHtml: string, extra = ""): string {
  return `
    <div class="tg-overlay__card" tabindex="-1">
      <span class="tg-overlay__icon" data-icon></span>
      <div class="tg-overlay__title" id="tg-overlay-title">${escapeHtml(title)}</div>
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
    ? `<div class="tg-overlay__count">${escapeHtml(t("overlayPrintProfileProgress", { current: Math.min(job.profiles.done + 1, job.profiles.total), total: job.profiles.total }))}</div>`
    : "";
  return `<div class="tg-overlay__count">${escapeHtml(t("overlayProgress", { imported: job.imported, total: job.total, percent }))}</div>
     <div class="tg-progress"><div class="tg-progress__bar" style="width:${percent}%"></div></div>${profiles}`;
}

function wireAbort(overlay: HTMLElement): void {
  const abortBtn = overlay.querySelector<HTMLButtonElement>("[data-action=abort]")!;
  abortBtn.addEventListener("click", () => {
    abortBtn.disabled = true;
    abortBtn.textContent = t("aborting");
    void send("ABORT_MAKERWORLD_COLLECTION_JOB");
  });
}

/** Keeps keyboard focus on a full-page blocking overlay; the puzzle's spotlight and the docked CAPTCHA card deliberately
 *  do not use this. */
function focusBlockingOverlay(overlay: HTMLElement, preferred?: HTMLElement): void {
  const card = overlay.querySelector<HTMLElement>(".tg-overlay__card")!;
  (preferred ?? card).focus();
  // On the document, not the overlay: focus can slip out to the page without a Tab (Chrome drops it from a button
  // that disables itself when pressed, a click on the backdrop lands on the body), and the overlay never hears the
  // next Tab from there.
  const onKeydown = (event: KeyboardEvent) => {
    if (!overlay.isConnected) {
      document.removeEventListener("keydown", onKeydown, true);
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = [...overlay.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].filter(
      (button) => !button.hidden,
    );
    if (!buttons.length) {
      event.preventDefault();
      card.focus();
      return;
    }
    const first = buttons[0];
    const last = buttons.at(-1)!;
    const root = overlay.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : null;
    if (!(active instanceof HTMLButtonElement) || !buttons.includes(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if ((event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  document.addEventListener("keydown", onKeydown, true);
}

/** Counts down the wait between models, then asks the background to start this one. */
export function mountJobOverlay(root: ShadowRoot, job: MakerworldJob): void {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml(
    t("importingFromMakerWorld"),
    progressHtml(job),
    `<div class="tg-overlay__count" data-role="wait" hidden></div>
     <button class="tg-btn tg-btn--danger" type="button" data-action="abort">${escapeHtml(t("abort"))}</button>
     <button class="tg-btn tg-btn--secondary" type="button" data-action="next" hidden>${escapeHtml(t("import"))}</button>`,
  );
  fillIcons(overlay);
  root.appendChild(overlay);
  wireAbort(overlay);
  focusBlockingOverlay(overlay, overlay.querySelector<HTMLButtonElement>("[data-action=abort]")!);

  const nextBtn = overlay.querySelector<HTMLButtonElement>("[data-action=next]")!;
  nextBtn.addEventListener("click", () => {
    nextBtn.disabled = true;
    nextBtn.textContent = t("checking");
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
    waitEl.textContent = t("nextIn", {
      next: job.profiles?.ids.length ? t("nextPrintProfile") : t("nextModel"),
      time: formatWait(remaining),
    });
    if (remaining > 0) return;
    clearInterval(timer);
    waitEl.hidden = true;
    startStep();
  };
  const timer = setInterval(tick, 1000);
  tick();
}

/** The puzzle being cleared for a paused step, shared by the cards a re-render mounts for it, so none opens a second. */
let solving: { step: string; outcome: Promise<PuzzleOutcome> } | null = null;

function resume(resolved: ResolvedDownload | null): void {
  void send("RESUME_MAKERWORLD_JOB", { resolved });
}

function stepKey(job: MakerworldJob): string {
  return `${job.runId}:${job.index}:${job.profiles?.done ?? 0}`;
}

/** A button that ends whatever waits on the puzzle, saying so once pressed. */
export type StopButton = { label: string; busyLabel: string; onClick: () => void };

function abortJob(): StopButton {
  return {
    label: t("abort"),
    busyLabel: t("aborting"),
    onClick: () => void send("ABORT_MAKERWORLD_COLLECTION_JOB"),
  };
}

function wireStop(overlay: HTMLElement, stop: StopButton): void {
  const button = overlay.querySelector<HTMLButtonElement>("[data-action=stop]")!;
  button.addEventListener("click", () => {
    button.disabled = true;
    button.textContent = stop.busyLabel;
    stop.onClick();
  });
}

const stopButtonHtml = (stop: StopButton) =>
  `<button class="tg-btn tg-btn--danger" type="button" data-action="stop">${escapeHtml(stop.label)}</button>`;

/** Puts one overlay in place of the last. */
export function overlaySwitcher(root: ShadowRoot): { show(overlay: HTMLElement): void; current(): HTMLElement | null } {
  let current: HTMLElement | null = null;
  return {
    show(overlay) {
      current?.remove();
      current = overlay;
      fillIcons(overlay);
      root.appendChild(overlay);
    },
    current: () => current,
  };
}

/** MakerWorld wants its puzzle solved: it opens on the page straight away, MakerWorld's own, and once it's solved the
 *  step carries on with the file it got. Closed, it offers to open again; where the page can't show one, it's left to
 *  the user as before. */
export function mountPausedJobOverlay(root: ShadowRoot, job: MakerworldJob): void {
  const overlays = overlaySwitcher(root);
  const attempt = async () => {
    const key = stepKey(job);
    if (solving?.step !== key) {
      // The model the run paused on, which needn't be the page this tab has gone to since.
      const model = job.urls[job.index] ?? location.href;
      solving = { step: key, outcome: solvePausedStep(model, job.profiles?.ids[0] ?? null) };
    }
    const mine = solving;
    const spotlight = spotlightOverlay(t("puzzleProgress", { imported: job.imported, total: job.total }), {
      stop: abortJob(),
      askAgain: () => resume(null),
    });
    overlays.show(spotlight);
    const outcome = await mine.outcome;
    // Torn down meanwhile by a re-render, whose own card takes the outcome.
    const shown = (overlay: HTMLElement) => overlays.current() === overlay && overlay.isConnected;
    if (!shown(spotlight)) return;
    if (outcome.kind === "solved") {
      // Kept until the step goes on, so a re-render during "Solved" takes this outcome too rather than asking again,
      // and resumes in place of this card.
      const solved = solvedOverlay(progressHtml(job));
      overlays.show(solved);
      setTimeout(() => {
        if (!shown(solved)) return;
        if (solving === mine) solving = null;
        resume(outcome.resolved);
      }, SOLVED_MS);
      return;
    }
    if (solving === mine) solving = null;
    if (outcome.kind === "clear") resume(outcome.resolved);
    else if (outcome.kind === "closed") {
      overlays.show(
        closedOverlay({
          extraHtml: progressHtml(job),
          text: t("puzzleWaits"),
          again: () => void attempt(),
          stop: abortJob(),
        }),
      );
    } else overlays.show(byHandCard(job));
  };
  void attempt();
}

/** How long "Solved" shows before what waited on the puzzle carries on. */
export const PUZZLE_SOLVED_MS = SOLVED_MS;

/** The dimmed page with a card beside MakerWorld's puzzle, which sits a z-index above it. Not modal: the puzzle is the
 *  page's, and Tab has to reach it. `line` says what carries on once it's solved. `askAgain`, offered as Resume where
 *  the puzzle never shows (its script blocked, say), carries on without it; without one, Stop is all there is. */
export function spotlightOverlay(
  line: string,
  { stop, askAgain }: { stop: StopButton; askAgain?: () => void },
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = `
    <div class="tg-overlay__card tg-spotlight" tabindex="-1">
      <span class="tg-overlay__icon" data-icon></span>
      <div class="tg-spotlight__text" role="status">
        <div class="tg-overlay__title" id="tg-overlay-title">${escapeHtml(t("solveMakerworldPuzzle"))}</div>
        <div class="tg-overlay__count">${escapeHtml(line)}</div>
      </div>
      ${askAgain ? `<button class="tg-btn tg-btn--secondary" type="button" data-action="again" hidden>${escapeHtml(t("resume"))}</button>` : ""}
      ${stopButtonHtml(stop)}
      <span class="tg-spotlight__arrow" aria-hidden="true"></span>
    </div>`;
  wireStop(overlay, stop);
  const card = overlay.querySelector<HTMLElement>(".tg-spotlight")!;
  const againBtn = overlay.querySelector<HTMLButtonElement>("[data-action=again]");
  againBtn?.addEventListener("click", () => {
    againBtn.disabled = true;
    againBtn.textContent = t("resuming");
    askAgain?.();
  });
  // Above the puzzle where there's room, below it where there isn't. Until it shows, where it will.
  let seen = false;
  const place = () => {
    if (!card.isConnected) return;
    const box = puzzleBox()?.getBoundingClientRect();
    seen ||= Boolean(box);
    const height = card.offsetHeight;
    const top = box?.top ?? (innerHeight - PUZZLE_HEIGHT) / 2;
    const bottom = box?.bottom ?? (innerHeight + PUZZLE_HEIGHT) / 2;
    const below = top - height - SPOTLIGHT_GAP < SPOTLIGHT_MARGIN;
    card.classList.toggle("tg-spotlight--below", below);
    // On screen whatever the puzzle's size, over its foot if it must be: Stop is on this card.
    const wanted = below ? bottom + SPOTLIGHT_GAP : top - height - SPOTLIGHT_GAP;
    card.style.top = `${Math.max(SPOTLIGHT_MARGIN, Math.min(wanted, innerHeight - height - SPOTLIGHT_MARGIN))}px`;
    if (box) card.style.left = `${box.left + box.width / 2}px`;
  };
  const watch = setInterval(() => (card.isConnected ? place() : clearInterval(watch)), 250);
  requestAnimationFrame(place);
  setTimeout(() => {
    if (againBtn && !seen && card.isConnected) againBtn.hidden = false;
  }, JOB_STUCK_REVEAL_MS);
  return overlay;
}

function blockingCard(title: string, extra: string): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml("", "", extra);
  overlay.querySelector("#tg-overlay-title")!.innerHTML = title;
  return overlay;
}

/** "Solved", with a tick, for a moment before what waited on the puzzle carries on. */
export function solvedOverlay(extraHtml: string): HTMLElement {
  const overlay = blockingCard(
    `<span class="tg-overlay__tick" aria-hidden="true">✓</span>${escapeHtml(t("puzzleSolved"))}`,
    extraHtml,
  );
  overlay.querySelector("#tg-overlay-title")!.setAttribute("role", "status");
  queueMicrotask(() => overlay.querySelector<HTMLElement>(".tg-overlay__card")?.focus());
  return overlay;
}

/** The puzzle closed unsolved: `text` says what waits on it, Show puzzle opens it again. */
export function closedOverlay({
  extraHtml,
  text,
  again,
  stop,
}: {
  extraHtml: string;
  text: string;
  again: () => void;
  stop: StopButton;
}): HTMLElement {
  const overlay = blockingCard(
    escapeHtml(t("puzzleClosed")),
    `${extraHtml}
     <div class="tg-overlay__text">${escapeHtml(text)}</div>
     <button class="tg-btn" type="button" data-action="again">${escapeHtml(t("showPuzzle"))}</button>
     ${stopButtonHtml(stop)}`,
  );
  wireStop(overlay, stop);
  const againBtn = overlay.querySelector<HTMLButtonElement>("[data-action=again]")!;
  againBtn.addEventListener("click", again);
  queueMicrotask(() => focusBlockingOverlay(overlay, againBtn));
  return overlay;
}

/** Docked, as the page stays usable: a run's progress, its bar, and what it's on. */
export function progressOverlay(title: string, line: string, percent: number): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay tg-overlay--docked";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml(
    title,
    `<div class="tg-overlay__count" role="status">${escapeHtml(line)}</div>
     <div class="tg-progress"><div class="tg-progress__bar" style="width:${Math.round(percent)}%"></div></div>`,
  );
  return overlay;
}

/** Docked: how a run came out, a link to see the result, and Close. */
export function doneOverlay(title: string, line: string, link: { href: string; label: string } | null): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay tg-overlay--docked";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml(
    title,
    `<div class="tg-overlay__count" role="status">${escapeHtml(line)}</div>
     ${link ? `<a class="tg-btn" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>` : ""}
     <button class="tg-btn tg-btn--secondary" type="button" data-action="close">${escapeHtml(t("close"))}</button>`,
  );
  overlay.querySelector("[data-action=close]")!.addEventListener("click", () => overlay.remove());
  return overlay;
}

/** Docked rather than full-page: with no puzzle to open, the user brings up MakerWorld's own underneath. */
function byHandCard(job: MakerworldJob): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay tg-overlay--docked";
  overlay.setAttribute("role", "region");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml(
    t("pausedCaptcha"),
    progressHtml(job),
    `<div class="tg-overlay__text">${escapeHtml(t("captchaInstructions"))}</div>
     <button class="tg-btn" type="button" data-action="resume">${escapeHtml(t("resume"))}</button>
     <button class="tg-btn tg-btn--danger" type="button" data-action="abort">${escapeHtml(t("abort"))}</button>`,
  );
  // Not modal, so the CAPTCHA underneath stays in reach, and focus the user put on the page stays there.
  queueMicrotask(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      overlay.querySelector<HTMLElement>(".tg-overlay__card")?.focus({ preventScroll: true });
    }
  });
  wireAbort(overlay);
  const resumeBtn = overlay.querySelector<HTMLButtonElement>("[data-action=resume]")!;
  resumeBtn.addEventListener("click", () => {
    resumeBtn.disabled = true;
    resumeBtn.textContent = t("resuming");
    void send("RESUME_MAKERWORLD_JOB", {});
  });
  return overlay;
}

export type ScanOverlay = { update(count: number, total?: number | null): void; remove(): void };

export function mountScanOverlay(root: ShadowRoot): ScanOverlay {
  const previousFocus = root.activeElement instanceof HTMLElement ? root.activeElement : null;
  const overlay = document.createElement("div");
  overlay.className = "tg-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "tg-overlay-title");
  overlay.innerHTML = overlayHtml(
    t("scanCollection"),
    `<div class="tg-overlay__count" data-role="count" role="status" aria-live="polite">${escapeHtml(t("foundSoFar", { count: 0 }))}</div>`,
  );
  fillIcons(overlay);
  root.appendChild(overlay);
  focusBlockingOverlay(overlay);
  const countEl = overlay.querySelector<HTMLElement>('[data-role="count"]')!;
  return {
    update: (count, total) => {
      countEl.textContent = total ? t("foundOfTotal", { count, total }) : t("foundSoFar", { count });
    },
    remove: () => {
      overlay.remove();
      const fallback = root.querySelector<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      (previousFocus?.isConnected ? previousFocus : fallback)?.focus();
    },
  };
}
