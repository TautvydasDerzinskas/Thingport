// What a Fab365 page shows of the signed-in user: whether anyone's signed in at all, which its page storage says.

/** Whether this fab365.net tab is signed in: its page storage holds an accessToken that looks like a JWT. A visitor
 *  has none, so sending its (absent) token on would never replace a working sign-in. */
export function fab365SignedIn(): boolean {
  try {
    return (localStorage.getItem("accessToken") ?? "").split(".").length === 3;
  } catch {
    return false;
  }
}
