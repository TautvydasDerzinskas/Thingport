// Toolbar popup (or a tab, when the browser won't open the popup). Connect: the setup form, which becomes Providers
// once connected. Offline features (Extra features once connected): what works without an instance. History: recent
// imports when connected, and recently viewed models either way.

import { fillIcons } from "../shared/icon";
import { seasonalIcon } from "../shared/seasonalIcon";
import { dressMark } from "../shared/seasonalMark";
import { send, type Connection, type ExtensionState } from "../shared/messages";
import { STORAGE_KEYS, apiUrl, normalizeInstanceUrl, type OfflineFeature } from "../shared/storage";
import { clearError, els, showError } from "./dom";
import { loadRecentImports } from "./recentImports";
import { loadRecentlyViewed } from "./recentlyViewed";
import { loadSites } from "./sites";
import "./styles/popup.scss";

// When opened as a tab from a page's setup dialog, return there once saved.
const returnTabId = Number.parseInt(new URLSearchParams(location.search).get("returnTab") ?? "", 10);

fillIcons(document);
dressMark(els.headerIcon, seasonalIcon(), "header__season");
// Room above for a hat.
if (els.headerIcon.dataset.season) els.headerIcon.closest(".header")?.classList.add("header--seasonal");
// Bumped by semantic-release in package.json, which the build copies into the manifest.
els.version.textContent = `v${chrome.runtime.getManifest().version}`;

const FEATURE_SWITCHES: Record<OfflineFeature, HTMLInputElement> = {
  normalizeMakerworld: els.normalizeSwitch,
  thingiverseDark: els.thingiverseDarkSwitch,
  thingiverseHideAds: els.thingiverseAdsSwitch,
};

type Tab = "connect" | "offline" | "history";

const TABS: Record<Tab, { tab: HTMLButtonElement; panel: HTMLElement }> = {
  connect: { tab: els.connectTab, panel: els.connectPanel },
  offline: { tab: els.offlineTab, panel: els.offlinePanel },
  history: { tab: els.historyTab, panel: els.historyPanel },
};

/** The first two tabs' names: what they hold changes once connected. */
function labelTabs(connected: boolean): void {
  els.connectTab.textContent = connected ? "Providers" : "Connect";
  els.offlineTab.textContent = connected ? "Extra features" : "Offline features";
  els.offlineNote.hidden = connected;
}

function selectTab(selected: Tab, { focus = false } = {}): void {
  els.tabs.dataset.active = selected;
  for (const [name, { tab, panel }] of Object.entries(TABS)) {
    const active = name === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
  if (focus) TABS[selected].tab.focus();
}

for (const [name, { tab }] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
  tab.addEventListener("click", () => selectTab(name));
}

// Arrow keys move between tabs, as in any tab list.
els.tabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const names = Object.keys(TABS) as Tab[];
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

function showConfiguredView(state: ExtensionState): void {
  labelTabs(true);
  els.configuredView.hidden = false;
  els.setupForm.hidden = true;
  els.instanceRow.hidden = false;
  els.enabledToggle.hidden = false;
  els.instanceUrlText.textContent = displayInstanceUrl(state.instanceUrl);
  els.instanceUrlText.title = state.instanceUrl;
  els.enabledSwitch.checked = !state.disabled;
  clearError(els.configuredError);
  void loadRecentImports();
  void loadSites();
}

function showSetupForm(prefillUrl = "", prefillEmail = ""): void {
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
  els.ssoPending.hidden = true;
  els.disconnectedNote.hidden = true;
  clearError();
  els.instanceUrlInput.focus();
  void offerSingleSignOn(prefillUrl);
}

// Asked of each instance typed in, so single sign-on only shows where it works: instances from before connecting
// by approval existed, or without a provider set up, don't answer this and the form stays as it always was.
let ssoProbe = 0;
let ssoProbeTimer: number | undefined;

async function offerSingleSignOn(rawUrl: string): Promise<void> {
  const probe = ++ssoProbe;
  els.ssoBlock.hidden = true;
  const instanceUrl = normalizeInstanceUrl(rawUrl);
  if (!/^https?:\/\/[^/]+/i.test(instanceUrl)) return;
  try {
    // Health answers any origin, so this works before the instance's permission is granted.
    const res = await fetch(apiUrl(instanceUrl, "/health"), { signal: AbortSignal.timeout(4000) });
    const health = (await res.json()) as { grab_pairing?: boolean; oidc_providers?: { name: string }[] };
    const providers = Array.isArray(health.oidc_providers) ? health.oidc_providers : [];
    if (probe !== ssoProbe || health.grab_pairing !== true || providers.length === 0) return;
    els.ssoBtn.textContent =
      providers.length === 1 ? `Sign in with ${providers[0].name}` : "Sign in with single sign-on";
    els.ssoBlock.hidden = false;
  } catch {
    // Unreachable, or an older Thingport: the password form is all there is.
  }
}

function connectionProblem(connection: Extract<Connection, { connected: false }>): string {
  if (connection.reason === "credentials" && connection.byApproval) {
    return "Your Thingport instance no longer accepts this browser's Thingport Grab -- it was probably removed from your profile there. Connect again, or sign in with your email and password.";
  }
  return connection.reason === "credentials"
    ? `Your Thingport instance turned down the saved email and password -- they were probably changed there. Sign in again with the current ones. (${connection.detail})`
    : `Your Thingport instance didn't answer -- it may not be running or reachable right now. Check its URL, or try again later. (${connection.detail})`;
}

/** Opens on the edit form when the saved connection no longer signs in. `checkConnection` is off
 *  after Cancel, which then shows the problem above the configured view instead. */
async function refresh({ checkConnection = true } = {}): Promise<void> {
  const res = await send("GET_STATE");
  if (!res?.ok) {
    showError(res?.error ?? "The extension background isn't responding");
    return;
  }
  for (const [feature, input] of Object.entries(FEATURE_SWITCHES) as [OfflineFeature, HTMLInputElement][]) {
    input.checked = res.data.offlineFeatures[feature];
  }
  if (!res.data.configured) {
    showSetupForm();
    return;
  }
  showConfiguredView(res.data);
  if (res.data.disabled) return;
  const connection = await send("CHECK_CONNECTION");
  if (!connection?.ok || connection.data.connected) return;
  if (checkConnection) {
    // A connection that stopped working is worth seeing whichever tab was open last.
    selectTab("connect");
    showSetupForm(res.data.instanceUrl, res.data.email);
    showError(connectionProblem(connection.data));
    // A removed connection has no password to fix: nothing to jump to.
    if (!connection.data.byApproval) {
      (connection.data.reason === "credentials" ? els.passwordInput : els.instanceUrlInput).focus();
    }
  } else {
    showError(connectionProblem(connection.data), els.configuredError);
  }
}

els.editInstanceBtn.addEventListener("click", async () => {
  const res = await send("GET_STATE");
  selectTab("connect");
  showSetupForm(res?.ok ? res.data.instanceUrl : "", res?.ok ? res.data.email : "");
});

els.disconnectBtn.addEventListener("click", async () => {
  const res = await send("GET_STATE");
  const host = res?.ok ? displayInstanceUrl(res.data.instanceUrl) : "your Thingport instance";
  els.disconnectText.textContent =
    `Thingport Grab forgets ${host} and its sign-in in this browser. ` +
    "Offline features and recently viewed models stay.";
  els.disconnectConfirm.disabled = false;
  els.disconnectConfirm.textContent = "Disconnect";
  els.disconnectDialog.showModal();
});

els.disconnectCancel.addEventListener("click", () => els.disconnectDialog.close());

// A click on the backdrop lands on the dialog itself, outside its box.
els.disconnectDialog.addEventListener("click", (event) => {
  if (event.target === els.disconnectDialog && !els.disconnectConfirm.disabled) els.disconnectDialog.close();
});

els.disconnectConfirm.addEventListener("click", async () => {
  els.disconnectConfirm.disabled = true;
  els.disconnectConfirm.textContent = "Disconnecting…";
  const state = await send("GET_STATE");
  const res = await send("DISCONNECT");
  if (!res?.ok) {
    els.disconnectDialog.close();
    showError(res?.error ?? "Couldn't disconnect", els.configuredError);
    return;
  }
  // The instance's address was granted for this connection alone.
  if (state?.ok && state.data.instanceUrl) {
    try {
      await chrome.permissions.remove({ origins: [`${new URL(state.data.instanceUrl).origin}/*`] });
    } catch {
      // Granted as part of wider access, which stays.
    }
  }
  els.disconnectDialog.close();
  await refresh();
  if (res.data.approvalKept) {
    els.disconnectedNote.textContent =
      "Disconnected. Your Thingport instance didn't remove this browser's connection: remove it from your " +
      "profile in Thingport to revoke its access there.";
    els.disconnectedNote.hidden = false;
  }
});

els.cancelBtn.addEventListener("click", () => void refresh({ checkConnection: false }));

els.instanceUrlInput.addEventListener("input", () => {
  window.clearTimeout(ssoProbeTimer);
  els.ssoBlock.hidden = true;
  ssoProbeTimer = window.setTimeout(() => void offerSingleSignOn(els.instanceUrlInput.value), 400);
});

els.ssoBtn.addEventListener("click", async () => {
  clearError();
  const instanceUrl = normalizeInstanceUrl(els.instanceUrlInput.value);
  let origin: string;
  try {
    origin = new URL(instanceUrl).origin;
  } catch {
    showError("Enter a valid instance URL, e.g. https://thingport.example.com");
    return;
  }
  // First, while this click still counts as the user's: it's what lets Grab read the approval tab.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) {
    showError("Thingport Grab needs permission to reach this instance to work.");
    return;
  }
  const res = await send("START_PAIRING", { instanceUrl });
  if (!res?.ok) {
    showError(res?.error ?? "Couldn't open Thingport");
    return;
  }
  els.ssoPending.hidden = false;
});

// Connecting by approval finishes in the background, maybe while this is open as a tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEYS.connectionToken]?.newValue) return;
  if (Number.isInteger(returnTabId)) {
    void chrome.tabs.update(returnTabId, { active: true }).catch(() => undefined);
    void chrome.tabs.getCurrent().then((self) => (self?.id != null ? chrome.tabs.remove(self.id) : undefined));
    return;
  }
  void refresh();
});

els.enabledSwitch.addEventListener("change", async () => {
  clearError(els.configuredError);
  els.enabledSwitch.disabled = true;
  const res = await send("SET_DISABLED", { disabled: !els.enabledSwitch.checked });
  els.enabledSwitch.disabled = false;
  if (!res?.ok) {
    showError(res?.error ?? "Couldn't save", els.configuredError);
    els.enabledSwitch.checked = !els.enabledSwitch.checked;
  }
});

for (const [feature, input] of Object.entries(FEATURE_SWITCHES) as [OfflineFeature, HTMLInputElement][]) {
  input.addEventListener("change", async () => {
    clearError(els.offlineError);
    input.disabled = true;
    const res = await send("SET_OFFLINE_FEATURE", { feature, enabled: input.checked });
    input.disabled = false;
    if (!res?.ok) {
      showError(res?.error ?? "Couldn't save", els.offlineError);
      input.checked = !input.checked;
    }
  });
}

els.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const normalized = normalizeInstanceUrl(els.instanceUrlInput.value);
  let origin: string;
  try {
    origin = new URL(normalized).origin;
  } catch {
    showError("Enter a valid instance URL, e.g. https://thingport.example.com");
    return;
  }

  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving…";
  try {
    // Must happen here: permissions.request() needs this submit's user gesture.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      showError("Thingport Grab needs permission to reach this instance to work.");
      return;
    }
    const res = await send("SAVE_CONFIG", {
      instanceUrl: normalized,
      email: els.emailInput.value,
      password: els.passwordInput.value,
    });
    if (!res?.ok) {
      showError(res?.error ?? "Couldn't save");
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
    els.saveBtn.textContent = "Save";
  }
});

// A page open in another window can note a model while this is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "recentlyViewed" in changes) void loadRecentlyViewed();
});

void refresh();
void loadRecentlyViewed();
