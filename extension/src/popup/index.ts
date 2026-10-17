// Toolbar popup (or a tab, when the browser won't open the popup): the setup form until configured,
// then the enable switch and recent imports.

import { fillIcons } from "../shared/icon";
import { send, type Connection, type ExtensionState } from "../shared/messages";
import { STORAGE_KEYS, apiUrl, normalizeInstanceUrl } from "../shared/storage";
import { clearError, els, showError } from "./dom";
import { loadRecentImports } from "./recentImports";
import "./styles/popup.scss";

// When opened as a tab from a page's setup dialog, return there once saved.
const returnTabId = Number.parseInt(new URLSearchParams(location.search).get("returnTab") ?? "", 10);

fillIcons(document);
// Bumped by semantic-release in package.json, which the build copies into the manifest.
els.version.textContent = `v${chrome.runtime.getManifest().version}`;

function displayInstanceUrl(instanceUrl: string): string {
  return instanceUrl.replace(/^https?:\/\//i, "");
}

function showConfiguredView(state: ExtensionState): void {
  els.configuredView.hidden = false;
  els.setupForm.hidden = true;
  els.instanceRow.hidden = false;
  els.enabledToggle.hidden = false;
  els.instanceUrlText.textContent = displayInstanceUrl(state.instanceUrl);
  els.instanceUrlText.title = state.instanceUrl;
  els.enabledSwitch.checked = !state.disabled;
  clearError(els.configuredError);
  void loadRecentImports();
}

function showSetupForm(prefillUrl = "", prefillEmail = ""): void {
  els.configuredView.hidden = true;
  els.instanceRow.hidden = true;
  els.enabledToggle.hidden = true;
  els.setupForm.hidden = false;
  els.cancelBtn.hidden = !prefillUrl;
  els.instanceUrlInput.value = prefillUrl;
  els.emailInput.value = prefillEmail;
  els.passwordInput.value = "";
  els.ssoPending.hidden = true;
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
  if (!res.data.configured) {
    showSetupForm();
    return;
  }
  showConfiguredView(res.data);
  if (res.data.disabled) return;
  const connection = await send("CHECK_CONNECTION");
  if (!connection?.ok || connection.data.connected) return;
  if (checkConnection) {
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
  showSetupForm(res?.ok ? res.data.instanceUrl : "", res?.ok ? res.data.email : "");
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

void refresh();
