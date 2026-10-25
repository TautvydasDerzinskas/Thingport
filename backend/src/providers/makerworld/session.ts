import {
  connectionState,
  readConnection,
  rejectConnection,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

const ID = manifest.id;
type Secret = { cookie: string };

/** Per-user, unlike the instance-wide Thingiverse token: MakerWorld imports run as the user's own
 * login. */
export async function getUserMakerworldCookie(userId: string): Promise<string | null> {
  return (await readConnection<Secret>(userId, ID))?.secret?.cookie ?? null;
}

// Falls back to the cookie saved in Settings when the request doesn't carry one.
export async function withStoredMakerworldCookie<T extends { makerworld_cookie?: string | null }>(
  userId: string,
  body: T,
): Promise<T> {
  if (body.makerworld_cookie && body.makerworld_cookie.trim()) return body;
  const stored = await getUserMakerworldCookie(userId);
  return stored ? { ...body, makerworld_cookie: stored } : body;
}

/** `verified`: MakerWorld just accepted it, so an earlier rejection no longer stands even if it's
 *  the same cookie. A different cookie clears it too. */
export async function setUserMakerworldCookie(
  userId: string,
  cookie: string | null,
  { verified = false } = {},
): Promise<boolean> {
  const trimmed = (cookie ?? "").trim() || null;
  const current = await getUserMakerworldCookie(userId);
  await writeConnection<Secret>(userId, ID, {
    secret: trimmed ? { cookie: trimmed } : null,
    ...(verified || trimmed !== current ? { rejectedAt: null } : {}),
  });
  return Boolean(trimmed);
}

// A synced collection's error while its MakerWorld syncs wait for a new cookie.
export const MAKERWORLD_REJECTED_ERROR = "Your MakerWorld sign-in has expired";

export async function markMakerworldCookieRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type MakerworldConnection = ConnectionState;

export async function getMakerworldConnection(userId: string): Promise<MakerworldConnection> {
  return connectionState(await readConnection(userId, ID));
}
