import { STORAGE_KEYS, normalizeInstanceUrl, type StoredConfig } from "../shared/storage";
import type { ExtensionState } from "../shared/messages";
import { loginAndStoreToken } from "./api";

export async function getStoredConfig(): Promise<StoredConfig> {
  return chrome.storage.local.get(Object.values(STORAGE_KEYS)) as Promise<StoredConfig>;
}

/** Signs in with the password, or with the connection made by approval in Thingport. */
export type ConfiguredConfig = StoredConfig & { instanceUrl: string; email: string };

export function isConfigured(config: StoredConfig): config is ConfiguredConfig {
  return Boolean(config.instanceUrl && config.email && (config.password || config.connectionToken));
}

export async function getState(): Promise<ExtensionState> {
  const config = await getStoredConfig();
  // Set up before the role was stored: one login learns it.
  if (isConfigured(config) && config.isAdmin === undefined) {
    await loginAndStoreToken(config)
      .then(async () => Object.assign(config, await getStoredConfig()))
      .catch(() => undefined);
  }
  return {
    configured: isConfigured(config),
    disabled: Boolean(config.disabled),
    isAdmin: Boolean(config.isAdmin),
    instanceUrl: config.instanceUrl || "",
    email: config.email || "",
    connectedByApproval: Boolean(config.connectionToken),
  };
}

// The popup requests the host permission itself: it needs the submit's user gesture.
export async function saveConfig({
  instanceUrl,
  email,
  password,
}: {
  instanceUrl: string;
  email: string;
  password: string;
}): Promise<null> {
  const normalized = normalizeInstanceUrl(instanceUrl);
  // Validate before persisting.
  await loginAndStoreToken({ instanceUrl: normalized, email, password });
  await chrome.storage.local.set({ instanceUrl: normalized, email, password, disabled: false });
  // The password replaces a connection made by approval; that one stays listed in Thingport until removed there.
  await chrome.storage.local.remove([STORAGE_KEYS.connectionToken, STORAGE_KEYS.pendingPairing]);
  return null;
}

export async function setDisabled(disabled: boolean): Promise<null> {
  await chrome.storage.local.set({ disabled: Boolean(disabled) });
  return null;
}
