import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import type { CrealitycloudAuth } from "./api";
import manifest from "./manifest.generated";

// Per-user: the Creality Cloud sign-in, its model_token and model_user_id cookies, which the API takes together. The
// site sets them once at sign-in for 7 days and never renews them, and Thingport doesn't either: Thingport Grab sends
// each new pair. The cookie's expiry is kept only to show; the token is used until Creality Cloud turns it down, as it
// may outlive the cookie.

const TOKEN_COOKIE = manifest.sessionCookies.token;
const USER_COOKIE = manifest.sessionCookies.user;
const ID = manifest.id;
type Secret = { token: string };

export type CrealitycloudSession = CrealitycloudAuth & { expiresAt: Date | null };

function valueOf(text: string, names: string[]): string | null {
  for (const name of names) {
    // `name=value` from a Cookie header, `name: value` or `name` then the value on the next line from copied headers.
    const m = text.match(new RegExp(String.raw`(?:^|[;\s])${name}(?:\s*[=:]\s*|\s+)([^;\s]+)`, "i"));
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return null; // Malformed percent-encoding: not a value.
      }
    }
  }
  return null;
}

/** The token and user id from a Cookie header, or from the `__cxy_token_` and `__cxy_uid_` request headers copied
 *  from the browser; null without both. */
export function normalizeCrealitycloudSession(
  raw: string | null | undefined,
  expiresAt: Date | null = null,
): CrealitycloudSession | null {
  const text = (raw ?? "").replace(/^\s*cookie:\s*/i, "").trim();
  if (!text) return null;
  const token = valueOf(text, [TOKEN_COOKIE, "__cxy_token_"]);
  const userId = valueOf(text, [USER_COOKIE, "__cxy_uid_"]);
  if (!token || !/^[0-9a-f]{32,128}$/i.test(token) || !userId || !/^\d+$/.test(userId)) return null;
  return { token, userId, expiresAt };
}

/** The user's sign-in until Creality Cloud turns it down; null without one. */
export async function getUserCrealitycloudAuth(userId: string): Promise<CrealitycloudAuth | null> {
  const connection = await readConnection<Secret>(userId, ID);
  const secret = usableSecret(connection);
  return secret && connection?.accountId ? { token: secret.token, userId: connection.accountId } : null;
}

export async function getUserCrealitycloudId(userId: string): Promise<string | null> {
  return (await readConnection(userId, ID))?.accountId ?? null;
}

/** A new sign-in clears an earlier rejection. The Creality Cloud user id is kept on disconnect, as for Snapmaker. */
export async function setUserCrealitycloudSession(
  userId: string,
  session: CrealitycloudSession | null,
): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: session && { token: session.token },
    expiresAt: session?.expiresAt ?? null,
    rejectedAt: null,
    ...(session ? { accountId: session.userId } : {}),
  });
  return Boolean(session);
}

export async function markCrealitycloudSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type CrealitycloudConnection = ConnectionState;

export async function getCrealitycloudConnection(userId: string): Promise<CrealitycloudConnection> {
  return connectionState(await readConnection(userId, ID));
}

/** Shown wherever a Creality Cloud download or the user's likes need a sign-in they haven't given, or that ran out. */
export const CREALITYCLOUD_CONNECT =
  "Creality Cloud only gives its files to a signed-in user: visit crealitycloud.com signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers, then import it again.";
