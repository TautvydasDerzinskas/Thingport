// The popup's confirmation dialog, for actions that are a step too far to take on one click: disconnecting, turning
// Grab off. A native <dialog>: focus stays in it, Cancel is focused first, and Esc or a click beside it backs out.

import { els } from "./dom";

let busy = false;
let onConfirm: (() => Promise<void>) | null = null;
let confirmLabel = "";
let busyLabel = "";

/** `action` runs on confirming, the dialog showing `busyLabel` until it's done; it closes either way. */
export function confirmAction(options: {
  title: string;
  text: string;
  confirmLabel: string;
  busyLabel: string;
  action: () => Promise<void>;
}): void {
  els.confirmTitle.textContent = options.title;
  els.confirmText.textContent = options.text;
  ({ confirmLabel, busyLabel } = options);
  els.confirmOk.textContent = confirmLabel;
  els.confirmOk.disabled = false;
  onConfirm = options.action;
  els.confirmDialog.showModal();
  els.confirmCancel.focus();
}

function close(): void {
  if (!busy) els.confirmDialog.close();
}

els.confirmCancel.addEventListener("click", close);
// A click on the backdrop lands on the dialog itself, outside its box.
els.confirmDialog.addEventListener("click", (event) => {
  if (event.target === els.confirmDialog) close();
});
// Esc, but not while the action runs.
els.confirmDialog.addEventListener("cancel", (event) => {
  if (busy) event.preventDefault();
});

els.confirmOk.addEventListener("click", async () => {
  if (!onConfirm || busy) return;
  busy = true;
  els.confirmOk.disabled = true;
  els.confirmOk.textContent = busyLabel;
  try {
    await onConfirm();
  } finally {
    busy = false;
    onConfirm = null;
    els.confirmDialog.close();
  }
});
