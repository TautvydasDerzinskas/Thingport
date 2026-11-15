// Download adapted on a model page, where the site's files can be adapted and Adapt 3MFs is on: the copies the
// settings ask for, less those the site's files don't need, beside the site's own button (button.ts) or in Grab's
// bubble (rows.ts), as the settings say.

import { request } from "../../shared/messages";
import type { ProviderId } from "../../providers/index.generated";
import { copiesFor } from "./offer";
import type { PageAdapt } from "./site";
import { ADAPT_SITES } from "./sites";

export { mountAdaptedButton, unmountAdaptedButton } from "./button";
export { adaptedReveal, mountAdaptBubble } from "./rows";
export type { PageAdapt } from "./site";

/** Null where Download adapted has nothing for the page: a site it doesn't work on, no copy the files need, or no
 *  3MF on the model. */
export async function loadPageAdapt(provider: ProviderId, pageUrl: string): Promise<PageAdapt | null> {
  const site = ADAPT_SITES[provider];
  if (!site) return null;
  const offer = await request("GET_ADAPT_OFFER").catch(() => null);
  if (!offer) return null;
  const targets = copiesFor(site, offer.targets);
  if (!targets.length) return null;
  const files = await site.files(pageUrl).catch((err: unknown) => {
    console.warn(`[Thingport Grab] Couldn't list this model's 3MFs on ${site.name}:`, err);
    return [];
  });
  return files.length ? { site, files, targets, offer } : null;
}
