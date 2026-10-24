import { prisma } from "../../db";
import manifest from "../_generated/nexprint/manifest";

// Per-user: the NexPrint token, its auth_token cookie, sent as a Bearer token. The site keeps the cookie for a week and
// sets it again whenever it refreshes the token, so Thingport Grab sends each new one on. The cookie's expiry is kept
// only to show; the token is used until NexPrint turns it down, as it may outlive the cookie.

const TOKEN_COOKIE = manifest.sessionCookies.token;

export type NexprintSession = { token: string; expiresAt: Date | null };

/** The token from a bare value, an `Authorization: Bearer` header or a whole Cookie header; null when there's none. */
export function normalizeNexprintSession(
  raw: string | null | undefined,
  expiresAt: Date | null = null,
): NexprintSession | null {
  let text = (raw ?? "")
    .replace(/^\s*(cookie|authorization):\s*/i, "")
    .replace(/^\s*bearer\s+/i, "")
    .trim();
  const pair = text
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TOKEN_COOKIE}=`));
  if (pair) {
    try {
      text = decodeURIComponent(pair.slice(TOKEN_COOKIE.length + 1));
    } catch {
      return null; // Malformed percent-encoding: not a token.
    }
  }
  return /^[0-9a-f]{32,128}$/i.test(text) ? { token: text, expiresAt } : null;
}

/** The user's token until NexPrint turns it down; null without one. */
export async function getUserNexprintToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nexprintToken: true, nexprintRejectedAt: true },
  });
  if (!user?.nexprintToken || user.nexprintRejectedAt) return null;
  return user.nexprintToken;
}

/** A new token clears an earlier rejection. */
export async function setUserNexprintSession(userId: string, session: NexprintSession | null): Promise<boolean> {
  await prisma.user.update({
    where: { id: userId },
    data: session
      ? { nexprintToken: session.token, nexprintExpiresAt: session.expiresAt, nexprintRejectedAt: null }
      : { nexprintToken: null, nexprintExpiresAt: null, nexprintRejectedAt: null },
  });
  return Boolean(session);
}

export async function markNexprintSessionRejected(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { nexprintRejectedAt: new Date() } });
}

export type NexprintConnection = "connected" | "disconnected" | "expired";

export async function getNexprintConnection(userId: string): Promise<NexprintConnection> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nexprintToken: true, nexprintRejectedAt: true },
  });
  if (!user?.nexprintToken) return "disconnected";
  return user.nexprintRejectedAt ? "expired" : "connected";
}

/** Shown wherever a NexPrint download needs a sign-in the user hasn't given, or that ran out. */
export const NEXPRINT_CONNECT =
  "NexPrint only gives its files to a signed-in user: visit nexprint.com signed in with Thingport Grab, " +
  "or connect it in Configuration > Providers, then import it again.";
