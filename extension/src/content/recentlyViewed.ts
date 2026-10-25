// Notes a model page for the popup's "Recently viewed" (see background/recentlyViewed.ts), with its name and picture
// once the page has drawn them.

import { send } from "../shared/messages";
import { modelKey } from "../shared/urls";

const POLL_MS = 500;
const GIVE_UP_MS = 10_000;

function meta(selector: string): string | null {
  const el = document.querySelector(selector);
  return el?.getAttribute("content") || el?.getAttribute("href") || null;
}

/** Whether the page's og: tags are this model's: SPA navigation can leave the last model's behind. */
function ogIsFor(key: string): boolean {
  const ogUrl = meta('meta[property="og:url"]') ?? meta('link[rel="canonical"]');
  try {
    return Boolean(ogUrl) && modelKey(new URL(ogUrl!, location.href).href) === key;
  } catch {
    return false;
  }
}

/** Its og:image when that's this model's, else the biggest picture showing, which on every provider is the model's
 *  gallery. */
function pageImage(key: string): string | null {
  const ogImage = meta('meta[property="og:image"]');
  if (ogImage && ogIsFor(key)) return new URL(ogImage, location.href).href;
  let best: string | null = null;
  let bestArea = 0;
  for (const img of document.images) {
    const rect = img.getBoundingClientRect();
    const area = rect.width * rect.height;
    const src = img.currentSrc || img.src;
    if (!img.complete || img.naturalWidth < 200 || rect.width < 150 || !/^https:/i.test(src)) continue;
    if (area > bestArea) {
      bestArea = area;
      best = src;
    }
  }
  return best;
}

// Trailing " - Free 3D Print Model - MakerWorld"-style parts of a page title.
const TITLE_SUFFIX =
  /makerworld|printables|thingiverse|myminifactory|snapmaker|makeronline|creality|nexprint|thangs|cults|eufymake|make it real|pinshape|3d (print )?model|\bstl\b/i;

function withoutSiteSuffix(title: string): string {
  const parts = title.split(/\s+[-|–·]\s+/);
  while (parts.length > 1 && TITLE_SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" - ").trim();
}

/** The <h1> first, as in the import panel: og:title goes stale on SPA navigation. MakerWorld has no <h1>, so then
 *  og:title when it's this model's, or the page title, either without the site's name. */
function pageTitle(key: string): string | null {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  if (h1) return h1;
  const og = ogIsFor(key) ? meta('meta[property="og:title"]') : null;
  const title = (og || document.title).trim();
  return title ? withoutSiteSuffix(title) : null;
}

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
