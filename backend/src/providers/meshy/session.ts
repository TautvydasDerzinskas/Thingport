import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type Connection,
  type ConnectionState,
} from "../connections";
import { createLogger } from "../../logger";
import manifest from "./manifest.generated";
import {
  decodeMeshyToken,
  fetchMeshyAccount,
  MeshyAccountChangedError,
  MeshyAuthError,
  refreshMeshySession,
  type MeshyAccount,
  type MeshyAuth,
} from "./api";

// Per-user: the Meshy sign-in. Meshy signs in with Supabase, which keeps the session -- a 15-minute access token and
// the refresh token that renews it -- in the `sb-auth-auth-token` cookie, split across `.0`, `.1`, … once it outgrows
// one, as `base64-` and the session's JSON. Thingport keeps both tokens and renews the access token itself as it runs
// out, saving each new refresh token, as the site's pages do. In testing Meshy let the browser and Thingport each renew
// from the same sign-in without signing the other out; should it ever end it, the next visit with Grab sends a new one.
// Thingport Grab sends the cookie whenever the browser's changes, with the browser's device id and AWS bot-check token
// beside it; a pasted Cookie header works too.

const ID = manifest.id;
const { session: SESSION_PREFIX, device: DEVICE_COOKIE, waf: WAF_COOKIE } = manifest.sessionCookies;
const log = createLogger(ID);

// Renewed a little before it runs out, so a conversion that takes minutes never starts with a token about to.
const RENEW_BEFORE_MS = 2 * 60 * 1000;

type Secret = {
  accessToken: string;
  refreshToken: string;
  deviceId: string | null;
  wafToken: string | null;
  /** The account's handle on Meshy (`s1754341417b55bb`, or one they chose), which their profile's address is. */
  handle?: string | null;
};

/** A sign-in as read from the browser's cookies: the secret, whose it is and when its access token runs out. */
export type MeshySession = Secret & { userId: string; expiresAt: Date | null };

// A split cookie's last chunk holds whatever was left over, which may be a character or two.
const COOKIE_VALUE = String.raw`[\w%=+/.~:-]{1,8192}`;
const cookiePattern = (name: string) =>
  new RegExp(
    String.raw`(?:^|[;\s])(${name.replace(/[.-]/g, "\\$&")}(?:\.\d{1,2})?)="?(${COOKIE_VALUE})"?(?=[;\s]|$)`,
    "g",
  );

/** Which chunk of the split cookie a name is; -1 for an unsplit one, which comes first on its own. */
const chunkIndex = (name: string) => Number(name.match(/\.(\d{1,2})$/)?.[1] ?? -1);

/** The session JSON a cookie's value holds: `base64-` and its base64url, or, from older Supabase clients, the JSON
 *  percent-encoded. */
function sessionJson(value: string): Record<string, unknown> | null {
  try {
    const text = value.startsWith("base64-")
      ? Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")
      : decodeURIComponent(value);
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function firstCookie(text: string, name: string): string | null {
  return [...text.matchAll(cookiePattern(name))].find(([, found]) => found === name)?.[2] ?? null;
}

/** The sign-in in a Cookie header, or a signed-in request's copied headers. Null without one. */
export function normalizeMeshySession(raw: string | null | undefined): MeshySession | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const chunks = [...text.matchAll(cookiePattern(SESSION_PREFIX))].map(([, name, value]) => ({ name, value }));
  if (!chunks.length) return null;
  const value = chunks
    .toSorted((a, b) => chunkIndex(a.name) - chunkIndex(b.name))
    .map((chunk) => chunk.value)
    .join("");
  const session = sessionJson(value);
  const accessToken = typeof session?.access_token === "string" ? session.access_token : null;
  const refreshToken = typeof session?.refresh_token === "string" ? session.refresh_token : null;
  const claims = accessToken ? decodeMeshyToken(accessToken) : null;
  if (!accessToken || !refreshToken || !claims) return null;
  return {
    accessToken,
    refreshToken,
    deviceId: firstCookie(text, DEVICE_COOKIE),
    wafToken: firstCookie(text, WAF_COOKIE),
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  };
}

const authOf = (secret: Secret, accountId: string): MeshyAuth => ({
  token: secret.accessToken,
  deviceId: secret.deviceId,
  wafToken: secret.wafToken,
  accountId,
});

/** The user's Meshy connection, the row each write below is conditional on. */
const ROW = (userId: string) => ({ userId, provider: ID, slot: "default" });

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept with it; one for another
 *  account than the last forgets that one's name. */
export async function setUserMeshySession(
  userId: string,
  session: MeshySession | null,
  account: MeshyAccount | null = null,
): Promise<boolean> {
  if (!session) {
    await writeConnection(userId, ID, { secret: null, expiresAt: null, rejectedAt: null });
    return false;
  }
  const current = await readConnection<Secret>(userId, ID);
  const sameAccount = current?.accountId === session.userId;
  const { userId: meshyUserId, expiresAt, ...secret } = session;
  await writeConnection<Secret>(userId, ID, {
    secret: { ...secret, handle: account?.handle ?? (sameAccount ? (current?.secret?.handle ?? null) : null) },
    expiresAt,
    rejectedAt: null,
    accountId: meshyUserId,
    accountName: account?.name ?? (sameAccount ? (current?.accountName ?? null) : null),
  });
  return true;
}

export async function markMeshySessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

/** The Meshy account the user connected, as far as it's known: its id always, its name once Meshy said it. */
export async function getMeshyConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: MeshyAccount | null }> {
  const connection = await readConnection<Secret>(userId, ID);
  const accountId = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: accountId
      ? { userId: accountId, name: connection?.accountName ?? null, handle: connection?.secret?.handle ?? null }
      : null,
  };
}

// One renewal of a refresh token at a time, however many calls ask at once: a second would spend the token the first
// already used.
const renewing = new Map<string, Promise<Secret>>();

/** The stored sign-in of `accountId`, renewed and saved. The save, and a refusal's mark, apply only while the refresh
 *  token renewed is still the one stored: a disconnect, or a new sign-in saved meanwhile, wins over them. Throws
 *  MeshyAuthError when Supabase turns the refresh token down. */
function renew(userId: string, secret: Secret, accountId: string): Promise<Secret> {
  const key = `${userId}:${secret.refreshToken}`;
  const running = renewing.get(key);
  if (running) return running;
  const stillStored = { ...ROW(userId), accountId, secret: { path: ["refreshToken"], equals: secret.refreshToken } };
  const run = (async () => {
    try {
      const tokens = await refreshMeshySession(secret.refreshToken);
      const renewed: Secret = { ...secret, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
      // Saved before anything uses it: the refresh token it replaced is spent.
      const { count } = await prisma.providerConnection.updateMany({
        where: stillStored,
        data: { secret: renewed as Prisma.InputJsonValue, expiresAt: tokens.expiresAt },
      });
      log.info(count ? "access token renewed" : "access token renewed, but a newer sign-in was kept", { user: userId });
      return renewed;
    } catch (err) {
      if (err instanceof MeshyAuthError) {
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

/** The user's sign-in to call Meshy with, renewed first when it's out or nearly, and who it is; null when they haven't
 *  connected Meshy or it turned them down. Throws MeshyAuthError when the renewal is turned down. */
export async function getUserMeshyAuth(userId: string): Promise<{ auth: MeshyAuth; account: MeshyAccount } | null> {
  const connection = await readConnection<Secret>(userId, ID);
  const secret = usableSecret<Secret>(connection);
  const accountId = connection?.accountId;
  if (!secret || !accountId) return null;
  const current = fresh(connection.expiresAt) ? secret : await renew(userId, secret, accountId);
  const auth = authOf(current, accountId);
  const account = { userId: accountId, name: connection.accountName, handle: secret.handle ?? null };
  return { auth, account: account.name ? account : await resolveAccount(userId, auth, account) };
}

/** Who the sign-in is, asked of Meshy once and kept -- on that account's connection only, should another have been
 *  saved meanwhile; the id alone when it can't be asked just now. */
async function resolveAccount(userId: string, auth: MeshyAuth, known: MeshyAccount): Promise<MeshyAccount> {
  const account = await fetchMeshyAccount(auth).catch(() => null);
  if (!account || account.userId !== known.userId) return known;
  // In place, so the tokens a renewal may have saved meanwhile stay as they are.
  await prisma.$executeRaw`
    UPDATE "ProviderConnection"
    SET "accountName" = ${account.name},
        secret = jsonb_set(secret, '{handle}', ${JSON.stringify(account.handle)}::jsonb),
        "updatedAt" = now()
    WHERE "userId" = ${userId} AND provider = ${ID} AND slot = 'default'
      AND "accountId" = ${known.userId} AND secret IS NOT NULL`;
  return account;
}

/** Runs `call` with the user's sign-in; when Meshy turns the access token down, renews it and tries once more -- as
 *  the same account only: throws MeshyAccountChangedError when another was connected meanwhile. Throws MeshyAuthError
 *  once the sign-in itself is turned down, and remembers it. */
export async function withMeshyAuth<T>(
  userId: string,
  auth: MeshyAuth,
  call: (auth: MeshyAuth) => Promise<T>,
): Promise<T> {
  try {
    return await call(auth);
  } catch (err) {
    if (!(err instanceof MeshyAuthError)) throw err;
    // The account and its tokens from the one read, so the retry can't pair one account with another's tokens.
    const connection: Connection<Secret> | null = await readConnection<Secret>(userId, ID);
    const secret = usableSecret<Secret>(connection);
    if (!secret || !connection?.accountId) throw err;
    if (auth.accountId && connection.accountId !== auth.accountId) throw new MeshyAccountChangedError();
    const accountId = connection.accountId;
    // Renewed by a concurrent call meanwhile: that one's token is tried instead.
    const renewed = secret.accessToken !== auth.token ? secret : await renew(userId, secret, accountId);
    try {
      return await call(authOf(renewed, accountId));
    } catch (retryErr) {
      if (retryErr instanceof MeshyAuthError) await markMeshySessionRejected(userId);
      throw retryErr;
    }
  }
}

/** Checks a sign-in with Meshy before it's kept: renewed first when its access token has run out, as a cookie Grab
 *  reads from a tab left closed may have. The session to keep -- the renewed one, if it was, whose refresh token is the
 *  only one left that works -- with who it is, and whether Meshy could be asked; null when it turned the sign-in down. */
export async function checkMeshySession(
  session: MeshySession,
): Promise<{ session: MeshySession; account: MeshyAccount | null; reachable: boolean } | null> {
  let current = session;
  try {
    if (!fresh(session.expiresAt)) current = { ...session, ...(await refreshMeshySession(session.refreshToken)) };
    return { session: current, account: await fetchMeshyAccount(authOf(current, session.userId)), reachable: true };
  } catch (err) {
    return err instanceof MeshyAuthError ? null : { session: current, account: null, reachable: false };
  }
}

/** Shown wherever a Meshy download needs a sign-in the user hasn't given, or that ended. */
export const MESHY_CONNECT =
  "Meshy only hands its files to a signed-in account: visit meshy.ai signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers, then import it again.";
