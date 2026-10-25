import {
  connectionState,
  readConnection,
  rejectConnection,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user, beside the instance-wide API key: the user's MyMiniFactory session downloads the paid and login-only
// models in their library, which the API key can't.

const SESSION_COOKIE = manifest.sessionCookies.session;
const ID = manifest.id;
type Secret = { cookie: string };

/** "PHPSESSID=<value>" from a whole Cookie header, a "PHPSESSID=..." pair or a bare value; null when there's none.
 *  The other cookies a browser sends are Cloudflare's and tied to that browser, so only this one is kept. */
export function normalizeMyminifactoryCookie(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/^\s*cookie:\s*/i, "").trim();
  if (!text) return null;
  const pair = text
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toUpperCase().startsWith(`${SESSION_COOKIE}=`));
  const value = pair ? pair.slice(SESSION_COOKIE.length + 1).trim() : text.includes("=") ? "" : text;
  return /^[\w,-]+$/.test(value) ? `${SESSION_COOKIE}=${value}` : null;
}

export async function getUserMyminifactoryCookie(userId: string): Promise<string | null> {
  return (await readConnection<Secret>(userId, ID))?.secret?.cookie ?? null;
}

/** `verified`: MyMiniFactory just accepted it, so an earlier rejection no longer stands. A different cookie clears
 *  it too. */
export async function setUserMyminifactoryCookie(
  userId: string,
  cookie: string | null,
  { verified = false } = {},
): Promise<boolean> {
  const current = await getUserMyminifactoryCookie(userId);
  await writeConnection<Secret>(userId, ID, {
    secret: cookie ? { cookie } : null,
    ...(verified || cookie !== current ? { rejectedAt: null } : {}),
  });
  return Boolean(cookie);
}

export async function markMyminifactoryCookieRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type MyminifactoryConnection = ConnectionState;

export async function getMyminifactoryConnection(userId: string): Promise<MyminifactoryConnection> {
  return connectionState(await readConnection(userId, ID));
}
