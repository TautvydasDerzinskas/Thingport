import {
  OFFLINE_FEATURE_DEFAULTS,
  STORAGE_KEYS,
  normalizeInstanceUrl,
  offlineFeatureOn,
  type OfflineFeature,
  type StoredConfig,
} from "../shared/storage";
import type { ExtensionState } from "../shared/messages";
import { learnImportQueue, loginAndStoreToken } from "./api";

export async function getStoredConfig(): Promise<StoredConfig> {
  return chrome.storage.local.get(Object.values(STORAGE_KEYS)) as Promise<StoredConfig>;
}

/** Signs in with the password, or with the connection made by approval in Thingport. */
export type ConfiguredConfig = StoredConfig & { instanceUrl: string; email: string };

export function isConfigured(config: StoredConfig): config is ConfiguredConfig {
  return Boolean(config.instanceUrl && config.email && (config.password || config.connectionToken));
}

// Shared, so a burst of tabs opening asks the instance once.
let learningImportQueue: Promise<void> | null = null;

export async function getState(): Promise<ExtensionState> {
  const config = await getStoredConfig();
  // Set up before the role was stored: one login learns it.
  if (isConfigured(config) && config.isAdmin === undefined) {
    await loginAndStoreToken(config)
      .then(async () => Object.assign(config, await getStoredConfig()))
      .catch(() => undefined);
  }
  // Set up before the instance was asked, or it hasn't answered yet. Not waited for: an instance out of reach would
  // hold up the popup and every page, offline features included. Open tabs re-render once it's in storage.
  if (isConfigured(config) && !config.disabled && config.importQueue === undefined) {
    learningImportQueue ??= learnImportQueue(config.instanceUrl, config.instanceUrl).finally(() => {
      learningImportQueue = null;
    });
  }
  const importQueue = config.importQueue === true;
  return {
    configured: isConfigured(config),
    disabled: Boolean(config.disabled),
    canQueue: Boolean(config.isAdmin) || importQueue,
    importQueue,
    instanceUrl: config.instanceUrl || "",
    email: config.email || "",
    connectedByApproval: Boolean(config.connectionToken),
    offlineFeatures: Object.fromEntries(
      (Object.keys(OFFLINE_FEATURE_DEFAULTS) as OfflineFeature[]).map((feature) => [
        feature,
        offlineFeatureOn(config, feature),
      ]),
    ) as Record<OfflineFeature, boolean>,
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

export async function setOfflineFeature(feature: OfflineFeature, enabled: boolean): Promise<null> {
  if (!(feature in OFFLINE_FEATURE_DEFAULTS)) throw new Error(`Unknown feature: ${feature}`);
  await chrome.storage.local.set({ [feature]: Boolean(enabled) });
  return null;
}
