import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import type { CgtraderSession } from "./api";
import manifest from "./manifest.generated";

// Per-user: the CGTrader sign-in, which its files and the user's own lists need. It's Rails' session cookie, which
// lasts two weeks from its last use, Thingport's own included. Beside it is the token the browser got for passing
// AWS's bot check, which the downloads want too (waf.ts). Thingport Grab reads both from a signed-in cgtrader.com page
// and sends them whenever either changes; a pasted Cookie header, or a signed-in request's copied headers, works too.
// Who it is (accountId) is their username, which their own page on the site is at.

const ID = manifest.id;
const { session: SESSION_COOKIE, waf: WAF_COOKIE } = manifest.sessionCookies;
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}=([0-9a-f]{16,128})(?=;|\s|$)`, "i");
// `<uuid>:<base64>:<base64>`.
const WAF = new RegExp(String.raw`(?:^|[;\s])${WAF_COOKIE}=([\w:/+=.-]{20,4000})(?=;|\s|$)`);

export type CgtraderAccount = { username: string };

/** The sign-in in a Cookie header, or a signed-in request's copied headers; null without a session cookie. A visitor
 *  gets one too, so only checking it tells whether it signs anyone in. */
export function normalizeCgtraderSession(raw: string | null | undefined): CgtraderSession | null {
  const text = raw ?? "";
  const session = text.match(SESSION)?.[1];
  if (!session) return null;
  const waf = text.match(WAF)?.[1] ?? null;
  return { session, waf, wafAt: waf ? Date.now() : null };
}

/** The user's sign-in, until CGTrader turns it down; null without one. */
export async function getUserCgtraderSession(userId: string): Promise<CgtraderSession | null> {
  return usableSecret(await readConnection<CgtraderSession>(userId, ID));
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserCgtraderSession(
  userId: string,
  session: CgtraderSession | null,
  account: CgtraderAccount | null = null,
): Promise<boolean> {
  await writeConnection<CgtraderSession>(userId, ID, {
    secret: session,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.username, accountName: account.username }
      : session
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(session);
}

export async function markCgtraderSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getCgtraderConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: CgtraderAccount | null }> {
  const connection = await readConnection(userId, ID);
  const username = connection?.accountId ?? null;
  return { state: connectionState(connection), account: username ? { username } : null };
}

/** Shown wherever an import or a list needs the user's sign-in, and there's none. */
export const CGTRADER_CONNECT =
  "CGTrader gives its files to signed-in users only, the free models included: visit cgtrader.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
