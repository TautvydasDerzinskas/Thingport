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

const sameHex = (value: string, other: string | null) => other !== null && value.toLowerCase() === other.toLowerCase();

/** The runs of hex digits in a paste long enough to be a token, a Gtoken or a user id, as they appear. */
function hexRuns(text: string): string[] {
  return text.match(/[0-9a-f]{32,128}/gi) ?? [];
}

/** A hex value under one of `names`, as pasted header and cookie lists show it: after the name on its own line, or
 *  on the line below it. The name need only be part of the line, so a `makeitreal-euid` cookie row reads too. */
function labelledHex(text: string, names: readonly string[]): string | null {
  const lines = text.split("\n").map((line) => line.trim());
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    const name = names.find((candidate) => lower.includes(candidate));
    if (name === undefined) continue;
    const value = hexRuns(lines[i].slice(lower.indexOf(name) + name.length))[0] ?? lines[i + 1] ?? "";
    if (TOKEN.test(value)) return value;
  }
  return null;
}

/** The JSON inside an mk-userinfo value: base64 of the percent-encoded JSON, behind the `exp@<unix seconds>;` stamp
 *  the site's store puts on values that run out -- or the plain JSON builds before October 2026 wrote. Null when the
 *  value is neither. */
export function eufymakeUserInfoJson(value: string): string | null {
  let plain = value;
  if (!plain.startsWith("{")) {
    if (!/^[A-Za-z0-9+/=]+$/.test(plain)) return null;
    try {
      plain = decodeURIComponent(Buffer.from(plain, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
  const json = plain.startsWith("exp@") ? plain.slice(plain.indexOf(";") + 1) : plain;
  return json.startsWith("{") ? json : null;
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
  const userInfo = eufymakeUserInfoJson(text);
  if (userInfo) {
    try {
      const info = JSON.parse(userInfo) as { auth_token?: unknown; user_id?: unknown };
      token = typeof info.auth_token === "string" ? info.auth_token : null;
      id = typeof info.user_id === "string" ? info.user_id : id;
    } catch {
      return null;
    }
  } else if (TOKEN.test(text)) {
    token = text;
  } else {
    token = labelledHex(text, ["x-auth-token", "auth_token"]);
    gtoken = labelledHex(text, ["gtoken"]);
    id = labelledHex(text, ["user_id", "userid", "euid"]) ?? id;
    // A user id settles the Gtoken, its MD5, so a pasted copy of that isn't taken for the token.
    if (!gtoken && id && USER_ID.test(id)) gtoken = eufymakeGtoken(id.toLowerCase());
    // Pasted with the names stripped off: the run of exactly 32 digits is the Gtoken, the other one the token. A
    // token can be 32 digits too, and then either could be the Gtoken, so it has to come labelled.
    const spare = hexRuns(text).filter((run) => !sameHex(run, token) && !sameHex(run, gtoken) && !sameHex(run, id));
    const short = spare.filter((run) => GTOKEN.test(run));
    if (!gtoken && short.length === 1) gtoken = short[0];
    token ??= spare.find((run) => !sameHex(run, gtoken)) ?? null;
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
