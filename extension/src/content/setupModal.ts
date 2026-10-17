// The grayed-out icon's dialog: not set up yet, or set up but unable to sign in. Setup happens in an
// extension page: saving needs a host-permission prompt, and the password never enters this page's
// DOM.

import { send, type Connection } from "../shared/messages";
import { fillIcons } from "../shared/icon";
import { escapeHtml } from "./runtime";

type Disconnected = Extract<Connection, { connected: false }>;

function setupBodyHtml(): string {
  return `
      <div class="tg-hint">
        To import from this page, Thingport Grab needs to know where your Thingport instance is
        and how to sign in to it:
      </div>
      <ul class="tg-modal__list">
        <li><strong>Instance URL</strong>, e.g. https://thingport.example.com</li>
        <li><strong>Email</strong> and <strong>password</strong> of your Thingport account</li>
      </ul>
      <div class="tg-hint">
        They're stored only in this browser's extension storage and sent only to your own
        instance. You can also open this any time from the Thingport Grab icon in your browser
        toolbar.
      </div>`;
}

function disconnectedBodyHtml(problem: Disconnected, instanceUrl: string): string {
  const instance = `<strong>${escapeHtml(instanceUrl.replace(/^https?:\/\//i, ""))}</strong>`;
  const cause =
    problem.reason === "credentials" && problem.byApproval
      ? `${instance} no longer accepts this browser's Thingport Grab. It was probably removed from
         your profile there -- connect again.`
      : problem.reason === "credentials"
        ? `${instance} turned down the email and password saved in Thingport Grab. They were probably
         changed in Thingport since -- sign in again with the current ones.`
        : `${instance} didn't answer. It may not be running, or not be reachable from this network
         right now. If it moved, update its URL.`;
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
      <button class="tg-close" type="button" aria-label="Close">×</button>
      <div class="tg-modal__header">
        <span class="tg-modal__icon" data-icon></span>
        <div class="tg-title" id="tg-setup-title">
          ${disconnected ? "Thingport Grab can't sign in" : "Connect Thingport Grab"}
        </div>
      </div>
      ${disconnected ? disconnectedBodyHtml(disconnected.problem, disconnected.instanceUrl) : setupBodyHtml()}
      <button class="tg-btn" type="button" data-action="open-setup">
        ${disconnected ? "Edit connection" : "Open setup"}
      </button>
      ${disconnected ? `<button class="tg-btn tg-btn--secondary" type="button" data-action="retry">Try again</button>` : ""}
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
    statusEl.textContent = res?.ok
      ? "Setup opened in a new tab -- you'll be brought back here once it's saved."
      : "Couldn't open setup automatically -- click the Thingport Grab icon in your browser toolbar (it may be under the Extensions menu).";
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
