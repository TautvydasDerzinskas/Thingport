import {
  connectionState,
  readConnection,
  rejectConnection,
  writeConnection,
  type ConnectionState,
} from "../connections";
import { createLogger } from "../../logger";
import manifest from "./manifest.generated";
import { decodeThangsJwt, refreshThangsToken, ThangsAuthError } from "./api";

// Per-user: the Thangs sign-in, its accessToken cookie (a 7-day JWT, sent as a Bearer token) and the refreshToken
// cookie that renews it. The refresh token lasts about a year and Thangs keeps it as it is on use, so Thingport renews
// the access token itself as it runs out; Thingport Grab sends both whenever the browser's change.

const ID = manifest.id;
const log = createLogger(ID);

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

type Secret = { token: string | null; refreshToken: string | null };

/** What's stored, flattened; null without a row. */
async function stored(userId: string) {
  const connection = await readConnection<Secret>(userId, ID);
  return (
    connection && {
      token: connection.secret?.token ?? null,
      refreshToken: connection.secret?.refreshToken ?? null,
      expiresAt: connection.expiresAt,
      userId: connection.accountId,
      rejectedAt: connection.rejectedAt,
    }
  );
}

/** Both tokens as a secret: null when neither is left. */
const secretOf = (token: string | null, refreshToken: string | null): Secret | null =>
  token || refreshToken ? { token, refreshToken } : null;

/** A new sign-in clears an earlier rejection. One without a refresh token keeps the one already there for the same
 *  Thangs account, so pasting a fresh access token doesn't lose the renewals. */
export async function setUserThangsSession(userId: string, session: ThangsSession | null): Promise<boolean> {
  if (!session) {
    await writeConnection(userId, ID, { secret: null, expiresAt: null, accountId: null, rejectedAt: null });
    return false;
  }
  const current = await stored(userId);
  const sameAccount = current?.userId === session.userId;
  await writeConnection<Secret>(userId, ID, {
    secret: secretOf(
      session.token ?? (sameAccount ? current?.token : null) ?? null,
      session.refreshToken ?? (sameAccount ? current?.refreshToken : null) ?? null,
    ),
    expiresAt: session.token ? session.expiresAt : sameAccount ? (current?.expiresAt ?? null) : null,
    accountId: session.userId,
    rejectedAt: null,
  });
  return true;
}

export async function markThangsSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export type ThangsConnection = ConnectionState;

export async function getThangsConnection(userId: string): Promise<ThangsConnection> {
  return connectionState(await readConnection(userId, ID));
}

/** The Thangs account the user connected, whose likes are theirs; null when none is. */
export async function getUserThangsId(userId: string): Promise<string | null> {
  const user = await stored(userId);
  if (!user?.userId || user.rejectedAt) return null;
  return user.token || user.refreshToken ? user.userId : null;
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
      const current = await stored(userId);
      await writeConnection<Secret>(userId, ID, { secret: secretOf(token, current?.refreshToken ?? null), expiresAt });
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
  const user = await stored(userId);
  if (!user || user.rejectedAt || (!user.token && !user.refreshToken)) return null;
  const fresh = user.expiresAt && user.expiresAt.getTime() - Date.now() > RENEW_BEFORE_MS;
  if (user.token && (fresh || !user.refreshToken)) return user.token;
  return renewToken(userId, user.refreshToken);
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
    const user = await stored(userId);
    // Renewed by a concurrent call meanwhile: that one's token is tried instead.
    const renewed =
      user?.token && user.token !== token ? user.token : await renewToken(userId, user?.refreshToken ?? null);
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
