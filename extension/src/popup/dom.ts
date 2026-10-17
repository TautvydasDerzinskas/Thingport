function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup.html is missing #${id}`);
  return el as T;
}

export const els = {
  instanceRow: byId("instance-row"),
  instanceUrlText: byId("instance-url-text"),
  editInstanceBtn: byId<HTMLButtonElement>("edit-instance-btn"),
  configuredView: byId("configured-view"),
  enabledToggle: byId("enabled-toggle"),
  enabledSwitch: byId<HTMLInputElement>("enabled-switch"),
  recentSection: byId("recent-section"),
  recentGrid: byId("recent-grid"),
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
