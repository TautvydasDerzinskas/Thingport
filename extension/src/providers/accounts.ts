// What a page of each provider's sends the background, once per tab (content/providerAccount.ts): its sign-in, or who
// the user is there. Only the signed-in account: these pages link to plenty of other people's profiles too.

import { send } from "../shared/messages";
import type { ProviderId } from "./index.generated";
import { cults3dSignedIn } from "./cults3d/content";
import { syncMakeronline } from "./makeronline/content";
import { captureMyminifactoryAccount } from "./myminifactory/account";
import { syncPrintables } from "./printables/content";
import { captureThingiverseAccount } from "./thingiverse/account";

function syncSession(provider: ProviderId): void {
  void send("SYNC_PROVIDER_SESSION", { provider });
}

/** What a page of each provider's sends on, once per tab. */
export const CAPTURE: Partial<Record<ProviderId, (id: ProviderId) => void>> = {
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
  myminifactory: captureMyminifactoryAccount,
  thingiverse: captureThingiverseAccount,
};
