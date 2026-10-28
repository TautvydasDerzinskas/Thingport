import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the Toymakr3D sign-in, which its files and the likes need. The site signs in with Laravel: its session
// cookie holds the sign-in, and its remember-me cookie signs in again on its own once that runs out. Both are kept
// and sent. Thingport Grab reads them from a signed-in toymakr3d.com page and sends each new pair; a pasted Cookie
// header, or a signed-in request's copied headers, works too. Who it is (accountId) is their username, which their
// own page on the site is at.

const ID = manifest.id;
const { remember: REMEMBER_PREFIX, session: SESSION_COOKIE } = manifest.sessionCookies;

type Secret = { remember: string | null; rememberName: string | null; session: string | null };

/** A sign-in as given: either cookie may be missing. `rememberName` is the remember cookie's whole name, whose last
 *  part is a hash of the site's app key, so it's kept as it was read rather than guessed at. */
export type Toymakr3dSession = Secret;

/** Who they are on Toymakr3D: their username, and the name their account shows. */
export type Toymakr3dAccount = { username: string; name: string | null };

// Laravel writes both as base64 of its encrypted JSON, percent-encoded in the cookie.
const COOKIE_VALUE = String.raw`[\w%=+/.~-]{32,4096}`;
const REMEMBER = new RegExp(
  String.raw`(?:^|[;\s])(${REMEMBER_PREFIX}[0-9a-f]{20,80})="?(${COOKIE_VALUE})"?(?=[;\s]|$)`,
  "i",
);
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}="?(${COOKIE_VALUE})"?(?=[;\s]|$)`);

/** The sign-in in a Cookie header, or a signed-in request's copied headers; null when there's none. A visitor gets a
 *  session cookie too, so only checking it tells whether it signs anyone in. */
export function normalizeToymakr3dSession(raw: string | null | undefined): Toymakr3dSession | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const remember = text.match(REMEMBER);
  const session = text.match(SESSION)?.[1] ?? null;
  if (!remember && !session) return null;
  return { remember: remember?.[2] ?? null, rememberName: remember?.[1] ?? null, session };
}

/** The Cookie header a sign-in is sent as. */
export function toymakr3dCookie(secret: Secret): string {
  return [
    secret.remember && `${secret.rememberName ?? `${REMEMBER_PREFIX}0`}=${secret.remember}`,
    secret.session && `${SESSION_COOKIE}=${secret.session}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** The user's sign-in as a Cookie header, until Toymakr3D turns it down; null without one. */
export async function getUserToymakr3dCookie(userId: string): Promise<string | null> {
  const secret = usableSecret(await readConnection<Secret>(userId, ID));
  return secret && toymakr3dCookie(secret);
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserToymakr3dSession(
  userId: string,
  session: Toymakr3dSession | null,
  account: Toymakr3dAccount | null = null,
): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: session,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.username, accountName: account.name }
      : session
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(session);
}

export async function markToymakr3dSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getToymakr3dConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: Toymakr3dAccount | null }> {
  const connection = await readConnection(userId, ID);
  const username = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: username ? { username, name: connection?.accountName ?? null } : null,
  };
}

/** Shown wherever an import needs the user's sign-in, and there's none. */
export const TOYMAKR3D_CONNECT =
  "Toymakr3D gives its files to signed-in users only, the free models included: visit toymakr3d.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
