// MakerWorld collection import. Avoids MakerWorld's collection-listing API (a burst of those calls
// trips an account-wide CAPTCHA) by scrolling the page and scraping model ids from the DOM, until
// it has as many as the page's own data says the collection holds.
// Every not-yet-imported model is queued, and with more than each model's own print profile wanted, those already in
// the library too, for the profiles they lack.

import type { ImportStatus, SyncLookup } from "../../shared/api";
import { t } from "../../shared/i18n";
import { request } from "../../shared/messages";
import { makerworldModelUrl } from "./urls.generated";
import { ctx } from "../../content/context";
import { findOrCreateCollection } from "../../content/panels/collectionPicker";
import { NO_MORE_DATA } from "./labels";
import { loadMakerworldCollectionTotal, type MakerworldProfileScope } from "./pageData";
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
  { ms: 5_000, label: "collectionDelay5Seconds" },
  { ms: 30_000, label: "collectionDelay30Seconds" },
  { ms: 60_000, label: "collectionDelay1Minute" },
  { ms: 2 * 60_000, label: "collectionDelay2Minutes" },
  { ms: 5 * 60_000, label: "collectionDelay5Minutes" },
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
    ({ ms, label }) =>
      `<option value="${ms}"${ms === selectedMs ? " selected" : ""}>${escapeHtml(t(label))}</option>`,
  ).join("");
}

// As the model page's panel offers them. Beyond each model's own, every profile is a page visit and a download of its
// own, after the same wait as a model.
const PROFILE_SCOPE_CHOICES: { scope: MakerworldProfileScope; label: string }[] = [
  { scope: "url", label: "collectionDefaultProfile" },
  { scope: "designer", label: "collectionDesignerProfiles" },
  { scope: "all", label: "collectionCommunityProfiles" },
];
const PROFILE_SCOPE_STORAGE_KEY = "makerworldProfileScope";

async function rememberedProfileScope(): Promise<MakerworldProfileScope> {
  try {
    const stored = (await chrome.storage.local.get(PROFILE_SCOPE_STORAGE_KEY))[PROFILE_SCOPE_STORAGE_KEY];
    const known = PROFILE_SCOPE_CHOICES.find((choice) => choice.scope === stored);
    if (known) return known.scope;
  } catch {}
  return "url";
}

async function rememberProfileScope(scope: MakerworldProfileScope): Promise<void> {
  try {
    await chrome.storage.local.set({ [PROFILE_SCOPE_STORAGE_KEY]: scope });
  } catch {}
}

function profileScopeOptions(selected: MakerworldProfileScope): string {
  return PROFILE_SCOPE_CHOICES.map(
    ({ scope, label }) =>
      `<option value="${scope}"${scope === selected ? " selected" : ""}>${escapeHtml(t(label))}</option>`,
  ).join("");
}

/** Beyond each model's own, every print profile waits as a model does. */
function waitLabel(scope: MakerworldProfileScope): string {
  return t(scope === "url" ? "collectionWaitBetweenModels" : "collectionWaitBetweenProfiles");
}

function readProfileScope(): MakerworldProfileScope {
  const value = panelQuery<HTMLSelectElement>("#tg-profile-scope")?.value;
  return PROFILE_SCOPE_CHOICES.find((choice) => choice.scope === value)?.scope ?? "url";
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
      errorHtml(new Error(t("couldNotFindMakerworldModels"))),
    );
    return;
  }

  renderPanel(statusHtml(t("checkingModelsInLibrary", { count: ids.length })));
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
  if (toImport.length) parts.push(t("modelsToImport", { count: toImport.length }));
  if (alreadyImported.length) {
    parts.push(
      toImport.length
        ? t("modelsAlreadyInLibrary", { count: alreadyImported.length })
        : t("allModelsAlreadyInLibrary"),
    );
  }
  const target = sync?.sync
    ? t("modelsGoIntoSyncedCollection", { collection: sync.sync.collection_name })
    : collectionTitle
      ? t("modelsGoIntoCollection", { collection: collectionTitle })
      : "";
  // The models a run visits: the new ones, and with more than each one's own profile, those in the library too.
  const toVisit = (scope: MakerworldProfileScope) => (scope === "url" ? toImport : statuses);
  const startLabel = (scope: MakerworldProfileScope) =>
    toVisit(scope).length ? t("startImport") : sync ? t("save") : t("addToCollection");
  const paceHint = (scope: MakerworldProfileScope) =>
    !toVisit(scope).length
      ? ""
      : scope === "url"
        ? t("collectionImportPace")
        : t(alreadyImported.length ? "collectionProfilesExistingPace" : "collectionProfilesPace");
  const scope = await rememberedProfileScope();
  renderPanel(`
    <div class="tg-title">${escapeHtml(collectionTitle || t("importCollection"))}</div>
    <div class="tg-hint">${escapeHtml(parts.join(", ") || t("noModelsFound"))}</div>
    ${
      statuses.length
        ? `<label class="tg-label" for="tg-profile-scope">${escapeHtml(t("printProfiles"))}</label>
           <select id="tg-profile-scope" class="tg-select">${profileScopeOptions(scope)}</select>
           <label class="tg-label" for="tg-step-delay" data-role="wait-label">${waitLabel(scope)}</label>
           <select id="tg-step-delay" class="tg-select">${stepDelayOptions(await rememberedStepDelay())}</select>`
        : ""
    }
    ${syncToggleHtml(sync)}
    <button class="tg-btn" type="button" data-action="start">${escapeHtml(startLabel(scope))}</button>
    <div class="tg-hint tg-hint--spaced">${escapeHtml(target)}<span data-role="pace">${escapeHtml(paceHint(scope))}</span></div>
  `);
  panelQuery<HTMLSelectElement>("#tg-profile-scope")?.addEventListener("change", () => {
    const chosen = readProfileScope();
    const start = panelQuery<HTMLButtonElement>('[data-action="start"]');
    const pace = panelQuery<HTMLElement>('[data-role="pace"]');
    const wait = panelQuery<HTMLElement>('[data-role="wait-label"]');
    if (start) start.textContent = startLabel(chosen);
    if (pace) pace.textContent = paceHint(chosen);
    if (wait) wait.textContent = waitLabel(chosen);
  });
  onPanelAction("start", () => {
    const stepDelayMs = Number(panelQuery<HTMLSelectElement>("#tg-step-delay")?.value) || STEP_DELAY_CHOICES[0].ms;
    const chosen = readProfileScope();
    const visit = toVisit(chosen);
    void rememberProfileScope(chosen);
    if (visit.length) void rememberStepDelay(stepDelayMs);
    void startGuidedImport(visit, alreadyImported, collectionTitle, stepDelayMs, chosen, {
      state: sync,
      wanted: readSyncToggle(),
      knownIds: ids,
    });
  });
}

/** `visit`: the models the run goes to, page by page; `alreadyImported` are filed into the collection first. */
async function startGuidedImport(
  visit: ModelStatus[],
  alreadyImported: ModelStatus[],
  collectionTitle: string | null,
  stepDelayMs: number,
  profileScope: MakerworldProfileScope,
  sync: { state: SyncLookup | null; wanted: boolean; knownIds: string[] },
): Promise<void> {
  const { url: originalUrl, instanceUrl } = ctx();
  renderPanel(statusHtml(t("preparingCollection")));
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

  // Filed here directly: they need no page visit to be, and get one only for profiles they lack.
  if (alreadyImported.length && collectionId) {
    renderPanel(
      statusHtml(
        t("addingExistingModelsToCollection", { count: alreadyImported.length }),
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

  if (!visit.length) {
    renderPanel(
      successHtml(
        collectionId ? `${instanceUrl}/models/collections/${collectionId}` : `${instanceUrl}/models`,
        `${t("nothingNewCollectionImport")}${syncNote ? ` ${syncNote}` : ""}`,
      ),
    );
    return;
  }

  renderPanel(statusHtml(t("startingGuidedImport")));
  await request("START_MAKERWORLD_COLLECTION_JOB", {
    urls: visit.map((e) => e.url),
    collectionId,
    originalUrl,
    stepDelayMs,
    profileScope,
  });
}
