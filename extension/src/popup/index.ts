// Toolbar popup (or a tab, when the browser won't open the popup). Connect: the setup form, which becomes Providers
// once connected. Appearance: the language (language.ts) and the bubble. Offline features (Extra features once
// connected): what works without an instance, Adapt 3MFs with its settings among them (adapt.ts). History: recent
// imports when connected, and recently viewed models either way.

import { fillIcons } from "../shared/icon";
import { seasonalIcon } from "../shared/seasonalIcon";
import { dressMark } from "../shared/seasonalMark";
import { send, type Connection, type ExtensionState } from "../shared/messages";
import { STORAGE_KEYS, apiUrl, normalizeInstanceUrl, type OfflineFeature } from "../shared/storage";
import { applyTranslations, detectLocale, setLocale, t, type Locale } from "../shared/i18n";
import { loadAdapt, renderAll as renderAdapt } from "./adapt";
import { refreshAppearance, showAppearance } from "./appearance";
import { renderLanguage, setUpLanguage } from "./language";
import { confirmAction } from "./confirm";
import { clearError, els, opensInTab, showError } from "./dom";
import { loadRecentImports } from "./recentImports";
import { loadRecentlyViewed } from "./recentlyViewed";
import { loadSites } from "./sites";
import "./styles/popup.scss";

// When opened as a tab from a page's setup dialog, return there once saved.
const returnTabId = Number.parseInt(new URLSearchParams(location.search).get("returnTab") ?? "", 10);

fillIcons(document);
setLocale(detectLocale());
applyTranslations();
dressMark(els.headerIcon, seasonalIcon(), "header__season");
// Room above for a hat.
if (els.headerIcon.dataset.season) els.headerIcon.closest(".header")?.classList.add("header--seasonal");
// Bumped by semantic-release in package.json, which the build copies into the manifest.
els.version.textContent = `v${chrome.runtime.getManifest().version}`;
// The instance's address, shown once connected, opens it.
opensInTab(els.instanceLink);

const FEATURE_SWITCHES: Record<OfflineFeature, HTMLInputElement> = {
  normalizeMakerworld: els.normalizeSwitch,
  thingiverseDark: els.thingiverseDarkSwitch,
  thingiverseHideAds: els.thingiverseAdsSwitch,
};

type Tab = "connect" | "appearance" | "offline" | "history";

// In the order they're shown.
const TABS: Record<Tab, { tab: HTMLButtonElement; panel: HTMLElement }> = {
  connect: { tab: els.connectTab, panel: els.connectPanel },
  appearance: { tab: els.appearanceTab, panel: els.appearancePanel },
  offline: { tab: els.offlineTab, panel: els.offlinePanel },
  history: { tab: els.historyTab, panel: els.historyPanel },
};

/** The tabs on offer. */
const shownTabs = (): Tab[] => (Object.keys(TABS) as Tab[]).filter((name) => !TABS[name].tab.hidden);

/** What the tabs hold changes once connected: the first two are named for it. */
function labelTabs(connected: boolean): void {
  els.connectTab.textContent = connected ? t("providers") : t("connect");
  els.offlineTab.textContent = connected ? t("tabExtraFeatures") : t("tabOfflineFeatures");
  els.offlineNote.hidden = connected;
  const active = els.tabs.dataset.active as Tab | undefined;
  selectTab(active && shownTabs().includes(active) ? active : "connect");
}

function localizeDynamicContent(): void {
  els.enabledToggle.dataset.tooltip = t("extensionEnabled");
  els.viewedClearWrap.dataset.tooltip = t("clearRecentlyViewed");
  els.pairNote.textContent = t(pairNoteKey);
  refreshAppearance();
  renderAdapt();
  void loadRecentlyViewed();
  if (!els.configuredView.hidden) {
    void loadRecentImports();
    void loadSites();
  }
}

function selectTab(selected: Tab, { focus = false } = {}): void {
  els.tabs.dataset.active = selected;
  for (const [name, { tab, panel }] of Object.entries(TABS)) {
    const active = name === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
  // The underline: as wide as one tab of those shown, under the one picked (styles/_tabs.scss).
  const shown = shownTabs();
  els.tabs.style.setProperty("--tab-count", String(shown.length));
  els.tabs.style.setProperty("--tab-index", String(Math.max(shown.indexOf(selected), 0)));
  if (focus) TABS[selected].tab.focus();
}

for (const [name, { tab }] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
  tab.addEventListener("click", () => selectTab(name));
}

// Arrow keys move between tabs, as in any tab list.
els.tabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const names = shownTabs();
  const current = names.indexOf(els.tabs.dataset.active as Tab);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? names.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + names.length) % names.length;
  selectTab(names[next], { focus: true });
});

// Always opens on the first tab.
selectTab("connect");

function displayInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/^https?:\/\//i, "");
}

let localeRevision = 0;
/** The choice stored, which a failed save goes back to (null: follow the browser). */
let savedLanguage: Locale | null = null;
/** The pick `savedLanguage` came from: a save that answers after a newer one's doesn't take its place. */
let savedRevision = 0;

function showLanguage(choice: Locale | null): void {
  const locale = choice ?? detectLocale();
  setLocale(locale);
  document.documentElement.lang = locale;
  renderLanguage(choice);
  applyTranslations();
  labelTabs(!els.configuredView.hidden);
  localizeDynamicContent();
}

/** Shown at once, and put back if it can't be saved. */
async function chooseLanguage(choice: Locale | null): Promise<void> {
  const revision = ++localeRevision;
  clearError(els.appearanceError);
  showLanguage(choice);
  const res = await send("SET_LOCALE", { locale: choice });
  if (res?.ok) {
    if (revision > savedRevision) {
      savedRevision = revision;
      savedLanguage = choice;
    }
    return;
  }
  // A later pick has replaced this one already.
  if (revision !== localeRevision) return;
  showLanguage(savedLanguage);
  showError(res?.error ?? t("saveFailed"), els.appearanceError);
}

setUpLanguage((choice) => void chooseLanguage(choice));
renderLanguage(null);

function showConfiguredView(state: ExtensionState): void {
  labelTabs(true);
  els.configuredView.hidden = false;
  els.setupForm.hidden = true;
  els.instanceRow.hidden = false;
  els.enabledToggle.hidden = false;
  els.instanceLink.textContent = displayInstanceUrl(state.instanceUrl);
  els.instanceLink.href = state.instanceUrl;
  els.instanceLink.title = t("openInstance", { instance: state.instanceUrl });
  els.enabledSwitch.checked = !state.disabled;
  clearError(els.configuredError);
  void loadRecentImports();
  void loadSites();
}

/** `credentials`: open with the password form already out, for someone coming back to fix one. */
function showSetupForm(prefillUrl = "", prefillEmail = "", { credentials = false } = {}): void {
  labelTabs(false);
  els.recentSection.hidden = true;
  els.configuredView.hidden = true;
  els.instanceRow.hidden = true;
  els.enabledToggle.hidden = true;
  els.setupForm.hidden = false;
  els.cancelBtn.hidden = !prefillUrl;
  els.instanceUrlInput.value = prefillUrl;
  els.emailInput.value = prefillEmail;
  els.passwordInput.value = "";
  setPairing(false);
  els.disconnectedNote.hidden = true;
  clearError();
  if (credentials) showCredentials();
  else hideCredentials();
  els.instanceUrlInput.focus();
  void probeInstance(prefillUrl);
}

/** The password form stays out of the way until it's asked for. Its fields are only `required` while they're
 *  on screen: a hidden required field makes the form unsubmittable, with nothing to show for it. */
function showCredentials({ focus = false } = {}): void {
  els.credentialsBlock.hidden = false;
  els.credentialsToggle.hidden = true;
  els.credentialsBtn.setAttribute("aria-expanded", "true");
  els.emailInput.required = true;
  els.passwordInput.required = true;
  if (focus) (els.emailInput.value ? els.passwordInput : els.emailInput).focus();
}

function hideCredentials(): void {
  els.credentialsBlock.hidden = true;
  els.credentialsToggle.hidden = false;
  els.credentialsBtn.setAttribute("aria-expanded", "false");
  els.emailInput.required = false;
  els.passwordInput.required = false;
}

let pairNoteKey = "pairNote";

// Asked of each instance typed in. Pairing leads, so the button follows the address alone and only an instance
// that answers and says it can't pair takes it away -- one that simply doesn't answer may still be fine, and
// says so for itself in the tab it opens.
let instanceProbe = 0;
let instanceProbeTimer: number | undefined;
let pairable = false;
let pairing = false;

// Pair wants an address that looks like one, and one pairing at a time: a second start opens a second tab and
// overwrites the first one's secret, leaving the approval the user is looking at with nothing to finish.
function updatePairBtn(): void {
  els.pairBtn.disabled = !pairable || pairing;
}

function setPairable(enabled: boolean, noteKey = "pairNote"): void {
  pairable = enabled;
  pairNoteKey = noteKey;
  els.pairNote.textContent = t(noteKey);
  updatePairBtn();
}

/** Off again as soon as the background drops the pending pairing -- cancelled, its tab closed, or its code
 *  taken -- so one that didn't finish can be started over. */
function setPairing(inFlight: boolean): void {
  pairing = inFlight;
  if (!inFlight) els.pairPending.hidden = true;
  updatePairBtn();
}

async function probeInstance(rawUrl: string): Promise<void> {
  const probe = ++instanceProbe;
  const instanceUrl = normalizeInstanceUrl(rawUrl);
  const looksLikeUrl = /^https?:\/\/[^/]+/i.test(instanceUrl);
  setPairable(looksLikeUrl);
  if (!looksLikeUrl) return;
  try {
    // Health answers any origin, so this works before the instance's permission is granted.
    const res = await fetch(apiUrl(instanceUrl, "/health"), {
      signal: AbortSignal.timeout(4000),
    });
    const health = (await res.json()) as { grab_pairing?: boolean };
    if (probe !== instanceProbe || health.grab_pairing === true) return;
    setPairable(false, "pairUnsupported");
    showCredentials();
  } catch {
    // Unreachable from here, or still being typed: leave pairing on offer rather than guess.
  }
}

function connectionProblem(connection: Extract<Connection, { connected: false }>): string {
  if (connection.reason === "credentials" && connection.byApproval) {
    return t("connectionApprovalRevoked");
  }
  return connection.reason === "credentials"
    ? t("connectionCredentialsRejected", { detail: connection.detail })
    : t("connectionUnreachable", { detail: connection.detail });
}

/** Opens on the edit form when the saved connection no longer signs in. `checkConnection` is off
 *  after Cancel, which then shows the problem above the configured view instead. */
async function refresh({ checkConnection = true } = {}): Promise<void> {
  const localeAtRequest = localeRevision;
  const res = await send("GET_STATE");
  if (!res?.ok) {
    showError(res?.error ?? t("backgroundUnavailable"));
    return;
  }
  if (localeAtRequest === localeRevision) {
    savedLanguage = res.data.localeChoice;
    setLocale(res.data.locale);
    document.documentElement.lang = res.data.locale;
    renderLanguage(res.data.localeChoice);
    applyTranslations();
    localizeDynamicContent();
  }
  // Off until the stored choice is known, as a failed pick goes back to it.
  els.languageTrigger.disabled = false;
  for (const [feature, input] of Object.entries(FEATURE_SWITCHES) as [OfflineFeature, HTMLInputElement][]) {
    input.checked = res.data.offlineFeatures[feature];
  }
  showAppearance(res.data.bubble);
  // Its slicers and printers are the instance's once connected, so it's read again whenever this is.
  void loadAdapt();
  if (!res.data.configured) {
    showSetupForm(res.data.pairingInstanceUrl);
    setPairing(res.data.pairing);
    els.pairPending.hidden = !res.data.pairing;
    return;
  }
  showConfiguredView(res.data);
  if (res.data.disabled) return;
  const connection = await send("CHECK_CONNECTION");
  if (!connection?.ok || connection.data.connected) return;
  if (checkConnection) {
    // A connection that stopped working is worth seeing whichever tab was open last.
    selectTab("connect");
    // Back in the way they came: a password that stopped working is retyped, a removed approval is paired again.
    const byPassword = !connection.data.byApproval;
    showSetupForm(res.data.instanceUrl, res.data.email, {
      credentials: byPassword,
    });
    showError(connectionProblem(connection.data));
    // A removed connection has no password to fix: nothing to jump to.
    if (byPassword) {
      (connection.data.reason === "credentials" ? els.passwordInput : els.instanceUrlInput).focus();
    }
  } else {
    showError(connectionProblem(connection.data), els.configuredError);
  }
}

els.editInstanceBtn.addEventListener("click", async () => {
  const res = await send("GET_STATE");
  selectTab("connect");
  showSetupForm(res?.ok ? res.data.instanceUrl : "", res?.ok ? res.data.email : "", {
    credentials: res?.ok ? !res.data.connectedByApproval : false,
  });
});

async function disconnect(): Promise<void> {
  const state = await send("GET_STATE");
  const res = await send("DISCONNECT");
  if (!res?.ok) {
    showError(res?.error ?? t("disconnectFailed"), els.configuredError);
    return;
  }
  // The instance's address was granted for this connection alone.
  if (state?.ok && state.data.instanceUrl) {
    try {
      await chrome.permissions.remove({
        origins: [`${new URL(state.data.instanceUrl).origin}/*`],
      });
    } catch {
      // Granted as part of wider access, which stays.
    }
  }
  await refresh();
  if (res.data.approvalKept) {
    els.disconnectedNote.textContent = t("disconnectedApprovalKept");
    els.disconnectedNote.hidden = false;
  }
}

els.disconnectBtn.addEventListener("click", async () => {
  const res = await send("GET_STATE");
  const host = res?.ok ? displayInstanceUrl(res.data.instanceUrl) : t("yourThingportInstance");
  confirmAction({
    title: t("disconnectTitle"),
    text: t("disconnectConfirm", { host }),
    confirmLabel: t("disconnect"),
    busyLabel: t("disconnecting"),
    action: disconnect,
  });
});

els.cancelBtn.addEventListener("click", () => void refresh({ checkConnection: false }));

els.instanceUrlInput.addEventListener("input", () => {
  window.clearTimeout(instanceProbeTimer);
  // The address changed, so an answer still on its way is about the old one.
  instanceProbe++;
  // The button follows the address as it's typed; the instance gets asked once the typing settles.
  setPairable(/^https?:\/\/[^/]+/i.test(normalizeInstanceUrl(els.instanceUrlInput.value)));
  instanceProbeTimer = window.setTimeout(() => void probeInstance(els.instanceUrlInput.value), 400);
});

els.credentialsBtn.addEventListener("click", () => showCredentials({ focus: true }));

/** An http:// instance's https:// twin too: a reverse proxy may upgrade it, and Grab follows that upgrade only where it
 *  may reach the https:// origin. */
function instanceOrigins(origin: string): string[] {
  return origin.startsWith("http://") ? [`${origin}/*`, `${origin.replace("http://", "https://")}/*`] : [`${origin}/*`];
}

/** Must be called straight from a click or a submit: `permissions.request()` needs that gesture. */
async function pairWithInstance(): Promise<void> {
  if (pairing) return;
  clearError();
  const instanceUrl = normalizeInstanceUrl(els.instanceUrlInput.value);
  let origin: string;
  try {
    origin = new URL(instanceUrl).origin;
  } catch {
    showError(t("invalidInstanceUrl"));
    return;
  }
  setPairing(true);
  // Start the durable write without awaiting it, then request permission while this still counts as the user's
  // gesture. Chrome may dismiss this popup for its prompt; background storage/permission listeners continue it.
  const rememberIntent = chrome.storage.local.set({
    [STORAGE_KEYS.pairingIntent]: { instanceUrl, startedAt: Date.now() },
  });
  const permission = chrome.permissions.request({
    origins: instanceOrigins(origin),
  });
  let granted: boolean;
  try {
    granted = await permission;
    await rememberIntent;
  } catch {
    await chrome.storage.local.remove(STORAGE_KEYS.pairingIntent).catch(() => undefined);
    setPairing(false);
    showError(t("openThingportFailed"));
    return;
  }
  if (!granted) {
    await chrome.storage.local.remove(STORAGE_KEYS.pairingIntent);
    setPairing(false);
    showError(t("instancePermission"));
    return;
  }
  // Also resume here for already-granted access, where permissions.onAdded does not fire.
  const res = await send("RESUME_PAIRING");
  if (!res?.ok) {
    setPairing(false);
    showError(res?.error ?? t("openThingportFailed"));
    return;
  }
  // Only now is there a tab to finish it in.
  els.pairPending.hidden = false;
}

els.pairBtn.addEventListener("click", () => void pairWithInstance());

// Connecting by approval finishes in the background, maybe while this is open as a tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes[STORAGE_KEYS.connectionToken]?.newValue) {
    if (STORAGE_KEYS.pendingPairing in changes && !changes[STORAGE_KEYS.pendingPairing].newValue) {
      setPairing(false);
    }
    return;
  }
  if (Number.isInteger(returnTabId)) {
    void chrome.tabs.update(returnTabId, { active: true }).catch(() => undefined);
    void chrome.tabs.getCurrent().then((self) => (self?.id != null ? chrome.tabs.remove(self.id) : undefined));
    return;
  }
  void refresh();
});

async function setEnabled(enabled: boolean): Promise<void> {
  clearError(els.configuredError);
  els.enabledSwitch.disabled = true;
  const res = await send("SET_DISABLED", { disabled: !enabled });
  els.enabledSwitch.disabled = false;
  if (res?.ok) els.enabledSwitch.checked = enabled;
  else showError(res?.error ?? t("saveFailed"), els.configuredError);
}

// Turning it back on is one click; turning it off asks first, and the switch stays on until it's confirmed.
els.enabledSwitch.addEventListener("change", () => {
  if (els.enabledSwitch.checked) {
    void setEnabled(true);
    return;
  }
  els.enabledSwitch.checked = true;
  confirmAction({
    title: t("turnOffTitle"),
    text: t("turnOffConfirm"),
    confirmLabel: t("disable"),
    busyLabel: t("turningOff"),
    action: () => setEnabled(false),
  });
});

for (const [feature, input] of Object.entries(FEATURE_SWITCHES) as [OfflineFeature, HTMLInputElement][]) {
  input.addEventListener("change", async () => {
    clearError(els.offlineError);
    input.disabled = true;
    const res = await send("SET_OFFLINE_FEATURE", {
      feature,
      enabled: input.checked,
    });
    input.disabled = false;
    if (!res?.ok) {
      showError(res?.error ?? t("saveFailed"), els.offlineError);
      input.checked = !input.checked;
    }
  });
}

els.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Enter in the address field runs the button beneath it, which is Pair until the password form is out.
  if (els.credentialsBlock.hidden) {
    if (!els.pairBtn.disabled) await pairWithInstance();
    return;
  }
  clearError();

  const normalized = normalizeInstanceUrl(els.instanceUrlInput.value);
  let origin: string;
  try {
    origin = new URL(normalized).origin;
  } catch {
    showError(t("invalidInstanceUrl"));
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = t("saving");
  try {
    // Must happen here: permissions.request() needs this submit's user gesture.
    const granted = await chrome.permissions.request({
      origins: instanceOrigins(origin),
    });
    if (!granted) {
      showError(t("instancePermission"));
      return;
    }
    const res = await send("SAVE_CONFIG", {
      instanceUrl: normalized,
      email: els.emailInput.value,
      password: els.passwordInput.value,
    });
    if (!res?.ok) {
      showError(res?.error ?? t("saveFailed"));
      return;
    }
    if (Number.isInteger(returnTabId)) {
      await chrome.tabs.update(returnTabId, { active: true }).catch(() => undefined);
      const self = await chrome.tabs.getCurrent();
      if (self?.id != null) await chrome.tabs.remove(self.id);
      return;
    }
    await refresh();
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = t("save");
  }
});

// A page open in another window can note a model while this is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "recentlyViewed" in changes) void loadRecentlyViewed();
});

void refresh();
void loadRecentlyViewed();
