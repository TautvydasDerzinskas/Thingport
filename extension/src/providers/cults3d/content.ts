// What a Cults3D page shows of the signed-in user and of the model, read from the page itself, and whether the user's
// own downloads have the model, which the page doesn't say.

import { MANIFESTS } from "../index.generated";
import { parseCults3dModelUrl } from "./urls.generated";

// Links only a signed-in user's pages have: their own designs, messages and profile settings.
const SIGNED_IN_LINKS = ["/creations/mine", "/my-messages", "/profile/edit"];

/** Whether the page is a signed-in user's. A visitor gets a session cookie too, and sending that on would replace a
 *  working sign-in with one that isn't. */
export function cults3dSignedIn(): boolean {
  return Boolean(document.querySelector(SIGNED_IN_LINKS.map((path) => `a[href$="${path}"]`).join(", ")));
}

/** The model's designer, as the page's structured data names them. */
function designerNick(): string | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const name: unknown = JSON.parse(script.textContent ?? "")?.creator?.name;
      if (typeof name === "string" && name.trim()) return name.trim();
    } catch {}
  }
  return null;
}

/** Whether the user's downloads page lists the model. Null when it can't tell: the page is the sign-in instead, or
 *  one of several pages. */
export function cults3dDownloadsHave(html: string, slug: string): boolean | null {
  const hrefs = [...html.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (!hrefs.some((href) => SIGNED_IN_LINKS.some((path) => href.endsWith(path)))) return null;
  const listed = hrefs.some((href) => {
    try {
      return parseCults3dModelUrl(new URL(href, MANIFESTS.cults3d.site).toString())?.slug === slug;
    } catch {
      return false;
    }
  });
  if (listed) return true;
  return hrefs.some((href) => /[?&]page=\d/.test(href)) ? null : false;
}

/** A paid model the user hasn't bought. Its page looks the same once it's bought -- the button still puts it in the
 *  cart -- so their downloads are asked, filtered to the model's designer. One it can't tell about never blocks. */
export async function isUnboughtCults3dModel(url: string): Promise<boolean> {
  const addsToCart = Boolean(document.querySelector('form[action*="/lines?creation_id="]'));
  const downloads = Boolean(
    document.querySelector('form[action*="/free_orders?"], a[href*="/downloads/"], a[href*="/orders/"]'),
  );
  if (!addsToCart || downloads || !cults3dSignedIn()) return false;
  const slug = parseCults3dModelUrl(url)?.slug;
  const designer = designerNick();
  if (!slug || !designer) return false;
  try {
    // The panel waits on this to show the import button, so an answer that stalls, its body too, doesn't block either.
    const res = await fetch(`${location.origin}/en/orders?creator=${encodeURIComponent(designer)}`, {
      headers: { Accept: "text/html" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    return cults3dDownloadsHave(await res.text(), slug) === false;
  } catch {
    return false;
  }
}
