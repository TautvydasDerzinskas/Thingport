// The grayed-out icon's dialog: not set up yet, or set up but unable to sign in. Setup happens in an
// extension page: pairing needs a host-permission prompt, and a password, for anyone who gives one
// instead, never enters this page's DOM.

import { send, type Connection } from "../shared/messages";
import { fillIcons } from "../shared/icon";
import { t } from "../shared/i18n";
import { escapeHtml } from "./runtime";

type Disconnected = Extract<Connection, { connected: false }>;

function setupBodyHtml(): string {
  return `
      <div class="tg-hint">
        ${escapeHtml(t("setupIntro"))}
      </div>
      <ul class="tg-modal__list">
        <li><strong>${escapeHtml(t("setupInstanceUrl"))}</strong>, ${escapeHtml(t("setupInstanceUrlExample"))}</li>
        <li><strong>${escapeHtml(t("setupPair"))}</strong> — ${escapeHtml(t("setupPairHint"))}</li>
      </ul>
      <div class="tg-hint">
        ${escapeHtml(t("setupSecurityHint"))}
      </div>`;
}

function disconnectedBodyHtml(problem: Disconnected, instanceUrl: string): string {
  const instance = instanceUrl.replace(/^https?:\/\//i, "");
  const message = (key: string): string => {
    const marker = "__INSTANCE__";
    return escapeHtml(t(key, { instance: marker })).replace(marker, `<strong>${escapeHtml(instance)}</strong>`);
  };
  const cause =
    problem.reason === "credentials" && problem.byApproval
      ? message("setupApprovalRevoked")
      : problem.reason === "credentials"
        ? message("setupCredentialsRejected")
        : message("setupUnreachable");
  return `
      <div class="tg-hint">${cause}</div>
      <div class="tg-hint tg-modal__detail">${escapeHtml(problem.detail)}</div>`;
}

let open: { backdrop: HTMLElement; onKeydown: (event: KeyboardEvent) => void } | null = null;

/** `problem` set: configured, but signing in failed. `onRetry` re-checks after it's fixed. */
export function openSetupModal(
  root: ShadowRoot,
  disconnected?: { problem: Disconnected; instanceUrl: string; onRetry: () => void },
): void {
  if (open) return;
  const backdrop = document.createElement("div");
  backdrop.className = "tg-modal-backdrop";
  backdrop.innerHTML = `
    <div class="tg-modal" role="dialog" aria-modal="true" aria-labelledby="tg-setup-title">
      <button class="tg-close" type="button" aria-label="${escapeHtml(t("close"))}">×</button>
      <div class="tg-modal__header">
        <span class="tg-modal__icon" data-icon></span>
        <div class="tg-title" id="tg-setup-title">
          ${escapeHtml(t(disconnected ? "setupSignInFailed" : "setupConnect"))}
        </div>
      </div>
      ${disconnected ? disconnectedBodyHtml(disconnected.problem, disconnected.instanceUrl) : setupBodyHtml()}
      <button class="tg-btn" type="button" data-action="open-setup">
        ${escapeHtml(t(disconnected ? "editConnection" : "setupOpen"))}
      </button>
      ${disconnected ? `<button class="tg-btn tg-btn--secondary" type="button" data-action="retry">${escapeHtml(t("retry"))}</button>` : ""}
      <div class="tg-hint tg-modal__status" hidden></div>
    </div>
  `;

  fillIcons(backdrop);
  const openBtn = backdrop.querySelector<HTMLButtonElement>("[data-action=open-setup]")!;
  const statusEl = backdrop.querySelector<HTMLElement>(".tg-modal__status")!;
  openBtn.addEventListener("click", async () => {
    openBtn.disabled = true;
    const res = await send("OPEN_SETUP");
    openBtn.disabled = false;
    if (res?.ok && res.data === "popup") return;
    statusEl.hidden = false;
    statusEl.textContent = res?.ok ? t("setupOpened") : t("setupOpenFailed");
  });

  backdrop.querySelector("[data-action=retry]")?.addEventListener("click", () => {
    closeSetupModal();
    disconnected?.onRetry();
  });

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeSetupModal();
  };
  document.addEventListener("keydown", onKeydown, true);
  backdrop.querySelector(".tg-close")!.addEventListener("click", closeSetupModal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeSetupModal();
  });

  root.appendChild(backdrop);
  open = { backdrop, onKeydown };
  openBtn.focus();
}

export function closeSetupModal(): void {
  if (!open) return;
  document.removeEventListener("keydown", open.onKeydown, true);
  open.backdrop.remove();
  open = null;
}
