import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import {
  connectionState,
  readConnection,
  rejectConnection,
  usableSecret,
  writeConnection,
  type ConnectionState,
} from "../connections";
import manifest from "./manifest.generated";

// Per-user: the VoxelShare sign-in, which only the user's own collections and likes need. It's the site's `token`
// cookie, a signed token good for 31 days that its pages send as a Bearer token. The site renews it with a refresh
// token kept beside it, which Thingport never uses: whether a renewal signs the browser out is unknown, so Thingport
// Grab sends each new token the browser gets instead. The token says when it runs out, and the site takes it no longer.

const TOKEN_COOKIE = manifest.sessionCookies.token;
const ID = manifest.id;
type Secret = { token: string };

// A JSON Web Token: three base64url parts, the first two JSON.
const TOKEN = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/;

/** The token from a bare value, an Authorization header, a Cookie header, or a row of the browser's cookie table pasted
 *  from its developer tools (the name, a tab, then the value); null when there's none. */
export function normalizeVoxelshareSession(raw: string | null | undefined): string | null {
  const text = (raw ?? "")
    .replace(/^\s*(?:cookie|authorization):\s*/i, "")
    .replace(/^bearer\s+/i, "")
    .trim();
  if (TOKEN.test(text)) return text;
  const pair = text
    .split(/[;\n]/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${TOKEN_COOKIE}=`));
  const row = text.match(new RegExp(String.raw`^${TOKEN_COOKIE}[ \t]+(\S+)`, "m"));
  let value = pair ? pair.slice(TOKEN_COOKIE.length + 1) : (row?.[1] ?? "");
  try {
    value = decodeURIComponent(value);
  } catch {
    return null; // Malformed percent-encoding: not a token.
  }
  return TOKEN.test(value) ? value : null;
}

/** What the token says of itself, unchecked: it's only shown, or compared with another of the site's. */
function claims(token: string): { exp?: unknown; sub?: unknown } {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

/** When the token runs out, as it says itself; null where it doesn't say. */
export function voxelshareTokenExpiry(token: string): Date | null {
  const { exp } = claims(token);
  return typeof exp === "number" && Number.isFinite(exp) ? new Date(exp * 1000) : null;
}

/** Whose the token is, by the account number it names; null where it names none. */
export function voxelshareTokenAccount(token: string): string | null {
  const { sub } = claims(token);
  return typeof sub === "string" && sub ? sub : typeof sub === "number" ? String(sub) : null;
}

/** The user's token until VoxelShare turns it down or it runs out; null without one. */
export async function getUserVoxelshareToken(userId: string): Promise<string | null> {
  return usableSecret(await readConnection<Secret>(userId, ID), true)?.token ?? null;
}

/** A new token clears an earlier rejection. Whose it is, where known, is kept beside it; on disconnect it stays. A
 *  token saved without saying whose it is (Grab sends each new one so) keeps the name only while it's the same
 *  account's as the token it replaces: a renewal, not someone else signing in. */
export async function setUserVoxelshareSession(
  userId: string,
  token: string | null,
  account: { id: string; name: string | null } | null = null,
): Promise<boolean> {
  let whose: { accountId?: string | null; accountName?: string | null } = {};
  if (account) whose = { accountId: account.id, accountName: account.name };
  else if (token) {
    const stored = (await readConnection<Secret>(userId, ID))?.secret?.token;
    const sameAccount = Boolean(stored) && voxelshareTokenAccount(stored!) === voxelshareTokenAccount(token);
    if (!sameAccount || !voxelshareTokenAccount(token)) whose = { accountId: null, accountName: null };
  }
  await writeConnection<Secret>(userId, ID, {
    secret: token ? { token } : null,
    expiresAt: token ? voxelshareTokenExpiry(token) : null,
    rejectedAt: null,
    ...whose,
  });
  return Boolean(token);
}

/** With `token`, only while it's still the one stored: Grab may have sent a new one since it was read. */
export async function markVoxelshareSessionRejected(userId: string, token?: string): Promise<void> {
  await rejectConnection(userId, ID, "default", token ? ({ token } satisfies Secret) : undefined);
}

/** Forgets `token`, only while it's still the one stored. Whose it was is kept, as on any disconnect. */
export async function clearVoxelshareSessionIf(userId: string, token: string): Promise<void> {
  await prisma.providerConnection.updateMany({
    where: { userId, provider: ID, slot: "default", secret: { equals: { token } satisfies Secret } },
    data: { secret: Prisma.DbNull, expiresAt: null, rejectedAt: null },
  });
}

/** Whose sign-in Thingport has, by the name VoxelShare shows them under; null when it doesn't know. */
export async function getVoxelshareAccountName(userId: string): Promise<string | null> {
  return (await readConnection<Secret>(userId, ID))?.accountName ?? null;
}

export async function getVoxelshareConnection(userId: string): Promise<ConnectionState> {
  return connectionState(await readConnection(userId, ID), true);
}

/** Shown wherever the user's own lists need a sign-in they haven't given, or that ran out. */
export const VOXELSHARE_CONNECT =
  "VoxelShare shows your likes and private collections to you only: visit www.voxelshare.com signed in with " +
  "Thingport Grab, or connect it in Configuration > Providers.";
