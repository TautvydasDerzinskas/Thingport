// What a 3DExport model's page shows the signed-in user: its downloads, which it lists for a model that's free or
// theirs, or its buttons to buy it.

import { parseThreedexportModelUrl } from "./urls.generated";

/** Its menu's link to the user's own profile, which only a signed-in user's pages have. */
export function threedexportSignedIn(): boolean {
  return Boolean(document.querySelector("a.profile-link"));
}

/** A paid model the user hasn't bought: their page offers to buy it and lists no downloads. A visitor's page lists none
 *  either way, so one that isn't signed in never blocks. */
export function isUnboughtThreedexportModel(url: string): boolean {
  if (!parseThreedexportModelUrl(url) || !threedexportSignedIn()) return false;
  const downloads = document.querySelector('a[href*="download?link="]');
  const buy = document.querySelector("#button_addtocart, #buynow");
  return !downloads && Boolean(buy);
}
