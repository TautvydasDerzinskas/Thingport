// MakerWorld collection import. Avoids MakerWorld's collection-listing API (a burst of those calls
// trips an account-wide CAPTCHA) by scrolling the page and scraping model ids from the DOM, until
// it has as many as the page's own data says the collection holds.
// Every not-yet-imported model is queued.

import type { ImportStatus, SyncLookup } from "../../shared/api";
import { request } from "../../shared/messages";
import { makerworldModelUrl } from "./urls.generated";
import { ctx } from "../../content/context";
import { findOrCreateCollection } from "../../content/panels/collectionPicker";
import { NO_MORE_DATA } from "./labels";
import { loadMakerworldCollectionTotal } from "./pageData";
import { mountScanOverlay } from "../../content/overlays";
import { api, escapeHtml, sleep } from "../../content/runtime";
import { getShadowRoot, onPanelAction, panelQuery, renderPanel } from "../../content/shell";
import { errorHtml, statusHtml, successHtml } from "../../content/panels/results";
import {
  applySyncToggle,
  loadSyncState,
  readSyncToggle,
  syncChangeNote,
  syncToggleHtml,
} from "../../content/panels/syncToggle";
import { MANIFESTS } from "../index.generated";

// The page may still be hydrating; checking too early sees zero cards and looks like the end.
const SCAN_START_DELAY_MS = 1500;
const SCAN_ROUND_DELAY_MS = 700;
const SCAN_MAX_ROUNDS = 600; // generous: ~1,000 models at 20/page is ~50 loads
// ~14s without new cards. Only a fallback: the scan normally stops at the page's own model count
// or the end marker. At ~4s, a slow page load ended it early (e.g. at 40 of 56).
const SCAN_STAGNANT_LIMIT = 20;

/** Matched on text: MakerWorld's class names are build hashes. */
function hasNoMoreDataMarker(): boolean {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent && NO_MORE_DATA.has(node.textContent.trim())) return true;
  }
  return false;
}

function collectModelIds(into: Set<string>): void {
  for (const a of document.querySelectorAll('a[href*="/models/"]')) {
    const match = (a.getAttribute("href") || "").match(/\/models\/(\d+)/);
    if (match) into.add(match[1]);
  }
}

function scrollToLastCard(): void {
  const links = document.querySelectorAll('a[href*="/models/"]');
  const lastLink = links[links.length - 1];
  if (lastLink) lastLink.scrollIntoView({ block: "end" });
  else window.scrollTo(0, document.body.scrollHeight);
}

/** Scrolls the last card into view until `total` models are seen, the end marker shows, or the
 *  count stops growing. Ids are collected every round, in case the page drops cards that scrolled
 *  out of view. */
async function scrollToEnd(
  total: number | null,
  onProgress: (count: number, total: number | null) => void,
): Promise<string[]> {
  const ids = new Set<string>();
  let stagnantRounds = 0;
  await sleep(SCAN_START_DELAY_MS);
  for (let round = 0; round < SCAN_MAX_ROUNDS; round++) {
    collectModelIds(ids);
    if ((total !== null && ids.size >= total) || hasNoMoreDataMarker()) break;
    // Scrolling to where the page already is fires no scroll event, so a stalled infinite-scroll
    // loader is nudged by stepping back up first.
    if (stagnantRounds > 0 && stagnantRounds % 3 === 0) {
      window.scrollBy(0, -window.innerHeight);
      await sleep(100);
    }
    scrollToLastCard();
    await sleep(SCAN_ROUND_DELAY_MS);
    const before = ids.size;
    collectModelIds(ids);
    onProgress(ids.size, total);
    stagnantRounds = ids.size === before ? stagnantRounds + 1 : 0;
    if (stagnantRounds >= SCAN_STAGNANT_LIMIT) break;
  }
  return [...ids];
}

// The first is the default. Longer waits let a big run go unattended under MakerWorld's rate limit.
const STEP_DELAY_CHOICES = [
  { ms: 5_000, label: "5 seconds" },
  { ms: 30_000, label: "30 seconds" },
  { ms: 60_000, label: "1 minute" },
  { ms: 2 * 60_000, label: "2 minutes" },
  { ms: 5 * 60_000, label: "5 minutes" },
];
const STEP_DELAY_STORAGE_KEY = "makerworldStepDelayMs";

async function rememberedStepDelay(): Promise<number> {
  try {
    const stored = (await chrome.storage.local.get(STEP_DELAY_STORAGE_KEY))[STEP_DELAY_STORAGE_KEY];
    if (STEP_DELAY_CHOICES.some((choice) => choice.ms === stored)) return stored as number;
  } catch {}
  return STEP_DELAY_CHOICES[0].ms;
}

async function rememberStepDelay(ms: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [STEP_DELAY_STORAGE_KEY]: ms });
  } catch {}
}

function stepDelayOptions(selectedMs: number): string {
  return STEP_DELAY_CHOICES.map(
    ({ ms, label }) => `<option value="${ms}"${ms === selectedMs ? " selected" : ""}>${label}</option>`,
  ).join("");
}

type ModelStatus = { url: string; already_imported: boolean; print_id: string | null };

// Per-model checks, for instances without the batch endpoint, run a few at a time.
const STATUS_CHECK_CONCURRENCY = 6;

/** Throws rather than guessing: an unchecked model counted as new would be re-imported. */
async function checkLibrary(ids: string[]): Promise<ModelStatus[]> {
  let printIds: Record<string, string>;
  try {
    ({ print_ids: printIds } = await api<{ print_ids: Record<string, string> }>("POST", "/import/status/batch", {
      provider: MANIFESTS.makerworld.id,
      external_ids: ids,
    }));
  } catch {
    printIds = {};
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const status = await api<ImportStatus>(
          "GET",
          `/import/status?url=${encodeURIComponent(makerworldModelUrl(id))}`,
        );
        if (status.already_imported && status.print_id) printIds[id] = status.print_id;
      }
    };
    await Promise.all(Array.from({ length: STATUS_CHECK_CONCURRENCY }, worker));
  }
  return ids.map((id) => ({
    url: makerworldModelUrl(id),
    already_imported: id in printIds,
    print_id: printIds[id] ?? null,
  }));
}

export async function loadMakerworldGuidedCollection(): Promise<void> {
  const collectionTitle = document.getElementsByTagName("h1")[0]?.innerText?.trim() || null;

  const root = getShadowRoot();
  if (!root) return;
  const scan = mountScanOverlay(root);
  const syncState = loadSyncState();
  const total = await loadMakerworldCollectionTotal(location.href);
  const ids = await scrollToEnd(total, (count, expected) => scan.update(count, expected));
  scan.remove();

  if (!ids.length) {
    renderPanel(
      errorHtml(new Error("Couldn't find any models on this page -- MakerWorld may have changed its page layout.")),
    );
    return;
  }

  renderPanel(statusHtml(`Checking ${ids.length} models against your library…`));
  let statuses: ModelStatus[];
  try {
    statuses = await checkLibrary(ids);
  } catch (err) {
    renderPanel(errorHtml(err));
    return;
  }
  const toImport = statuses.filter((s) => !s.already_imported);
  const alreadyImported = statuses.filter((s) => s.already_imported);
  const sync = await syncState;

  const parts: string[] = [];
  if (toImport.length) parts.push(`${toImport.length} new model${toImport.length === 1 ? "" : "s"} to import`);
  if (alreadyImported.length) {
    parts.push(toImport.length ? `${alreadyImported.length} already in your library` : "all already in your library");
  }
  const target = sync?.sync
    ? `Models go into "${escapeHtml(sync.sync.collection_name)}", the Thingport collection synced with this one. `
    : collectionTitle
      ? `Models go into a Thingport collection named "${escapeHtml(collectionTitle)}" (created if it doesn't exist yet). `
      : "";
  renderPanel(`
    <div class="tg-title">${escapeHtml(collectionTitle || "Import collection")}</div>
    <div class="tg-hint">${parts.join(", ") || "No models found."}</div>
    ${
      toImport.length
        ? `<label class="tg-label" for="tg-step-delay">Wait between models</label>
           <select id="tg-step-delay" class="tg-select">${stepDelayOptions(await rememberedStepDelay())}</select>`
        : ""
    }
    ${syncToggleHtml(sync)}
    <button class="tg-btn" type="button" data-action="start">${toImport.length ? "Start import" : sync ? "Save" : "Add to collection"}</button>
    <div class="tg-hint tg-hint--spaced">
      ${target}${
        toImport.length
          ? `New models are imported one page visit at a time, pacing itself to avoid MakerWorld's rate
             limiting -- this can take a while for a large collection.`
          : ""
      }
    </div>
  `);
  onPanelAction("start", () => {
    const stepDelayMs = Number(panelQuery<HTMLSelectElement>("#tg-step-delay")?.value) || STEP_DELAY_CHOICES[0].ms;
    if (toImport.length) void rememberStepDelay(stepDelayMs);
    void startGuidedImport(toImport, alreadyImported, collectionTitle, stepDelayMs, {
      state: sync,
      wanted: readSyncToggle(),
      knownIds: ids,
    });
  });
}

async function startGuidedImport(
  toImport: ModelStatus[],
  alreadyImported: ModelStatus[],
  collectionTitle: string | null,
  stepDelayMs: number,
  sync: { state: SyncLookup | null; wanted: boolean; knownIds: string[] },
): Promise<void> {
  const { url: originalUrl, instanceUrl } = ctx();
  renderPanel(statusHtml("Preparing your collection…"));
  let syncNote: string | null;
  let collectionId: string | null;
  try {
    const { change, link } = await applySyncToggle(sync.state, sync.wanted, {
      title: collectionTitle,
      knownIds: sync.knownIds,
    });
    syncNote = syncChangeNote(change, link);
    // A synced collection keeps getting this page's models whatever it's been renamed to.
    collectionId =
      link?.collection_id ?? sync.state?.sync?.collection_id ?? (await findOrCreateCollection(collectionTitle));
  } catch (err) {
    renderPanel(errorHtml(err));
    return;
  }

  // Already-imported models need no page visit, so they're filed here directly.
  if (alreadyImported.length && collectionId) {
    renderPanel(
      statusHtml(
        `Adding ${alreadyImported.length} existing model${alreadyImported.length === 1 ? "" : "s"} to your collection…`,
      ),
    );
    const printIds = alreadyImported.flatMap((entry) => (entry.print_id ? [entry.print_id] : []));
    try {
      await api("POST", `/collection/${collectionId}/items`, { print_ids: printIds });
    } catch {
      // Instances without the bulk endpoint, one model at a time.
      for (const printId of printIds) {
        await api("POST", `/collection/${collectionId}/items/${printId}`).catch(() => undefined);
      }
    }
  }

  if (!toImport.length) {
    renderPanel(
      successHtml(
        collectionId ? `${instanceUrl}/models/collections/${collectionId}` : `${instanceUrl}/models`,
        `Nothing new to import -- already-imported models were added to your collection.${syncNote ? ` ${syncNote}` : ""}`,
      ),
    );
    return;
  }

  renderPanel(statusHtml("Starting guided import…"));
  await request("START_MAKERWORLD_COLLECTION_JOB", {
    urls: toImport.map((e) => e.url),
    collectionId,
    originalUrl,
    stepDelayMs,
  });
}
