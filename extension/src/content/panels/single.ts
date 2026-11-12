import { t } from "../../shared/i18n";
// Every provider's model pages import directly but MakerWorld's, which go through /import/inspect first, like the web
// app's useUploadImport.tsx. MakerOnline's files are signed on its own page first (see providers/makeronline/background.ts).
// MakerWorld's downloads resolve in the page (providers/makerworld/downloadResolver.ts), at steps of the panel's import
// flow below, which is every provider's.

import type { FillGapsResult, InspectResult, SourceGap, ZipEntriesResult } from "../../shared/api";
import { IMPORT_PAUSED, request } from "../../shared/messages";
import { ctx } from "../context";
import {
  isMakerworldBlockingError,
  resolveMakerworldDownloadUrl,
  resolveMakerworldProfileDownload,
} from "../../providers/makerworld/downloadResolver";
import { currentMakerworldProfileTitle } from "../../providers/makerworld/pageData";
import { CONTENT_MODULES, type ProfileScope, type ScriptState } from "../../providers/content";
import { missingOf, profileUrl, withoutHeld, type MissingProfiles } from "../profiles";
import { api, escapeHtml } from "../runtime";
import { onPanelAction, panelQuery, panelQueryAll, renderPanel, setPanelNote } from "../shell";
import { modelHeadHtml, modelTitle } from "./modelHead";
import { collectionIdFor, collectionPickerHtml, readCollectionChoice, wireCollectionPicker } from "./collectionPicker";
import { errorHtml, pausedHtml, queuedHtml, statusHtml, successHtml } from "./results";
import { SHARED_SCRIPT_PANEL_NOTE_HTML, WITHHELD_SCRIPT_PANEL_NOTE_HTML } from "../scriptNote";
import {
  checkingLinkPhrases,
  fillingGapsPhrases,
  importingPhrases,
  renderFunStatus,
  SITE_NAMES,
  zipFilesPhrases,
} from "./funStatus";
import { MANIFESTS, manifestOf } from "../../providers/index.generated";

// Several profile resolutions in a quick burst still look automated to MakerWorld.
const PROFILE_GAP_MS = 2000;

/** The print profile ids a scope brings, the page's own first. Null on sites without profiles, or when they can't
 *  be read. */
async function profileIdsFor(): Promise<((scope: ProfileScope) => string[]) | null> {
  const { url, classification } = ctx();
  if (classification.kind !== "single") return null;
  return (await CONTENT_MODULES[classification.provider].loadProfiles?.(url)) ?? null;
}

/** The page offers a print profile, whose download is always one 3MF. */
async function hasPrintProfiles(): Promise<boolean> {
  return ((await profileIdsFor())?.("all").length ?? 0) > 0;
}

/** What the profile picker picks: a scope of the page's profiles, or of the ones the library's model lacks. */
type ProfileChoice = ProfileScope | "missing" | "missing-designer";

type ProfileOption = { value: ProfileChoice; label: string };

/** A lone choice other than the page's own profile, which is what no picker means, still goes in as a hidden field. */
function profilePickerHtml(options: ProfileOption[], picked: ProfileChoice = "url"): string {
  if (options.length < 2) {
    const only = options[0]?.value;
    return only && only !== "url" ? `<input type="hidden" id="tg-profiles" value="${only}" />` : "";
  }
  const rows = options.map(
    ({ value, label }) =>
      `<option value="${value}"${value === picked ? " selected" : ""}>${escapeHtml(label)}</option>`,
  );
  return `
    <label class="tg-label" for="tg-profiles">${escapeHtml(t("printProfiles"))}</label>
    <select id="tg-profiles" class="tg-select">${rows.join("")}</select>
  `;
}

/** The page's selected profile first, then "designer's" and "all" where they'd import more. */
async function profilesPickerHtml(): Promise<string> {
  const ids = await profileIdsFor();
  if (!ids) return "";
  const all = ids("all").length;
  if (all < 2) return "";
  const designer = ids("designer").length;
  const options: ProfileOption[] = [{ value: "url", label: t("currentProfile") }];
  if (designer > 1) options.push({ value: "designer", label: t("allDesignerProfiles", { count: designer }) });
  if (all > designer) options.push({ value: "all", label: t("designerCommunityProfiles", { count: all }) });
  return profilePickerHtml(options);
}

/** For a model in the library: the page's own profile while the model lacks it, picked first, then the missing
 *  ones, the designer's and all of them, all of them picked otherwise. A choice the one before it covers is left out. */
function missingProfilesPickerHtml(missing: MissingProfiles, selectedMissing: boolean): string {
  const options: ProfileOption[] = [];
  if (selectedMissing) options.push({ value: "url", label: t("currentProfile") });
  const designer = missing.designer.length;
  if (designer && designer < missing.all.length && designer > (selectedMissing ? 1 : 0)) {
    options.push({ value: "missing-designer", label: t("missingDesignerProfiles", { count: designer }) });
  }
  if (missing.all.length > (selectedMissing ? 1 : 0)) {
    options.push({ value: "missing", label: t("allMissingProfiles", { count: missing.all.length }) });
  }
  return profilePickerHtml(options, selectedMissing ? "url" : "missing");
}

function selectedProfileChoice(): ProfileChoice {
  const value = panelQuery<HTMLSelectElement | HTMLInputElement>("#tg-profiles")?.value;
  return value === "designer" || value === "all" || value === "missing" || value === "missing-designer" ? value : "url";
}

/** The scope a choice is queued or signed with: the instance leaves out what the model already has. */
function scopeOf(choice: ProfileChoice): ProfileScope {
  return choice === "missing" ? "all" : choice === "missing-designer" ? "designer" : choice;
}

function importHeading(): string {
  return modelHeadHtml(t("importToThingport"));
}

/** A card of its own above the panel, since it is about the model rather than about the import. */
function showScriptNote(script: ScriptState | null): void {
  if (!script) return setPanelNote(null);
  setPanelNote(
    script.withheld ? WITHHELD_SCRIPT_PANEL_NOTE_HTML : SHARED_SCRIPT_PANEL_NOTE_HTML,
    script.withheld ? "withheld" : "shared",
  );
}

/**
 * Asks whether the model's script comes with it and puts the card up whenever the answer lands.
 *
 * Started rather than awaited: on MakerWorld the answer may need the page's own data fetched, which takes
 * seconds, and the import has nothing to wait for -- the note is a remark about the model, and most models
 * have none. Ahead of the panel's branches rather than inside one, so it reaches the add-a-profile panel too,
 * which imports a profile and so has the same question about the script. Dropping it onto whatever is mounted
 * by then is safe: setPanelNote does nothing once the panel is gone.
 */
function startScriptNote(): void {
  const { provider } = ctx().classification;
  // Best-effort: a page that won't say whether its script is shared is treated as any other model.
  void CONTENT_MODULES[provider].scriptState?.(ctx().url).then(showScriptNote, () => undefined);
}

/** Whoever `canQueue` lets: the same import, but waiting in the instance's import queue. Not where only Grab gets the
 *  files: the queue would only hand the link back to it. */
function queueButtonHtml(): string {
  return ctx().canQueue && manifestOf(ctx().classification.provider).helpers.grab !== "required"
    ? `<button class="tg-btn tg-btn--secondary" type="button" data-action="queue">${escapeHtml(t("addToQueue"))}</button>`
    : "";
}

/** Queues with the panel's current choices. Picking files out of a zip needs the download now, so
 *  only the whole-link imports offer it. */
function onQueueAction(): void {
  onPanelAction("queue", () => {
    const choice = readCollectionChoice();
    const scope = scopeOf(selectedProfileChoice());
    void collectionIdFor(choice).then((collectionId) => runQueueImport(scope, collectionId));
  });
}

export async function loadSingleItem(): Promise<void> {
  const { library } = ctx();
  startScriptNote();
  // A MakerWorld profile is always one 3MF, so inspecting would only cost a download resolution.
  if (library?.state === "complete") {
    renderPanel(completeHtml());
    return;
  }
  if (library) {
    const ids = library.heldProfiles ? await profileIdsFor() : null;
    const missing = ids && library.heldProfiles ? missingOf(ids, library.heldProfiles) : null;
    if (library.state === "imported" && !missing?.all.length) {
      renderPanel(fillGapsHtml());
      onPanelAction("fill-gaps", () => void runFillGaps());
      return;
    }
    const picker = missing
      ? missingProfilesPickerHtml(missing, library.state !== "imported")
      : await profilesPickerHtml();
    renderPanel(addProfileHtml(picker, missing));
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
  // A design without print profiles may download as a zip of its raw files, so it's looked at first. Not one with
  // them: that would only wait on the instance resolving a 3MF. Every other site's link is a model page it reads.
  const skipInspect = !manifestOf(provider).capabilities.rawFilesZip || (await hasPrintProfiles());

  let zipFilename: string | null = null;
  if (skipInspect) {
    ctx().title = modelTitle();
  } else {
    try {
      const inspect = await api<InspectResult>("POST", "/import/inspect", { url: ctx().url });
      ctx().title = inspect.title || null;
      if (inspect.is_zip) zipFilename = inspect.filename ?? t("thisFile");
    } catch (err) {
      renderPanel(errorHtml(err));
      return;
    }
  }

  if (zipFilename === null) {
    renderPanel(`
      ${importHeading()}
      ${await profilesPickerHtml()}
      ${await collectionPickerHtml()}
      <button class="tg-btn" type="button" data-action="import">${escapeHtml(t("import"))}</button>
      ${queueButtonHtml()}
    `);
    wireCollectionPicker();
    onPanelAction("import", () => void runDirectImport());
    onQueueAction();
    return;
  }

  renderPanel(`
    ${importHeading()}
    <div class="tg-hint">${t("zipContainsMultipleFiles", { filename: escapeHtml(zipFilename) })}</div>
    ${await collectionPickerHtml()}
    <button class="tg-btn" type="button" data-action="import-as-zip">${escapeHtml(t("importOneModel"))}</button>
    ${queueButtonHtml()}
    <button class="tg-btn tg-btn--secondary" type="button" data-action="choose-files">${escapeHtml(t("chooseFilesButton"))}</button>
  `);
  wireCollectionPicker();
  onPanelAction("import-as-zip", () => void runDirectImport());
  onQueueAction();
  onPanelAction("choose-files", () => void loadZipEntries());
}

/** The model's in the library but this profile, or others of the page's, may not be. */
function addProfileHtml(profilesPicker: string, missing: MissingProfiles | null): string {
  const { library, url } = ctx();
  const profileName = currentMakerworldProfileTitle(url);
  const profileLabel = profileName ? t("namedPrintProfile", { name: escapeHtml(profileName) }) : t("thisPrintProfile");
  // This profile is on the model, so what's on offer is the others.
  const lacking = library?.state === "imported" && missing?.all.length ? missing : null;
  const others = lacking?.all.length ?? 0;
  const hint = lacking
    ? t(others === 1 ? "missingProfilesHint_one" : "missingProfilesHint_other", {
        have: lacking.total - others,
        total: lacking.total,
        missing: others,
      })
    : library?.state === "profile_missing"
      ? t("addProfileToExistingModel", { profile: profileLabel })
      : t("existingModelProfileHint", { profile: profileLabel });
  return `
    ${modelHeadHtml(t("inLibrary"))}
    <div class="tg-hint">${hint}</div>
    ${profilesPicker}
    <button class="tg-btn" type="button" data-action="import">${escapeHtml(t(others > 1 ? "addProfiles" : "addProfile"))}</button>
    ${queueButtonHtml()}
    ${library?.gaps.length ? fillGapsButtonHtml("tg-btn--secondary") : ""}
    <a class="tg-btn tg-btn--secondary" href="${escapeHtml(libraryModelLink())}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("openModelInThingport"))}</a>
  `;
}

const GAP_LABELS: Record<SourceGap, string> = {
  title: "gapTitle",
  description: "gapDescription",
  tags: "gapTags",
  creator: "gapCreator",
  author: "gapAuthor",
  category: "gapCategory",
  images: "gapImages",
};

function gapList(gaps: SourceGap[]): string {
  return gaps.map((gap) => t(GAP_LABELS[gap] ?? gap)).join(", ");
}

function fillGapsButtonHtml(variant = ""): string {
  return `<button class="tg-btn ${variant}" type="button" data-action="fill-gaps">${escapeHtml(t("fetchMissingDetails"))}</button>`;
}

function libraryModelLink(): string {
  const { library, instanceUrl } = ctx();
  return library?.printId ? `${instanceUrl}/models/${library.printId}` : `${instanceUrl}/models`;
}

/** Everything's in the library: the model, the page's print profiles and its details, so all there is to do is open
 *  it. Where the instance didn't say which model it is, only that it has it, the button opens the library. Drawn at
 *  once, from the count taken when the model was found complete: nothing more is asked of the site first. */
function completeHtml(): string {
  const { library } = ctx();
  const profiles = library?.printId ? (library.profiles ?? 0) : 0;
  const hint = library?.printId
    ? profiles
      ? profiles === 1
        ? t("completeModelWithOneProfile")
        : t("completeModelWithProfiles", { count: profiles })
      : t("completeModel")
    : t("modelInLibrary");
  return `
    ${modelHeadHtml(t("inLibrary"))}
    <div class="tg-hint">${hint}</div>
    <a class="tg-btn" href="${escapeHtml(libraryModelLink())}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("openInThingport"))}</a>
  `;
}

/** Everything's imported, but the library model has empty details the source can fill. */
function fillGapsHtml(): string {
  const { library, classification } = ctx();
  const gaps = library?.gaps ?? [];
  return `
    ${modelHeadHtml(t("inLibrary"))}
    <div class="tg-hint">${t("fillGapsHint", { gaps: escapeHtml(gapList(gaps)), site: SITE_NAMES[classification.provider] })}</div>
    ${fillGapsButtonHtml()}
    <a class="tg-btn tg-btn--secondary" href="${escapeHtml(libraryModelLink())}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("openModelInThingport"))}</a>
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
    const remaining = result.remaining.length ? t("sourceHasNoGaps", { site, gaps: gapList(result.remaining) }) : "";
    renderPanel(
      result.filled.length
        ? successHtml(
            libraryModelLink(),
            `${t("detailsFetchedMessage", { gaps: gapList(result.filled) })} ${remaining}`.trim(),
            t("detailsFetched"),
          )
        : successHtml(libraryModelLink(), t("sourceHasNoDetails", { site }), t("nothingToFetch")),
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
      ({ path }) => `
        <label class="tg-entry">
          <input type="checkbox" class="tg-entry__checkbox" value="${escapeHtml(path)}" checked />
          <span class="tg-entry__name">${escapeHtml(path)}</span>
        </label>
      `,
    )
    .join("");
  renderPanel(`
    <div class="tg-title">${escapeHtml(t("chooseFiles"))}</div>
    <div class="tg-entries">${rows}</div>
    ${await collectionPickerHtml()}
    <button class="tg-btn" type="button" data-action="import">${escapeHtml(t("importSelected"))}</button>
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
  const profiles = selectedProfileChoice();
  if (ctx().classification.provider === MANIFESTS.makeronline.id) {
    await runMakeronlineImport(scopeOf(profiles), await collectionIdFor(choice));
    return;
  }
  if (ctx().classification.provider === MANIFESTS.owlcad.id) {
    await runOwlcadImport(await collectionIdFor(choice));
    return;
  }
  if (profiles !== "url") {
    await runProfilesImport(profiles, await collectionIdFor(choice));
    return;
  }
  const { url, instanceUrl, classification, title } = ctx();
  renderFunStatus(importingPhrases(classification.provider));
  const collectionId = await collectionIdFor(choice);
  try {
    const resolved =
      classification.provider === MANIFESTS.makerworld.id && classification.kind === "single"
        ? await resolveMakerworldDownloadUrl(url).catch(nullUnlessBlocking)
        : null;
    // One message so import and collection filing finish even if the page is gone.
    const print = await request("IMPORT_SINGLE", { url, entries: opts?.entries, collectionId, resolved, title });
    const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
    if (print?.import_outcome === "profile_added") {
      renderPanel(successHtml(link, t("profileFileAdded"), t("profileAdded")));
    } else if (print?.import_outcome === "already_imported") {
      renderPanel(successHtml(link, t("profileFileAlreadyAdded"), t("alreadyInLibrary")));
    } else {
      renderPanel(successHtml(link));
    }
  } catch (err) {
    if (err instanceof Error && err.message === IMPORT_PAUSED) renderPanel(pausedHtml(instanceUrl));
    else renderBlockedError(err, "url", collectionId);
  }
}

/** Every profile the scope picks comes down in one import: the page signs their files, the instance makes one model
 *  of them. */
async function runMakeronlineImport(scope: ProfileScope, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title } = ctx();
  renderFunStatus(importingPhrases(MANIFESTS.makeronline.id));
  try {
    const print = await request("IMPORT_MAKERONLINE_MODEL", { url, scope, collectionId, title: title ?? null });
    const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
    if (print?.import_outcome === "profile_added") {
      renderPanel(successHtml(link, t("profileFilesAdded"), t("profileAdded")));
    } else if (print?.import_outcome === "already_imported") {
      renderPanel(successHtml(link, t("profileFilesAlreadyAdded"), t("alreadyInLibrary")));
    } else {
      renderPanel(successHtml(link));
    }
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}

/** OwlCAD keeps no file for a CAD project: its editor builds one. Grab opens the model there, exports it and hands
 *  the bytes to the instance; a library part, whose mesh is stored, is imported by the instance itself. */
async function runOwlcadImport(collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title } = ctx();
  renderFunStatus(importingPhrases(MANIFESTS.owlcad.id));
  try {
    const print = await request("IMPORT_OWLCAD_MODEL", { url, collectionId, title: title ?? null });
    const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
    if (print?.import_outcome === "already_imported") {
      renderPanel(successHtml(link, t("modelAlreadyInLibrary"), t("alreadyInLibrary")));
    } else {
      renderPanel(successHtml(link));
    }
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}

/** A CAPTCHA or the daily limit won't clear by clicking Import again, so whoever `canQueue` lets can
 *  park the link in the queue with the same choices instead, and have it started once MakerWorld
 *  lets go. The backend's errors arrive as plain text, hence the message check. */
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

/** The first profile creates (or finds) the model; later ones are added as files. Ones the library's model has are
 *  left out before anything is downloaded: each MakerWorld download counts towards its daily limit, which a retry
 *  after a partial import would otherwise spend on them again. Stops on a CAPTCHA or that limit, which would fail
 *  every later one. */
async function runProfilesImport(choice: Exclude<ProfileChoice, "url">, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title, classification, library } = ctx();
  const scope = scopeOf(choice);
  const makerworld = classification.provider === MANIFESTS.makerworld.id;
  const ids = (await profileIdsFor())?.(scope) ?? [];
  if (!ids.length) {
    renderPanel(errorHtml(new Error(t("couldNotReadProfiles"))));
    return;
  }
  const wanted = withoutHeld(ids, library?.heldProfiles ?? []);
  if (!wanted.length) {
    renderPanel(successHtml(libraryModelLink(), t("profilesAlreadyOnModel"), t("alreadyInLibrary")));
    return;
  }

  let added = 0;
  let already = 0;
  let failed = 0;
  let lastError: unknown = null;
  let printId: string | null = null;
  for (const [index, instanceId] of wanted.entries()) {
    renderPanel(statusHtml(t("importingPrintProfile", { current: index + 1, total: wanted.length })));
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PROFILE_GAP_MS));
    // Each profile is picked on the page, then downloaded with its own button: the one the page shows needn't be the
    // first of these. Snapmaker's and Creality Cloud's the instance fetches itself.
    try {
      const resolved = makerworld
        ? await resolveMakerworldProfileDownload(url, instanceId).catch(nullUnlessBlocking)
        : null;
      const print = await request("IMPORT_SINGLE", {
        // Named even where it's the page's own: a MakerWorld link naming none means the default profile to the
        // instance, which a model already in the library may have.
        url: profileUrl(classification.provider, url, instanceId),
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
        failed += wanted.length - index - 1;
        break;
      }
    }
  }

  if (!printId) {
    renderBlockedError(lastError ?? new Error(t("importFailed")), scope, collectionId);
    return;
  }
  const parts = [t("printProfilesImported", { count: added, suffix: added === 1 ? "" : "s" })];
  if (already) parts.push(t("profilesAlreadyOnModelCount", { count: already }));
  if (failed) parts.push(t("profilesFailed", { count: failed }));
  // Onto a model already in the library, as adding the page's own profile there says.
  const addedTitle = library && added ? t("profilesAdded", { suffix: added === 1 ? "" : "s" }) : undefined;
  // The last failure's reason (a CAPTCHA, the daily limit, the instance's refusal) says what to do about the rest.
  const reason =
    failed && lastError
      ? ` ${t("lastError", { error: lastError instanceof Error ? lastError.message : String(lastError) })}`
      : "";
  renderPanel(
    successHtml(
      `${instanceUrl}/models/${printId}`,
      `${parts.join(", ")}.${reason}`,
      failed ? t("partlyImported") : addedTitle,
    ),
  );
}

/** Sends the link to the import queue with the panel's collection and profile choices. No download
 *  is resolved here: the instance does that when the link's turn comes. */
async function runQueueImport(scope: ProfileScope, collectionId: string | null): Promise<void> {
  const { url, instanceUrl, title, importQueue } = ctx();
  renderPanel(statusHtml(t("addingToQueue")));
  try {
    const result = await request("QUEUE_IMPORT", { url, collectionId, scope, title: title ?? null });
    renderPanel(queuedHtml(instanceUrl, result, importQueue));
  } catch (err) {
    renderPanel(errorHtml(err));
  }
}
