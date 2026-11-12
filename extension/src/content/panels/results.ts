import type { QueueImportResult } from "../../shared/api";
import { getLocale, t } from "../../shared/i18n";
import { escapeHtml } from "../runtime";

export function statusHtml(text: string): string {
  return `<div class="tg-status">${escapeHtml(text)}</div>`;
}

export function successHtml(
  link: string,
  note?: string | null,
  title = t("imported"),
  linkLabel = t("openInThingport"),
): string {
  return `
    <div class="tg-title">${escapeHtml(title)}</div>
    ${note ? `<div class="tg-hint">${escapeHtml(note)}</div>` : ""}
    <a class="tg-btn" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>
  `;
}

export function errorHtml(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `<div class="tg-title tg-title--error">${t("errorTitle")}</div><div class="tg-hint">${escapeHtml(message)}</div>`;
}

/** Every Thingport version answers at this address, and the web app keeps it for good. Only an older one sends anyone
 *  but an admin home from it. */
function importQueueLink(instanceUrl: string): string {
  return `${instanceUrl}/admin-queue`;
}

function queuedNote(result: QueueImportResult, importQueue: boolean): string {
  const waiting = t(getLocale() === "en" && result.waiting === 1 ? "queueWaitingOne" : "queueWaiting", { count: result.waiting });
  // `started` is only ever true from an instance with a queue of one's own, whatever Grab last heard about it.
  if (!importQueue && !result.started) {
    return result.duplicate
      ? t("queueDuplicate", { waiting })
      : t("queueAdminPaused", { waiting });
  }
  if (!result.started) return t("queueHeld", { waiting });
  if (result.position === 1) return t("queueNext", { waiting });
  return result.position
    ? t("queuePosition", { position: result.position, waiting })
    : t("queueInLine", { waiting });
}

/** "Add to the queue" went through. `importQueue`: the instance has a queue of one's own. */
export function queuedHtml(instanceUrl: string, result: QueueImportResult, importQueue: boolean): string {
  return successHtml(
    importQueueLink(instanceUrl),
    queuedNote(result, importQueue),
    t(result.duplicate ? "queueAlready" : "queueAdded"),
    t("queueOpen"),
  );
}

/** A job that stopped without finishing, which is no success: what's left carries on from the instance's import queue.
 *  `progress` says how far it got. */
export function pausedHtml(instanceUrl: string, progress?: string | null, note?: string | null): string {
  return successHtml(
    importQueueLink(instanceUrl),
    [progress, t("queueContinues"), note].filter(Boolean).join(" "),
    t("importPaused"),
    t("queueOpen"),
  );
}
