import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import type { Cults3dBrowser, Cults3dCredentials } from "./api";
import manifest from "./manifest.generated";

// Per-user, two things. The API credentials -- the user's Cults3D nickname and an API key they make on the site --
// read models, likes, printlists and orders. The browser's sign-in -- its _session_id cookie, and the cf_clearance
// cookie with the User-Agent it was issued to -- opens the site's order and download pages; Thingport Grab sends it
// whenever the browser's changes, and pasting a signed-in request's headers works too. The session lasts 20 days from
// its last use, and Thingport's own use renews it.

const { session: SESSION_COOKIE, clearance: CLEARANCE_COOKIE } = manifest.sessionCookies;
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}=([0-9a-f]{16,128})(?=;|\s|$)`, "i");
const CLEARANCE = new RegExp(String.raw`(?:^|[;\s])${CLEARANCE_COOKIE}=([\w.~-]{20,4000})(?=;|\s|$)`, "i");
// "User-Agent: ..." from copied headers, or Chrome's DevTools, which puts the name and the value on lines of their own.
const USER_AGENT = /(?:^|\n)\s*user-agent\s*(?::\s*|\n\s*)(Mozilla\/[^\n]+)/i;

/** The sign-in in a Cookie header, or a signed-in request's copied headers. `userAgent` is the one to send with the
 *  clearance when the text doesn't carry its own. Null without a session cookie. */
export function normalizeCults3dBrowser(
  raw: string | null | undefined,
  userAgent?: string | null,
): Cults3dBrowser | null {
  const text = raw ?? "";
  const session = text.match(SESSION)?.[1];
  if (!session) return null;
  const clearance = text.match(CLEARANCE)?.[1] ?? null;
  const agent = text.match(USER_AGENT)?.[1]?.trim() || userAgent?.trim() || null;
  return { session, clearance, userAgent: agent };
}

const ID = manifest.id;
// The API credentials are the default slot, the browser's sign-in the "browser" one.
const BROWSER = "browser";

/** New credentials clear an earlier rejection; null forgets them. */
export async function setUserCults3dCredentials(userId: string, credentials: Cults3dCredentials | null): Promise<void> {
  await writeConnection<Cults3dCredentials>(userId, ID, {
    secret: credentials,
    rejectedAt: null,
  });
}

/** A new sign-in clears an earlier rejection; null forgets it. `nick` is the account the site showed it signed in as,
 *  which the downloads need to match the API key's; it's always written, as a new sign-in may be another account's and
 *  a stale nickname would be worse than none. */
export async function setUserCults3dBrowser(
  userId: string,
  browser: Cults3dBrowser | null,
  nick: string | null = null,
): Promise<void> {
  await writeConnection<Cults3dBrowser>(
    userId,
    ID,
    { secret: browser, rejectedAt: null, accountName: browser ? nick : null },
    BROWSER,
  );
}

/** Keeps whose account the browser's sign-in is, for one stored before Thingport read it; the sign-in itself is left
 *  as it is, so a newer one Grab pushed meanwhile isn't written over. */
export async function setUserCults3dBrowserAccount(userId: string, nick: string): Promise<void> {
  await writeConnection(userId, ID, { accountName: nick }, BROWSER);
}

export async function markCults3dApiRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function markCults3dSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID, BROWSER);
}

export type Cults3dConnection = {
  api: ConnectionState;
  site: ConnectionState;
  nick: string | null;
  /** Who the browser's sign-in is, where the site told Thingport; null when it couldn't be read. */
  siteNick: string | null;
};

export async function getCults3dConnection(userId: string): Promise<Cults3dConnection> {
  const [api, site] = await Promise.all([
    readConnection<Cults3dCredentials>(userId, ID),
    readConnection(userId, ID, BROWSER),
  ]);
  return {
    api: connectionState(api),
    site: connectionState(site),
    nick: api?.secret?.nick ?? null,
    siteNick: site?.accountName ?? null,
  };
}

/** The user's API credentials; null when they haven't given them, or Cults3D turned them down. */
export async function getUserCults3dCredentials(userId: string): Promise<Cults3dCredentials | null> {
  return usableSecret(await readConnection<Cults3dCredentials>(userId, ID));
}

/** The browser's sign-in with the account the site last showed it signed in as, which a download has to be ordered by;
 *  null when Grab hasn't sent one, or the site turned it down since. */
export async function getUserCults3dBrowserAccount(
  userId: string,
): Promise<{ browser: Cults3dBrowser; nick: string | null } | null> {
  const connection = await readConnection<Cults3dBrowser>(userId, ID, BROWSER);
  const browser = usableSecret(connection);
  return browser ? { browser, nick: connection!.accountName } : null;
}

/** Shown wherever Cults3D's API is needed and the user hasn't given their credentials, or they were turned down. */
export const CULTS3D_CONNECT =
  "Thingport reads Cults3D with your own API key: make one at cults3d.com/en/api/keys, then enter it with your " +
  "nickname in Configuration > Providers.";

/** Shown when the browser's sign-in came without Cloudflare's clearance cookie, which the download pages need. */
export const CULTS3D_NO_CLEARANCE =
  "Thingport has your Cults3D sign-in but not Cloudflare's clearance for it, which the downloads need. Update " +
  "Thingport Grab, then visit cults3d.com signed in again -- or paste a signed-in request's headers, with the " +
  "cf_clearance cookie, in Configuration > Providers.";

/** Shown wherever a download needs the browser's sign-in, and there's none. */
export const CULTS3D_SIGN_IN =
  "Cults3D only gives its files to a signed-in user: visit cults3d.com signed in with Thingport Grab, then import " +
  "it again.";
