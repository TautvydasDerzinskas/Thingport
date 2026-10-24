// Background entry point (service worker in Chrome/Edge, event page in Firefox). Owns config, auth
// and every request to the Thingport instance.

import { listen, type BackgroundMessages } from "../shared/messages";
import { LEGACY_SESSION_KEYS } from "../shared/storage";
import { apiCall, checkConnection, disconnect } from "./api";
import { getState, saveConfig, setDisabled, setOfflineFeature } from "./config";
import { armDownloadCapture, awaitDownloadCapture, disarmDownloadCapture } from "./downloadCapture";
import { importSingle, queueImport } from "./importJobs";
import {
  abortJob,
  advanceJob,
  dropJobIfForTab,
  forceAdvanceJob,
  getJobForTab,
  resumeJob,
  startJob,
} from "./makerworldJob";
import { getPrintablesToken, printablesPushDue, pushPrintables, reportProviderAccount } from "./providerAccounts";
import { getRecentImports } from "./recentImports";
import { seasonalIcon } from "../shared/seasonalIcon";
import { clearRecentlyViewed, getRecentlyViewed, recordViewedModel } from "./recentlyViewed";
import { scheduleSnapmakerRenewal, SNAPMAKER_ALARM } from "./snapmakerSession";
import { syncSession } from "./sessionSync";
import { importMakeronlineModel, runWaitingImports } from "./makeronline";
import { onPairingTabClosed, onPairingTabUrl, startPairing } from "./pairing";
import { openSetup } from "./setup";
import { setTabIconState } from "./tabIcon";
import { injectIntoOpenTabs, OPTIONAL_SITES, siteEnabled, syncSiteScripts } from "../shared/optionalSites";
import { MANIFESTS } from "../shared/providers/_generated";

function senderTabId(sender: chrome.runtime.MessageSender): number {
  if (!sender.tab?.id) throw new Error("This action is only available from a page");
  return sender.tab.id;
}

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
  GET_PRINTABLES_TOKEN: () => getPrintablesToken(),
  REPORT_PROVIDER_ACCOUNT: ({ provider, value }) => reportProviderAccount(provider, value),
  SYNC_PROVIDER_SESSION: ({ provider }) => syncSession(provider),
  IMPORT_MAKERONLINE_MODEL: (payload, sender) => importMakeronlineModel(senderTabId(sender), payload),
  RUN_MAKERONLINE_WAITING: (_payload, sender) => runWaitingImports(senderTabId(sender)),
  PRINTABLES_PUSH_DUE: ({ now }) => printablesPushDue({ now }),
  PUSH_PRINTABLES: (push) => pushPrintables(push),
  OPEN_SETUP: (_payload, sender) => openSetup(sender.tab?.id),
  SET_TAB_ICON_STATE: ({ active }, sender) => setTabIconState(senderTabId(sender), active),
  API_CALL: ({ method, path, body }) => apiCall(method, path, body),
  IMPORT_SINGLE: (payload) => importSingle(payload),
  QUEUE_IMPORT: (payload) => queueImport(payload),
  START_MAKERWORLD_COLLECTION_JOB: (payload, sender) => startJob(senderTabId(sender), payload),
  ABORT_MAKERWORLD_COLLECTION_JOB: (_payload, sender) => abortJob(senderTabId(sender)),
  FORCE_ADVANCE_MAKERWORLD_JOB: (_payload, sender) => forceAdvanceJob(senderTabId(sender)),
  RESUME_MAKERWORLD_JOB: (_payload, sender) => resumeJob(senderTabId(sender)),
  // Not awaited: the step runs for as long as the import takes.
  MAKERWORLD_JOB_STEP_DUE: (_payload, sender) => {
    void advanceJob(senderTabId(sender));
    return null;
  },
  ARM_DOWNLOAD_CAPTURE: () => armDownloadCapture(),
  AWAIT_DOWNLOAD_CAPTURE: () => awaitDownloadCapture(),
  DISARM_DOWNLOAD_CAPTURE: () => disarmDownloadCapture(),
  GET_MAKERWORLD_JOB: (_payload, sender) => getJobForTab(sender.tab?.id),
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // The approval tab's #fragment changing is how Thingport hands back the code; the url is visible because the
  // instance's host permission was granted first.
  void onPairingTabUrl(tabId, changeInfo.url ?? (changeInfo.status === "complete" ? tab.url : undefined));
  // Per-tab icon overrides persist, so reset on every new navigation; the content script re-asserts it.
  if (changeInfo.status === "loading") void setTabIconState(tabId, false);
  // "complete" wakes a suspended background to drive the guided import.
  if (changeInfo.status === "complete") void advanceJob(tabId);
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
  void scheduleSnapmakerRenewal();
});
chrome.permissions.onRemoved.addListener(() => {
  void syncSiteScripts();
  void scheduleSnapmakerRenewal();
});

// Snapmaker's sign-in lasts a day: renewed on a timer too, so syncs keep working on days Snapmaker isn't visited.
void scheduleSnapmakerRenewal();
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SNAPMAKER_ALARM) void syncSession(MANIFESTS.snapmaker.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void dropJobIfForTab(tabId);
  void onPairingTabClosed(tabId);
});
