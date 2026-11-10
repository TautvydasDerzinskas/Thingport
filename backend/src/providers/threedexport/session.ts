import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { HttpError } from "../../utils/fileUtils";
import { connectionState, readConnection, usableSecret, writeConnection, type ConnectionState } from "../connections";
import {
  checkThreedexportAuth,
  ThreedexportAuthError,
  threedexportVisit,
  type ThreedexportAccount,
  type ThreedexportSession,
  type ThreedexportVisit,
} from "./api";
import manifest from "./manifest.generated";

// Per-user: the 3DExport sign-in, which its files and the user's own collections need. It's the site's remember-me
// pair, kept ten years: the user's number (`nm_userid`) and a hash (`nm_hash`), from which any request starts a session
// of its own. Signing out of 3dexport.com anywhere revokes the hash. Thingport Grab reads both from the browser and
// sends them whenever they change; a pasted Cookie header, or a signed-in request's copied headers, works too. Who it
// is (accountId) is their username, which their profile is at.

const ID = manifest.id;
const { user: USER_COOKIE, hash: HASH_COOKIE } = manifest.sessionCookies;
const ROW = (userId: string) => ({ userId, provider: ID, slot: "default" });
// A visitor's number is -1, and no hash comes with it.
const USER = new RegExp(String.raw`(?:^|[;\s])${USER_COOKIE}=(\d{1,12})(?=;|\s|$)`);
const HASH = new RegExp(String.raw`(?:^|[;\s])${HASH_COOKIE}=([0-9a-f]{32})(?=;|\s|$)`, "i");

/** The sign-in in a Cookie header, or a signed-in request's copied headers; null without both halves of it. */
export function normalizeThreedexportSession(raw: string | null | undefined): ThreedexportSession | null {
  const text = raw ?? "";
  const userId = text.match(USER)?.[1];
  const hash = text.match(HASH)?.[1];
  return userId && Number(userId) > 0 && hash ? { userId, hash: hash.toLowerCase() } : null;
}

/** The user's sign-in, until 3DExport turns it down; null without one. */
export async function getUserThreedexportSession(userId: string): Promise<ThreedexportSession | null> {
  return usableSecret(await readConnection<ThreedexportSession>(userId, ID));
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserThreedexportSession(
  userId: string,
  session: ThreedexportSession | null,
  account: ThreedexportAccount | null = null,
): Promise<boolean> {
  await writeConnection<ThreedexportSession>(userId, ID, {
    secret: session,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.username, accountName: account.username }
      : session
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(session);
}

/** Marks the sign-in whose hash is `used` turned down, only while it's still the one stored; whether it was. */
export async function markThreedexportSessionRejected(userId: string, used: string): Promise<boolean> {
  const { count } = await prisma.providerConnection.updateMany({
    where: { ...ROW(userId), secret: { path: ["hash"], equals: used } },
    data: { rejectedAt: new Date() },
  });
  return count > 0;
}

/** Clears the sign-in whose hash is `hash`, only while it's still the one stored; whether it was. Who it was is kept,
 *  as on any disconnect. */
export async function clearThreedexportSessionIf(userId: string, hash: string): Promise<boolean> {
  const { count } = await prisma.providerConnection.updateMany({
    where: { ...ROW(userId), secret: { path: ["hash"], equals: hash } },
    data: { secret: Prisma.DbNull, expiresAt: null, rejectedAt: null },
  });
  return count > 0;
}

/** `err`, a turned-down sign-in among them, as what to report. That sign-in (the one the error names, else `used`) is
 *  marked rejected, unless another was saved meanwhile: that one isn't the one turned down, so it stays connected,
 *  and a 409 says to try again instead. */
export async function threedexportRejection(userId: string, used: string | null, err: unknown): Promise<unknown> {
  if (!(err instanceof ThreedexportAuthError)) return err;
  const hash = err.hash ?? used;
  if (!hash || (await markThreedexportSessionRejected(userId, hash))) return err;
  return new HttpError(
    409,
    "3DExport turned down the sign-in this started with, which has been replaced since. Try again.",
  );
}

/** `read` run as one visit with the user's sign-in, or as a visitor without one. A sign-in it turns down is
 *  remembered as such (`threedexportRejection`). */
export async function withThreedexportVisit<T>(
  userId: string,
  read: (visit: ThreedexportVisit) => Promise<T>,
): Promise<T> {
  const session = await getUserThreedexportSession(userId);
  try {
    return await read(threedexportVisit(session));
  } catch (err) {
    throw session ? await threedexportRejection(userId, session.hash, err) : err;
  }
}

export async function getThreedexportConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: ThreedexportAccount | null }> {
  const connection = await readConnection(userId, ID);
  const username = connection?.accountId ?? null;
  return { state: connectionState(connection), account: username ? { username } : null };
}

/** Who the user is on 3DExport, by their sign-in: as saved, or asked of the site and saved, where it was saved without
 *  a check that said. Null without a sign-in, or one the site doesn't answer for. */
export async function threedexportAccountOf(userId: string): Promise<ThreedexportAccount | null> {
  const [{ account }, session] = await Promise.all([
    getThreedexportConnection(userId),
    getUserThreedexportSession(userId),
  ]);
  if (account || !session) return session ? account : null;
  const check = await checkThreedexportAuth(session);
  // What the check says applies only to the sign-in it checked: a disconnect, or a new sign-in saved meanwhile, wins.
  if (check === "rejected") {
    await markThreedexportSessionRejected(userId, session.hash);
    return null;
  }
  if (typeof check !== "object") return null;
  const { count } = await prisma.providerConnection.updateMany({
    where: { ...ROW(userId), rejectedAt: null, secret: { path: ["hash"], equals: session.hash } },
    data: {
      accountId: check.username,
      accountName: check.username,
      secret: session as unknown as Prisma.InputJsonValue,
    },
  });
  return count ? check : null;
}

/** Shown wherever an import or a list needs the user's sign-in, and there's none. */
export const THREEDEXPORT_CONNECT =
  "3DExport gives its files to signed-in users only, the free models included: visit 3dexport.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
