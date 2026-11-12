// Download adapted on a model page, where the site's files can be adapted and Adapt 3MFs is on: the copies the
// settings ask for, less those the site's files don't need, beside the site's own button (button.ts) or in Grab's
// bubble (rows.ts), as the settings say.

import { request, type AdaptOffer } from "../../shared/messages";
import type { AdaptTarget } from "../../shared/adaptTargets";
import { MAKERWORLD_ADAPT } from "../../providers/makerworld/adaptSite";
import type { ProviderId } from "../../providers/index.generated";
import { copiesFor } from "./offer";
import type { AdaptSite } from "./site";

export { mountAdaptedButton, unmountAdaptedButton } from "./button";
export { adaptedReveal, mountAdaptBubble } from "./rows";

const SITES: Partial<Record<ProviderId, AdaptSite>> = { makerworld: MAKERWORLD_ADAPT };

/** What a page offers: its site, the copies it gets, and the settings' place for the button. */
export type PageAdapt = { site: AdaptSite; targets: AdaptTarget[]; offer: AdaptOffer };

/** Null where Download adapted has nothing for the page: a site it doesn't work on, or no copy the files need. */
export async function loadPageAdapt(provider: ProviderId): Promise<PageAdapt | null> {
  const site = SITES[provider];
  if (!site) return null;
  const offer = await request("GET_ADAPT_OFFER").catch(() => null);
  if (!offer) return null;
  const targets = copiesFor(site, offer.targets);
  return targets.length ? { site, targets, offer } : null;
}
