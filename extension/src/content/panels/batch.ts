// Batch flow for every provider's collections, likes and bookmarks. MakerWorld collections use the guided flow in
// providers/makerworld/collectionPanel.ts. Two providers' lists differ within it, so they're handled here: a private
// Printables collection is read as its owner (providers/printables/content.ts), and Snapmaker's likes and bookmarks
// share one page, which the panel switches between.

import type { BatchEntriesResult, BatchEntry, ImportJob, SyncLookup } from "../../shared/api";
import { ctx, setContext } from "../context";
import { MANIFESTS, manifestOf } from "../../providers/index.generated";
import { parseSnapmakerListUrl, snapmakerListUrl, type SnapmakerList } from "../../shared/urls";
import { request } from "../../shared/messages";
import { api, escapeHtml, sleep } from "../runtime";
import { isPanelMounted, onPanelAction, panelQueryAll, renderPanel } from "../shell";
import { errorHtml, pausedHtml, statusHtml, successHtml } from "./results";
import { loadingModelsPhrases, renderFunStatus } from "./funStatus";
import { applySyncToggle, loadSyncState, readSyncToggle, syncChangeNote, syncToggleHtml } from "./syncToggle";
import { printablesToken, readCollectionForPanel } from "../../providers/printables/content";
import { pushPrintablesNow } from "../../providers/printables/content";
import { CONTENT_MODULES, type ImportBlock } from "../../providers/content";
import { t } from "../../shared/i18n";

const SNAPMAKER_LISTS: { list: SnapmakerList; label: string }[] = [
  { list: "likes", label: "snapmakerLikes" },
  { list: "bookmarks", label: "snapmakerBookmarks" },
];

/** Snapmaker shows likes and bookmarks on one page without changing its address, so the panel picks which. */
function snapmakerListSwitchHtml(): string {
  const { classification } = ctx();
  if (classification.provider !== MANIFESTS.snapmaker.id || classification.kind !== "batch") return "";
  const options = SNAPMAKER_LISTS.map(
    ({ list, label }) =>
      `<button class="tg-segmented__option" type="button" data-action="list-${list}" aria-pressed="${classification.type === list}">${escapeHtml(t(label))}</button>`,
  ).join("");
  return `<div class="tg-segmented" role="group" aria-label="${escapeHtml(t("snapmakerListLabel"))}">${options}</div>`;
}

function wireSnapmakerListSwitch(): void {
  for (const { list } of SNAPMAKER_LISTS) {
    onPanelAction(`list-${list}`, () => {
      const current = ctx();
      const userId = parseSnapmakerListUrl(current.url)?.userId;
      if (!userId || (current.classification.kind === "batch" && current.classification.type === list)) return;
      setContext({
        ...current,
        url: snapmakerListUrl(userId, list),
        classification: { kind: "batch", provider: MANIFESTS.snapmaker.id, type: list },
      });
      void loadBatchEntries();
    });
  }
}

/** The page's list: the batch panel only opens on one. */
function pageList() {
  const { classification } = ctx();
  if (classification.kind !== "batch") throw new Error(t("notAListPage"));
  return classification;
}

/** The provider's own endpoints for this kind of list, which every backend has, older ones too; the generic ones
 *  for a provider added since. */
function endpoints(): { entries: string; start: string; idField: string } {
  const { provider, type } = pageList();
  const manifest = manifestOf(provider);
  const legacy = manifest.legacy?.lists.find((list) => !list.kinds || list.kinds.includes(type));
  const path = legacy?.path ?? `${provider}/list`;
  return { entries: `/import/${path}/entries`, start: `/import/${path}`, idField: legacy?.idsField ?? "model_ids" };
}

function isPrintablesCollection(): boolean {
  const { provider, type } = pageList();
  return provider === MANIFESTS.printables.id && type === "collection";
}

function printablesCollectionId(): string | null {
  return ctx().url.match(/\/collections\/(\d+)/)?.[1] ?? null;
}

/** A Printables collection as its signed-in owner sees it: the instance can only read public ones,
 *  and would find a private one empty. Null without a login, for the instance's own read; a failed
 *  read with one says so, rather than falling back to that read and looking empty. */
async function signedInPrintablesEntries(): Promise<BatchEntriesResult | null> {
  const collectionId = printablesCollectionId();
  const token = collectionId ? await printablesToken() : null;
  if (!collectionId || !token) return null;
  try {
    const { title, entries, truncated } = await readCollectionForPanel(token, collectionId);
    const { print_ids: inLibrary } = await api<{ print_ids: Record<string, string> }>("POST", "/import/status/batch", {
      provider: MANIFESTS.printables.id,
      external_ids: entries.map((entry) => entry.id),
    });
    return {
      title,
      truncated,
      entries: entries.map((entry) => ({
        design_id: entry.id,
        title: entry.title,
        already_imported: entry.id in inLibrary,
      })),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(t("couldNotReadPrintablesCollection", { reason }), {
      cause: err,
    });
  }
}

/** `readAsUser`: read with the user's Printables login, as only a private collection needs. */
type PanelEntries = BatchEntriesResult & { readAsUser?: boolean };

/** The instance's own read first; for a Printables collection it finds nothing in (a private one),
 *  the user's own. */
async function loadEntries(): Promise<PanelEntries> {
  let instanceError: unknown = null;
  try {
    const found = await api<BatchEntriesResult>("POST", endpoints().entries, { url: ctx().url });
    if (found.entries.length || !isPrintablesCollection()) return found;
  } catch (err) {
    if (!isPrintablesCollection()) throw err;
    instanceError = err;
  }
  // Null without a login; a read with one, even an empty one, is the answer.
  const signedIn = await signedInPrintablesEntries();
  if (signedIn) return { ...signedIn, readAsUser: true };
  if (instanceError) throw instanceError;
  return { entries: [] };
}

/** The notes over the list for its models the provider keeps from the user: one per reason, with how many. */
function blockedNotesHtml(blocked: ImportBlock[]): string {
  const counts = new Map<ImportBlock, number>();
  for (const block of blocked) counts.set(block, (counts.get(block) ?? 0) + 1);
  return [...counts]
    .map(
      ([block, count]) => `<div class="tg-hint">${escapeHtml(block.title)} (${count}): ${escapeHtml(block.hint)}</div>`,
    )
    .join("");
}

export async function loadBatchEntries(): Promise<void> {
  const { provider } = ctx().classification;
  renderFunStatus(loadingModelsPhrases(provider));
  let result: PanelEntries;
  let sync: SyncLookup | null;
  try {
    [result, sync] = await Promise.all([loadEntries(), loadSyncState()]);
  } catch (err) {
    renderPanel(`${snapmakerListSwitchHtml()}${errorHtml(err)}`);
    wireSnapmakerListSwitch();
    return;
  }
  const allImported = result.entries.every((entry) => entry.already_imported);
  // A reason the provider has no words for leaves its model as any other.
  const blockOf = (entry: BatchEntry) =>
    entry.blocked && !entry.already_imported ? CONTENT_MODULES[provider].listBlocks?.[entry.blocked] : undefined;
  const rows = result.entries
    .map((entry) => {
      const block = blockOf(entry);
      const state = entry.already_imported ? " tg-entry--imported" : block ? " tg-entry--blocked" : "";
      const badge = entry.already_imported ? t("alreadyImported") : block?.title;
      return `
        <label class="tg-entry${state}"${block ? ` title="${escapeHtml(block.hint)}"` : ""}>
          <input type="checkbox" class="tg-entry__checkbox" value="${escapeHtml(entry.design_id)}" ${entry.already_imported || block ? "" : "checked"}${block ? " disabled" : ""} />
          <span class="tg-entry__name">${escapeHtml(entry.title || entry.design_id)}</span>
          ${badge ? `<span class="tg-badge">${escapeHtml(badge)}</span>` : ""}
        </label>
      `;
    })
    .join("");
  const count = result.entries.length;
  const found = `${t("modelsFound", { count, suffix: count === 1 ? "" : "s" })}${result.truncated ? t("moreModelsAvailable") : ""}`;
  renderPanel(`
    ${snapmakerListSwitchHtml()}
    <div class="tg-title">${escapeHtml(result.title || t("importModels"))}</div>
    <div class="tg-hint">${allImported && result.entries.length ? t("allFoundModelsAlreadyInLibrary", { found }) : found}</div>
    ${blockedNotesHtml(result.entries.flatMap((entry) => blockOf(entry) ?? []))}
    <div class="tg-entries">${rows}</div>
    ${syncToggleHtml(sync)}
    <button class="tg-btn" type="button" data-action="import">${escapeHtml(allImported && sync ? t("save") : t("importSelected"))}</button>
  `);
  onPanelAction("import", () => void runBatchImport(result, sync));
  wireSnapmakerListSwitch();
}

async function runBatchImport(result: PanelEntries, sync: SyncLookup | null): Promise<void> {
  const ids = panelQueryAll<HTMLInputElement>(".tg-entry__checkbox:checked").map((el) => el.value);
  const wantSync = readSyncToggle();
  if (!ids.length && !sync) return;
  const { url, instanceUrl } = ctx();
  const { start, idField } = endpoints();
  renderPanel(statusHtml(ids.length ? t("startingImport") : t("saving")));
  try {
    // Sync first, so the import files into the synced collection.
    const { change, link } = await applySyncToggle(sync, wantSync, {
      title: result.title ?? null,
      knownIds: result.entries.map((entry) => entry.design_id),
    });
    const note = syncChangeNote(change, link);
    // A private one: the instance can't read it, so it gets its models now rather than waiting.
    const collectionId = result.readAsUser ? printablesCollectionId() : null;
    if (change === "enabled" && collectionId) {
      void pushPrintablesNow(
        collectionId,
        result.entries.map((entry) => entry.design_id),
      );
    }
    if (!ids.length) {
      const target = link ?? sync?.sync;
      const collectionLink = target
        ? `${instanceUrl}/models/collections/${target.collection_id}`
        : `${instanceUrl}/models`;
      renderPanel(
        successHtml(collectionLink, note ?? t("nothingNewToImport"), note ? t("saved") : t("nothingToImport")),
      );
      return;
    }
    if (manifestOf(ctx().classification.provider).helpers.grab === "required") {
      // Parked on the instance, then brought in from this page, which can sign their files.
      const { collection_id } = await api<{ queued: number; collection_id: string }>("POST", start, {
        url,
        [idField]: ids,
      });
      renderPanel(statusHtml(t("importingSelectedModels", { count: ids.length })));
      const imported = await request("RUN_MAKERONLINE_WAITING");
      renderPanel(
        successHtml(
          `${instanceUrl}/models/collections/${collection_id}`,
          `${t("importedModels", { count: imported })}${note ? ` ${note}` : ""}`,
          imported ? undefined : t("nothingImported"),
        ),
      );
      return;
    }
    const { job_id } = await api<{ job_id: string }>("POST", start, {
      url,
      [idField]: ids,
      // A private Printables collection's name, which the instance can't read itself.
      ...(result.readAsUser ? { collection_title: result.title ?? null } : {}),
    });
    await pollJobWithProgress(job_id, instanceUrl, note);
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}

/** A finished job isn't always a success: its links can all have failed. Undefined leaves the usual heading. */
function doneTitle(job: ImportJob): string | undefined {
  if (!job.imported && !job.already_in_library) return t("nothingImported");
  return job.failed_count ? t("partlyImported") : undefined;
}

async function pollJobWithProgress(jobId: string, instanceUrl: string, note: string | null = null): Promise<void> {
  for (;;) {
    // The panel is gone; the job keeps running server-side.
    if (!isPanelMounted()) return;
    const job = await api<ImportJob>("GET", `/import/jobs/${jobId}`);
    if (!isPanelMounted()) return;
    if (job.status === "RUNNING") {
      renderPanel(statusHtml(t("importProgress", { processed: job.processed, total: job.total })));
      await sleep(1000);
      continue;
    }
    if (job.status === "ERROR") {
      renderPanel(errorHtml(new Error(job.error_message || t("importFailed"))));
      return;
    }
    if (job.status !== "DONE") {
      renderPanel(
        pausedHtml(
          instanceUrl,
          job.total ? t("importedSoFar", { imported: job.imported, total: job.total }) : null,
          note,
        ),
      );
      return;
    }
    const link = job.result_print_id ? `${instanceUrl}/models/${job.result_print_id}` : `${instanceUrl}/models`;
    renderPanel(
      successHtml(
        link,
        `${t("importedOfTotal", { imported: job.imported, total: job.total })}${note ? ` ${note}` : ""}`,
        doneTitle(job),
      ),
    );
    return;
  }
}
