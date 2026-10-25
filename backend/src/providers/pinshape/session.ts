import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the Pinshape sign-in, which its files need. The site signs in with Flask-Login: its remember_token cookie,
// good for a year, signs in on its own, and the session cookie holds the sign-in between, so both are kept and sent.
// Thingport Grab reads them from a signed-in pinshape.com page and sends each new pair; a pasted Cookie header, or a
// signed-in request's copied headers, works too. Who it is (accountId) is their profile's part of its address,
// `<id>-<name>`: their id, and the name their links use.

const ID = manifest.id;
const { remember: REMEMBER_COOKIE, session: SESSION_COOKIE } = manifest.sessionCookies;

type Secret = { remember: string | null; session: string | null };

/** A sign-in as given: either cookie may be missing, and the remember token says whose it is. */
export type PinshapeSession = Secret & { userId: string | null };

/** Who they are on Pinshape: their id, their profile's `<id>-<name>`, and their username. */
export type PinshapeAccount = { userId: string; key: string; name: string | null };

// Flask-Login's remember cookie is "<user id>|<HMAC>", written with its pipe escaped by some browsers.
const REMEMBER_VALUE = String.raw`(\d{1,12})(?:\||%7C)([0-9a-f]{32,256})`;
const REMEMBER = new RegExp(String.raw`(?:^|[;\s])${REMEMBER_COOKIE}="?${REMEMBER_VALUE}"?(?=;|\s|$)`, "i");
const BARE_REMEMBER = new RegExp(`^${REMEMBER_VALUE}$`, "i");
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}=([\w.~-]{16,1024})(?=;|\s|$)`);

/** The sign-in in a Cookie header, a signed-in request's copied headers, or a bare remember_token value; null when
 *  there's none. A visitor's session cookie alone looks the same as a signed-in one's, so only checking it tells. */
export function normalizePinshapeSession(raw: string | null | undefined): PinshapeSession | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const remember = text.match(BARE_REMEMBER) ?? text.match(REMEMBER);
  const session = remember && BARE_REMEMBER.test(text) ? null : (text.match(SESSION)?.[1] ?? null);
  if (!remember && !session) return null;
  return {
    remember: remember ? `${remember[1]}|${remember[2].toLowerCase()}` : null,
    session,
    userId: remember?.[1] ?? null,
  };
}

/** The Cookie header a sign-in is sent as. */
export function pinshapeCookie(secret: Secret): string {
  return [
    secret.remember && `${REMEMBER_COOKIE}=${secret.remember}`,
    secret.session && `${SESSION_COOKIE}=${secret.session}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** The user's sign-in as a Cookie header, until Pinshape turns it down; null without one. */
export async function getUserPinshapeCookie(userId: string): Promise<string | null> {
  const secret = usableSecret(await readConnection<Secret>(userId, ID));
  return secret && pinshapeCookie(secret);
}

/** A new sign-in clears an earlier rejection. Who it is, where known, is kept on disconnect, as for MakerOnline: as
 *  checked, or else the id its remember token starts with, keeping what's known of that id but not another's. A
 *  sign-in that doesn't say whose it is forgets the last one's: it may be someone else's. */
export async function setUserPinshapeSession(
  userId: string,
  session: PinshapeSession | null,
  account: PinshapeAccount | null = null,
): Promise<boolean> {
  let who: { accountId: string | null; accountName: string | null } | null = null;
  if (account) who = { accountId: account.key, accountName: account.name };
  else if (session?.userId) {
    if ((await getPinshapeConnection(userId)).account?.userId !== session.userId) {
      who = { accountId: session.userId, accountName: null };
    }
  } else if (session) who = { accountId: null, accountName: null };
  await writeConnection<Secret>(userId, ID, {
    secret: session && { remember: session.remember, session: session.session },
    expiresAt: null,
    rejectedAt: null,
    ...who,
  });
  return Boolean(session);
}

export async function markPinshapeSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getPinshapeConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: PinshapeAccount | null }> {
  const connection = await readConnection(userId, ID);
  const key = connection?.accountId ?? null;
  const id = key?.match(/^\d+/)?.[0];
  return {
    state: connectionState(connection),
    account: key && id ? { userId: id, key, name: connection?.accountName ?? null } : null,
  };
}

/** Shown wherever an import needs the user's sign-in, and there's none. */
export const PINSHAPE_CONNECT =
  "Pinshape gives its files to signed-in users only: visit pinshape.com signed in with Thingport Grab, or connect " +
  "it in Configuration > Providers.";
