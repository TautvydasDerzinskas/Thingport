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
let ownAddress: string | null = null;

/** Runs `work`, which moves the page's address itself -- a print profile picked on the page changes its #fragment -- so
 *  that isn't taken for the user going elsewhere, which would close the panel mid-import. */
export async function holdingNavigation<T>(work: () => Promise<T>): Promise<T> {
  navigationHolds++;
  try {
    return await work();
  } finally {
    navigationHolds--;
    ownAddress = location.href;
  }
}

/** Asked once the address has changed: whether `holdingNavigation`'s work changed it, rather than the user. */
export function isOwnNavigation(): boolean {
  if (navigationHolds > 0) return true;
  const own = location.href === ownAddress;
  ownAddress = null;
  return own;
}
