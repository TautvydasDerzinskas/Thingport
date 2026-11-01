// chrome.storage.local keys and their shapes. Nothing is synced across browsers.

import type { ProviderId } from "../providers/index.generated";

export const STORAGE_KEYS = {
  instanceUrl: "instanceUrl",
  email: "email",
  password: "password",
  // Set instead of the password when the user connected by approving Grab in Thingport (single sign-on users
  // may have no password). Traded for sessions at /grab/session.
  connectionToken: "connectionToken",
  // A connection by approval in progress: the secret it proves itself with, and the tab it opened.
  pendingPairing: "pendingPairing",
  disabled: "disabled",
  // The popup's Offline features (see OFFLINE_FEATURE_DEFAULTS); unset means the default.
  normalizeMakerworld: "normalizeMakerworld",
  thingiverseDark: "thingiverseDark",
  thingiverseHideAds: "thingiverseHideAds",
  // From the last login: admins get "Add to the queue" in the import panel.
  isAdmin: "isAdmin",
  // Whether the instance gives everyone an import queue of their own, as its health check said at the last sign-in:
  // everyone gets "Add to the queue" there. Unset until it has answered.
  importQueue: "importQueue",
  token: "token",
  tokenExpiresAt: "tokenExpiresAt",
  // Last successful sign-in; the connection check signs in again once it's a few minutes old.
  loginVerifiedAt: "loginVerifiedAt",
  // Lets the cookie sync skip a redundant PATCH.
  // Providers' own keys are listed here with the others: storage is one namespace, and the popup clears it whole.
  lastSyncedMakerworldCookie: "lastSyncedMakerworldCookie",
  // Each provider's sign-in last sent, and to which Thingport account (see background/sessionSync.ts).
  lastSyncedSessions: "lastSyncedSessions",
  // The Printables and Thingiverse usernames last sent to the instance, so unchanged ones aren't.
  lastSentProviderAccounts: "lastSentProviderAccounts",
  // When Printables' lists were last read and sent, so a burst of page loads reads them once.
  lastPrintablesPushAt: "lastPrintablesPushAt",
  // When every page of the user's Printables likes was last read (see printablesPushDue).
  lastPrintablesLikesAt: "lastPrintablesLikesAt",
  // When a tab was last told to read Printables, so others hold off meanwhile.
  printablesPlanHandedOutAt: "printablesPlanHandedOutAt",
  // The provider site each open tab is on (see background/providerTab.ts).
  providerTab: "providerTab",
} as const;

export type StoredConfig = {
  instanceUrl?: string;
  email?: string;
  password?: string;
  connectionToken?: string;
  pendingPairing?: PendingPairing;
  disabled?: boolean;
  normalizeMakerworld?: boolean;
  thingiverseDark?: boolean;
  thingiverseHideAds?: boolean;
  isAdmin?: boolean;
  importQueue?: boolean;
  token?: string;
  tokenExpiresAt?: number;
  loginVerifiedAt?: number;
  lastSyncedMakerworldCookie?: string;
  /** `account` is the Thingport instance and email it was sent to. */
  lastSyncedSessions?: Partial<Record<ProviderId, { account: string; value: string }>>;
  /** `account` is the Thingport instance and email they were sent to. */
  lastSentProviderAccounts?: { account: string; values: Record<string, string> };
  lastPrintablesPushAt?: number;
  lastPrintablesLikesAt?: number;
  printablesPlanHandedOutAt?: number;
  providerTab?: ProviderTabs;
};

/** Which provider's site each tab is on, by tab id, as their content scripts reported. */
export type ProviderTabs = Partial<Record<number, ProviderId>>;

/** What works without a Thingport instance, and whether each is on until the user says otherwise. */
export const OFFLINE_FEATURE_DEFAULTS = {
  // The "Download normalized" button on MakerWorld.
  normalizeMakerworld: true,
  // Restyles Thingiverse, which has no dark theme of its own, while the system theme is dark.
  thingiverseDark: true,
  // Hides the ads on Thingiverse's pages.
  thingiverseHideAds: true,
} as const;

export type OfflineFeature = keyof typeof OFFLINE_FEATURE_DEFAULTS;

export function offlineFeatureOn(config: StoredConfig, feature: OfflineFeature): boolean {
  return config[feature] ?? OFFLINE_FEATURE_DEFAULTS[feature];
}

export type PendingPairing = { instanceUrl: string; verifier: string; tabId: number; startedAt: number };

/** Where each sign-in sent was remembered before lastSyncedSessions; dropped on update, so each is sent once more. */
export const LEGACY_SESSION_KEYS = [
  "lastSyncedMyminifactorySession",
  "lastSyncedSnapmakerToken",
  "lastSyncedMakeronlineToken",
  "lastSyncedCrealitycloudSession",
  "lastSyncedNexprintSession",
  "lastSyncedThangsSession",
  "lastSyncedCults3dSession",
];

export const CONFIG_CHANGE_KEYS: readonly string[] = [
  STORAGE_KEYS.instanceUrl,
  STORAGE_KEYS.email,
  STORAGE_KEYS.password,
  STORAGE_KEYS.connectionToken,
  STORAGE_KEYS.disabled,
  STORAGE_KEYS.normalizeMakerworld,
  STORAGE_KEYS.isAdmin,
  STORAGE_KEYS.importQueue,
];

export function normalizeInstanceUrl(raw: string | undefined | null): string {
  return (raw || "").trim().replace(/\/+$/, "");
}

export function apiUrl(instanceUrl: string, path: string): string {
  return `${normalizeInstanceUrl(instanceUrl)}/api${path}`;
}
