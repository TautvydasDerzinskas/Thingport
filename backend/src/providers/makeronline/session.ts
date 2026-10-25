import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the MakerOnline access token, the JWT in its mo_access_token cookie, sent bare in Authorization. It lasts
// about 90 days and Thingport never renews it; Thingport Grab sends a new one whenever the browser's changes.

const ID = manifest.id;
const ACCESS_COOKIE = manifest.sessionCookies.token;
type Secret = { token: string };

export type MakeronlineToken = { token: string; expiresAt: Date | null; userId: string | null };

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

/** The access token from a bare token, an Authorization value or a whole Cookie header; null when there's none. */
export function normalizeMakeronlineToken(raw: string | null | undefined): MakeronlineToken | null {
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
  const userId = typeof payload.sub === "string" ? payload.sub : typeof payload.id === "string" ? payload.id : null;
  return { token: text, expiresAt: exp, userId };
}

/** The user's token while it's still valid; null once it has expired or been turned down, so nothing asks MakerOnline
 *  with it in vain and public reads go without it. */
export async function getUserMakeronlineToken(userId: string): Promise<string | null> {
  return usableSecret(await readConnection<Secret>(userId, ID), true)?.token ?? null;
}

export async function getUserMakeronlineId(userId: string): Promise<string | null> {
  return (await readConnection(userId, ID))?.accountId ?? null;
}

/** A new token clears an earlier rejection. The MakerOnline user id is kept on disconnect, as for Snapmaker. */
export async function setUserMakeronlineToken(userId: string, token: MakeronlineToken | null): Promise<boolean> {
  await writeConnection<Secret>(userId, ID, {
    secret: token && { token: token.token },
    expiresAt: token?.expiresAt ?? null,
    rejectedAt: null,
    ...(token?.userId ? { accountId: token.userId } : {}),
  });
  return Boolean(token);
}

export async function markMakeronlineTokenRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type MakeronlineConnection = ConnectionState;

export async function getMakeronlineConnection(userId: string): Promise<MakeronlineConnection> {
  return connectionState(await readConnection(userId, ID), true);
}

/** Shown wherever reading the user's own MakerOnline lists needs a sign-in they haven't given, or that has run out. */
export const MAKERONLINE_CONNECT =
  "MakerOnline shows likes and private collections to their owner only: visit makeronline.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
