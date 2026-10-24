import type { ConfiguredConfig } from "../../background/config";
import { apiCall } from "../../background/api";
import { MANIFESTS } from "../../shared/providers/_generated";

const { makerworld } = MANIFESTS;

/** The session cookie is HttpOnly, so pages can't read it but chrome.cookies can. Null (never
 *  throws) when the user isn't logged in or access is blocked. */
export async function getLiveMakerworldCookie(): Promise<string | null> {
  try {
    const cookie = await chrome.cookies.get({ url: makerworld.site, name: makerworld.sessionCookies.token });
    if (!cookie) return null;
    // "<name>=<value>": a bare token containing `=` (base64 padding) would be rejected by the backend.
    return `${makerworld.sessionCookies.token}=${cookie.value}`;
  } catch {
    return null;
  }
}

/** Best-effort: keeps the stored cookie in sync so the web app's imports benefit too. Never
 *  affects the triggering import. */
export async function maybeSyncMakerworldCookie(config: ConfiguredConfig, cookieValue: string): Promise<void> {
  if (config.lastSyncedMakerworldCookie === cookieValue) return;
  try {
    await apiCall("PATCH", `/settings/${makerworld.auth[0].legacyEndpoint.path}`, { cookie: cookieValue });
    await chrome.storage.local.set({ lastSyncedMakerworldCookie: cookieValue });
  } catch {}
}
