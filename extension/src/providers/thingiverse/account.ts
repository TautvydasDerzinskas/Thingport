// Who the user is signed in as on Thingiverse, read on its pages for the web app's Browse tab.

import { sleep } from "../../content/runtime";
import { send } from "../../shared/messages";
import { MANIFESTS } from "../../shared/providers/_generated";

// The header is drawn after load; give up quietly if it never shows (e.g. signed out).
const HEADER_WAIT_MS = 15_000;
const HEADER_POLL_MS = 500;

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

export function captureThingiverseAccount(): void {
  void readThingiverseUsername().then((value) => {
    if (value) void send("REPORT_PROVIDER_ACCOUNT", { provider: MANIFESTS.thingiverse.id, value });
  });
}
