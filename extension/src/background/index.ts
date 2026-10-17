// Background entry point (service worker in Chrome/Edge, event page in Firefox). Owns config, auth
// and every request to the Thingport instance.

import { listen, type BackgroundMessages } from "../shared/messages";
import { apiCall, checkConnection } from "./api";
import { getState, saveConfig, setDisabled } from "./config";
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
import { onPairingTabClosed, onPairingTabUrl, startPairing } from "./pairing";
import { openSetup } from "./setup";
import { setTabIconState } from "./tabIcon";

function senderTabId(sender: chrome.runtime.MessageSender): number {
  if (!sender.tab?.id) throw new Error("This action is only available from a page");
  return sender.tab.id;
}

listen<BackgroundMessages>({
  GET_STATE: () => getState(),
  SAVE_CONFIG: (payload) => saveConfig(payload),
  SET_DISABLED: ({ disabled }) => setDisabled(disabled),
  START_PAIRING: ({ instanceUrl }) => startPairing(instanceUrl),
  GET_RECENT_IMPORTS: () => getRecentImports(),
  CHECK_CONNECTION: () => checkConnection(),
  GET_PRINTABLES_TOKEN: () => getPrintablesToken(),
  REPORT_PROVIDER_ACCOUNT: ({ provider, value }) => reportProviderAccount(provider, value),
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
chrome.runtime.onInstalled.addListener(() => void checkConnection());

chrome.tabs.onRemoved.addListener((tabId) => {
  void dropJobIfForTab(tabId);
  void onPairingTabClosed(tabId);
});
