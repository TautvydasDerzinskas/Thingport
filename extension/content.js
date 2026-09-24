// Renders the floating Thingport icon + its import panel on a recognized MakerWorld/
// Thingiverse/Printables page. All actual network calls go through background.js's API_CALL
// message (see its own doc comment for why) -- this file only classifies the current URL,
// walks the user through whatever picking/decisions the import needs, and renders the result.
(() => {
  if (window.__thingportGrabInjected) return;
  window.__thingportGrabInjected = true;

  const ICON_URL = chrome.runtime.getURL("icons/thingport-icon-color.svg");

  function call(type, payload) {
    return chrome.runtime.sendMessage({ type, payload });
  }
  /** Unwraps background.js's `{ok, data}` / `{ok:false, error}` message-response shape into a
   *  plain resolve-with-data-or-throw call, so every call site below can just `await` it and
   *  try/catch it like a normal fetch. */
  function unwrap(res) {
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }
  function api(method, path, body) {
    return call("API_CALL", { method, path, body }).then(unwrap);
  }

  // -- Shell: shadow-rooted host, icon button, panel container ---------------------------------

  let shadowRoot = null;
  let panelEl = null;
  let contentEl = null;
  let panelOpen = false;
  /** Set once per page, from the classification + (for a single-model page) whatever
   *  /import/inspect returned -- everything the panel's render functions need to know which
   *  step to show and which endpoints to call. */
  let context = null;

  async function injectStyles(root) {
    const res = await fetch(chrome.runtime.getURL("content.css"));
    const style = document.createElement("style");
    style.textContent = await res.text();
    root.appendChild(style);
  }

  async function mount() {
    const host = document.createElement("div");
    host.id = "thingport-grab-host";
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });
    await injectStyles(shadowRoot);

    const button = document.createElement("button");
    button.className = context.library ? "tg-fab tg-fab-in-library" : "tg-fab";
    button.setAttribute("aria-label", context.library ? "Add this print profile to Thingport" : "Import to Thingport");
    button.innerHTML = `<img src="${ICON_URL}" alt="" />`;
    button.addEventListener("click", togglePanel);
    shadowRoot.appendChild(button);

    panelEl = document.createElement("div");
    panelEl.className = "tg-panel";
    panelEl.hidden = true;

    // Lives outside contentEl (renderPanel's target) so it survives every re-render instead of
    // needing to be re-added to each step's template -- closing an accidental open shouldn't
    // depend on which step happened to be showing.
    const closeBtn = document.createElement("button");
    closeBtn.className = "tg-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closePanel);
    panelEl.appendChild(closeBtn);

    contentEl = document.createElement("div");
    contentEl.className = "tg-panel-content";
    panelEl.appendChild(contentEl);

    shadowRoot.appendChild(panelEl);
  }

  function closePanel() {
    panelOpen = false;
    panelEl.hidden = true;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    panelEl.hidden = !panelOpen;
    if (panelOpen && !panelEl.dataset.loaded) {
      panelEl.dataset.loaded = "1";
      void loadPanel();
    }
  }

  function renderPanel(html) {
    // A no-op, not a bug, once the panel's been torn down (unmount(), e.g. an SPA route change
    // mid-import) -- a still-in-flight step like the batch progress poll below has nothing left
    // to draw into, but the underlying request/job it's watching keeps running regardless (see
    // background.js's handleImportSingle and the README's own note on batch jobs).
    if (!contentEl) return;
    contentEl.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // -- Collection picker (single-item imports only -- see the plan's scope note) ---------------

  async function collectionOptionsHtml() {
    try {
      const collections = await api("GET", "/collections");
      const opts = collections
        .filter((c) => !c.system_key)
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
        .join("");
      return `
        <label class="tg-label" for="tg-collection">Add to collection (optional)</label>
        <select id="tg-collection" class="tg-select"><option value="">No collection</option>${opts}</select>
      `;
    } catch {
      return ""; // Collections failed to load -- import still works without the picker.
    }
  }

  // -- Single-item flow (Thingiverse Thing / Printables Model skip straight to import; a plain
  //    MakerWorld model link -- and any other generic single link -- goes through /import/inspect
  //    first, mirroring the web app's own useUploadImport.tsx branching exactly) ----------------

  /** Best-effort model name for the "Import ..." heading, read straight from the current page --
   *  used only for Thingiverse Thing/Printables Model pages, which skip /import/inspect (see
   *  skipInspect below) and so never get inspect's own resolved `title`. og:title is set
   *  accurately by both sites without the "... - Thingiverse" site-name suffix document.title
   *  tends to carry, so it's tried first. */
  function guessPageTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();
    return document.title.trim() || null;
  }

  function importHeading() {
    return context.title ? `Import "${escapeHtml(context.title)}"` : "Import this model";
  }

  async function loadSingleItem() {
    // Nothing inspect would tell us matters here (a MakerWorld profile is always a single 3MF),
    // and inspecting would make the backend resolve the download from MakerWorld just to show
    // the panel.
    if (context.library) {
      renderPanel(addProfileHtml());
      bindImportButton(() => runDirectImport());
      return;
    }
    renderPanel(`<div class="tg-status">Checking link…</div>`);
    const { provider, type } = context.classification;
    // Printables' generic page-fetch flow is Cloudflare-gated (inspectImportLink would just fail)
    // and a Thingiverse Thing always resolves through its own dedicated API path regardless -- see
    // useUploadImport.tsx's identical isThingiverseThingUrl/isPrintablesModelUrl special-case.
    // Neither needs (or can safely use) /import/inspect at all.
    const skipInspect = (provider === "thingiverse" && type === "thing") || (provider === "printables" && type === "model");

    let zip = null;
    if (skipInspect) {
      context.title = guessPageTitle();
    } else {
      try {
        const inspect = await api("POST", "/import/inspect", { url: context.url });
        context.title = inspect.title || null;
        if (inspect.is_zip) zip = { filename: inspect.filename };
      } catch (err) {
        renderPanel(errorHtml(err));
        return;
      }
    }

    if (!zip) {
      renderPanel(await readyToImportHtml());
      bindImportButton(() => runDirectImport());
      return;
    }

    renderPanel(await zipChoiceHtml(zip.filename));
    panelEl.querySelector("[data-action=import-as-zip]").addEventListener("click", () => runDirectImport());
    panelEl.querySelector("[data-action=choose-files]").addEventListener("click", () => void loadZipEntries());
  }

  async function readyToImportHtml() {
    const collectionHtml = await collectionOptionsHtml();
    return `
      <div class="tg-title">${importHeading()}</div>
      ${collectionHtml}
      <button class="tg-btn" data-action="import">Import</button>
    `;
  }

  /** The model's already in the library, but this page's print profile isn't known to be --
   *  each MakerWorld profile has its own 3MF (own print settings), stored as its own file on the
   *  one model. No collection picker: the model's collections are already whatever they are. */
  function addProfileHtml() {
    const { state, printId } = context.library;
    const profileName = currentMakerworldProfileTitle();
    const profileLabel = profileName ? `the "${escapeHtml(profileName)}" profile` : "this print profile";
    const hint =
      state === "profile_missing"
        ? `You already have this model. Add ${profileLabel} as another file on it?`
        : `This model is in your library. Add ${profileLabel} if you don't have it yet -- if one of the model's files already is this profile, nothing is downloaded twice.`;
    const modelLink = printId ? `${context.instanceUrl}/models/${printId}` : `${context.instanceUrl}/models`;
    return `
      <div class="tg-title">In your library</div>
      <div class="tg-hint">${hint}</div>
      <button class="tg-btn" data-action="import">Add profile</button>
      <a class="tg-btn tg-btn-secondary tg-link" href="${escapeHtml(modelLink)}" target="_blank" rel="noopener noreferrer">Open model in Thingport</a>
    `;
  }

  /** The title of the print profile named in this page's URL hash, read from the page's own data
   *  -- null when there's no hash or the page data is stale (see readMakerworldDesignForPage). */
  function currentMakerworldProfileTitle() {
    const page = readMakerworldDesignForPage(context.url);
    if (!page || !page.requestedInstanceId || !Array.isArray(page.design.instances)) return null;
    const instance = page.design.instances.find((inst) => inst && String(inst.id) === page.requestedInstanceId);
    return instance && typeof instance.title === "string" && instance.title.trim() ? instance.title.trim() : null;
  }

  async function zipChoiceHtml(filename) {
    const collectionHtml = await collectionOptionsHtml();
    return `
      <div class="tg-title">${importHeading()}</div>
      <div class="tg-hint">${escapeHtml(filename)} contains multiple files.</div>
      ${collectionHtml}
      <button class="tg-btn" data-action="import-as-zip">Import as one model</button>
      <button class="tg-btn tg-btn-secondary" data-action="choose-files">Choose files…</button>
    `;
  }

  async function loadZipEntries() {
    renderPanel(`<div class="tg-status">Loading files…</div>`);
    let result;
    try {
      result = await api("POST", "/import/zip/entries", { url: context.url });
    } catch (err) {
      renderPanel(errorHtml(err));
      return;
    }
    const collectionHtml = await collectionOptionsHtml();
    const rows = result.entries
      .map(
        (entry, i) => `
          <label class="tg-entry">
            <input type="checkbox" class="tg-entry-checkbox" value="${escapeHtml(entry)}" checked />
            <span>${escapeHtml(entry)}</span>
          </label>
        `,
      )
      .join("");
    renderPanel(`
      <div class="tg-title">Choose files to import</div>
      <div class="tg-entries">${rows}</div>
      ${collectionHtml}
      <button class="tg-btn" data-action="import">Import selected</button>
    `);
    bindImportButton(() => {
      const entries = [...panelEl.querySelectorAll(".tg-entry-checkbox:checked")].map((el) => el.value);
      if (!entries.length) return;
      void runDirectImport({ entries });
    });
  }

  function bindImportButton(handler) {
    panelEl.querySelector("[data-action=import]").addEventListener("click", handler);
  }

  function selectedCollectionId() {
    const select = panelEl.querySelector("#tg-collection");
    return select && select.value ? select.value : null;
  }

  // Captured up front rather than read from `context` after the await below -- if the page
  // navigates (an SPA route change) while the import is still in flight, `context` gets nulled
  // out from under this still-running function (see unmount()); these locals keep working
  // regardless, though there's nothing left to render into a torn-down panel by then anyway (see
  // renderPanel's own guard for that).
  async function runDirectImport(opts) {
    const collectionId = selectedCollectionId();
    const { url, instanceUrl, classification } = context;
    renderPanel(`<div class="tg-status">Importing…</div>`);
    // Only meaningful for a MakerWorld model page -- see resolveMakerworldDownloadUrlFromPage's
    // own doc comment for why resolving it here beats leaving it to the backend. Read from
    // `classification` (captured above, before any await) rather than `context.classification`
    // afterward, for the same reason `url`/`instanceUrl` are destructured up front: an SPA nav
    // mid-flight nulls `context` out from under this still-running function.
    const resolved =
      classification.provider === "makerworld" && classification.type === "model"
        ? await resolveMakerworldDownloadUrl(url).catch(() => null)
        : null;
    try {
      // One message, not two -- import (and, per collectionId, filing the result into a
      // collection) both run to completion inside the background service worker regardless of
      // whether this tab/page is still around by the time it finishes (see background.js's
      // handleImportSingle for why that matters: a content script's own execution ends the
      // moment the page navigates or fully reloads, but the service worker doesn't).
      const print = await call("IMPORT_SINGLE", { url, entries: opts && opts.entries, collectionId, resolved }).then(unwrap);
      const link = print ? `${instanceUrl}/models/${print.id}` : `${instanceUrl}/models`;
      if (print && print.import_outcome === "profile_added") {
        renderPanel(successHtml(link, "Added this print profile's file to the model you already had.", "Profile added"));
      } else if (print && print.import_outcome === "already_imported") {
        renderPanel(successHtml(link, "This print profile's file was already on the model -- nothing new was added.", "Already in your library"));
      } else {
        renderPanel(successHtml(link));
      }
    } catch (err) {
      renderPanel(errorHtml(err));
    }
  }

  // -- MakerWorld client-side download-URL resolution --------------------------------------------
  //
  // Resolves a model's actual downloadable file URL directly from the live page instead of
  // asking the backend to (see importService.ts's tryMakerworldCloudApi/resolveMakerworldDownloadUrl
  // -- both call MakerWorld's own resolution APIs, and both are the only two places able to trip
  // its CAPTCHA and the resulting 2-hour account-wide lockout, see makerworldCaptcha.ts). Doing it
  // here instead has two real advantages, not just one fewer server-side call: the fetch() below
  // is same-origin (this page and the API are both on makerworld.com), so the browser attaches the
  // real, currently-valid session cookie automatically -- no bearer-token extraction, no stale
  // cookie risk -- and the request looks exactly like the page's own JS making it, not a batch of
  // requests arriving from one server IP. Falls through to null on any failure (page structure
  // changed, not logged into MakerWorld, a transient error) -- this is a pure enhancement; the
  // caller just omits resolved_download_url and the backend resolves it exactly as it always has.

  function readMakerworldNextData() {
    const el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return null;
    try {
      return JSON.parse(el.textContent);
    } catch {
      return null;
    }
  }

  function getPath(obj, ...keys) {
    let current = obj;
    for (const key of keys) {
      if (!current || typeof current !== "object") return undefined;
      current = current[key];
    }
    return current;
  }

  /** Same field shape the backend's extractDownloadUrlFromResponse checks -- a plain
   *  {url|downloadUrl|download_url}, optionally nested one level under `data`. */
  function extractDownloadUrlFromJson(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    for (const key of ["url", "downloadUrl", "download_url"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const inner = data.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      for (const key of ["url", "downloadUrl", "download_url"]) {
        const value = inner[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return null;
  }

  // Mirrors every outbound fetch on the backend side (rawFetch/fetchCloudJson in
  // importService.ts/makerworldCloudApi.ts, all built on an AbortController timeout) -- a plain
  // fetch() has no default timeout at all, so a MakerWorld endpoint that stalls or holds an
  // interactive challenge open (observed live: a model with extra download options, like an STL/
  // "Card files" toggle, got the guided import stuck here indefinitely) would otherwise hang this
  // resolution -- and everything waiting on it, all the way up to the guided job itself -- forever.
  const MAKERWORLD_API_FETCH_TIMEOUT_MS = 8000;

  async function fetchMakerworldApiJson(url, nonce) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAKERWORLD_API_FETCH_TIMEOUT_MS);
    try {
      const headers = { Accept: "application/json" };
      if (nonce) headers["X-Nonce"] = nonce;
      // credentials default to "same-origin" -- the real session cookie rides along automatically.
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Best-effort match for the page's own real "Download" button -- text-based (not a class name
   *  or test-id, which MakerWorld's build could change at any time), restricted to a visible
   *  element so an off-screen/hidden duplicate (e.g. inside an unopened dropdown) isn't clicked
   *  instead of the real one. Multiple design "instances" can each have their own download
   *  control; this returns whichever matches first, i.e. the default/selected one. */
  function findMakerworldDownloadButton() {
    for (const el of document.querySelectorAll("button, a")) {
      if (!/^download$/i.test((el.textContent || "").trim())) continue;
      if (el.offsetParent === null) continue; // hidden (display:none or detached)
      return el;
    }
    return null;
  }

  /** Clicks the page's own real Download button and captures the resulting browser download's
   *  resolved URL, canceling it immediately -- see background.js's armDownloadCapture/
   *  onCreated.addListener doc comment for the full reasoning (this sidesteps guessing
   *  MakerWorld's resolution API shape entirely, since whatever request the button's own click
   *  handler makes is the one that gets captured). Returns null on anything not working out
   *  (no button found, nothing captured within the timeout, or a blob: URL that isn't independently
   *  fetchable) -- always a graceful "try the fallback instead", never a thrown error. */
  async function captureDownloadUrlViaRealClick() {
    const button = findMakerworldDownloadButton();
    if (!button) return null;
    const armed = await call("ARM_DOWNLOAD_CAPTURE");
    if (!armed || !armed.ok) return null;
    button.click();
    const res = await call("AWAIT_DOWNLOAD_CAPTURE");
    return res && res.ok ? res.downloadUrl : null;
  }

  /** The single entry point every caller below uses: tries the real-click capture first (far
   *  higher fidelity, since it's not a guess), falling back to reconstructing the API call
   *  ourselves only if that didn't pan out. `pageUrl` is the model page the caller means to
   *  import, captured before any await -- see readMakerworldDesignForPage for why it's needed.
   *  Resolves to { downloadUrl, instanceId } (the MakerWorld print profile the file belongs to,
   *  null when unknown -- the backend uses it to add a second profile of an already-imported
   *  model as its own file), or null. */
  async function resolveMakerworldDownloadUrl(pageUrl) {
    const viaClick = await captureDownloadUrlViaRealClick().catch(() => null);
    if (viaClick) {
      // The page's own button downloads whichever profile the page has selected, which follows
      // the URL hash. Without trustworthy page data, the hash is all there is to go on.
      const page = readMakerworldDesignForPage(pageUrl);
      if (!page) {
        const parsed = thingportIsMakerworldModelUrl(pageUrl);
        return { downloadUrl: viaClick, instanceId: (parsed && parsed.requestedInstanceId) || null };
      }
      return { downloadUrl: viaClick, instanceId: pickMakerworldInstanceId(page.design, page.requestedInstanceId) };
    }
    return resolveMakerworldDownloadUrlFromPage(pageUrl).catch(() => null);
  }

  /** The page's own MakerWorld design data, or null if missing -- or stale: Next.js only writes
   *  __NEXT_DATA__ on a full page load, so after a client-side route change from one model to
   *  another it still describes the first-loaded design, and resolving from it would pair this
   *  page's metadata with that other model's 3MF. */
  function readMakerworldDesignForPage(pageUrl) {
    const nextData = readMakerworldNextData();
    if (!nextData) return null;
    const design = getPath(nextData, "props", "pageProps", "design");
    if (!design || typeof design !== "object") return null;
    const expected = thingportIsMakerworldModelUrl(pageUrl);
    if (!expected || design.id == null || String(design.id) !== expected.designId) return null;
    const nonce = getPath(nextData, "props", "pageProps", "x-nonce");
    return {
      design,
      nonce: typeof nonce === "string" && nonce.trim() ? nonce : null,
      requestedInstanceId: expected.requestedInstanceId,
    };
  }

  /** Same precedence as the backend's resolveMakerworldViaCloudApi: the requested profile (only
   *  if this design actually has it), then the design's default, then the first one. */
  function pickMakerworldInstanceId(design, requestedInstanceId) {
    const instances = Array.isArray(design.instances) ? design.instances.filter((inst) => inst && inst.id) : [];
    if (requestedInstanceId && instances.some((inst) => String(inst.id) === requestedInstanceId)) return requestedInstanceId;
    if (design.defaultInstanceId) return String(design.defaultInstanceId);
    return instances.length ? String(instances[0].id) : null;
  }

  /** Mirrors the backend's own two-step MakerWorld resolution (importResolvers.ts's
   *  resolveMakerworldDownloadUrl) -- instance-scoped endpoint first, model-scoped as a fallback
   *  -- just run from the page itself instead of the server. Fallback only -- see
   *  resolveMakerworldDownloadUrl above, which tries the real-click capture first. */
  async function resolveMakerworldDownloadUrlFromPage(pageUrl) {
    // Stale or missing page data -- let the backend resolve from the URL instead.
    const page = readMakerworldDesignForPage(pageUrl);
    if (!page) return null;
    const { design, nonce } = page;
    const instanceId = pickMakerworldInstanceId(design, page.requestedInstanceId);
    if (instanceId) {
      const apiUrl = `https://makerworld.com/api/v1/design-service/instance/${instanceId}/f3mf?type=download&fileType=`;
      const downloadUrl = extractDownloadUrlFromJson(await fetchMakerworldApiJson(apiUrl, nonce));
      if (downloadUrl) return { downloadUrl, instanceId };
    }

    // Model-level, i.e. the default profile's file.
    const apiUrl = `https://makerworld.com/api/v1/models/${String(design.id)}/download`;
    const downloadUrl = extractDownloadUrlFromJson(await fetchMakerworldApiJson(apiUrl, nonce));
    return downloadUrl ? { downloadUrl, instanceId: pickMakerworldInstanceId(design, null) } : null;
  }

  // -- Batch flow (a collection/Likes listing page) ---------------------------------------------

  // MakerWorld collections don't use this one -- see loadMakerworldGuidedCollection below, which
  // scrapes the page's own DOM instead of calling this endpoint at all.
  const BATCH_ENTRIES_PATH = {
    "thingiverse:likes": "/import/thingiverse-likes/entries",
    "thingiverse:collection": "/import/thingiverse-collection/entries",
    "printables:collection": "/import/printables-collection/entries",
  };
  // MakerWorld collections don't use these two -- see loadMakerworldGuidedCollection/
  // startMakerworldGuidedImport above instead, which never calls the bulk job-start endpoint.
  const BATCH_START_PATH = {
    "thingiverse:likes": "/import/thingiverse-likes",
    "thingiverse:collection": "/import/thingiverse-collection",
    "printables:collection": "/import/printables-collection",
  };
  const BATCH_ID_FIELD = {
    "thingiverse:likes": "thing_ids",
    "thingiverse:collection": "thing_ids",
    "printables:collection": "model_ids",
  };

  function batchKey() {
    return `${context.classification.provider}:${context.classification.type}`;
  }

  // -- MakerWorld guided collection import -------------------------------------------------------
  //
  // MakerWorld specifically (not the other providers below) trips a multi-hour account-wide
  // CAPTCHA lockout from a burst of collection-import API calls, even with pacing -- see
  // background.js's startMakerworldCollectionJob for the full reasoning. This avoids MakerWorld's
  // own collection-listing API entirely (unlike the generic batch flow below): every model id
  // comes from scraping the page's own DOM instead, after scrolling it to the end -- the exact
  // same requests MakerWorld's own site already makes for a person scrolling through it by hand,
  // and nothing our own backend has to ask for on top of that. There's no entry-selection step
  // here (unlike loadBatchEntries below) -- every not-yet-imported model gets queued.

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** True once MakerWorld's own "No more data" end-of-list marker is showing anywhere on the
   *  page. Matched on rendered text, not a class name -- MakerWorld's CSS-module class names are
   *  build-specific hashes that can (and do) change on any redeploy, while the actual displayed
   *  text is far more stable. */
  function hasNoMoreDataMarker() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent && node.textContent.trim() === "No more data") return true;
    }
    return false;
  }

  /** Every distinct MakerWorld design id linked from the current DOM -- a model card's link looks
   *  like "/en/models/1954043-screw-measuring-tool-...", so the id is just the leading digits
   *  after "/models/". */
  function extractMakerworldModelIds() {
    const ids = new Set();
    for (const a of document.querySelectorAll('a[href*="/models/"]')) {
      const match = (a.getAttribute("href") || "").match(/\/models\/(\d+)/);
      if (match) ids.add(match[1]);
    }
    return [...ids];
  }

  // How long to wait, once asked to start scanning, before the very first scroll/check -- this
  // page can still be mid-navigation/hydration at that exact moment (most commonly right after a
  // full-page navigation back from finishing a previous guided import run), and checking too
  // early can catch zero model cards rendered yet, which the stagnant-round check below would
  // otherwise mistake for "already reached the end" before the page has shown anything at all.
  const MAKERWORLD_SCAN_START_DELAY_MS = 1500;

  /** Repeatedly scrolls the last loaded model card into view -- the standard way to nudge an
   *  intersection-observer-driven infinite scroll into fetching its next page, more reliable
   *  than blindly scrolling the window when the actual scroll container might be some nested
   *  element instead. Stops on the "No more data" marker, or once the model count has stopped
   *  growing for several rounds in a row as a safety net if that marker's wording ever changes
   *  (never loops forever regardless). */
  async function scrollMakerworldCollectionToEnd(onProgress) {
    const MAX_ROUNDS = 300; // generous: 153 models at ~20/page is ~8 loads
    const STAGNANT_LIMIT = 6;
    let lastCount = -1;
    let stagnantRounds = 0;
    await sleep(MAKERWORLD_SCAN_START_DELAY_MS);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (hasNoMoreDataMarker()) return;
      const links = document.querySelectorAll('a[href*="/models/"]');
      const lastLink = links[links.length - 1];
      if (lastLink) lastLink.scrollIntoView({ block: "end" });
      else window.scrollTo(0, document.body.scrollHeight);
      await sleep(700);
      const count = extractMakerworldModelIds().length;
      if (onProgress) onProgress(count);
      if (count === lastCount) {
        stagnantRounds += 1;
        if (stagnantRounds >= STAGNANT_LIMIT) return;
      } else {
        stagnantRounds = 0;
      }
      lastCount = count;
    }
  }

  /** Finds this user's Thingport collection whose name matches (case-insensitively, same as the
   *  backend's own uniqueness check) the given MakerWorld collection title, creating one if none
   *  exists yet. Returns null (best-effort) on any failure -- the import still proceeds, it just
   *  won't have anywhere to file into. */
  async function findOrCreateThingportCollection(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase();
    try {
      const collections = await api("GET", "/collections");
      const existing = collections.find((c) => !c.system_key && (c.name || "").trim().toLowerCase() === normalized);
      if (existing) return existing.id;
      const created = await api("POST", "/collections", { name: trimmed });
      return created.id;
    } catch {
      return null;
    }
  }

  /** Same full-page dark cover as the guided import's own progress overlay (mountJobOverlay) --
   *  reused here, rather than the small in-panel status line the scroll-to-end step used to show,
   *  since scrolling the page around while a little bottom-right card silently updates its text is
   *  easy to miss entirely. Appended into the same shadow root the fab/panel already live in
   *  (mount() has already run by the time this is called), so it just needs to paint over them,
   *  not replace them -- removed once scanning finishes and the panel takes back over. */
  function mountScanOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "tg-overlay";
    overlay.innerHTML = `
      <div class="tg-overlay-card">
        <img class="tg-overlay-icon" src="${ICON_URL}" alt="" />
        <div class="tg-overlay-title">Scanning collection models…</div>
        <div class="tg-overlay-count" data-role="count">0 found so far</div>
      </div>
    `;
    shadowRoot.appendChild(overlay);
    return overlay;
  }

  function updateScanOverlay(overlay, count) {
    const countEl = overlay.querySelector('[data-role="count"]');
    if (countEl) countEl.textContent = `${count} found so far`;
  }

  function unmountScanOverlay(overlay) {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  async function loadMakerworldGuidedCollection() {
    const h1 = document.getElementsByTagName("h1")[0];
    const collectionTitle = h1 && h1.innerText ? h1.innerText.trim() : null;

    const scanOverlay = mountScanOverlay();
    await scrollMakerworldCollectionToEnd((count) => updateScanOverlay(scanOverlay, count));
    unmountScanOverlay(scanOverlay);

    const ids = extractMakerworldModelIds();
    if (!ids.length) {
      renderPanel(errorHtml(new Error("Couldn't find any models on this page -- MakerWorld may have changed its page layout.")));
      return;
    }

    renderPanel(`<div class="tg-status">Checking ${ids.length} models against your library…</div>`);
    const statuses = await Promise.all(
      ids.map(async (id) => {
        const url = thingportMakerworldModelUrl(id);
        try {
          const status = await api("GET", `/import/status?url=${encodeURIComponent(url)}`);
          return { url, already_imported: status.already_imported, print_id: status.print_id };
        } catch {
          return { url, already_imported: false, print_id: null };
        }
      }),
    );
    const toImport = statuses.filter((s) => !s.already_imported);
    const alreadyImported = statuses.filter((s) => s.already_imported);

    const parts = [];
    if (toImport.length) parts.push(`${toImport.length} new model${toImport.length === 1 ? "" : "s"} to import`);
    if (alreadyImported.length) parts.push(`${alreadyImported.length} already in your library`);
    renderPanel(`
      <div class="tg-title">${escapeHtml(collectionTitle || "Import collection")}</div>
      <div class="tg-hint">${parts.join(", ") || "No models found."}</div>
      <button class="tg-btn" data-action="start">Start import</button>
      <div class="tg-hint" style="margin-top:8px">
        ${collectionTitle ? `Models go into a Thingport collection named "${escapeHtml(collectionTitle)}" (created if it doesn't exist yet). ` : ""}New
        models are imported one page visit at a time, pacing itself to avoid MakerWorld's rate
        limiting -- this can take a while for a large collection.
      </div>
    `);
    const startBtn = panelEl.querySelector("[data-action=start]");
    if (startBtn) startBtn.addEventListener("click", () => void startMakerworldGuidedImport(toImport, alreadyImported, collectionTitle));
  }

  async function startMakerworldGuidedImport(toImport, alreadyImported, collectionTitle) {
    const originalUrl = context.url;
    renderPanel(`<div class="tg-status">Preparing your collection…</div>`);
    const collectionId = await findOrCreateThingportCollection(collectionTitle);

    if (alreadyImported.length && collectionId) {
      renderPanel(
        `<div class="tg-status">Adding ${alreadyImported.length} existing model${alreadyImported.length === 1 ? "" : "s"} to your collection…</div>`,
      );
      for (const entry of alreadyImported) {
        if (entry.print_id) {
          await api("POST", `/collection/${collectionId}/items/${entry.print_id}`).catch(() => undefined);
        }
      }
    }

    if (!toImport.length) {
      renderPanel(successHtml(`${context.instanceUrl}/models`, "Nothing new to import -- already-imported models were added to your collection."));
      return;
    }

    renderPanel(`<div class="tg-status">Starting guided import…</div>`);
    const urls = toImport.map((e) => e.url);
    await call("START_MAKERWORLD_COLLECTION_JOB", { urls, collectionId, originalUrl });
    // The tab is about to navigate to the first model's page (background just kicked that off) --
    // nothing more to render here; the full-page overlay (mountJobOverlay) takes over from there.
  }

  async function loadBatchEntries() {
    renderPanel(`<div class="tg-status">Loading models…</div>`);
    let result;
    try {
      result = await api("POST", BATCH_ENTRIES_PATH[batchKey()], { url: context.url });
    } catch (err) {
      renderPanel(errorHtml(err));
      return;
    }
    const rows = result.entries
      .map(
        (entry) => `
          <label class="tg-entry ${entry.already_imported ? "tg-entry-imported" : ""}">
            <input type="checkbox" class="tg-entry-checkbox" value="${escapeHtml(entry.design_id)}" ${entry.already_imported ? "" : "checked"} />
            <span>${escapeHtml(entry.title || entry.design_id)}</span>
            ${entry.already_imported ? '<span class="tg-badge">already imported</span>' : ""}
          </label>
        `,
      )
      .join("");
    renderPanel(`
      <div class="tg-title">${escapeHtml(result.title || "Import models")}</div>
      <div class="tg-hint">${result.entries.length} models found${result.truncated ? " (more available on the site)" : ""}</div>
      <div class="tg-entries">${rows}</div>
      <button class="tg-btn" data-action="import">Import selected</button>
    `);
    panelEl.querySelector("[data-action=import]").addEventListener("click", () => void runBatchImport());
  }

  async function runBatchImport() {
    const ids = [...panelEl.querySelectorAll(".tg-entry-checkbox:checked")].map((el) => el.value);
    if (!ids.length) return;
    const { url, instanceUrl } = context;
    renderPanel(`<div class="tg-status">Starting import…</div>`);
    try {
      const body = { url, [BATCH_ID_FIELD[batchKey()]]: ids };
      const { job_id } = await api("POST", BATCH_START_PATH[batchKey()], body);
      await pollJobWithProgress(job_id, instanceUrl);
    } catch (err) {
      renderPanel(errorHtml(err));
    }
  }

  async function pollJobWithProgress(jobId, instanceUrl) {
    for (;;) {
      // The panel was torn down (unmount(), e.g. an SPA route change) since the last tick --
      // stop polling. The job itself is unaffected: it keeps running server-side either way
      // (see the README's own note on this), this just stops burning a request every second on
      // a job nothing is watching any more.
      if (!contentEl) return;
      const job = await api("GET", `/import/jobs/${jobId}`);
      if (!contentEl) return;
      if (job.status === "RUNNING") {
        renderPanel(`<div class="tg-status">Importing ${job.processed} of ${job.total}…</div>`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (job.status === "ERROR") {
        renderPanel(errorHtml(new Error(job.error_message || "Import failed")));
        return;
      }
      const link = job.result_print_id ? `${instanceUrl}/models/${job.result_print_id}` : `${instanceUrl}/models`;
      renderPanel(successHtml(link, `Imported ${job.imported} of ${job.total}.`));
      return;
    }
  }

  // -- Shared result states -----------------------------------------------------------------

  function successHtml(link, note, title = "Imported!") {
    return `
      <div class="tg-title">${escapeHtml(title)}</div>
      ${note ? `<div class="tg-hint">${escapeHtml(note)}</div>` : ""}
      <a class="tg-btn tg-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open in Thingport</a>
    `;
  }

  function errorHtml(err) {
    const message = err instanceof Error ? err.message : String(err);
    return `<div class="tg-title tg-error">Something went wrong</div><div class="tg-hint">${escapeHtml(message)}</div>`;
  }

  async function loadPanel() {
    if (context.classification.kind === "single") await loadSingleItem();
    else if (batchKey() === "makerworld:collection") await loadMakerworldGuidedCollection();
    else await loadBatchEntries();
  }

  function unmount() {
    const host = document.getElementById("thingport-grab-host");
    if (host) host.remove();
    shadowRoot = null;
    panelEl = null;
    contentEl = null;
    panelOpen = false;
    context = null;
  }

  // -- MakerWorld guided-import full-page cover ---------------------------------------------------
  //
  // Shown instead of the normal fab/panel on every page this tab visits while a guided collection
  // import (see background.js) is running -- each model's own page is a fresh navigation, so this
  // mounts fresh each time too, reading the job's current progress from storage rather than
  // carrying any state of its own across pages.

  // How long the overlay waits, with no sign the job has moved on, before it offers the manual
  // "Import next" escape hatch below -- long enough that it never appears during an ordinary step
  // (a model page load + import + the job's own pacing delay), short enough that a genuinely
  // stuck step (see handleForceAdvanceMakerworldJob's own doc comment: most often an unusually
  // large multi-plate model that took long enough to import for the service worker to get killed
  // mid-request, silently losing the automatic advance) doesn't leave the user staring at a
  // motionless progress bar for long before there's something to actually do about it.
  const MAKERWORLD_JOB_STUCK_REVEAL_MS = 20000;

  async function mountJobOverlay(job) {
    const host = document.createElement("div");
    host.id = "thingport-grab-host";
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });
    await injectStyles(shadowRoot);

    const overlay = document.createElement("div");
    overlay.className = "tg-overlay";
    const percent = job.total ? Math.round((job.imported / job.total) * 100) : 0;
    overlay.innerHTML = `
      <div class="tg-overlay-card">
        <img class="tg-overlay-icon" src="${ICON_URL}" alt="" />
        <div class="tg-overlay-title">Importing from MakerWorld…</div>
        <div class="tg-overlay-count">${job.imported} / ${job.total} models imported (${percent}%)</div>
        <button class="tg-btn tg-overlay-abort" type="button" data-action="abort">Abort</button>
        <button class="tg-btn tg-btn-secondary tg-overlay-next" type="button" data-action="next" hidden>Import next</button>
      </div>
    `;
    shadowRoot.appendChild(overlay);
    overlay.querySelector("[data-action=abort]").addEventListener("click", (event) => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = "Aborting…";
      void call("ABORT_MAKERWORLD_COLLECTION_JOB");
    });

    // Cleared automatically the moment this page actually navigates away (the normal, successful
    // case) -- a full navigation tears this whole script instance down along with its timer, so
    // there's nothing to clean up explicitly for that path. Only a step that's still sitting here
    // 20s later ever gets this far.
    const nextBtn = overlay.querySelector("[data-action=next]");
    setTimeout(() => {
      nextBtn.hidden = false;
    }, MAKERWORLD_JOB_STUCK_REVEAL_MS);
    nextBtn.addEventListener("click", () => {
      nextBtn.disabled = true;
      nextBtn.textContent = "Checking…";
      void call("FORCE_ADVANCE_MAKERWORLD_JOB");
    });
  }

  // -- Entry point: decide whether this page gets the icon at all -------------------------------

  // Bumped on every re-init so a status-check/mount still in flight for a page the user has
  // already navigated away from (see installNavigationWatcher below) discards its result instead
  // of mounting a stale icon for the wrong URL.
  let initToken = 0;

  function reportTabIconState(active) {
    void call("SET_TAB_ICON_STATE", { active });
  }

  async function init() {
    const myToken = ++initToken;

    // A guided MakerWorld collection import in progress for this tab takes over the whole page,
    // on every model page it visits along the way -- checked before anything else below, since
    // none of the normal single/batch detection applies while this is running.
    const jobRes = await call("GET_MAKERWORLD_JOB");
    if (myToken !== initToken) return;
    if (jobRes.ok && jobRes.data) {
      await mountJobOverlay(jobRes.data);
      if (myToken !== initToken) return;
      reportTabIconState(true);
      return;
    }

    const stateRes = await call("GET_STATE");
    if (myToken !== initToken) return;
    if (!stateRes.ok || !stateRes.data.configured || stateRes.data.disabled) {
      reportTabIconState(false);
      return;
    }

    const classification = thingportClassifyUrl(location.href);
    if (!classification) {
      reportTabIconState(false);
      return;
    }

    // Set when the model is already in the library but this page's MakerWorld print profile might
    // not be (see the backend's checkImportStatus) -- the icon and panel then offer to add the
    // profile's file to the existing model rather than presenting it as a new import.
    let library = null;
    if (classification.kind === "single") {
      try {
        const status = await api("GET", `/import/status?url=${encodeURIComponent(location.href)}`);
        if (myToken !== initToken) return;
        if (status.already_imported) {
          reportTabIconState(false);
          return;
        }
        if (status.state === "profile_missing" || status.state === "profile_unknown") {
          library = { state: status.state, printId: status.print_id };
        }
      } catch {
        // If the status check fails (instance unreachable, bad credentials, etc.) still show the
        // icon -- the panel's own error state will surface the real problem when they try it.
      }
    }
    if (myToken !== initToken) return;

    context = { url: location.href, instanceUrl: stateRes.data.instanceUrl, classification, library };
    await mount();
    if (myToken !== initToken) return;
    reportTabIconState(true);

    // A guided import that just stopped early (see background.js's advanceMakerworldJob) always
    // lands back here, on the collection page it started from -- surface why immediately rather
    // than leaving the user to wonder why it only got partway through.
    if (jobRes.ok && jobRes.error) {
      panelOpen = true;
      panelEl.hidden = false;
      const { message, imported, total } = jobRes.error;
      renderPanel(errorHtml(new Error(`Guided import stopped after ${imported} of ${total} models: ${message}`)));
    }
  }

  // MakerWorld, Printables, and Thingiverse are all client-side-routed SPAs -- navigating from
  // one model to another (or away from one) changes location.href without a full page load, so
  // this content script only ever runs once per *tab*, not once per page. Without this, the icon
  // either never appears on a later model page, or stays stuck showing for a page you've already
  // left. Patching history.pushState/replaceState covers every router built on the standard History
  // API (which is all three of these); popstate covers back/forward; the interval is a cheap,
  // low-frequency safety net for the rare navigation that manages to bypass both.
  function installNavigationWatcher() {
    let lastHref = location.href;
    const onLocationChange = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      unmount();
      void init();
    };

    const origPushState = history.pushState;
    history.pushState = function (...args) {
      const result = origPushState.apply(this, args);
      onLocationChange();
      return result;
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = origReplaceState.apply(this, args);
      onLocationChange();
      return result;
    };
    window.addEventListener("popstate", onLocationChange);
    setInterval(onLocationChange, 1000);
  }

  // Re-evaluates immediately if the user flips "Disable extension" (or changes the instance URL)
  // from the popup while already sitting on an importable page -- without this, the floating
  // icon/panel and the toolbar icon would only catch up on the next navigation.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const relevant = ["instanceUrl", "email", "password", "disabled"].some((key) => key in changes);
    if (!relevant) return;
    unmount();
    void init();
  });

  // Answers background.js's advanceMakerworldJob (the guided MakerWorld collection import loop):
  // once it navigates this tab to a model's page, it asks whoever's running here to resolve that
  // model's download URL directly (see resolveMakerworldDownloadUrlFromPage) rather than leaving
  // the backend to do it for every single model in the run -- this is exactly the repeated,
  // back-to-back resolution pattern most likely to trip MakerWorld's CAPTCHA.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "RESOLVE_MAKERWORLD_DOWNLOAD_URL") return undefined;
    resolveMakerworldDownloadUrl(location.href)
      .then((resolved) => sendResponse({ ok: true, resolved }))
      .catch(() => sendResponse({ ok: true, resolved: null }));
    return true; // keep the message channel open for the async sendResponse above
  });

  installNavigationWatcher();
  void init();
})();
