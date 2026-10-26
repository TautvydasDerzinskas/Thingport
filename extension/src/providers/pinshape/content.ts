// What a Pinshape page shows of the signed-in user, read from the page itself.

/** Its menu's Log Out link, which only a signed-in user's pages have. A visitor gets a session cookie too, and sending
 *  that on would replace a working sign-in with one that isn't. */
export function pinshapeSignedIn(): boolean {
  return Boolean(document.querySelector('a[href="/auth/logout"]'));
}
