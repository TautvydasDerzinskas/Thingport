// Connecting to Thingport by approval instead of a saved password, for people who sign in through single sign-on.
// Grab opens Thingport's approval page with the hash of a secret it keeps; once the user approves, the page puts a
// code in its #fragment. Grab sees that on the tab (it has the instance's host permission), trades the code and
// the secret for a connection token, and closes the tab. The code is worthless without the secret.

import type { LoginResult } from "../shared/api";
import { STORAGE_KEYS, apiUrl, normalizeInstanceUrl, type PendingPairing } from "../shared/storage";
import { storeApprovedConnection } from "./api";
import { getStoredConfig } from "./config";

// Long enough to sign in through a provider on the way.
const PAIRING_TTL_MS = 15 * 60 * 1000;

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
  const tab = await chrome.tabs.create({ url: page.href });
  if (tab.id == null) throw new Error("Couldn't open Thingport in a new tab");
  const pending: PendingPairing = { instanceUrl, verifier, tabId: tab.id, startedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingPairing]: pending });
  return null;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string } | null;
    if (body?.detail) return body.detail;
  } catch {}
  return `Thingport answered ${res.status}`;
}

async function claim(pending: PendingPairing, code: string): Promise<void> {
  const res = await fetch(apiUrl(pending.instanceUrl, "/grab/pairings/claim"), {
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
  const { pendingPairing: pending } = await getStoredConfig();
  if (!pending || pending.tabId !== tabId) return;
  if (Date.now() - pending.startedAt > PAIRING_TTL_MS) {
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
  if (!code) return;
  // Taken first, so the same code isn't tried twice by two quick updates.
  await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
  try {
    await claim(pending, code);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  } catch (err) {
    const error = new URL(`${pending.instanceUrl}/connect-grab`);
    error.searchParams.set("error", err instanceof Error ? err.message : String(err));
    await chrome.tabs.update(tabId, { url: error.href }).catch(() => undefined);
  }
}

export async function onPairingTabClosed(tabId: number): Promise<void> {
  const { pendingPairing: pending } = await getStoredConfig();
  if (pending?.tabId === tabId) await chrome.storage.local.remove(STORAGE_KEYS.pendingPairing);
}
