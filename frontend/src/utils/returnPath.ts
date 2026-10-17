// A page someone reached signed out, to return to after single sign-on, which goes through the provider and
// would otherwise land on the home page. Only Thingport Grab's approval page needs it.

const KEY = "thingport_return_to";
const RETURNABLE = "/connect-grab";

export function rememberReturnPath(): void {
  try {
    if (window.location.pathname === RETURNABLE) {
      window.sessionStorage.setItem(KEY, window.location.pathname + window.location.search);
    }
  } catch {}
}

/** The remembered page, once; null when there's none. */
export function takeReturnPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return path?.startsWith(`${RETURNABLE}?`) ? path : null;
  } catch {
    return null;
  }
}
