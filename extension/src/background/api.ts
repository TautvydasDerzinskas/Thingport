// Every fetch to the Thingport instance goes through here, so auth (including silent re-login) and
// the instance URL live in one place. The host permission granted at setup bypasses CORS.

import type { LoginResult } from "../shared/api";
import type { Connection } from "../shared/messages";
import { STORAGE_KEYS, apiUrl } from "../shared/storage";
import { isMakerworldUrl } from "../shared/urls";
import { getStoredConfig, isConfigured, type ConfiguredConfig } from "./config";
import { getLiveMakerworldCookie, maybeSyncMakerworldCookie } from "../providers/makerworld/cookie";

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// The instance never asks the extension for a captcha (see captchaService.ts).
const CLIENT_HEADERS = { "X-Thingport-Client": "grab" };

type Credentials = Pick<ConfiguredConfig, "instanceUrl" | "email" | "password" | "connectionToken">;

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string } | null;
    if (body && body.detail) return body.detail;
  } catch {}
  return fallback;
}

/** The instance turned the saved email/password down (401/403), as opposed to not answering. */
export class LoginRejectedError extends Error {
  /** The instance's own message, without advice added for where it's shown. */
  constructor(
    message: string,
    readonly detail = message,
  ) {
    super(message);
  }
}

// A JWT outlives a password change, so only signing in proves the saved password still works.
const CONNECTION_RECHECK_MS = 10 * 60 * 1000;

/** A provider session or Thingport token must not be replayed to a redirect target. */
export async function fetchInstance(url: string, init: RequestInit): Promise<Response> {
  // Browsers hide redirect targets behind opaqueredirect, even for same-origin redirects.
  // Require the configured final URL instead of replaying credentials to any redirect.
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.type === "opaqueredirect" || [301, 302, 303, 307, 308].includes(res.status)) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error("Thingport instance redirected a credential-bearing request; configure its final URL");
  }
  return res;
}

/** Mirrored on the toolbar icon, so a broken connection shows before the user reaches a provider. */
function setConnectionBadge(connected: boolean): void {
  void chrome.action.setBadgeText({ text: connected ? "" : "!" }).catch(() => undefined);
  if (!connected) void chrome.action.setBadgeBackgroundColor({ color: "#d32f2f" }).catch(() => undefined);
}

/** Also called once on a 401, so a password change doesn't require reopening the popup. A connection made by
 *  approval trades its token for a session instead. */
export async function loginAndStoreToken(credentials: Credentials): Promise<string> {
  const res = await fetchInstance(
    apiUrl(credentials.instanceUrl, credentials.connectionToken ? "/grab/session" : "/login"),
    {
      method: "POST",
      headers: { ...CLIENT_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(
        credentials.connectionToken
          ? { connection_token: credentials.connectionToken }
          : { email: credentials.email, password: credentials.password },
      ),
    },
  );
  if (!res.ok) {
    const detail = await errorDetail(res, `Could not sign in to this Thingport instance (${res.status})`);
    throw res.status === 401 || res.status === 403 ? new LoginRejectedError(detail) : new Error(detail);
  }
  const data = (await res.json()) as LoginResult;
  const tokenExpiresAt = Date.now() + data.expires_in * 1000;
  const isAdmin = data.user?.role === "ADMIN";
  // isAdmin is a config key: rewriting it re-initializes every open provider tab.
  const stored = await getStoredConfig();
  await chrome.storage.local.set({
    token: data.token,
    tokenExpiresAt,
    loginVerifiedAt: Date.now(),
    ...(stored.isAdmin === isAdmin ? {} : { isAdmin }),
  });
  setConnectionBadge(true);
  return data.token;
}

/** Stores what a connection by approval was given, replacing any saved password. */
export async function storeApprovedConnection(
  instanceUrl: string,
  connectionToken: string,
  data: LoginResult,
): Promise<void> {
  await chrome.storage.local.set({
    instanceUrl,
    email: data.user?.email ?? "",
    connectionToken,
    token: data.token,
    tokenExpiresAt: Date.now() + data.expires_in * 1000,
    loginVerifiedAt: Date.now(),
    isAdmin: data.user?.role === "ADMIN",
    disabled: false,
  });
  await chrome.storage.local.remove([STORAGE_KEYS.password, STORAGE_KEYS.pendingPairing]);
  setConnectionBadge(true);
}

// Shared, so a burst of calls with an expired token signs in once rather than once per call.
let pendingLogin: Promise<string> | null = null;

export async function ensureToken(config: ConfiguredConfig, { forceRefresh = false } = {}): Promise<string> {
  if (
    !forceRefresh &&
    config.token &&
    config.tokenExpiresAt &&
    config.tokenExpiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS
  ) {
    return config.token;
  }
  pendingLogin ??= loginAndStoreToken(config)
    .catch((err: unknown) => {
      void chrome.storage.local.remove(STORAGE_KEYS.loginVerifiedAt);
      setConnectionBadge(false);
      // A silent re-login has no form to show the error next to, so say where to fix it.
      if (err instanceof LoginRejectedError) {
        throw new LoginRejectedError(
          config.connectionToken
            ? `Thingport no longer accepts this browser's Thingport Grab (${err.message}). ` +
                "Open the extension popup, click the instance and connect again."
            : `Thingport rejected the email or password saved in Thingport Grab (${err.message}). ` +
                "Open the extension popup, click the instance and sign in again.",
          err.detail,
        );
      }
      throw err;
    })
    .finally(() => {
      pendingLogin = null;
    });
  return pendingLogin;
}

/** Signs in at most every few minutes; a failed check isn't remembered, so the next one retries. */
export async function checkConnection(): Promise<Connection> {
  const config = await getStoredConfig();
  if (!isConfigured(config) || config.disabled) {
    setConnectionBadge(true);
    return { connected: true };
  }
  // Credentials only change through saveConfig, which signs in and so resets this.
  if (config.loginVerifiedAt && Date.now() - config.loginVerifiedAt < CONNECTION_RECHECK_MS) return { connected: true };
  try {
    await ensureToken(config, { forceRefresh: true });
    return { connected: true };
  } catch (err) {
    const detail = err instanceof LoginRejectedError ? err.detail : err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      reason: err instanceof LoginRejectedError ? "credentials" : "unreachable",
      detail,
      byApproval: Boolean(config.connectionToken),
    };
  }
}

export async function requireConfig(): Promise<ConfiguredConfig> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) throw new Error("Thingport Grab isn't configured yet -- open the extension popup first.");
  if (config.disabled) throw new Error("Thingport Grab is disabled -- re-enable it from the extension popup.");
  return config;
}

/** `path` is after `/api`. MakerWorld `/import*` calls get the live browser cookie attached unless
 *  the caller set one. */
export async function apiCall<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const config = await requireConfig();

  let finalBody = body as Record<string, unknown> | undefined;
  // The browser's own MakerWorld cookie, on any import of a MakerWorld link: the backend imports MakerWorld's models by
  // the shared link import (its LINK_PROVIDER), which reads the cookie from the request. Here, as every call to the
  // instance passes through, rather than in providers/makerworld/.
  if (
    path.startsWith("/import") &&
    finalBody &&
    !finalBody.makerworld_cookie &&
    isMakerworldUrl(finalBody.url as string)
  ) {
    const liveCookie = await getLiveMakerworldCookie();
    if (liveCookie) {
      finalBody = { ...finalBody, makerworld_cookie: liveCookie };
      void maybeSyncMakerworldCookie(config, liveCookie);
    }
  }

  const doFetch = (token: string) =>
    fetchInstance(apiUrl(config.instanceUrl, path), {
      method,
      headers: {
        ...CLIENT_HEADERS,
        Authorization: `Bearer ${token}`,
        ...(finalBody ? { "Content-Type": "application/json" } : {}),
      },
      body: finalBody ? JSON.stringify(finalBody) : undefined,
    });

  let res = await doFetch(await ensureToken(config));
  if (res.status === 401) res = await doFetch(await ensureToken(config, { forceRefresh: true }));
  if (!res.ok) throw new Error(await errorDetail(res, `Request failed (${res.status})`));
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

export async function apiFetchBlob(config: ConfiguredConfig, path: string): Promise<Blob | null> {
  const res = await fetchInstance(apiUrl(config.instanceUrl, path), {
    headers: { ...CLIENT_HEADERS, Authorization: `Bearer ${await ensureToken(config)}` },
  });
  return res.ok ? res.blob() : null;
}

// Everything tied to the connection or the account it signs in as. Offline features and recently viewed models stay; recent imports are kept per account, so they come back on reconnecting.
const CONNECTION_KEYS = [
  STORAGE_KEYS.instanceUrl,
  STORAGE_KEYS.email,
  STORAGE_KEYS.password,
  STORAGE_KEYS.connectionToken,
  STORAGE_KEYS.pendingPairing,
  STORAGE_KEYS.disabled,
  STORAGE_KEYS.isAdmin,
  STORAGE_KEYS.token,
  STORAGE_KEYS.tokenExpiresAt,
  STORAGE_KEYS.loginVerifiedAt,
  STORAGE_KEYS.lastSyncedMakerworldCookie,
  STORAGE_KEYS.lastSyncedSessions,
  STORAGE_KEYS.lastSentProviderAccounts,
  STORAGE_KEYS.lastPrintablesPushAt,
  STORAGE_KEYS.lastPrintablesLikesAt,
  STORAGE_KEYS.printablesPlanHandedOutAt,
];

/** Tells the instance, as far as it answers, then forgets the connection here. `approvalKept`: a connection made by
 *  approval the instance didn't remove (it's older, or didn't answer), still listed in the user's Thingport profile. */
export async function disconnect(): Promise<{ approvalKept: boolean }> {
  const config = await getStoredConfig();
  let approvalKept = false;
  if (config.instanceUrl) {
    const post = (path: string, init: RequestInit = {}) =>
      fetchInstance(apiUrl(config.instanceUrl!, path), {
        method: "POST",
        ...init,
        headers: { ...CLIENT_HEADERS, "Content-Type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(5000),
      });
    if (config.connectionToken) {
      const res = await post("/grab/disconnect", {
        body: JSON.stringify({ connection_token: config.connectionToken }),
      }).catch(() => null);
      approvalKept = !res?.ok;
    }
    // Ends this session on the instance; it would run out by itself anyway.
    if (config.token) await post("/logout", { headers: { Authorization: `Bearer ${config.token}` } }).catch(() => null);
  }
  await chrome.storage.local.remove(CONNECTION_KEYS);
  setConnectionBadge(true);
  return { approvalKept };
}
