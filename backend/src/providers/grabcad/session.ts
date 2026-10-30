import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import { checkGrabcadAuth, type GrabcadMember, type GrabcadSession } from "./api";
import manifest from "./manifest.generated";

// Per-user: the GrabCAD sign-in, which downloading its files needs. It's Rails' session cookie, with no remember-me
// cookie beside it: the site keeps it two days from its last use, Thingport's own included. Thingport Grab reads it
// from a signed-in grabcad.com page and sends each new one; a pasted Cookie header, or the cookie's bare value, works
// too. Who it is (accountId) is their member slug, which their page and their likes are at.

const ID = manifest.id;
const { session: SESSION_COOKIE } = manifest.sessionCookies;
const VALUE = String.raw`[0-9a-f]{16,128}`;
const SESSION = new RegExp(String.raw`(?:^|[;\s])${SESSION_COOKIE}=(${VALUE})(?=;|\s|$)`, "i");
const BARE = new RegExp(`^${VALUE}$`, "i");

/** The sign-in in a Cookie header, a signed-in request's copied headers, or the cookie's bare value; null when there's
 *  none. A visitor gets a session cookie too, so only checking it tells whether it signs anyone in. */
export function normalizeGrabcadSession(raw: string | null | undefined): GrabcadSession | null {
  const text = (raw ?? "").trim();
  const session = BARE.test(text) ? text : text.match(SESSION)?.[1];
  return session ? { session: session.toLowerCase() } : null;
}

/** The user's sign-in, until GrabCAD turns it down; null without one. */
export async function getUserGrabcadSession(userId: string): Promise<GrabcadSession | null> {
  return usableSecret(await readConnection<GrabcadSession>(userId, ID));
}

/** A new sign-in clears an earlier rejection. Who it is, where a check said so, is kept on disconnect; one that was
 *  never checked forgets the last one's, as it may be someone else's. */
export async function setUserGrabcadSession(
  userId: string,
  session: GrabcadSession | null,
  account: GrabcadMember | null = null,
): Promise<boolean> {
  await writeConnection<GrabcadSession>(userId, ID, {
    secret: session,
    expiresAt: null,
    rejectedAt: null,
    ...(account
      ? { accountId: account.member, accountName: account.name ?? account.member }
      : session
        ? { accountId: null, accountName: null }
        : {}),
  });
  return Boolean(session);
}

export async function markGrabcadSessionRejected(userId: string): Promise<void> {
  await rejectConnection(userId, ID);
}

export async function getGrabcadConnection(
  userId: string,
): Promise<{ state: ConnectionState; account: GrabcadMember | null }> {
  const connection = await readConnection(userId, ID);
  const member = connection?.accountId ?? null;
  return {
    state: connectionState(connection),
    account: member ? { member, name: connection?.accountName ?? null } : null,
  };
}

/** Who the user is on GrabCAD, by their sign-in: as saved, or asked of the site and saved, where it was saved without
 *  a check that said. Null without a sign-in, or one the site doesn't answer for. */
export async function grabcadMemberOf(userId: string): Promise<GrabcadMember | null> {
  const [{ account }, session] = await Promise.all([getGrabcadConnection(userId), getUserGrabcadSession(userId)]);
  if (account || !session) return session ? account : null;
  const check = await checkGrabcadAuth(session);
  if (check === "rejected") await markGrabcadSessionRejected(userId);
  if (typeof check !== "object") return null;
  await setUserGrabcadSession(userId, session, check);
  return check;
}

/** Shown wherever an import needs the user's sign-in, and there's none. */
export const GRABCAD_CONNECT =
  "GrabCAD gives its files to signed-in users only: visit grabcad.com signed in with Thingport Grab, or connect it " +
  "in Configuration > Providers.";
