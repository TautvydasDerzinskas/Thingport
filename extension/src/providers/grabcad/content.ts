// What a GrabCAD page shows of the signed-in user, read from the page itself.

/** The header's account menu, marked `logged-in` only on a signed-in user's pages. A visitor gets a session cookie
 *  too, and sending that on would replace a working sign-in with one that isn't. */
export function grabcadSignedIn(): boolean {
  return Boolean(document.querySelector("header li.account.logged-in"));
}
