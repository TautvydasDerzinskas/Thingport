// A page someone reached signed out, to return to after single sign-on, which goes through the provider and
// would otherwise land on the home page. Thingport Grab's approval page, the bookmarklet's import link and links into
// the import queue need it.

const KEY = "thingport_return_to";
// These two open the same with or without a query; the others mean nothing without one.
const QUEUE_LINKS = ["/admin-queue", "/import-queue"];
const RETURNABLE = ["/connect-grab", "/import", ...QUEUE_LINKS];

export function rememberReturnPath(): void {
  try {
    if (RETURNABLE.includes(window.location.pathname)) {
      window.sessionStorage.setItem(KEY, window.location.pathname + window.location.search);
    }
  } catch {}
}

/** The remembered page, once; null when there's none. */
export function takeReturnPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!path) return null;
    return QUEUE_LINKS.includes(path) || RETURNABLE.some((returnable) => path.startsWith(`${returnable}?`))
      ? path
      : null;
  } catch {
    return null;
  }
}
