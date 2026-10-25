import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import { eufymakeGtoken, type EufymakeAuth } from "./api";
import manifest from "./manifest.generated";

// Per-user: the eufyMake sign-in, which only the user's likes need. The site keeps it in localStorage ("mk-userinfo":
// its auth_token and the user's id) rather than a cookie, and sends the token with a Gtoken, the MD5 of the user's id.
// Thingport Grab reads it from an open makeitreal.eufymake.com tab and sends each new one on.

const ID = manifest.id;
type Secret = EufymakeAuth;

export type EufymakeSession = EufymakeAuth & { userId: string | null };

const TOKEN = /^[0-9a-f]{32,128}$/i;
const USER_ID = /^[0-9a-f]{40}$/i;
const GTOKEN = /^[0-9a-f]{32}$/i;

/** A request header's value from pasted headers, as DevTools copies them: `name: value`, or the name and value on
 *  lines of their own. */
function headerValue(text: string, name: string): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.slice(0, name.length).toLowerCase() !== name) continue;
    const rest = line.slice(name.length);
    if (rest && !/^[\s:]/.test(rest)) continue;
    const value = rest.replace(/^\s*:?\s*/, "") || (lines[i + 1] ?? "");
    if (/^[0-9a-f]+$/i.test(value)) return value;
  }
  return null;
}

/** The sign-in from the site's mk-userinfo value (or just its auth_token, with `userId`), or from a signed-in
 *  request's pasted headers (X-Auth-Token and Gtoken); null when there's none. */
export function normalizeEufymakeSession(
  raw: string | null | undefined,
  userId: string | null = null,
): EufymakeSession | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  let token: string | null = null;
  let gtoken: string | null = null;
  let id = userId;
  if (text.startsWith("{")) {
    try {
      const info = JSON.parse(text) as { auth_token?: unknown; user_id?: unknown };
      token = typeof info.auth_token === "string" ? info.auth_token : null;
      id = typeof info.user_id === "string" ? info.user_id : id;
    } catch {
      return null;
    }
  } else if (TOKEN.test(text)) {
    token = text;
  } else {
    token = headerValue(text, "x-auth-token");
    gtoken = headerValue(text, "gtoken");
  }
  id = id && USER_ID.test(id) ? id.toLowerCase() : null;
  gtoken = id ? eufymakeGtoken(id) : gtoken;
  if (!token || !TOKEN.test(token) || !gtoken || !GTOKEN.test(gtoken)) return null;
  return { token, gtoken: gtoken.toLowerCase(), userId: id };
}

/** The user's sign-in until eufyMake turns it down; null without one. */
export async function getUserEufymakeAuth(userId: string): Promise<EufymakeAuth | null> {
  const secret = usableSecret(await readConnection<Secret>(userId, ID));
  return secret && { token: secret.token, gtoken: secret.gtoken };
}

/** A new sign-in clears an earlier rejection. The eufyMake user id is kept on disconnect, as for MakerOnline. */
export async function setUserEufymakeSession(userId: string, session: EufymakeSession | null): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: session && { token: session.token, gtoken: session.gtoken },
    expiresAt: null,
    rejectedAt: null,
    ...(session?.userId ? { accountId: session.userId } : {}),
  });
  return Boolean(session);
}

export async function markEufymakeSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getEufymakeConnection(userId: string): Promise<ConnectionState> {
  return connectionState(await readConnection(userId, ID));
}

/** Shown wherever reading the user's likes needs a sign-in they haven't given, or that ran out. */
export const EUFYMAKE_CONNECT =
  "eufyMake shows likes to their owner only: visit makeitreal.eufymake.com signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers.";
