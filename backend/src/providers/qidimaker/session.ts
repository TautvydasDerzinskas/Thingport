import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the QIDI Maker sign-in, which only the user's own collections and likes need. It's the site's `token`
// cookie, kept for 90 days and out of reach of the page's scripts, which Thingport Grab reads from the browser's cookies
// and sends each new one on. Nothing about it says when the site stops taking it, so it's used until it does.

const TOKEN_COOKIE = manifest.sessionCookies.token;
const ID = manifest.id;
type Secret = { token: string };

const TOKEN = /^[0-9a-f]{32,128}$/i;

/** The token from a bare value, a Cookie header, or a row of the browser's cookie table pasted from its developer
 *  tools (the name, a tab, then the value); null when there's none. */
export function normalizeQidimakerSession(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/^\s*cookie:\s*/i, "").trim();
  if (TOKEN.test(text)) return text;
  const pair = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TOKEN_COOKIE}=`));
  const row = text.match(new RegExp(String.raw`^${TOKEN_COOKIE}[ \t]+(\S+)`, "m"));
  let value = pair ? pair.slice(TOKEN_COOKIE.length + 1) : (row?.[1] ?? "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null; // Malformed percent-encoding: not a token.
  }
  return TOKEN.test(value) ? value : null;
}

/** The user's token until QIDI Maker turns it down; null without one. */
export async function getUserQidimakerToken(userId: string): Promise<string | null> {
  return usableSecret(await readConnection<Secret>(userId, ID))?.token ?? null;
}

/** A new token clears an earlier rejection. Whose it is, where known, is kept beside it; on disconnect it stays. */
export async function setUserQidimakerSession(
  userId: string,
  token: string | null,
  account: { id: string; name: string | null } | null = null,
): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: token ? { token } : null,
    expiresAt: null,
    rejectedAt: null,
    ...(account ? { accountId: account.id, accountName: account.name } : {}),
  });
  return Boolean(token);
}

/** With `token`, only while it's still the one stored: Grab may have sent a new one since it was read. */
export async function markQidimakerSessionRejected(userId: string, token?: string): Promise<void> {
  await rejectConnection(userId, ID, "default", token ? ({ token } satisfies Secret) : undefined);
}

/** Whose sign-in Thingport has, by the name QIDI Maker shows them under; null when it doesn't know. */
export async function getQidimakerAccountName(userId: string): Promise<string | null> {
  return (await readConnection<Secret>(userId, ID))?.accountName ?? null;
}

export async function getQidimakerConnection(userId: string): Promise<ConnectionState> {
  return connectionState(await readConnection(userId, ID));
}

/** Shown wherever the user's own lists need a sign-in they haven't given, or that ran out. */
export const QIDIMAKER_CONNECT =
  "QIDI Maker shows your likes and private collections to you only: visit www.qidimaker.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
