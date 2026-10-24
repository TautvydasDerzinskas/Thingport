import { prisma } from "../../db";
import type { Cults3dBrowser, Cults3dCredentials } from "./api";

// Per-user, two things. The API credentials -- the user's Cults3D nickname and an API key they make on the site --
// read models, likes, printlists and orders. The browser's sign-in -- its _session_id cookie, and the cf_clearance
// cookie with the User-Agent it was issued to -- opens the site's order and download pages; Thingport Grab sends it
// whenever the browser's changes, and pasting a signed-in request's headers works too. The session lasts 20 days from
// its last use, and Thingport's own use renews it.

const SESSION = /(?:^|[;\s])_session_id=([0-9a-f]{16,128})(?=;|\s|$)/i;
const CLEARANCE = /(?:^|[;\s])cf_clearance=([\w.~-]{20,4000})(?=;|\s|$)/i;
// "User-Agent: ..." from copied headers, or Chrome's DevTools, which puts the name and the value on lines of their own.
const USER_AGENT = /(?:^|\n)\s*user-agent\s*(?::\s*|\n\s*)(Mozilla\/[^\n]+)/i;

/** The sign-in in a Cookie header, or a signed-in request's copied headers. `userAgent` is the one to send with the
 *  clearance when the text doesn't carry its own. Null without a session cookie. */
export function normalizeCults3dBrowser(
  raw: string | null | undefined,
  userAgent?: string | null,
): Cults3dBrowser | null {
  const text = raw ?? "";
  const session = text.match(SESSION)?.[1];
  if (!session) return null;
  const clearance = text.match(CLEARANCE)?.[1] ?? null;
  const agent = text.match(USER_AGENT)?.[1]?.trim() || userAgent?.trim() || null;
  return { session, clearance, userAgent: agent };
}

const SELECT = {
  cults3dNick: true,
  cults3dApiKey: true,
  cults3dApiRejectedAt: true,
  cults3dSession: true,
  cults3dClearance: true,
  cults3dUserAgent: true,
  cults3dSessionRejectedAt: true,
} as const;

/** New credentials clear an earlier rejection; null forgets them. */
export async function setUserCults3dCredentials(userId: string, credentials: Cults3dCredentials | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      cults3dNick: credentials?.nick ?? null,
      cults3dApiKey: credentials?.apiKey ?? null,
      cults3dApiRejectedAt: null,
    },
  });
}

/** A new sign-in clears an earlier rejection; null forgets it. */
export async function setUserCults3dBrowser(userId: string, browser: Cults3dBrowser | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      cults3dSession: browser?.session ?? null,
      cults3dClearance: browser?.clearance ?? null,
      cults3dUserAgent: browser?.userAgent ?? null,
      cults3dSessionRejectedAt: null,
    },
  });
}

export async function markCults3dApiRejected(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { cults3dApiRejectedAt: new Date() } });
}

export async function markCults3dSessionRejected(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { cults3dSessionRejectedAt: new Date() } });
}

export type Cults3dConnectionState = "connected" | "disconnected" | "expired";
export type Cults3dConnection = { api: Cults3dConnectionState; site: Cults3dConnectionState; nick: string | null };

export async function getCults3dConnection(userId: string): Promise<Cults3dConnection> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  const api: Cults3dConnectionState =
    !user?.cults3dNick || !user.cults3dApiKey ? "disconnected" : user.cults3dApiRejectedAt ? "expired" : "connected";
  const site: Cults3dConnectionState = !user?.cults3dSession
    ? "disconnected"
    : user.cults3dSessionRejectedAt
      ? "expired"
      : "connected";
  return { api, site, nick: user?.cults3dNick ?? null };
}

/** The user's API credentials; null when they haven't given them, or Cults3D turned them down. */
export async function getUserCults3dCredentials(userId: string): Promise<Cults3dCredentials | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!user?.cults3dNick || !user.cults3dApiKey || user.cults3dApiRejectedAt) return null;
  return { nick: user.cults3dNick, apiKey: user.cults3dApiKey };
}

/** The browser's sign-in; null when Grab hasn't sent one, or the site turned it down since. */
export async function getUserCults3dBrowser(userId: string): Promise<Cults3dBrowser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  if (!user?.cults3dSession || user.cults3dSessionRejectedAt) return null;
  return { session: user.cults3dSession, clearance: user.cults3dClearance, userAgent: user.cults3dUserAgent };
}

/** Shown wherever Cults3D's API is needed and the user hasn't given their credentials, or they were turned down. */
export const CULTS3D_CONNECT =
  "Thingport reads Cults3D with your own API key: make one at cults3d.com/en/api/keys, then enter it with your " +
  "nickname in Configuration > Providers.";

/** Shown when the browser's sign-in came without Cloudflare's clearance cookie, which the download pages need. */
export const CULTS3D_NO_CLEARANCE =
  "Thingport has your Cults3D sign-in but not Cloudflare's clearance for it, which the downloads need. Update " +
  "Thingport Grab, then visit cults3d.com signed in again -- or paste a signed-in request's headers, with the " +
  "cf_clearance cookie, in Configuration > Providers.";

/** Shown wherever a download needs the browser's sign-in, and there's none. */
export const CULTS3D_SIGN_IN =
  "Cults3D only gives its files to a signed-in user: visit cults3d.com signed in with Thingport Grab, then import " +
  "it again.";
