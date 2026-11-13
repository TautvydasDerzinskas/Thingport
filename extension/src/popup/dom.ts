function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup.html is missing #${id}`);
  return el as T;
}

export const els = {
  headerIcon: byId("header-icon"),
  languagePicker: byId("language-picker"),
  languageSelect: byId<HTMLSelectElement>("language-select"),
  languageTrigger: byId<HTMLButtonElement>("language-trigger"),
  languageValue: byId("language-value"),
  languageList: byId<HTMLUListElement>("language-list"),
  instanceRow: byId("instance-row"),
  instanceLink: byId<HTMLAnchorElement>("instance-link"),
  editInstanceBtn: byId<HTMLButtonElement>("edit-instance-btn"),
  disconnectBtn: byId<HTMLButtonElement>("disconnect-btn"),
  confirmDialog: byId<HTMLDialogElement>("confirm-dialog"),
  confirmTitle: byId("confirm-title"),
  confirmText: byId("confirm-text"),
  confirmCancel: byId<HTMLButtonElement>("confirm-cancel"),
  confirmOk: byId<HTMLButtonElement>("confirm-ok"),
  disconnectedNote: byId("disconnected-note"),
  tabs: byId("tabs"),
  connectTab: byId<HTMLButtonElement>("tab-connect"),
  appearanceTab: byId<HTMLButtonElement>("tab-appearance"),
  offlineTab: byId<HTMLButtonElement>("tab-offline"),
  historyTab: byId<HTMLButtonElement>("tab-history"),
  connectPanel: byId("panel-connect"),
  appearancePanel: byId("panel-appearance"),
  bubbleStyles: byId("bubble-styles"),
  bubblePlaces: byId("bubble-places"),
  bubblePlaceName: byId("bubble-place-name"),
  appearanceError: byId("appearance-error"),
  offlinePanel: byId("panel-offline"),
  historyPanel: byId("panel-history"),
  offlineNote: byId("offline-note"),
  viewedGrid: byId("viewed-grid"),
  viewedEmpty: byId("viewed-empty"),
  viewedClearWrap: byId("viewed-clear-wrap"),
  viewedClear: byId<HTMLButtonElement>("viewed-clear"),
  historyError: byId("history-error"),
  normalizeSwitch: byId<HTMLInputElement>("normalize-switch"),
  // Thingiverse's offline features (providers/thingiverse/index.ts), switched in the popup with the others.
  thingiverseDarkSwitch: byId<HTMLInputElement>("thingiverse-dark-switch"),
  thingiverseAdsSwitch: byId<HTMLInputElement>("thingiverse-ads-switch"),
  offlineError: byId("offline-error"),
  configuredView: byId("configured-view"),
  enabledToggle: byId("enabled-toggle"),
  enabledSwitch: byId<HTMLInputElement>("enabled-switch"),
  recentSection: byId("recent-section"),
  recentGrid: byId("recent-grid"),
  sitesList: byId("sites-list"),
  sitesCount: byId("sites-count"),
  sitesEnableAll: byId<HTMLButtonElement>("sites-enable-all"),
  // The provider whose site the active tab is on, above the rest.
  featured: byId("featured"),
  featuredLogo: byId("featured-logo"),
  featuredName: byId("featured-name"),
  featuredDesc: byId("featured-desc"),
  featuredStatus: byId("featured-status"),
  configuredError: byId("configured-error"),
  setupForm: byId<HTMLFormElement>("setup-form"),
  instanceUrlInput: byId<HTMLInputElement>("instance-url"),
  emailInput: byId<HTMLInputElement>("email"),
  passwordInput: byId<HTMLInputElement>("password"),
  saveBtn: byId<HTMLButtonElement>("save-btn"),
  cancelBtn: byId<HTMLButtonElement>("cancel-btn"),
  pairBtn: byId<HTMLButtonElement>("pair-btn"),
  pairNote: byId("pair-note"),
  pairPending: byId("pair-pending"),
  credentialsToggle: byId("credentials-toggle"),
  credentialsBtn: byId<HTMLButtonElement>("credentials-btn"),
  credentialsBlock: byId("credentials-block"),
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

/** `link`, opening wherever its href points when it's clicked in a new tab, and closing the popup: a plain link click
 *  in a popup isn't guaranteed to open a tab, and the popup should close after. */
export function opensInTab(link: HTMLAnchorElement): HTMLAnchorElement {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: link.href });
    window.close();
  });
  return link;
}
