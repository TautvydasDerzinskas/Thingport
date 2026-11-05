import type { QueueImportResult } from "../../shared/api";
import { escapeHtml } from "../runtime";

export function statusHtml(text: string): string {
  return `<div class="tg-status">${escapeHtml(text)}</div>`;
}

export function successHtml(
  link: string,
  note?: string | null,
  title = "Imported!",
  linkLabel = "Open in Thingport",
): string {
  return `
    <div class="tg-title">${escapeHtml(title)}</div>
    ${note ? `<div class="tg-hint">${escapeHtml(note)}</div>` : ""}
    <a class="tg-btn" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>
  `;
}

export function errorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `<div class="tg-title tg-title--error">Something went wrong</div><div class="tg-hint">${escapeHtml(message)}</div>`;
}

/** Every Thingport version answers at this address, and the web app keeps it for good. Only an older one sends anyone
 *  but an admin home from it. */
function importQueueLink(instanceUrl: string): string {
  return `${instanceUrl}/admin-queue`;
}

function queuedNote(result: QueueImportResult, importQueue: boolean): string {
  const waiting = `${result.waiting} link${result.waiting === 1 ? "" : "s"} waiting`;
  // `started` is only ever true from an instance with a queue of one's own, whatever Grab last heard about it.
  if (!importQueue && !result.started) {
    return result.duplicate
      ? `This link was already waiting in the queue (${waiting}).`
      : `Paused until it's started from Administration > Import queue (${waiting}).`;
  }
  if (!result.started) return `On hold in your import queue until you start it (${waiting}).`;
  if (result.position === 1) return `Next up in your import queue (${waiting}).`;
  return result.position
    ? `#${result.position} in line in your import queue (${waiting}).`
    : `In line in your import queue (${waiting}).`;
}

/** "Add to the queue" went through. `importQueue`: the instance has a queue of one's own. */
export function queuedHtml(instanceUrl: string, result: QueueImportResult, importQueue: boolean): string {
  return successHtml(
    importQueueLink(instanceUrl),
    queuedNote(result, importQueue),
    result.duplicate ? "Already in the queue" : "Added to the queue",
    "Open import queue",
  );
}

/** A job that stopped without finishing, which is no success: what's left carries on from the instance's import queue.
 *  `progress` says how far it got. */
export function pausedHtml(instanceUrl: string, progress?: string | null, note?: string | null): string {
  return successHtml(
    importQueueLink(instanceUrl),
    [progress, "It continues from the import queue once it's started there.", note].filter(Boolean).join(" "),
    "Import paused",
    "Open import queue",
  );
}
