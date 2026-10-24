// Every provider's model pages import directly but MakerWorld's, which go through /import/inspect first, like the web
// app's useUploadImport.tsx. MakerOnline's files are signed on its own page first (see background/makeronline.ts).

import type { FillGapsResult, InspectResult, SourceGap, ZipEntriesResult } from "../../shared/api";
import { request } from "../../shared/messages";
import { ctx } from "../context";
import {
  isMakerworldBlockingError,
  resolveMakerworldDownloadUrl,
  resolveMakerworldProfileDownload,
} from "../makerworld/downloadResolver";
import { currentMakerworldProfileTitle } from "../makerworld/pageData";
import { CONTENT_MODULES, type ProfileScope } from "../providers";
import { api, escapeHtml } from "../runtime";
import { onPanelAction, panelQuery, panelQueryAll, renderPanel } from "../shell";
import { collectionIdFor, collectionPickerHtml, readCollectionChoice, wireCollectionPicker } from "./collectionPicker";
import { errorHtml, statusHtml, successHtml } from "./results";
import {
  checkingLinkPhrases,
  fillingGapsPhrases,
  importingPhrases,
  renderFunStatus,
  SITE_NAMES,
  zipFilesPhrases,
} from "./funStatus";

/** Model name for pages that skip /import/inspect. The <h1> first: Thingiverse's og:title goes
 *  stale on SPA navigation and Printables' has a suffix. */
function guessPageTitle(): string | null {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  if (h1) return h1;
  const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content?.trim();
  return og || document.title.trim() || null;
}

// Several profile resolutions in a quick burst still look automated to MakerWorld.
const PROFILE_GAP_MS = 2000;

/** The print profile ids a scope brings, the page's own first. Null on sites without profiles, or when they can't
 *  be read. */
async function profileIdsFor(): Promise<((scope: ProfileScope) => string[]) | null> {
  const { url, classification } = ctx();
  if (classification.kind !== "single") return null;
  return (await CONTENT_MODULES[classification.provider].loadProfiles?.(url)) ?? null;
}

/** The page's selected profile first, then "designer's" and "all" where they'd import more. */
async function profilesPickerHtml(): Promise<string> {
  const ids = await profileIdsFor();
  if (!ids) return "";
  const all = ids("all").length;
  if (all < 2) return "";
  const designer = ids("designer").length;
  const options = [`<option value="url">Currently selected print profile</option>`];
  if (designer > 1) options.push(`<option value="designer">All designer print profiles (${designer})</option>`);
  if (all > designer) options.push(`<option value="all">Designer &amp; community print profiles (${all})</option>`);
  return `
    <label class="tg-label" for="tg-profiles">Print profiles</label>
    <select id="tg-profiles" class="tg-select">${options.join("")}</select>
  `;
}

function selectedProfileScope(): ProfileScope {
  const value = panelQuery<HTMLSelectElement>("#tg-profiles")?.value;
  return value === "designer" || value === "all" ? value : "url";
}

function profileUrl(url: string, instanceId: string): string {
  const own = CONTENT_MODULES[ctx().classification.provider].profileUrl;
  return own ? own(url, instanceId) : `${url.split("#")[0]}#profileId-${instanceId}`;
}

function importHeading(): string {
  const { title } = ctx();
  return title ? `Import "${escapeHtml(title)}"` : "Import this model";
}

/** Admins only: the same import, but waiting paused in the instance's import queue. Not on MakerOnline: the queue
 *  can't get its files, so it would only hand the link back to Grab. */
function queueButtonHtml(): string {
  return ctx().canQueue && ctx().classification.provider !== "makeronline"
    ? `<button class="tg-btn tg-btn--secondary" type="button" data-action="queue">Add to the queue</button>`
    : "";
}

/** Queues with the panel's current choices. Picking files out of a zip needs the download now, so
 *  only the whole-link imports offer it. */
function onQueueAction(): void {
  onPanelAction("queue", () => {
    const choice = readCollectionChoice();
    if (choice === "missing-name") return;
    const scope = selectedProfileScope();
    void collectionIdFor(choice).then((collectionId) => runQueueImport(scope, collectionId));
  });
}

export async function loadSingleItem(): Promise<void> {
  const { library } = ctx();
  if (library?.state === "imported") {
    renderPanel(fillGapsHtml());
    onPanelAction("fill-gaps", () => void runFillGaps());
    return;
  }
  // A MakerWorld profile is always one 3MF, so inspecting would only cost a download resolution.
  if (library) {
    renderPanel(addProfileHtml(await profilesPickerHtml()));
    onPanelAction("import", () => void runDirectImport());
    onQueueAction();
    onPanelAction("fill-gaps", () => void runFillGaps());
    return;
  }
  const { provider } = ctx().classification;
  renderFunStatus(checkingLinkPhrases(provider));
  const block = await CONTENT_MODULES[provider].blockReason?.(ctx().url);
  if (block) {
    renderPanel(`
      <div class="tg-title">${escapeHtml(block.title)}</div>
      <div class="tg-hint">${escapeHtml(block.hint)}</div>
    `);
    return;
  }
  // MakerWorld's links may be a file to unpack; every other site's is a model page the instance reads itself.
  const skipInspect = provider !== "makerworld";

  let zipFilename: string | null = null;
  if (skipInspect) {
    ctx().title = guessPageTitle();
  } else {
    try {
      const inspect = await api<InspectResult>("POST", "/import/inspect", { url: ctx().url });
      ctx().title = inspect.title || null;
      if (inspect.is_zip) zipFilename = inspect.filename ?? "This file";
    } catch (err) {
      renderPanel(errorHtml(err));
      return;
    }
  }

  if (zipFilename === null) {
    renderPanel(`
      <div class="tg-title">${importHeading()}</div>
      ${await profilesPickerHtml()}
      ${await collectionPickerHtml()}
      <button class="tg-btn" type="button" data-action="import">Import</button>
      ${queueButtonHtml()}
    `);
    wireCollectionPicker();
    onPanelAction("import", () => void runDirectImport());
    onQueueAction();
    return;
  }

  renderPanel(`
    <div class="tg-title">${importHeading()}</div>
    <div class="tg-hint">${escapeHtml(zipFilename)} contains multiple files.</div>
    ${await collectionPickerHtml()}
    <button class="tg-btn" type="button" data-action="import-as-zip">Import as one model</button>
    ${queueButtonHtml()}
    <button class="tg-btn tg-btn--secondary" type="button" data-action="choose-files">Choose files…</button>
  `);
  wireCollectionPicker();
  onPanelAction("import-as-zip", () => void runDirectImport());
  onQueueAction();
  onPanelAction("choose-files", () => void loadZipEntries());
}

/** The model's in the library but this profile may not be. */
function addProfileHtml(profilesPicker: string): string {
  const { library, url } = ctx();
  const profileName = currentMakerworldProfileTitle(url);
  const profileLabel = profileName ? `the "${escapeHtml(profileName)}" profile` : "this print profile";
  const hint =
    library?.state === "profile_missing"
      ? `You already have this model. Add ${profileLabel} as another file on it?`
      : `This model is in your library. Add ${profileLabel} if you don't have it yet -- if one of the model's files already is this profile, nothing is downloaded twice.`;
  return `
    <div class="tg-title">In your library</div>
    <div class="tg-hint">${hint}</div>
    ${profilesPicker}
    <button class="tg-btn" type="button" data-action="import">Add profile</button>
    ${queueButtonHtml()}
    ${library?.gaps.length ? fillGapsButtonHtml("tg-btn--secondary") : ""}
    <a class="tg-btn tg-btn--secondary" href="${escapeHtml(libraryModelLink())}" target="_blank" rel="noopener noreferrer">Open model in Thingport</a>
  `;
}

const GAP_LABELS: Record<SourceGap, string> = {
  title: "title",
  description: "description",
  tags: "tags",
  creator: "creator name",
  author: "linked author",
  category: "category",
  images: "preview images",
};

function gapList(gaps: SourceGap[]): string {
  return gaps.map((gap) => GAP_LABELS[gap] ?? gap).join(", ");
}

function fillGapsButtonHtml(variant = ""): string {
  return `<button class="tg-btn ${variant}" type="button" data-action="fill-gaps">Fetch missing details</button>`;
}

function libraryModelLink(): string {
  const { library, instanceUrl } = ctx();
  return library?.printId ? `${instanceUrl}/models/${library.printId}` : `${instanceUrl}/models`;
}

/** Everything's imported, but the library model has empty details the source can fill. */
function fillGapsHtml(): string {
  const { library, classification } = ctx();
  const gaps = library?.gaps ?? [];
  return `
    <div class="tg-title">In your library</div>
    <div class="tg-hint">This model is missing its ${escapeHtml(gapList(gaps))}. Fetch them from ${SITE_NAMES[classification.provider]}? Nothing you've already filled in is changed.</div>
    ${fillGapsButtonHtml()}
    <a class="tg-btn tg-btn--secondary" href="${escapeHtml(libraryModelLink())}" target="_blank" rel="noopener noreferrer">Open model in Thingport</a>
  `;
}

/** Fills the library model's empty details and images from its source. Never overwrites anything
 *  and never adds files: which print profiles a model holds is the import's choice. */
async function runFillGaps(): Promise<void> {
  const { library, classification } = ctx();
  if (!library?.printId) return;
  const site = SITE_NAMES[classification.provider];
  renderFunStatus(fillingGapsPhrases(classification.provider));
  try {
    const result = await api<FillGapsResult>("POST", `/print/${library.printId}/fill-gaps`);
    library.gaps = [];
    const remaining = result.remaining.length ? `${site} has nothing for the ${gapList(result.remaining)}.` : "";
    renderPanel(
      result.filled.length
        ? successHtml(
            libraryModelLink(),
            `Fetched the ${gapList(result.filled)}. ${remaining}`.trim(),
            "Details fetched",
          )
        : successHtml(libraryModelLink(), `${site} doesn't have these either.`, "Nothing to fetch"),
    );
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}

async function loadZipEntries(): Promise<void> {
  renderFunStatus(zipFilesPhrases);
  let result: ZipEntriesResult;
  try {
    result = await api<ZipEntriesResult>("POST", "/import/zip/entries", { url: ctx().url });
  } catch (err) {
    renderPanel(errorHtml(err));
    return;
  }
  const rows = result.entries
    .map(
      (entry) => `
        <label class="tg-entry">
          <input type="checkbox" class="tg-entry__checkbox" value="${escapeHtml(entry)}" checked />
          <span class="tg-entry__name">${escapeHtml(entry)}</span>
        </label>
      `,
    )
    .join("");
  renderPanel(`
    <div class="tg-title">Choose files to import</div>
    <div class="tg-entries">${rows}</div>
    ${await collectionPickerHtml()}
    <button class="tg-btn" type="button" data-action="import">Import selected</button>
  `);
  wireCollectionPicker();
  onPanelAction("import", () => {
    const entries = panelQueryAll<HTMLInputElement>(".tg-entry__checkbox:checked").map((el) => el.value);
    if (entries.length) void runDirectImport({ entries });
  });
}

async function runDirectImport(opts?: { entries?: string[] }): Promise<void> {
  // Captured up front: SPA navigation clears the context mid-import.
  const choice = readCollectionChoice();
  if (choice === "missing-name") return;
  const scope = selectedProfileScope();
  if (ctx().classification.provider === "makeronline") {
    await runMakeronlineImport(scope, await collectionIdFor(choice));
    return;
  }
  if (scope !== "url") {
    await runProfilesImport(scope, await collectionIdFor(choice));
    return;
  }
  const { url, instanceUrl, classification, title } = ctx();
  renderFunStatus(importingPhrases(classification.provider));
  const collectionId = await collectionIdFor(choice);
  try {
    const resolved =
      classification.provider === "makerworld" && classification.kind === "single"
        ? await resolveMakerworldDownloadUrl(url).catch(nullUnlessBlocking)
        : null;
    // One message so import and collection filing finish even if the page is gone.
    const print = await request("IMPORT_SINGLE", { url, entries: opts?.entries, collectionId, resolved, title });
    const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
    if (print?.import_outcome === "profile_added") {
      renderPanel(successHtml(link, "Added this print profile's file to the model you already had.", "Profile added"));
    } else if (print?.import_outcome === "already_imported") {
      renderPanel(
        successHtml(
          link,
          "This print profile's file was already on the model -- nothing new was added.",
          "Already in your library",
        ),
      );
    } else {
      renderPanel(successHtml(link));
    }
  } catch (err) {
    renderBlockedError(err, "url", collectionId);
  }
}

/** Every profile the scope picks comes down in one import: the page signs their files, the instance makes one model
 *  of them. */
async function runMakeronlineImport(scope: ProfileScope, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title } = ctx();
  renderFunStatus(importingPhrases("makeronline"));
  try {
    const print = await request("IMPORT_MAKERONLINE_MODEL", { url, scope, collectionId, title: title ?? null });
    const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
    if (print?.import_outcome === "profile_added") {
      renderPanel(successHtml(link, "Added the print profiles' files to the model you already had.", "Profile added"));
    } else if (print?.import_outcome === "already_imported") {
      renderPanel(
        successHtml(link, "These files were already on the model -- nothing new was added.", "Already in your library"),
      );
    } else {
      renderPanel(successHtml(link));
    }
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}

/** A CAPTCHA or the daily limit won't clear by clicking Import again, so an admin can park the
 *  link in the queue with the same choices instead, and start it once MakerWorld lets go. The
 *  backend's errors arrive as plain text, hence the message check. */
function renderBlockedError(err: unknown, scope: ProfileScope, collectionId: string | null): void {
  const blocked =
    isMakerworldBlockingError(err) || (err instanceof Error && /captcha|download limit/i.test(err.message));
  if (!blocked || !ctx().canQueue) {
    renderPanel(errorHtml(err));
    return;
  }
  renderPanel(`${errorHtml(err)}${queueButtonHtml()}`);
  onPanelAction("queue", () => void runQueueImport(scope, collectionId));
}

/** Null lets the backend resolve it; a CAPTCHA or the download limit would stop it too. */
function nullUnlessBlocking(err: unknown): null {
  if (isMakerworldBlockingError(err)) throw err;
  return null;
}

/** The first profile creates (or finds) the model; later ones are added as files. Stops on a
 *  CAPTCHA or the daily download limit, which would fail every later one. */
async function runProfilesImport(scope: ProfileScope, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title, classification } = ctx();
  const makerworld = classification.provider === "makerworld";
  const ids = (await profileIdsFor())?.(scope) ?? [];
  if (!ids.length) {
    renderPanel(errorHtml(new Error("Couldn't read this model's print profiles. Reload the page and try again.")));
    return;
  }

  let added = 0;
  let already = 0;
  let failed = 0;
  let lastError: unknown = null;
  let printId: string | null = null;
  for (const [index, instanceId] of ids.entries()) {
    renderPanel(statusHtml(`Importing print profile ${index + 1} of ${ids.length}…`));
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PROFILE_GAP_MS));
    // The page's Download button gives exactly the link's profile. Snapmaker's and Creality Cloud's the instance
    // fetches itself.
    try {
      const resolved = !makerworld
        ? null
        : index === 0
          ? await resolveMakerworldDownloadUrl(url).catch(nullUnlessBlocking)
          : await resolveMakerworldProfileDownload(url, instanceId).catch(nullUnlessBlocking);
      const print = await request("IMPORT_SINGLE", {
        // MakerWorld's page link carries its profile; the others' is named, so a model already in the library gets it.
        url: index === 0 && makerworld ? url : profileUrl(url, instanceId),
        collectionId,
        resolved,
        title,
      });
      printId = print?.id ?? printId;
      if (print?.import_outcome === "already_imported") already++;
      else added++;
    } catch (err) {
      failed++;
      lastError = err;
      // The backend's errors arrive as plain text.
      if (err instanceof Error && /captcha|download limit/i.test(err.message)) {
        failed += ids.length - index - 1;
        break;
      }
    }
  }

  if (!printId) {
    renderBlockedError(lastError ?? new Error("Import failed"), scope, collectionId);
    return;
  }
  const parts = [`${added} print profile${added === 1 ? "" : "s"} imported`];
  if (already) parts.push(`${already} already on the model`);
  if (failed) parts.push(`${failed} failed`);
  renderPanel(
    successHtml(`${instanceUrl}/models/${printId}`, `${parts.join(", ")}.`, failed ? "Partly imported" : undefined),
  );
}

/** Sends the link to the paused import queue with the panel's collection and profile choices. No
 *  download is resolved here: the instance does that once the queue is started. */
async function runQueueImport(scope: ProfileScope, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title } = ctx();
  renderPanel(statusHtml("Adding to the queue…"));
  try {
    const result = await request("QUEUE_IMPORT", { url, collectionId, scope, title: title ?? null });
    const waiting = `${result.waiting} link${result.waiting === 1 ? "" : "s"} waiting`;
    renderPanel(
      successHtml(
        `${instanceUrl}/admin-queue`,
        result.duplicate
          ? `This link was already waiting in the queue (${waiting}).`
          : `Paused until it's started from Administration > Import queue (${waiting}).`,
        result.duplicate ? "Already in the queue" : "Added to the queue",
        "Open import queue",
      ),
    );
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}
