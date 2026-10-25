import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the Snapmaker access token that downloads files and reads the user's likes and bookmarks. It lasts a
// day. Snapmaker's refresh tokens work once, and using one signs out whoever held it before, so Thingport never
// refreshes: Thingport Grab keeps the browser's login fresh and sends each new access token here.

const ID = manifest.id;
const ACCESS_COOKIE = manifest.sessionCookies.token;
type Secret = { token: string };

export type SnapmakerToken = { token: string; expiresAt: Date | null; userId: string | null };

function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The access token from a bare token, an `Authorization: Bearer` value or a whole Cookie header; null when there's
 *  none. */
export function normalizeSnapmakerToken(raw: string | null | undefined): SnapmakerToken | null {
  let text = (raw ?? "")
    .replace(/^\s*(cookie|authorization):\s*/i, "")
    .replace(/^\s*bearer\s+/i, "")
    .trim();
  const pair = text
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`));
  if (pair) {
    try {
      text = decodeURIComponent(pair.slice(ACCESS_COOKIE.length + 1));
    } catch {
      return null; // Malformed percent-encoding: not a token.
    }
  }
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(text)) return null;
  const payload = jwtPayload(text);
  if (!payload) return null;
  const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  const userId =
    typeof payload.userId === "number" || typeof payload.userId === "string" ? String(payload.userId) : null;
  return { token: text, expiresAt: exp, userId };
}

/** The user's token while it's still valid; null once it has expired or Snapmaker turned it down, so nothing asks
 *  Snapmaker with it in vain. */
export async function getUserSnapmakerToken(userId: string): Promise<string | null> {
  return usableSecret(await readConnection<Secret>(userId, ID), true)?.token ?? null;
}

export async function getUserSnapmakerId(userId: string): Promise<string | null> {
  return (await readConnection(userId, ID))?.accountId ?? null;
}

/** A new token clears an earlier rejection. The Snapmaker user id is kept on disconnect, so syncs stay addressable. */
export async function setUserSnapmakerToken(userId: string, token: SnapmakerToken | null): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: token && { token: token.token },
    expiresAt: token?.expiresAt ?? null,
    rejectedAt: null,
    ...(token?.userId ? { accountId: token.userId } : {}),
  });
  return Boolean(token);
}

export async function markSnapmakerTokenRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type SnapmakerConnection = ConnectionState;

export async function getSnapmakerConnection(userId: string): Promise<SnapmakerConnection> {
  return connectionState(await readConnection(userId, ID), true);
}

/** Shown wherever a Snapmaker download needs a login the user hasn't given, or that has run out. */
export const SNAPMAKER_CONNECT =
  "Snapmaker only gives its files to a signed-in user: visit space.snapmaker.com with Thingport Grab (it keeps your " +
  "sign-in fresh), or connect it in Configuration > Providers, then import it again.";
