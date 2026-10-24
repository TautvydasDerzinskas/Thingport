import { prisma } from "../../db";

/** Per-user, unlike the instance-wide Thingiverse token: MakerWorld imports run as the user's own
 * login. */
export async function getUserMakerworldCookie(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { makerworldCookie: true } });
  return user?.makerworldCookie ?? null;
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
  await prisma.user.update({
    where: { id: userId },
    data: {
      makerworldCookie: trimmed,
      ...(verified || trimmed !== current ? { makerworldRejectedAt: null } : {}),
    },
  });
  return Boolean(trimmed);
}

// A synced collection's error while its MakerWorld syncs wait for a new cookie.
export const MAKERWORLD_REJECTED_ERROR = "Your MakerWorld sign-in has expired";

export async function markMakerworldCookieRejected(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { makerworldRejectedAt: new Date() } });
}

export type MakerworldConnection = "connected" | "disconnected" | "expired";

export async function getMakerworldConnection(userId: string): Promise<MakerworldConnection> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { makerworldCookie: true, makerworldRejectedAt: true },
  });
  if (!user?.makerworldCookie) return "disconnected";
  return user.makerworldRejectedAt ? "expired" : "connected";
}
