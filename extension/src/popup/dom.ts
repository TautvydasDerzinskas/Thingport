function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup.html is missing #${id}`);
  return el as T;
}

export const els = {
  headerIcon: byId("header-icon"),
  instanceRow: byId("instance-row"),
  instanceUrlText: byId("instance-url-text"),
  editInstanceBtn: byId<HTMLButtonElement>("edit-instance-btn"),
  disconnectBtn: byId<HTMLButtonElement>("disconnect-btn"),
  disconnectDialog: byId<HTMLDialogElement>("disconnect-dialog"),
  disconnectText: byId("disconnect-text"),
  disconnectCancel: byId<HTMLButtonElement>("disconnect-cancel"),
  disconnectConfirm: byId<HTMLButtonElement>("disconnect-confirm"),
  disconnectedNote: byId("disconnected-note"),
  tabs: byId("tabs"),
  connectTab: byId<HTMLButtonElement>("tab-connect"),
  offlineTab: byId<HTMLButtonElement>("tab-offline"),
  historyTab: byId<HTMLButtonElement>("tab-history"),
  connectPanel: byId("panel-connect"),
  offlinePanel: byId("panel-offline"),
  historyPanel: byId("panel-history"),
  offlineNote: byId("offline-note"),
  viewedGrid: byId("viewed-grid"),
  viewedEmpty: byId("viewed-empty"),
  viewedClearWrap: byId("viewed-clear-wrap"),
  viewedClear: byId<HTMLButtonElement>("viewed-clear"),
  historyError: byId("history-error"),
  normalizeSwitch: byId<HTMLInputElement>("normalize-switch"),
  thingiverseDarkSwitch: byId<HTMLInputElement>("thingiverse-dark-switch"),
  thingiverseAdsSwitch: byId<HTMLInputElement>("thingiverse-ads-switch"),
  offlineError: byId("offline-error"),
  configuredView: byId("configured-view"),
  enabledToggle: byId("enabled-toggle"),
  enabledSwitch: byId<HTMLInputElement>("enabled-switch"),
  recentSection: byId("recent-section"),
  recentGrid: byId("recent-grid"),
  sitesList: byId("sites-list"),
  configuredError: byId("configured-error"),
  setupForm: byId<HTMLFormElement>("setup-form"),
  instanceUrlInput: byId<HTMLInputElement>("instance-url"),
  emailInput: byId<HTMLInputElement>("email"),
  passwordInput: byId<HTMLInputElement>("password"),
  saveBtn: byId<HTMLButtonElement>("save-btn"),
  cancelBtn: byId<HTMLButtonElement>("cancel-btn"),
  ssoBlock: byId("sso-block"),
  ssoBtn: byId<HTMLButtonElement>("sso-btn"),
  ssoPending: byId("sso-pending"),
  error: byId("error"),
  version: byId("version"),
};

export function showError(message: string, el: HTMLElement = els.error): void {
  el.textContent = message;
  el.classList.add("error--visible");
}

export function clearError(el: HTMLElement = els.error): void {
  el.textContent = "";
  el.classList.remove("error--visible");
}
