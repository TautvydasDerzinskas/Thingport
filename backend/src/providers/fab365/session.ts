import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { createLogger } from "../../logger";
import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type Connection,
  type ConnectionState,
} from "../connections";
import {
  checkFab365Auth,
  decodeFab365Token,
  Fab365AuthError,
  refreshFab365Session,
  type Fab365Auth,
  type Fab365Member,
  type Fab365Secret,
} from "./api";
import manifest from "./manifest.generated";

// Per-user: the Fab365 sign-in. Fab365 keeps it in page storage as a short-lived JWT (`accessToken`, about 100 minutes)
// with the refresh token beside it. Thingport keeps both and renews the access token itself as it runs out, saving each
// new refresh token, as the site's own 401 retry does -- the refresh token rotates, and only works once the access
// token has actually expired. Thingport Grab reads the pair from an open fab365.net tab and sends each new one; a pasted
// access token works too, though without a refresh token beside it, it can't be renewed. Who it is (accountId) is the
// token's `loginId`.

const ID = manifest.id;
const log = createLogger(ID);

// Renewed a little before it runs out, so an import that takes a minute never starts with a token about to expire.
const RENEW_BEFORE_MS = 60 * 1000;

/** A sign-in as read from the browser or a paste: the secret, whose it is and when its access token runs out. */
export type Fab365Session = Fab365Secret & { userId: string; expiresAt: Date | null };

/** The sign-in Grab sends (`access_token`/`refresh_token`) or a pasted access token; null when it isn't a token. A
 *  paste may bring only the access token, which works until it expires but can't be renewed. */
export function normalizeFab365Session(
  accessToken: string | null | undefined,
  refreshToken: string | null | undefined,
): Fab365Session | null {
  const access = (accessToken ?? "").trim();
  const claims = access ? decodeFab365Token(access) : null;
  if (!access || !claims) return null;
  return {
    accessToken: access,
    refreshToken: (refreshToken ?? "").trim() || null,
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  };
}

const authOf = (secret: Fab365Secret, accountId: string): Fab365Auth => ({ token: secret.accessToken, accountId });

/** The user's Fab365 connection, the row each write below is conditional on. */
const ROW = (userId: string) => ({ userId, provider: ID, slot: "default" });

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept with it; one for another
 *  account than the last forgets that one's name. */
export async function setUserFab365Session(
  userId: string,
  session: Fab365Session | null,
  account: Fab365Member | null = null,
): Promise<boolean> {
  if (!session) {
    await writeConnection(userId, ID, { secret: null, expiresAt: null, rejectedAt: null });
    return false;
  }
  const current = await readConnection<Fab365Secret>(userId, ID);
  const sameAccount = current?.accountId === session.userId;
  const secret: Fab365Secret = { accessToken: session.accessToken, refreshToken: session.refreshToken };
  await writeConnection<Fab365Secret>(userId, ID, {
    secret,
    expiresAt: session.expiresAt,
    rejectedAt: null,
    accountId: session.userId,
    accountName: account?.name ?? (sameAccount ? (current?.accountName ?? null) : null),
  });
  return true;
}

export async function markFab365SessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

/** The Fab365 account the user connected, as far as it's known: its id always, its name once Fab365 said it. */
export async function getFab365Connection(
  userId: string,
): Promise<{ state: ConnectionState; account: Fab365Member | null }> {
  const connection = await readConnection<Fab365Secret>(userId, ID);
  const accountId = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: accountId ? { userId: accountId, name: connection?.accountName ?? null } : null,
  };
}

// One renewal of a refresh token at a time, however many calls ask at once: a second would spend the token the first
// already used.
const renewing = new Map<string, Promise<Fab365Secret>>();

/** The stored sign-in of `accountId`, renewed and saved. The save, and a refusal's mark, apply only while the refresh
 *  token renewed is still the one stored: a disconnect, or a new sign-in saved meanwhile, wins over them. Throws
 *  Fab365AuthError when Fab365 turns the refresh token down. */
function renew(userId: string, secret: Fab365Secret, accountId: string): Promise<Fab365Secret> {
  // A pasted access token with no refresh token beside it can't be renewed; it just runs out.
  const refreshToken = secret.refreshToken;
  if (!refreshToken) return Promise.reject(new Fab365AuthError());
  const key = `${userId}:${refreshToken}`;
  const running = renewing.get(key);
  if (running) return running;
  const stillStored = {
    ...ROW(userId),
    accountId,
    secret: { path: ["refreshToken"], equals: refreshToken },
  };
  const run = (async () => {
    try {
      const tokens = await refreshFab365Session(secret);
      const renewed: Fab365Secret = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
      // Saved before anything uses it: the refresh token it replaced is spent.
      const { count } = await prisma.providerConnection.updateMany({
        where: stillStored,
        data: { secret: renewed as Prisma.InputJsonValue, expiresAt: tokens.expiresAt },
      });
      log.info(count ? "access token renewed" : "access token renewed, but a newer sign-in was kept", { user: userId });
      return renewed;
    } catch (err) {
      if (err instanceof Fab365AuthError) {
        log.warn("refresh token turned down", { user: userId });
        await prisma.providerConnection.updateMany({ where: stillStored, data: { rejectedAt: new Date() } });
      }
      throw err;
    }
  })().finally(() => renewing.delete(key));
  renewing.set(key, run);
  return run;
}

const fresh = (expiresAt: Date | null) => Boolean(expiresAt && expiresAt.getTime() - Date.now() > RENEW_BEFORE_MS);

/** The user's sign-in to call Fab365 with, renewed first when it's out or nearly, and who it is; null when they haven't
 *  connected Fab365 or it turned them down. Throws Fab365AuthError when the renewal is turned down. */
export async function getUserFab365Auth(userId: string): Promise<{ auth: Fab365Auth; account: Fab365Member } | null> {
  const connection = await readConnection<Fab365Secret>(userId, ID);
  const secret = usableSecret<Fab365Secret>(connection);
  const accountId = connection?.accountId;
  if (!secret || !accountId) return null;
  const current = fresh(connection.expiresAt) ? secret : await renew(userId, secret, accountId);
  return { auth: authOf(current, accountId), account: { userId: accountId, name: connection.accountName } };
}

/** Runs `call` with the user's sign-in; when Fab365 turns the access token down, renews it and tries once more. Throws
 *  Fab365AuthError once the sign-in itself is turned down, and remembers it. */
export async function withFab365Auth<T>(
  userId: string,
  auth: Fab365Auth,
  call: (auth: Fab365Auth) => Promise<T>,
): Promise<T> {
  try {
    return await call(auth);
  } catch (err) {
    if (!(err instanceof Fab365AuthError)) throw err;
    const connection: Connection<Fab365Secret> | null = await readConnection<Fab365Secret>(userId, ID);
    const secret = usableSecret<Fab365Secret>(connection);
    if (!secret || !connection?.accountId) throw err;
    const accountId = connection.accountId;
    // Renewed by a concurrent call meanwhile: that one's token is tried instead.
    const renewed = secret.accessToken !== auth.token ? secret : await renew(userId, secret, accountId);
    try {
      return await call(authOf(renewed, accountId));
    } catch (retryErr) {
      if (retryErr instanceof Fab365AuthError) await markFab365SessionRejected(userId);
      throw retryErr;
    }
  }
}

/** Checks a sign-in with Fab365 before it's kept: renewed first when its access token has run out, as a token Grab read
 *  from a tab left open may have. The session to keep -- the renewed one, if it was -- with who it is, and whether
 *  Fab365 could be asked; null when it turned the sign-in down. */
export async function checkFab365Session(
  session: Fab365Session,
): Promise<{ session: Fab365Session; account: Fab365Member | null; reachable: boolean } | null> {
  let current = session;
  try {
    if (!fresh(session.expiresAt) && session.refreshToken) {
      const tokens = await refreshFab365Session(session);
      current = { ...session, ...tokens };
    }
    const check = await checkFab365Auth(current.accessToken);
    if (check === "rejected") return null;
    return { session: current, account: check === "unreachable" ? null : check, reachable: check !== "unreachable" };
  } catch (err) {
    return err instanceof Fab365AuthError ? null : { session: current, account: null, reachable: false };
  }
}

/** Shown wherever a Fab365 download needs a sign-in the user hasn't given, or that ended. */
export const FAB365_CONNECT =
  "Fab365 hands its files to signed-in members only: visit fab365.net signed in with Thingport Grab, or connect it " +
  "in Configuration > Providers, then import it again.";
