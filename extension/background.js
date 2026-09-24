// Service worker: owns the extension's config/auth state and every fetch() call to the user's
// Thingport instance. Content scripts and the popup never fetch() directly -- they send a
// message here and get a plain JSON result back -- so auth (login + silent re-login on
// expiry/401) and the instance URL live in exactly one place. `host_permissions` for the saved
// instance origin (requested at setup time, see handleSaveConfig) is what lets this fetch() the
// user's self-hosted instance free of that instance's own CORS config.
// Chrome runs this file as a service worker, where importScripts() exists. Firefox has no
// extension service workers and runs it as a background page instead, where importScripts is
// undefined and this line used to throw before onMessage was ever registered (so the popup
// got "Receiving end does not exist"). There, common.js comes in via background.scripts.
if (typeof importScripts === "function") importScripts("common.js");

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function getStoredConfig() {
  const keys = Object.values(THINGPORT_STORAGE_KEYS);
  return chrome.storage.local.get(keys);
}

function isConfigured(config) {
  return Boolean(config.instanceUrl && config.email && config.password);
}

/** (Re-)authenticates against the stored instance/credentials and persists the resulting token.
 *  Called by ensureToken on first use / near expiry, and again once on a 401 (a password change
 *  or server-side session revocation shouldn't require reopening the popup to recover from). */
async function loginAndStoreToken(config) {
  const res = await fetch(thingportApiUrl(config.instanceUrl, "/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.email, password: config.password }),
  });
  if (!res.ok) {
    let message = "Could not sign in to this Thingport instance";
    try {
      const body = await res.json();
      if (body && body.detail) message = body.detail;
    } catch {
      // ignore -- keep the generic message
    }
    throw new Error(message);
  }
  const data = await res.json();
  const tokenExpiresAt = Date.now() + data.expires_in * 1000;
  await chrome.storage.local.set({ token: data.token, tokenExpiresAt });
  return data.token;
}

async function ensureToken(config, { forceRefresh = false } = {}) {
  if (!forceRefresh && config.token && config.tokenExpiresAt && config.tokenExpiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return config.token;
  }
  return loginAndStoreToken(config);
}

function isMakerworldUrl(url) {
  return Boolean(url) && (Boolean(thingportIsMakerworldModelUrl(url)) || thingportIsMakerworldCollectionUrl(url));
}

/** Reads the user's live MakerWorld session straight from the browser's cookie jar -- makerworld.com
 *  sets it HttpOnly, which blocks a page's own `document.cookie` (that's the whole reason today's
 *  Profile-settings flow has the user paste it in manually), but chrome.cookies is a privileged,
 *  extension-only API that's explicitly allowed to read HttpOnly cookies regardless. Requires the
 *  "cookies" permission plus host access to makerworld.com -- the latter already comes from this
 *  extension's static content_scripts match for that domain, so no extra permission prompt is
 *  needed beyond what installing the extension already grants. Returns null (never throws) if the
 *  user isn't logged into MakerWorld in this browser, or cookie access is blocked by some browser
 *  policy -- callers just fall back to whatever's already stored in Thingport for that case. */
async function getLiveMakerworldCookie() {
  try {
    const cookie = await chrome.cookies.get({ url: "https://makerworld.com", name: "token" });
    if (!cookie) return null;
    // Re-wrapped as "token=<value>" rather than the bare value -- the backend's
    // extractMakerworldBearerToken (makerworldCloudApi.ts) has two extraction paths: a
    // "token=...;" regex match, or a bare-token fallback that only accepts a value with no `=`,
    // `;`, or whitespace at all. A real session token can easily contain `=` (base64 padding),
    // which would silently fail that bare-token path and make this whole feature quietly not
    // work. A cookie value can never itself contain a literal `;` (RFC 6265 forbids it unquoted),
    // so this format always matches the *first*, unambiguous regex path regardless of what
    // characters the token contains.
    return `token=${cookie.value}`;
  } catch {
    return null;
  }
}

/** Best-effort: keeps Thingport's own stored makerworld_cookie (Profile > MakerWorld) in sync
 *  with whatever's live in the browser, so the plain web app's imports benefit from this too, not
 *  just ones triggered through the extension. Skipped entirely once it's already in sync, so a
 *  steady MakerWorld session doesn't PATCH this on every single import. Never lets a failure here
 *  (network hiccup, session not fully configured yet, etc.) affect the import that triggered it --
 *  callers fire this and move on. */
async function maybeSyncMakerworldCookie(config, cookieValue) {
  if (config.lastSyncedMakerworldCookie === cookieValue) return;
  try {
    await apiCall("PATCH", "/settings/makerworld", { cookie: cookieValue });
    await chrome.storage.local.set({ lastSyncedMakerworldCookie: cookieValue });
  } catch {
    // Best-effort -- the import this was piggybacking on already has the live cookie regardless.
  }
}

/** Generic authenticated call to the stored instance -- every content-script/popup action goes
 *  through this rather than a bespoke RPC per endpoint, since the backend surface this extension
 *  needs (see the plan this was built from) is otherwise a straight passthrough. `path` is the
 *  API path after `/api` (e.g. "/collections", "/import/jobs/abc123"). Any `/import*` call whose
 *  body targets a MakerWorld URL gets the live browser cookie attached automatically (see
 *  getLiveMakerworldCookie) unless the caller already set one explicitly -- this is what lets a
 *  user who has never touched Profile > MakerWorld still import from MakerWorld via the
 *  extension. */
async function apiCall(method, path, body) {
  const config = await getStoredConfig();
  if (!isConfigured(config)) throw new Error("Thingport Grab isn't configured yet -- open the extension popup first.");
  if (config.disabled) throw new Error("Thingport Grab is disabled -- re-enable it from the extension popup.");

  let finalBody = body;
  if (path.startsWith("/import") && body && !body.makerworld_cookie && isMakerworldUrl(body.url)) {
    const liveCookie = await getLiveMakerworldCookie();
    if (liveCookie) {
      finalBody = { ...body, makerworld_cookie: liveCookie };
      void maybeSyncMakerworldCookie(config, liveCookie);
    }
  }

  const doFetch = async (token) =>
    fetch(thingportApiUrl(config.instanceUrl, path), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(finalBody ? { "Content-Type": "application/json" } : {}),
      },
      body: finalBody ? JSON.stringify(finalBody) : undefined,
    });

  let token = await ensureToken(config);
  let res = await doFetch(token);
  if (res.status === 401) {
    token = await ensureToken(config, { forceRefresh: true });
    res = await doFetch(token);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody && errBody.detail) message = errBody.detail;
    } catch {
      // ignore -- keep the generic message
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Same ~1s cadence as ImportJobContext.tsx / content.js's own batch-progress poll.
const JOB_POLL_INTERVAL_MS = 1000;

async function pollJobToCompletion(jobId) {
  for (;;) {
    const job = await apiCall("GET", `/import/jobs/${jobId}`);
    if (job.status !== "RUNNING") return job;
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/** Runs a single-model import (direct or "choose files" zip entries) and, if a destination
 *  collection was picked, files the result into it -- as ONE call from the content script rather
 *  than two chained ones, so the whole sequence still completes even if the tab that started it
 *  navigates away or fully reloads a moment later. This service worker isn't torn down by a tab
 *  navigation the way a content script's execution context is, so once this handler has started,
 *  the import (and any collection filing) runs to completion regardless of what the calling page
 *  does next -- only the reply back to a since-destroyed content script can get lost, never the
 *  work itself. */
async function handleImportSingle({ url, entries, collectionId, resolved }) {
  // For a MakerWorld model, content.js resolves the actual download URL itself, straight from
  // the live page (see its resolveMakerworldDownloadUrlFromPage) -- passing it through as
  // resolved_download_url lets the backend skip its own resolution entirely (both its
  // api.bambulab.com cloud-API call and its api/v1 HTML-scrape fallback), which are the only two
  // places able to trip MakerWorld's CAPTCHA and the resulting 2-hour account-wide lockout. Left
  // undefined/null for anything else, or when the page-side resolution didn't find one -- the
  // backend then falls back to resolving it exactly as before. The profile ids tell the backend
  // which MakerWorld print profile that file is, so importing another profile of a model that's
  // already in the library adds it as a second file instead of being skipped as a duplicate.
  const extra =
    resolved && resolved.downloadUrl
      ? {
          resolved_download_url: resolved.downloadUrl,
          resolved_instance_id: resolved.instanceId || null,
        }
      : null;
  let print;
  if (entries) {
    const { job_id } = await apiCall("POST", "/import/zip", { url, entries, ...extra });
    const job = await pollJobToCompletion(job_id);
    if (job.status === "ERROR") throw new Error(job.error_message || "Import failed");
    print = job.result_print_id ? { id: job.result_print_id } : null;
  } else {
    print = await apiCall("POST", "/import", { url, ...extra });
  }
  if (collectionId && print && print.id) {
    await apiCall("POST", `/collection/${collectionId}/items/${print.id}`).catch(() => undefined);
  }
  return print;
}

// -- MakerWorld click-and-capture download resolution ------------------------------------------
//
// An alternative to guessing MakerWorld's own resolution API shape (see content.js's
// resolveMakerworldDownloadUrlFromPage, kept as a fallback) -- content.js clicks the model page's
// own real "Download" button, and this captures the browser download that click triggers,
// cancels it immediately, and reads the resolved URL off it before erasing it from the downloads
// list. This sidesteps every guess about query params/nonce/headers entirely: whatever request
// MakerWorld's own page JS actually makes when a real person clicks Download is the one that gets
// captured here. Requires the "downloads" permission.

const DOWNLOAD_CAPTURE_TIMEOUT_MS = 8000;
// Only one of these is ever in flight at a time -- single-model imports and the guided
// collection loop both resolve one model at a time, never concurrently.
let pendingDownloadCapture = null; // { resolve, timeoutId }

chrome.downloads.onCreated.addListener((item) => {
  if (!pendingDownloadCapture) return;
  const { resolve, timeoutId } = pendingDownloadCapture;
  pendingDownloadCapture = null;
  clearTimeout(timeoutId);
  chrome.downloads.cancel(item.id).catch(() => undefined);
  chrome.downloads.erase({ id: item.id }).catch(() => undefined);
  // A blob: URL means the page resolved/fetched the file itself (fetch + URL.createObjectURL)
  // rather than navigating straight to a real remote URL -- not independently fetchable by the
  // backend, so this is treated the same as "nothing captured" and the caller falls back.
  resolve(/^https?:\/\//i.test(item.url) ? item.url : null);
});

/** Arms the capture (registers a fresh pending promise + safety timeout) and returns immediately
 *  -- called right before content.js clicks the real Download button, so the onCreated listener
 *  above is already primed by the time that click's resulting download fires. */
function armDownloadCapture() {
  if (pendingDownloadCapture) {
    clearTimeout(pendingDownloadCapture.timeoutId);
    pendingDownloadCapture.resolve(null);
  }
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });
  const timeoutId = setTimeout(() => {
    if (pendingDownloadCapture && pendingDownloadCapture.resolve === resolveFn) {
      pendingDownloadCapture = null;
      resolveFn(null);
    }
  }, DOWNLOAD_CAPTURE_TIMEOUT_MS);
  pendingDownloadCapture = { resolve: resolveFn, timeoutId };
  return promise;
}

// Holds the promise armDownloadCapture returned, for AWAIT_DOWNLOAD_CAPTURE (a separate message)
// to await -- split into two messages, rather than one, because the actual button click has to
// happen in content.js between arming and awaiting, and a single message can only get one reply.
let currentDownloadCapturePromise = null;

// -- MakerWorld guided collection import ---------------------------------------------------------
//
// MakerWorld's own anti-abuse system CAPTCHAs the whole account for hours the moment a burst of
// collection-import API calls looks automated -- even with pacing, a large collection can trip it
// almost immediately (see the backend's own IMPORT_MAKERWORLD_CALL_DELAY_MS comment). Rather than
// firing every design's import calls back-to-back from the backend, this literally drives the tab
// to each model's own page, one at a time -- a real navigation + page load imposes pacing no
// config value can fake, and looks like a person browsing rather than a script. Each page load is
// treated as a plain single-model import (handleImportSingle), the same path a manual visit would
// use -- no batch-specific inspect/zip logic, no extra pacing beyond the wait below.
//
// State lives in chrome.storage (not a module-level variable) because this job outlives any single
// page load in the tab it's driving, and an MV3 service worker can be suspended and woken again
// between steps -- chrome.tabs.onUpdated firing later is what wakes it back up, at which point it
// re-reads this instead of having "remembered" anything.

const MAKERWORLD_JOB_STORAGE_KEY = "makerworldCollectionJob";
// Pacing after each import, on top of however long the model page itself took to load --
// deliberately not configurable/hidden away, since a shorter value would undercut the entire
// point of this feature.
const MAKERWORLD_JOB_STEP_DELAY_MS = 5000;

async function getMakerworldJob() {
  const { [MAKERWORLD_JOB_STORAGE_KEY]: job } = await chrome.storage.local.get(MAKERWORLD_JOB_STORAGE_KEY);
  return job || null;
}

async function setMakerworldJob(job) {
  if (job) await chrome.storage.local.set({ [MAKERWORLD_JOB_STORAGE_KEY]: job });
  else await chrome.storage.local.remove(MAKERWORLD_JOB_STORAGE_KEY);
}

/** Started by content.js once the user clicks "Start import" on a MakerWorld collection page --
 *  `urls` is every not-yet-imported design's model-page URL (already-imported ones are filed into
 *  the destination collection separately, synchronously, by content.js itself before this ever
 *  runs -- see its own doc comment for why that split makes sense). Stores the job, then makes the
 *  first move; chrome.tabs.onUpdated's "complete" handler below drives every step after that. */
async function startMakerworldCollectionJob(tabId, { urls, collectionId, originalUrl }) {
  if (!urls.length) return;
  await setMakerworldJob({
    tabId,
    originalUrl,
    collectionId: collectionId || null,
    urls,
    index: 0,
    imported: 0,
    total: urls.length,
    // True exactly while a chrome.tabs.update navigation this job triggered is in flight -- the
    // "complete" handler only acts once, on the transition to false, so it can't double-advance
    // if MakerWorld's own page fires more than one "complete" event for a single navigation.
    awaitingLoad: true,
    error: null,
  });
  await chrome.tabs.update(tabId, { url: urls[0] });
}

/** The Abort button, from content.js's overlay -- returns the tab to wherever the run started and
 *  discards the rest of the queue. Nothing already imported is undone (nor should it be); it just
 *  stops importing anything further. */
async function abortMakerworldJob(tabId) {
  const job = await getMakerworldJob();
  if (!job || job.tabId !== tabId) return;
  await setMakerworldJob(null);
  await chrome.tabs.update(tabId, { url: job.originalUrl });
}

// chrome.tabs.sendMessage has no built-in timeout -- if the content script's resolution work
// ever stalls (content.js's own fetch calls are bounded, see MAKERWORLD_API_FETCH_TIMEOUT_MS
// there, but this is a second, independent backstop against anything else going wrong, e.g. the
// listener throwing before returning `true` or the tab's execution context stalling for some
// other reason) this whole guided job would otherwise just sit waiting forever with nothing to
// show the user but a progress overlay that never moves -- exactly what was observed live on a
// model with extra download options that made resolution take unusually long.
// Comfortably above content.js's own worst case (an 8s click-capture timeout, then up to two
// sequential 8s-bounded fallback fetches) so this backstop never races a legitimate resolution
// that's just taking the slow path, and only ever fires for a genuinely stuck one.
const MAKERWORLD_DOWNLOAD_RESOLVE_TIMEOUT_MS = 30000;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

/** True as long as nothing else (most relevantly, handleForceAdvanceMakerworldJob -- see its own
 *  doc comment) has already moved the job past the step this call started out on. Both
 *  advanceMakerworldJob and handleForceAdvanceMakerworldJob can end up racing to finish the same
 *  step -- a large model (many plates) can take long enough to import that a person clicks
 *  "Import next" on the overlay before the original request actually comes back -- and this is
 *  what keeps a late-arriving automatic completion from double-advancing (or clobbering a step the
 *  manual path already moved past) once that happens. */
async function isMakerworldJobStillAtStep(tabId, stepIndex) {
  const current = await getMakerworldJob();
  return Boolean(current && current.tabId === tabId && current.index === stepIndex);
}

/** Paces, then moves to the next URL -- or, on the last one, returns to the collection page the
 *  run started from. Shared by the normal per-step completion (advanceMakerworldJob) and the
 *  manual "Import next" escape hatch (handleForceAdvanceMakerworldJob). */
async function moveMakerworldJobForward(tabId, job) {
  job.index += 1;

  if (job.index >= job.urls.length) {
    await setMakerworldJob(null);
    await chrome.tabs.update(tabId, { url: job.originalUrl });
    return;
  }

  await setMakerworldJob(job);
  await new Promise((resolve) => setTimeout(resolve, MAKERWORLD_JOB_STEP_DELAY_MS));
  // The user may have hit Abort during the pacing delay above -- re-check before navigating on.
  const stillActive = await getMakerworldJob();
  if (!stillActive || stillActive.tabId !== tabId) return;
  job.awaitingLoad = true;
  await setMakerworldJob(job);
  await chrome.tabs.update(tabId, { url: job.urls[job.index] });
}

/** Runs once the tab finishes loading the current step's model page: imports it, paces, and moves
 *  to the next URL -- or, on the last one, returns to the collection page the run started from.
 *  Any import failure stops the whole run rather than skipping past it: this almost always means
 *  MakerWorld itself just rejected the request (CAPTCHA, rate limit, expired session), and
 *  continuing to fire more requests at that point would only make it worse, not better. */
async function advanceMakerworldJob(tabId) {
  const job = await getMakerworldJob();
  if (!job || job.tabId !== tabId || !job.awaitingLoad) return;
  const stepIndex = job.index;
  job.awaitingLoad = false;
  await setMakerworldJob(job);

  const currentUrl = job.urls[stepIndex];
  // Ask the content script sitting on the model page we just navigated to (it's the one with
  // DOM access to __NEXT_DATA__ and a same-origin fetch that carries the real session cookie) to
  // resolve the download URL itself -- see content.js's resolveMakerworldDownloadUrlFromPage.
  // This matters most right here, not just for a plain single-model import: it's this per-model
  // loop that fires MakerWorld resolution calls back-to-back, exactly the pattern that trips its
  // CAPTCHA. Best-effort -- if the content script isn't ready yet or the page structure doesn't
  // match, `resolved` stays null and the backend just resolves it the old way.
  let resolved = null;
  try {
    const res = await withTimeout(chrome.tabs.sendMessage(tabId, { type: "RESOLVE_MAKERWORLD_DOWNLOAD_URL" }), MAKERWORLD_DOWNLOAD_RESOLVE_TIMEOUT_MS);
    if (res && res.ok) resolved = res.resolved;
  } catch {
    // No listener yet, or the tab navigated away already -- fine, see above.
  }
  try {
    await handleImportSingle({ url: currentUrl, collectionId: job.collectionId, resolved });
  } catch (err) {
    // A manual "Import next" (see handleForceAdvanceMakerworldJob) may have already moved the job
    // past this step while this request was still in flight -- if so, this failure is stale and
    // says nothing about the step the job is actually on now, so don't abort over it.
    if (!(await isMakerworldJobStillAtStep(tabId, stepIndex))) return;
    await setMakerworldJob(null);
    await chrome.storage.local.set({
      makerworldJobError: { message: err instanceof Error ? err.message : String(err), imported: job.imported, total: job.total },
    });
    await chrome.tabs.update(tabId, { url: job.originalUrl });
    return;
  }

  // Same staleness check on the success path -- a big multi-plate model can take long enough to
  // import that "Import next" already fired and moved on before this ever got here; without this
  // check, this would double-advance the job (incrementing an index a manual click already moved
  // past) the moment a slow-but-not-actually-dead request finally comes back.
  if (!(await isMakerworldJobStillAtStep(tabId, stepIndex))) return;
  job.imported += 1;
  await moveMakerworldJobForward(tabId, job);
}

/** The overlay's "Import next" button (see content.js's mountJobOverlay) -- a manual escape hatch
 *  for when the automatic advance above never comes back. The likeliest cause isn't MakerWorld at
 *  all: a model with an unusually large file (many plates) can take long enough for the backend to
 *  import that MV3's own service-worker lifecycle limits kill this extension's background page
 *  mid-request, silently losing the in-flight await above -- the import itself still completes
 *  server-side regardless, it's only the extension's own bookkeeping that got dropped. Rather than
 *  just trusting that and blindly moving on, this confirms the stuck step actually landed in
 *  Thingport first (and files it into the destination collection if that part got skipped too)
 *  before crediting it and continuing. */
async function handleForceAdvanceMakerworldJob(tabId) {
  const job = await getMakerworldJob();
  if (!job || job.tabId !== tabId) return;
  const currentUrl = job.urls[job.index];
  try {
    const status = await apiCall("GET", `/import/status?url=${encodeURIComponent(currentUrl)}`);
    if (status.already_imported) {
      job.imported += 1;
      if (job.collectionId && status.print_id) {
        await apiCall("POST", `/collection/${job.collectionId}/items/${status.print_id}`).catch(() => undefined);
      }
    }
  } catch {
    // Status check failed (instance unreachable, etc.) -- proceed anyway; the user already saw it
    // land in their library before reaching for this button.
  }
  await moveMakerworldJobForward(tabId, job);
}

function iconPaths(active) {
  const prefix = active ? "thingport-icon-color" : "thingport-icon-dark";
  return {
    16: `icons/${prefix}-16.png`,
    32: `icons/${prefix}-32.png`,
    48: `icons/${prefix}-48.png`,
    128: `icons/${prefix}-128.png`,
  };
}

/** The toolbar icon is active (color) only for a tab where the floating in-page icon is actually
 *  showing right now -- configured, enabled, AND the current page is a recognized, not-already-
 *  imported provider page -- everywhere else it's the dark/inactive one (manifest.json's
 *  `action.default_icon`, used for any tab this never runs for). content.js reports this once per
 *  page/navigation via the SET_TAB_ICON_STATE message below; tabs.onUpdated below resets it the
 *  moment a new navigation starts, so a tab doesn't keep showing "active" after leaving an
 *  importable page for one this extension never runs on at all (a plain navigation within the
 *  same content-scripted page re-asserts the correct state itself, see content.js's own
 *  navigation watcher). */
async function setTabIconState(tabId, active) {
  await chrome.action.setIcon({ tabId, path: iconPaths(active) }).catch(() => undefined);
}

// The host permission for the chosen instance origin is requested by popup.js itself, not here --
// chrome.permissions.request() must run within the user gesture that triggered it (the popup's
// own submit click), which doesn't survive a chrome.runtime.sendMessage hop into this service
// worker. By the time SAVE_CONFIG arrives, popup.js has already been granted (or refused, in
// which case it never sends this) that permission.
async function handleSaveConfig({ instanceUrl, email, password }) {
  const normalized = thingportNormalizeInstanceUrl(instanceUrl);
  // Validate before persisting -- a typo'd URL or wrong password shouldn't silently save.
  await loginAndStoreToken({ instanceUrl: normalized, email, password });
  await chrome.storage.local.set({ instanceUrl: normalized, email, password, disabled: false });
}

async function handleSetDisabled(disabled) {
  await chrome.storage.local.set({ disabled: Boolean(disabled) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "GET_STATE": {
          const config = await getStoredConfig();
          sendResponse({
            ok: true,
            data: { configured: isConfigured(config), disabled: Boolean(config.disabled), instanceUrl: config.instanceUrl || "" },
          });
          return;
        }
        case "SAVE_CONFIG":
          await handleSaveConfig(message.payload);
          sendResponse({ ok: true });
          return;
        case "SET_DISABLED":
          await handleSetDisabled(message.payload.disabled);
          sendResponse({ ok: true });
          return;
        case "SET_TAB_ICON_STATE":
          // Only content scripts send this, and every content script runs attached to a tab, so
          // sender.tab is always present here (unlike a message from the popup, which has none).
          if (sender.tab) await setTabIconState(sender.tab.id, Boolean(message.payload.active));
          sendResponse({ ok: true });
          return;
        case "API_CALL": {
          const data = await apiCall(message.payload.method, message.payload.path, message.payload.body);
          sendResponse({ ok: true, data });
          return;
        }
        case "IMPORT_SINGLE": {
          const data = await handleImportSingle(message.payload);
          sendResponse({ ok: true, data });
          return;
        }
        case "START_MAKERWORLD_COLLECTION_JOB":
          if (sender.tab) await startMakerworldCollectionJob(sender.tab.id, message.payload);
          sendResponse({ ok: true });
          return;
        case "ABORT_MAKERWORLD_COLLECTION_JOB":
          if (sender.tab) await abortMakerworldJob(sender.tab.id);
          sendResponse({ ok: true });
          return;
        case "FORCE_ADVANCE_MAKERWORLD_JOB":
          if (sender.tab) await handleForceAdvanceMakerworldJob(sender.tab.id);
          sendResponse({ ok: true });
          return;
        case "ARM_DOWNLOAD_CAPTURE":
          currentDownloadCapturePromise = armDownloadCapture();
          sendResponse({ ok: true });
          return;
        case "AWAIT_DOWNLOAD_CAPTURE": {
          const downloadUrl = await (currentDownloadCapturePromise || Promise.resolve(null));
          sendResponse({ ok: true, downloadUrl });
          return;
        }
        case "GET_MAKERWORLD_JOB": {
          const job = sender.tab ? await getMakerworldJob() : null;
          const forThisTab = job && sender.tab && job.tabId === sender.tab.id ? job : null;
          if (forThisTab) {
            sendResponse({ ok: true, data: forThisTab });
          } else {
            // A job error is surfaced exactly once, on whichever page loads right after the job
            // aborts itself (always the original collection page -- see advanceMakerworldJob) --
            // read-and-clear so it doesn't reappear on a later, unrelated visit to that same page.
            const { makerworldJobError } = await chrome.storage.local.get("makerworldJobError");
            if (makerworldJobError) await chrome.storage.local.remove("makerworldJobError");
            sendResponse({ ok: true, data: null, error: makerworldJobError || null });
          }
          return;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep the message channel open for the async response above
});

// The moment a tab starts a NEW navigation (including away from a provider domain to one this
// extension never runs on at all, e.g. thingiverse.com -> google.com), reset its icon to inactive
// first. A per-tab chrome.action.setIcon override otherwise persists forever until something
// explicitly changes it -- there'd be nothing to reset it if the destination page never runs
// content.js. If the destination IS a matching provider page, content.js's own init() re-asserts
// the correct state a moment later via SET_TAB_ICON_STATE.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") void setTabIconState(tabId, false);
  // Drives the guided MakerWorld collection import (see advanceMakerworldJob's own doc comment)
  // -- "complete" is what wakes this back up even if the service worker was suspended between
  // steps, since the job's own state lives in chrome.storage rather than a variable here.
  if (changeInfo.status === "complete") void advanceMakerworldJob(tabId);
});

// If the tab a guided import is driving gets closed outright (not just navigated), there's no
// further chrome.tabs.onUpdated event to ever act on -- without this, the job's state would just
// sit in storage forever, orphaned, with nothing left to show progress or an Abort button for it.
chrome.tabs.onRemoved.addListener((tabId) => {
  (async () => {
    const job = await getMakerworldJob();
    if (job && job.tabId === tabId) await setMakerworldJob(null);
  })();
});
