import { prisma } from "../../db";
import { createLogger } from "../../logger";
import { decodeThangsJwt, refreshThangsToken, ThangsAuthError } from "./api";

// Per-user: the Thangs sign-in, its accessToken cookie (a 7-day JWT, sent as a Bearer token) and the refreshToken
// cookie that renews it. The refresh token lasts about a year and Thangs keeps it as it is on use, so Thingport renews
// the access token itself as it runs out; Thingport Grab sends both whenever the browser's change.

const log = createLogger("thangs");

// Renewed a little before it runs out, so a long import never starts with a token about to.
const RENEW_BEFORE_MS = 10 * 60 * 1000;

export type ThangsSession = {
  token: string | null;
  refreshToken: string | null;
  userId: string;
  expiresAt: Date | null;
};

const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g;

/** The tokens in a Cookie header, copied request headers or a bare token: an access token, a refresh token, or both.
 *  Null without one, or with two that are different accounts'. */
export function normalizeThangsSession(raw: string | null | undefined): ThangsSession | null {
  let token: string | null = null;
  let refreshToken: string | null = null;
  let userId: string | null = null;
  let expiresAt: Date | null = null;
  for (const candidate of (raw ?? "").match(JWT) ?? []) {
    const jwt = decodeThangsJwt(candidate);
    if (!jwt) continue;
    if (userId && jwt.userId !== userId) return null;
    userId = jwt.userId;
    if (jwt.refresh) refreshToken ??= candidate;
    else if (!token) {
      token = candidate;
      expiresAt = jwt.expiresAt;
    }
  }
  return userId && (token || refreshToken) ? { token, refreshToken, userId, expiresAt } : null;
}

const SESSION_SELECT = {
  thangsToken: true,
  thangsRefreshToken: true,
  thangsExpiresAt: true,
  thangsUserId: true,
  thangsRejectedAt: true,
} as const;

/** A new sign-in clears an earlier rejection. One without a refresh token keeps the one already there for the same
 *  Thangs account, so pasting a fresh access token doesn't lose the renewals. */
export async function setUserThangsSession(userId: string, session: ThangsSession | null): Promise<boolean> {
  if (!session) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        thangsToken: null,
        thangsRefreshToken: null,
        thangsExpiresAt: null,
        thangsUserId: null,
        thangsRejectedAt: null,
      },
    });
    return false;
  }
  const current = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_SELECT });
  const sameAccount = current?.thangsUserId === session.userId;
  await prisma.user.update({
    where: { id: userId },
    data: {
      thangsToken: session.token ?? (sameAccount ? current?.thangsToken : null) ?? null,
      thangsRefreshToken: session.refreshToken ?? (sameAccount ? current?.thangsRefreshToken : null) ?? null,
      thangsExpiresAt: session.token ? session.expiresAt : sameAccount ? (current?.thangsExpiresAt ?? null) : null,
      thangsUserId: session.userId,
      thangsRejectedAt: null,
    },
  });
  return true;
}

export async function markThangsSessionRejected(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { thangsRejectedAt: new Date() } });
}

export type ThangsConnection = "connected" | "disconnected" | "expired";

export async function getThangsConnection(userId: string): Promise<ThangsConnection> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_SELECT });
  if (!user?.thangsToken && !user?.thangsRefreshToken) return "disconnected";
  return user.thangsRejectedAt ? "expired" : "connected";
}

/** The Thangs account the user connected, whose likes are theirs; null when none is. */
export async function getUserThangsId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_SELECT });
  if (!user?.thangsUserId || user.thangsRejectedAt) return null;
  return user.thangsToken || user.thangsRefreshToken ? user.thangsUserId : null;
}

// One renewal at a time per user, however many imports ask at once.
const renewing = new Map<string, Promise<string>>();

/** A new access token from the stored refresh token, saved. Throws ThangsAuthError (and remembers it) when Thangs turns
 *  the refresh token down, or there's none to renew with. */
function renewToken(userId: string, refreshToken: string | null): Promise<string> {
  const running = renewing.get(userId);
  if (running) return running;
  const run = (async () => {
    if (!refreshToken) {
      await markThangsSessionRejected(userId);
      throw new ThangsAuthError();
    }
    try {
      const { token, expiresAt } = await refreshThangsToken(refreshToken);
      await prisma.user.update({ where: { id: userId }, data: { thangsToken: token, thangsExpiresAt: expiresAt } });
      log.info("access token renewed", { user: userId });
      return token;
    } catch (err) {
      if (err instanceof ThangsAuthError) {
        log.warn("refresh token turned down", { user: userId });
        await markThangsSessionRejected(userId);
      }
      throw err;
    }
  })().finally(() => renewing.delete(userId));
  renewing.set(userId, run);
  return run;
}

/** The user's access token, renewed first when it's out or nearly; null when they haven't connected Thangs or it
 *  turned them down. Throws ThangsAuthError when the renewal is turned down. */
export async function getUserThangsToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_SELECT });
  if (!user || user.thangsRejectedAt || (!user.thangsToken && !user.thangsRefreshToken)) return null;
  const fresh = user.thangsExpiresAt && user.thangsExpiresAt.getTime() - Date.now() > RENEW_BEFORE_MS;
  if (user.thangsToken && (fresh || !user.thangsRefreshToken)) return user.thangsToken;
  return renewToken(userId, user.thangsRefreshToken);
}

/** Runs `call` with the user's access token; when Thangs turns it down, renews it and tries once more. Throws
 *  ThangsAuthError once the sign-in itself is turned down, and remembers it. `token` must come from
 *  getUserThangsToken. */
export async function withThangsToken<T>(
  userId: string,
  token: string,
  call: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await call(token);
  } catch (err) {
    if (!(err instanceof ThangsAuthError)) throw err;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: SESSION_SELECT });
    // Renewed by a concurrent call meanwhile: that one's token is tried instead.
    const renewed =
      user?.thangsToken && user.thangsToken !== token
        ? user.thangsToken
        : await renewToken(userId, user?.thangsRefreshToken ?? null);
    try {
      return await call(renewed);
    } catch (retryErr) {
      if (retryErr instanceof ThangsAuthError) await markThangsSessionRejected(userId);
      throw retryErr;
    }
  }
}

/** Shown wherever a Thangs download needs a sign-in the user hasn't given, or that ran out. */
export const THANGS_CONNECT =
  "Thangs only gives its files to a signed-in user: visit thangs.com signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers, then import it again.";
