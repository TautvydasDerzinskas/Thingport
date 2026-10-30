// Notes a model page for the popup's "Recently viewed" (see background/recentlyViewed.ts), with its name and picture
// once the page has drawn them (pageModel.ts reads both).

import { send } from "../shared/messages";
import { pageImage, pageTitle } from "./pageModel";
import { modelKey } from "../shared/urls";

const POLL_MS = 500;
const GIVE_UP_MS = 10_000;

export async function trackViewedModel(url: string, isStale: () => boolean): Promise<void> {
  const key = modelKey(url);
  if (!key) return;
  const started = Date.now();
  let title: string | null = null;
  let image: string | null = null;
  let steady = false;
  while (Date.now() - started < GIVE_UP_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (isStale()) return;
    // The same on two looks running: right after SPA navigation the last model's can still be up.
    const next = pageTitle(key);
    steady = Boolean(next) && next === title;
    title = next;
    image = pageImage(key);
    if (steady && image) break;
  }
  // A page that never drew its name is most likely an error page, not a model.
  if (!title) return;
  void send("RECORD_VIEWED_MODEL", { url: url.split("#")[0], title, image });
}
