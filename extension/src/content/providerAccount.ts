// Reads who the user is signed in as on the provider's site, once per tab, and tells the background (see
// background/providerAccounts.ts). Only the signed-in account: these pages link to
// plenty of other people's profiles too.

import { request, send } from "../shared/messages";
import { MANIFESTS, PROVIDER_IDS, type ProviderId, URLS } from "../shared/providers/_generated";
import { printablesToken, readMe, readPrintables } from "./printables";
import { providerEnabled } from "./providerSettings";
import { sleep } from "./runtime";
import { cults3dSignedIn } from "./cults3d";

// The header is drawn after load; give up quietly if it never shows (e.g. signed out).
const HEADER_WAIT_MS = 15_000;
const HEADER_POLL_MS = 500;
const TOKEN_WAIT_MS = 30_000;
const TOKEN_POLL_MS = 2_000;

let captured = false;

/** Thingiverse's header avatar links to the signed-in user's designs: /<username>/designs. */
async function readThingiverseUsername(): Promise<string | null> {
  for (let waited = 0; waited < HEADER_WAIT_MS; waited += HEADER_POLL_MS) {
    const link = document.querySelector<HTMLAnchorElement>('[class*="PageHeader__pageHeader"] a[href$="/designs"]');
    const username = link?.getAttribute("href")?.split("/").find(Boolean);
    if (username) return decodeURIComponent(username);
    await sleep(HEADER_POLL_MS);
  }
  return null;
}

/** MyMiniFactory renders its top menu from data in the page, which names the signed-in user;
 *  `userDetails` is null when signed out. */
function readMyminifactoryUsername(): string | null {
  try {
    const data = document.querySelector('[data-component-name="TopMenu"]')?.textContent;
    const user = data ? (JSON.parse(data) as { userDetails?: { username?: unknown } | null }).userDetails : null;
    return typeof user?.username === "string" && user.username.trim() ? user.username.trim() : null;
  } catch {
    return null;
  }
}

/** Reads and sends what only the user sees on Printables, when it's time (or `now`). */
async function pushPrintables(
  token: string,
  me: { id: string; handle: string },
  { now = false, listings = {} }: { now?: boolean; listings?: Record<string, string[]> } = {},
): Promise<void> {
  try {
    const plan = await request("PRINTABLES_PUSH_DUE", { now });
    if (!plan) return;
    const push = await readPrintables(token, me, plan);
    await request("PUSH_PRINTABLES", { ...push, listings: { ...push.listings, ...listings } });
  } catch {}
}

/** Right away, with the models of a collection whose sync was just turned on on its page: the
 *  instance can't have asked for them yet, and would otherwise wait for the next visit to read it. */
export async function pushPrintablesNow(collectionId: string, modelIds: string[]): Promise<void> {
  const token = await printablesToken();
  const me = token ? await readMe(token).catch(() => null) : null;
  if (token && me) await pushPrintables(token, me, { now: true, listings: { [collectionId]: modelIds } });
}

/** At most hourly, what only the signed-in user sees on Printables: private collections and likes,
 *  for syncing them (see printables.ts). The push names the account too: reported on its own, it
 *  would link an account the user forgot in the app again. */
async function syncPrintables(): Promise<void> {
  // The token lasts minutes; the site renews an expired one only after it loads, so keep asking.
  for (let waited = 0; waited < TOKEN_WAIT_MS; waited += TOKEN_POLL_MS) {
    const token = await printablesToken();
    const me = token ? await readMe(token).catch(() => null) : null;
    if (token && me) return pushPrintables(token, me);
    await sleep(TOKEN_POLL_MS);
  }
}

/** Sends the MakerOnline sign-in on, then imports what waits for Grab: this page can sign its files. */
async function syncMakeronline(): Promise<void> {
  if (!(await providerEnabled(MANIFESTS.makeronline.id))) return;
  const { userId } = await request("SYNC_PROVIDER_SESSION", { provider: MANIFESTS.makeronline.id }).catch(() => ({
    userId: null,
  }));
  if (userId) await send("RUN_MAKERONLINE_WAITING");
}

/** What a page of each provider's sends on, once per tab. */
const CAPTURE: Partial<Record<ProviderId, (id: ProviderId) => void>> = {
  makeronline: () => void syncMakeronline(),
  // Its sign-in downloads the files and reads the likes; a new one comes with each sign-in there.
  crealitycloud: syncSession,
  // Its sign-in downloads the files; the site renews it as it refreshes the token, and each new one is sent on.
  nexprint: syncSession,
  // Its sign-in and Cloudflare clearance open the order and download pages; sent once they change, and only from a
  // signed-in page.
  cults3d: (id) => {
    if (cults3dSignedIn()) syncSession(id);
  },
  // Its sign-in downloads the files; Thingport renews it from the refresh token, so it's sent once it changes.
  thangs: syncSession,
  // Its sign-in downloads the files, and lasts a day: kept fresh by the background, and sent on.
  snapmaker: syncSession,
  printables: () => void syncPrintables(),
  myminifactory: (id) => {
    const value = readMyminifactoryUsername();
    if (!value) return;
    void send("REPORT_PROVIDER_ACCOUNT", { provider: MANIFESTS.myminifactory.id, value });
    // Signed in: its session downloads the paid and login-only models in the user's library.
    syncSession(id);
  },
  thingiverse: () =>
    void readThingiverseUsername().then((value) => {
      if (value) void send("REPORT_PROVIDER_ACCOUNT", { provider: MANIFESTS.thingiverse.id, value });
    }),
};

function syncSession(provider: ProviderId): void {
  void send("SYNC_PROVIDER_SESSION", { provider });
}

export function captureProviderAccount(hostname: string): void {
  if (captured) return;
  const provider = PROVIDER_IDS.find((id) => URLS[id].isHost(hostname));
  const capture = provider && CAPTURE[provider];
  if (!capture) return;
  captured = true;
  capture(provider);
}
