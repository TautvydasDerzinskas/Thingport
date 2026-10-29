// What a CGTrader model's page knows of the model and the signed-in user, asked as the page asks: its product
// script, which says whether the user bought it.

import { parseCgtraderModelUrl } from "./urls.generated";

/** A paid model the user hasn't bought, by its page's product script. Only a script asked for signed in -- which says
 *  whether the user liked it, where anyone else's says nothing -- can tell that, so one that wasn't never blocks. */
export async function isUnboughtCgtraderModel(url: string): Promise<boolean> {
  const slug = parseCgtraderModelUrl(url)?.slug;
  if (!slug) return false;
  try {
    // The panel waits on this to show the import button, so an answer that stalls, its body too, doesn't block either.
    const res = await fetch(`${location.origin}/products/${encodeURIComponent(slug)}.js`, {
      headers: { Accept: "text/javascript, application/javascript", "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const script = await res.text();
    const signedIn = /"isLiked":(?:true|false)/.test(script);
    const price = Number(script.match(/"price":([\d.]+)/)?.[1] ?? 0);
    return signedIn && price > 0 && !/"isPurchased":true/.test(script);
  } catch {
    return false;
  }
}
