// Connecting to Thingport by approval instead of a saved password, for people who sign in through single sign-on.
// Grab opens Thingport's approval page with the hash of a secret it keeps; once the user approves, the page puts a
// code in its #fragment. Grab sees that on the tab (it has the instance's host permission), trades the code and
// the secret for a connection token, and closes the tab. The code is worthless without the secret.

import type { LoginResult } from "../shared/api";
import { STORAGE_KEYS, apiUrl, normalizeInstanceUrl, pairingFresh, type PendingPairing } from "../shared/storage";
import { fetchInstance, storeApprovedConnection } from "./api";
import { getStoredConfig } from "./config";
import { carryAdaptPicks } from "./adaptSettings";
import { backgroundText } from "./localize";

let resuming: Promise<null> | null = null;
let rerunRequested = false;
let rerunRetries = false;
const claimingTabs = new Set<number>();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** e.g. "Chrome on macOS", so the user can tell their browsers apart in Thingport. */
function browserName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : "Browser";
  const os = /Mac OS X|Macintosh/.test(ua)
    ? "macOS"
    : /Windows/.test(ua)
      ? "Windows"
      : /CrOS/.test(ua)
        ? "ChromeOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

export async function startPairing(rawInstanceUrl: string): Promise<null> {
  const instanceUrl = normalizeInstanceUrl(rawInstanceUrl);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const page = new URL(`${instanceUrl}/connect-grab`);
  page.searchParams.set("challenge", challenge);
  page.searchParams.set("name", browserName());
  // The pending secret must be durable before the approval page can answer.
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  if (tab.id == null) throw new Error(await backgroundText("couldNotOpenThingportTab"));
  const pending: PendingPairing = { instanceUrl, verifier, tabId: tab.id, startedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingPairing]: pending });
  try {
    await chrome.tabs.update(tab.id, { url: page.href, active: true });
  } catch (error) {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
    await chrome.tabs.remove(tab.id).catch(() => undefined);
    throw error;
  }
  return null;
}

/** Resumes after Chrome's permission prompt, even when that prompt destroyed the popup that started it. `retry` is
 *  for the popup's pair button only: it may try again an intent whose tab couldn't be opened, where a browser event
 *  may not, since putting that intent back is itself a storage event. */
export function resumePairingIntent(retry = false): Promise<null> {
  if (resuming) {
    // A permission event can arrive after the active attempt read the old permission state.
    rerunRequested = true;
    rerunRetries ||= retry;
    return resuming;
  }
  resuming = (async () => {
    let retrying = retry;
    do {
      rerunRequested = false;
      await attemptPairingIntentResume(retrying);
      retrying = rerunRetries;
      rerunRetries = false;
    } while (rerunRequested);
    return null;
  })().finally(() => {
    resuming = null;
    rerunRequested = false;
    rerunRetries = false;
  });
  return resuming;
}

/** For chrome.storage.onChanged: the popup saved a new intent before its permission prompt. */
export function onPairingStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void {
  if (area === "local" && changes[STORAGE_KEYS.pairingIntent]?.newValue) {
    void resumePairingIntent().catch(() => undefined);
  }
}

async function attemptPairingIntentResume(retry: boolean): Promise<null> {
  const config = await getStoredConfig();
  const intent = config.pairingIntent;
  if (!intent) return null;
  if (!pairingFresh(intent)) {
    await chrome.storage.local.remove(STORAGE_KEYS.pairingIntent);
    return null;
  }
  if (intent.failed && !retry) return null;
  if (pairingFresh(config.pendingPairing)) {
    await chrome.storage.local.remove(STORAGE_KEYS.pairingIntent);
    return null;
  }
  const origin = new URL(normalizeInstanceUrl(intent.instanceUrl)).origin;
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return null;
  // Consume before opening the tab: permission and storage events can both ask to resume.
  await chrome.storage.local.remove(STORAGE_KEYS.pairingIntent);
  try {
    return await startPairing(intent.instanceUrl);
  } catch (error) {
    // Keep the address for a retry instead of dropping the user's input on another transient browser failure.
    await chrome.storage.local.set({ [STORAGE_KEYS.pairingIntent]: { ...intent, failed: true } });
    throw error;
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string } | null;
    if (body?.detail) return body.detail;
  } catch {}
  return backgroundText("thingportAnswered", { status: res.status });
}

async function claim(pending: PendingPairing, code: string): Promise<void> {
  const res = await fetchInstance(apiUrl(pending.instanceUrl, "/grab/pairings/claim"), {
    method: "POST",
    headers: { "X-Thingport-Client": "grab", "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier: pending.verifier }),
  });
  if (!res.ok) throw new Error(await errorDetail(res));
  const data = (await res.json()) as LoginResult & { connection_token: string };
  await storeApprovedConnection(pending.instanceUrl, data.connection_token, data);
}

/** Watches the approval tab: a code in its #fragment finishes the connection, a cancel drops it. */
export async function onPairingTabUrl(tabId: number, url: string | undefined): Promise<void> {
  if (!url) return;
  if (claimingTabs.has(tabId)) return;
  const { pendingPairing: pending } = await getStoredConfig();
  if (!pending || pending.tabId !== tabId) return;
  if (!pairingFresh(pending)) {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
    return;
  }
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return;
  }
  // Only the instance's own approval page; signing in on the way passes through other pages and sites.
  if (page.origin !== new URL(pending.instanceUrl).origin || page.pathname !== "/connect-grab") return;
  const fragment = new URLSearchParams(page.hash.slice(1));
  if (fragment.get("grab_cancelled")) {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
    return;
  }
  const code = fragment.get("grab_code");
  if (!code || claimingTabs.has(tabId)) return;
  // Chrome can report the same fragment through both its URL and completed-load updates. Claim ownership before
  // the first await so two handlers that already read the same pending value cannot both exchange the code.
  claimingTabs.add(tabId);
  try {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
    await claim(pending, code);
    void carryAdaptPicks();
    await chrome.tabs.remove(tabId).catch(() => undefined);
  } catch (err) {
    const error = new URL(`${pending.instanceUrl}/connect-grab`);
    error.searchParams.set("error", err instanceof Error ? err.message : String(err));
    await chrome.tabs.update(tabId, { url: error.href }).catch(() => undefined);
  } finally {
    claimingTabs.delete(tabId);
  }
}

export async function onPairingTabClosed(tabId: number): Promise<void> {
  const { pendingPairing: pending } = await getStoredConfig();
  if (pending?.tabId === tabId) await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
}
