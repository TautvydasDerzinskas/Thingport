import { request } from "../shared/messages";
import { modelKey } from "../shared/urls";

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

/** What an import run is told apart by: its model, whatever profile, locale or slug the address has, or the address
 *  less its #fragment on a page that names no model. */
export const importKey = (url: string): string => modelKey(url) ?? withoutFragment(url);

/** The imports started on this page, by the model they're for, while they run. `left`: the page has since been on
 *  another, whose panel was drawn, so coming back needs this one's drawn again. */
const importsUnderWay = new Map<string, { left: boolean }>();

/**
 * Runs an import started on the page, for the model `url` is of. While it runs, the address moving anywhere on that
 * model -- the print profiles it picks, the #profileId the site writes for each, however late -- isn't taken for the
 * user going elsewhere. That redrew the panel mid-run with what the library had that moment, offering the profiles the
 * run was still bringing in, and a second run of them then raced the first.
 */
export async function whileImporting<T>(url: string, work: () => Promise<T>): Promise<T> {
  const key = importKey(url);
  const run = { left: false };
  importsUnderWay.set(key, run);
  try {
    return await work();
  } finally {
    importsUnderWay.delete(key);
    // As a hold's end: where the run left the address, should that be noticed only afterwards.
    ownAddress = !run.left && importKey(location.href) === key ? location.href : null;
  }
}

/** An import of `url`'s model, started on this page, is under way. */
export function isImporting(url: string): boolean {
  return importsUnderWay.has(importKey(url));
}

/** Asked once the address has changed: whether `holdingNavigation`'s work changed it, rather than the user. Only the
 *  held page's #fragment is the work's to change; any other address is the user going elsewhere. During an import, any
 *  address on its model is the run's, until the page goes to another. */
export function isOwnNavigation(): boolean {
  const here = importKey(location.href);
  for (const [key, run] of importsUnderWay) if (key !== here) run.left = true;
  if (importsUnderWay.get(here)?.left === false) return true;
  if (navigationHolds > 0) return withoutFragment(location.href) === heldPage;
  const own = location.href === ownAddress;
  ownAddress = null;
  return own;
}
