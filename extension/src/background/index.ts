// Background entry point (service worker in Chrome/Edge, event page in Firefox). Owns config, auth
// and every request to the Thingport instance.

import { listen, senderTabId, type BackgroundMessages } from "../shared/messages";
import { LEGACY_SESSION_KEYS } from "../shared/storage";
import { apiCall, checkConnection, disconnect } from "./api";
import { getState, saveConfig, setDisabled, setOfflineFeature } from "./config";
import { armDownloadCapture, awaitDownloadCapture, disarmDownloadCapture } from "./downloadCapture";
import { importSingle, queueImport } from "./importJobs";
import {
  onProviderAlarm,
  onProvidersWake,
  onProviderTabClosed,
  onProviderTabLoaded,
  PROVIDER_HANDLERS,
} from "../providers/background";
import { reportProviderAccount } from "./providerAccounts";
import { getRecentImports } from "./recentImports";
import { seasonalIcon } from "../shared/seasonalIcon";
import { clearRecentlyViewed, getRecentlyViewed, recordViewedModel } from "./recentlyViewed";
import { syncSession } from "./sessionSync";
import { onPairingTabClosed, onPairingTabUrl, startPairing } from "./pairing";
import { openSetup } from "./setup";
import { setTabIconState } from "./tabIcon";
import { injectIntoOpenTabs, OPTIONAL_SITES, siteEnabled, syncSiteScripts } from "../shared/optionalSites";

listen<BackgroundMessages>({
  GET_STATE: () => getState(),
  SAVE_CONFIG: (payload) => saveConfig(payload),
  SET_DISABLED: ({ disabled }) => setDisabled(disabled),
  DISCONNECT: () => disconnect(),
  SET_OFFLINE_FEATURE: ({ feature, enabled }) => setOfflineFeature(feature, enabled),
  START_PAIRING: ({ instanceUrl }) => startPairing(instanceUrl),
  GET_RECENT_IMPORTS: () => getRecentImports(),
  GET_SEASONAL_ICON: () => seasonalIcon(),
  RECORD_VIEWED_MODEL: (model) => recordViewedModel(model),
  GET_RECENTLY_VIEWED: () => getRecentlyViewed(),
  CLEAR_RECENTLY_VIEWED: () => clearRecentlyViewed(),
  CHECK_CONNECTION: () => checkConnection(),
  REPORT_PROVIDER_ACCOUNT: ({ provider, value }) => reportProviderAccount(provider, value),
  SYNC_PROVIDER_SESSION: ({ provider }) => syncSession(provider),
  OPEN_SETUP: (_payload, sender) => openSetup(sender.tab?.id),
  SET_TAB_ICON_STATE: ({ active }, sender) => setTabIconState(senderTabId(sender), active),
  API_CALL: ({ method, path, body }) => apiCall(method, path, body),
  IMPORT_SINGLE: (payload) => importSingle(payload),
  QUEUE_IMPORT: (payload) => queueImport(payload),
  ARM_DOWNLOAD_CAPTURE: () => armDownloadCapture(),
  AWAIT_DOWNLOAD_CAPTURE: () => awaitDownloadCapture(),
  DISARM_DOWNLOAD_CAPTURE: () => disarmDownloadCapture(),
  ...PROVIDER_HANDLERS,
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // The approval tab's #fragment changing is how Thingport hands back the code; the url is visible because the
  // instance's host permission was granted first.
  void onPairingTabUrl(tabId, changeInfo.url ?? (changeInfo.status === "complete" ? tab.url : undefined));
  // Per-tab icon overrides persist, so reset on every new navigation; the content script re-asserts it.
  if (changeInfo.status === "loading") void setTabIconState(tabId, false);
  if (changeInfo.status === "complete") onProviderTabLoaded(tabId);
});

// Before the user reaches a provider page, so the toolbar badge already shows a broken connection.
chrome.runtime.onStartup.addListener(() => void checkConnection());
chrome.runtime.onInstalled.addListener(() => {
  void checkConnection();
  void chrome.storage.local.remove(LEGACY_SESSION_KEYS);
});

// Optional sites: on every wake (a Firefox event page loses its registrations with the browser session), and
// whenever access is granted or taken back, from the popup or the browser's own settings. Tabs already open on a
// site get Grab straight away; it doesn't run twice in one.
void syncSiteScripts();
chrome.permissions.onAdded.addListener(() => {
  void syncSiteScripts().then(async () => {
    for (const site of OPTIONAL_SITES) if (await siteEnabled(site)) await injectIntoOpenTabs(site);
  });
  onProvidersWake();
});
chrome.permissions.onRemoved.addListener(() => {
  void syncSiteScripts();
  onProvidersWake();
});

onProvidersWake();
chrome.alarms.onAlarm.addListener((alarm) => onProviderAlarm(alarm.name));

chrome.tabs.onRemoved.addListener((tabId) => {
  onProviderTabClosed(tabId);
  void onPairingTabClosed(tabId);
});
