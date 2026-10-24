// What only the signed-in user sees on Printables, read in the page (content.ts) and pushed to the instance from here.

import type { BackgroundMessages, Handlers, PrintablesPush, PrintablesPushPlan } from "../../shared/messages";
import { STORAGE_KEYS } from "../../shared/storage";
import { apiCall, requireConfig } from "../../background/api";
import { MANIFESTS } from "../../shared/providers/_generated";

const { printables } = MANIFESTS;

/** HttpOnly, so the page can't read it but chrome.cookies can. Null (never throws) when signed out. */
export async function getPrintablesToken(): Promise<string | null> {
  try {
    const cookie = await chrome.cookies.get({ url: printables.site, name: printables.sessionCookies.token });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

const PRINTABLES_PUSH_INTERVAL_MS = 60 * 60 * 1000;
// Likes have no count of their own: reading one means reading every page. Unsynced, they're read
// this seldom, only to keep their tile in the web app's Browse tab current.
const UNSYNCED_LIKES_INTERVAL_MS = 24 * 60 * 60 * 1000;
// What the instance asks for when the user's Printables likes are synced (see wantedPrintablesListings).
const LIKES_KEY = "likes";

// A plan handed to one tab holds off the others until its push arrives, or this long passes (that
// tab may have been closed mid-read). Two tabs reading at once would double the requests. Kept in
// storage: the background can be stopped and started again between the plan and its push.
const PUSH_PLAN_HOLD_MS = 10 * 60 * 1000;

/** What to read now, when a push is due; null when it isn't, or the instance predates pushes. */
export async function printablesPushDue({ now = false } = {}): Promise<PrintablesPushPlan | null> {
  const config = await requireConfig().catch(() => null);
  if (!config) return null;
  const handedOut = config.printablesPlanHandedOutAt;
  if (!now && handedOut && Date.now() - handedOut < PUSH_PLAN_HOLD_MS) return null;
  const last = config.lastPrintablesPushAt;
  if (!now && last && Date.now() - last < PRINTABLES_PUSH_INTERVAL_MS) return null;
  try {
    const { keys } = await apiCall<{ keys: string[] }>("GET", `/provider-collections/${printables.id}/wanted`);
    const likesRead = config.lastPrintablesLikesAt;
    const likes = keys.includes(LIKES_KEY) || !likesRead || Date.now() - likesRead >= UNSYNCED_LIKES_INTERVAL_MS;
    await chrome.storage.local.set({ [STORAGE_KEYS.printablesPlanHandedOutAt]: Date.now() });
    return { wanted: keys, likes };
  } catch {
    return null;
  }
}

export async function pushPrintables(push: PrintablesPush): Promise<null> {
  await chrome.storage.local.remove(STORAGE_KEYS.printablesPlanHandedOutAt);
  try {
    await apiCall("PUT", `/provider-collections/${printables.id}/push`, push);
    const now = Date.now();
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastPrintablesPushAt]: now,
      ...(push.likes ? { [STORAGE_KEYS.lastPrintablesLikesAt]: now } : {}),
    });
  } catch {}
  return null;
}

export const printablesHandlers: Partial<Handlers<BackgroundMessages>> = {
  GET_PRINTABLES_TOKEN: () => getPrintablesToken(),
  PRINTABLES_PUSH_DUE: ({ now }) => printablesPushDue({ now }),
  PUSH_PRINTABLES: (push) => pushPrintables(push),
};
