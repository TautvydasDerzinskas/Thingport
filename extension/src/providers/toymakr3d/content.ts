// What a Toymakr3D page shows of the signed-in user, read from the page itself.

/** The account menu's link to their own account, which only a signed-in user's pages have: a visitor gets a Login
 *  link there instead, and a session cookie of their own, which sending on would replace a working sign-in. */
export function toymakr3dSignedIn(): boolean {
  return Boolean(document.querySelector(".account-menu .account-menu__user"));
}
