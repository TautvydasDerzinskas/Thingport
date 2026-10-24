// Batch flow for every provider's collections, likes and bookmarks. MakerWorld collections use the guided flow in
// makerworldCollection.ts.

import type { BatchEntriesResult, ImportJob, SyncLookup } from "../../shared/api";
import { ctx, setContext } from "../context";
import { MANIFESTS, manifestOf } from "../../shared/providers/_generated";
import { parseSnapmakerListUrl, snapmakerListUrl, type SnapmakerList } from "../../shared/urls";
import { request } from "../../shared/messages";
import { api, escapeHtml, sleep } from "../runtime";
import { isPanelMounted, onPanelAction, panelQueryAll, renderPanel } from "../shell";
import { errorHtml, statusHtml, successHtml } from "./results";
import { loadingModelsPhrases, renderFunStatus } from "./funStatus";
import { applySyncToggle, loadSyncState, readSyncToggle, syncChangeNote, syncToggleHtml } from "./syncToggle";
import { printablesToken, readCollectionForPanel } from "../printables";
import { pushPrintablesNow } from "../providerAccount";

const SNAPMAKER_LISTS: { list: SnapmakerList; label: string }[] = [
  { list: "likes", label: "Likes" },
  { list: "bookmarks", label: "Bookmarks" },
];

/** Snapmaker shows likes and bookmarks on one page without changing its address, so the panel picks which. */
function snapmakerListSwitchHtml(): string {
  const { classification } = ctx();
  if (classification.provider !== MANIFESTS.snapmaker.id || classification.kind !== "batch") return "";
  const options = SNAPMAKER_LISTS.map(
    ({ list, label }) =>
      `<button class="tg-segmented__option" type="button" data-action="list-${list}" aria-pressed="${classification.type === list}">${label}</button>`,
  ).join("");
  return `<div class="tg-segmented" role="group" aria-label="Which list">${options}</div>`;
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
  if (classification.kind !== "batch") throw new Error("This page isn't a list");
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
    throw new Error(`Couldn't read this collection from Printables as you: ${reason}. Reload the page to try again.`, {
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

export async function loadBatchEntries(): Promise<void> {
  renderFunStatus(loadingModelsPhrases(ctx().classification.provider));
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
  const rows = result.entries
    .map(
      (entry) => `
        <label class="tg-entry${entry.already_imported ? " tg-entry--imported" : ""}">
          <input type="checkbox" class="tg-entry__checkbox" value="${escapeHtml(entry.design_id)}" ${entry.already_imported ? "" : "checked"} />
          <span class="tg-entry__name">${escapeHtml(entry.title || entry.design_id)}</span>
          ${entry.already_imported ? '<span class="tg-badge">already imported</span>' : ""}
        </label>
      `,
    )
    .join("");
  const found = `${result.entries.length} models found${result.truncated ? " (more available on the site)" : ""}`;
  renderPanel(`
    ${snapmakerListSwitchHtml()}
    <div class="tg-title">${escapeHtml(result.title || "Import models")}</div>
    <div class="tg-hint">${allImported && result.entries.length ? `${found}, all already in your library.` : found}</div>
    <div class="tg-entries">${rows}</div>
    ${syncToggleHtml(sync)}
    <button class="tg-btn" type="button" data-action="import">${allImported && sync ? "Save" : "Import selected"}</button>
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
  renderPanel(statusHtml(ids.length ? "Starting import…" : "Saving…"));
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
      renderPanel(successHtml(collectionLink, note ?? "Nothing new to import.", note ? "Saved" : "Nothing to import"));
      return;
    }
    if (manifestOf(ctx().classification.provider).helpers.grab === "required") {
      // Parked on the instance, then brought in from this page, which can sign their files.
      const { collection_id } = await api<{ queued: number; collection_id: string }>("POST", start, {
        url,
        [idField]: ids,
      });
      renderPanel(statusHtml(`Importing ${ids.length} model${ids.length === 1 ? "" : "s"}…`));
      const imported = await request("RUN_MAKERONLINE_WAITING");
      renderPanel(
        successHtml(
          `${instanceUrl}/models/collections/${collection_id}`,
          `Imported ${imported} model${imported === 1 ? "" : "s"}.${note ? ` ${note}` : ""}`,
          imported ? undefined : "Nothing imported",
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

async function pollJobWithProgress(jobId: string, instanceUrl: string, note: string | null = null): Promise<void> {
  for (;;) {
    // The panel is gone; the job keeps running server-side.
    if (!isPanelMounted()) return;
    const job = await api<ImportJob>("GET", `/import/jobs/${jobId}`);
    if (!isPanelMounted()) return;
    if (job.status === "RUNNING") {
      renderPanel(statusHtml(`Importing ${job.processed} of ${job.total}…`));
      await sleep(1000);
      continue;
    }
    if (job.status === "ERROR") {
      renderPanel(errorHtml(new Error(job.error_message || "Import failed")));
      return;
    }
    const link = job.result_print_id ? `${instanceUrl}/models/${job.result_print_id}` : `${instanceUrl}/models`;
    renderPanel(successHtml(link, `Imported ${job.imported} of ${job.total}.${note ? ` ${note}` : ""}`));
    return;
  }
}
