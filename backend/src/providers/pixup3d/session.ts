import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import { checkPixup3dAuth, type Pixup3dMember, type Pixup3dSession } from "./api";
import manifest from "./manifest.generated";

// Per-user: the PIXUP sign-in, which its files need. It's Rails' session, kept whole in its cookie and issued anew with
// every answer; no remember-me cookie sits beside it. Thingport keeps the newest one it was given, so its own imports
// keep it as fresh as a visit would. Thingport Grab reads it from a signed-in pixup3d.com page and sends each new one;
// a pasted Cookie header, or the cookie's bare value, works too. Who it is (accountId) is their username, which their
// page, wishlist and collections are at.

const ID = manifest.id;
const { session: SESSION_COOKIE } = manifest.sessionCookies;
const ROW = (userId: string) => ({ userId, provider: ID, slot: "default" });
// Rails' encrypted cookie, percent-encoded: its data, IV and tag, each base64, joined by "--". Kept as written: its
// case matters.
const VALUE = String.raw`[A-Za-z0-9%+/=]{16,8000}--[A-Za-z0-9%+/=]{8,200}--[A-Za-z0-9%+/=]{8,200}`;
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}=(${VALUE})(?=;|\s|$)`);
const BARE = new RegExp(`^${VALUE}$`);

/** The sign-in in a Cookie header, a signed-in request's copied headers, or the cookie's bare value; null when there's
 *  none. A visitor gets a session cookie too, so only checking it tells whether it signs anyone in. */
export function normalizePixup3dSession(raw: string | null | undefined): Pixup3dSession | null {
  const text = (raw ?? "").trim();
  const session = BARE.test(text) ? text : text.match(SESSION)?.[1];
  return session ? { session } : null;
}

/** The user's sign-in, until PIXUP turns it down; null without one. */
export async function getUserPixup3dSession(userId: string): Promise<Pixup3dSession | null> {
  return usableSecret(await readConnection<Pixup3dSession>(userId, ID));
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserPixup3dSession(
  userId: string,
  session: Pixup3dSession | null,
  account: Pixup3dMember | null = null,
): Promise<boolean> {
  await writeConnection<Pixup3dSession>(userId, ID, {
    secret: session,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.username, accountName: account.name ?? account.username }
      : session
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(session);
}

/** The newer session the site answered `used` with, kept in its place -- only while `used` is still the one stored,
 *  so a disconnect or a sign-in Grab sent meanwhile wins. */
export async function keepRenewedPixup3dSession(userId: string, used: string, session: Pixup3dSession): Promise<void> {
  if (session.session === used) return;
  await prisma.providerConnection.updateMany({
    where: { ...ROW(userId), rejectedAt: null, secret: { path: ["session"], equals: used } },
    data: { secret: { session: session.session } as Prisma.InputJsonValue },
  });
}

export async function markPixup3dSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getPixup3dConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: Pixup3dMember | null }> {
  const connection = await readConnection(userId, ID);
  const username = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: username ? { username, name: connection?.accountName ?? null } : null,
  };
}

/** Who the user is on PIXUP, by their sign-in: as saved, or asked of the site and saved, where it was saved without a
 *  check that said. Null without a sign-in, or one the site doesn't answer for. */
export async function pixup3dMemberOf(userId: string): Promise<Pixup3dMember | null> {
  const [{ account }, session] = await Promise.all([getPixup3dConnection(userId), getUserPixup3dSession(userId)]);
  if (account || !session) return session ? account : null;
  const check = await checkPixup3dAuth(session);
  if (check === "rejected") await markPixup3dSessionRejected(userId);
  if (typeof check !== "object") return null;
  await setUserPixup3dSession(userId, session, check);
  return check;
}

/** Shown wherever an import needs the user's sign-in, and there's none. */
export const PIXUP3D_CONNECT =
  "PIXUP gives its files to signed-in members only: visit pixup3d.com signed in with Thingport Grab, or connect it " +
  "in Configuration > Providers.";
