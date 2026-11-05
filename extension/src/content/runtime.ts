import { request } from "../shared/messages";

/** Proxied through the background, which owns the credentials and host permission. */
export function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return request("API_CALL", { method, path, body }) as Promise<T>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let navigationHolds = 0;
/** The page being held, without its #fragment. */
let heldPage: string | null = null;
/** Where the page's address was left when the hold ended, should that be noticed only afterwards. */
let ownAddress: string | null = null;

const withoutFragment = (href: string) => href.split("#")[0];

/** Runs `work`, which moves the page's address itself -- a print profile picked on the page changes its #fragment -- so
 *  that isn't taken for the user going elsewhere, which would close the panel mid-import. */
export async function holdingNavigation<T>(work: () => Promise<T>): Promise<T> {
  if (navigationHolds++ === 0) heldPage = withoutFragment(location.href);
  try {
    return await work();
  } finally {
    if (--navigationHolds === 0) {
      ownAddress = withoutFragment(location.href) === heldPage ? location.href : null;
      heldPage = null;
    }
  }
}

/** Asked once the address has changed: whether `holdingNavigation`'s work changed it, rather than the user. Only the
 *  held page's #fragment is the work's to change; any other address is the user going elsewhere. */
export function isOwnNavigation(): boolean {
  if (navigationHolds > 0) return withoutFragment(location.href) === heldPage;
  const own = location.href === ownAddress;
  ownAddress = null;
  return own;
}
