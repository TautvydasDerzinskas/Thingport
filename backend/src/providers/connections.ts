import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { AuthSlot, ProviderId } from "./index.generated";

// Each user's sign-in on a provider, and who they are there: a ProviderConnection row per user, provider and auth
// slot. What a secret holds is the provider's own (its session.ts), so a new provider needs no column.

/** The manifest's auth slots a user fills; "instance" ones are the admin's, in Settings. */
export type UserSlot = Exclude<AuthSlot["slot"], "instance">;

export type Connection<S> = {
  /** Null once the user disconnected, with who they were there kept. */
  secret: S | null;
  expiresAt: Date | null;
  /** When the provider last turned the secret down; giving a new one clears it. */
  rejectedAt: Date | null;
  accountId: string | null;
  accountName: string | null;
};

export type ConnectionState = "connected" | "disconnected" | "expired";

const key = (userId: string, provider: ProviderId, slot: UserSlot) => ({
  userId_provider_slot: { userId, provider, slot },
});

export async function readConnection<S>(
  userId: string,
  provider: ProviderId,
  slot: UserSlot = "default",
): Promise<Connection<S> | null> {
  const row = await prisma.providerConnection.findUnique({ where: key(userId, provider, slot) });
  if (!row) return null;
  const { secret, expiresAt, rejectedAt, accountId, accountName } = row;
  return { secret: (secret as S | null) ?? null, expiresAt, rejectedAt, accountId, accountName };
}

/** Writes the fields given, adding the row if there's none; those left out keep their values. */
export async function writeConnection<S>(
  userId: string,
  provider: ProviderId,
  fields: Partial<Connection<S>>,
  slot: UserSlot = "default",
): Promise<void> {
  const { secret, ...rest } = fields;
  const data = {
    ...rest,
    ...(secret === undefined ? {} : { secret: secret === null ? Prisma.DbNull : (secret as Prisma.InputJsonValue) }),
  };
  await prisma.providerConnection.upsert({
    where: key(userId, provider, slot),
    create: { userId, provider, slot, ...data },
    update: data,
  });
}

/** A no-op without a row: there's nothing to turn down. */
export async function rejectConnection(
  userId: string,
  provider: ProviderId,
  slot: UserSlot = "default",
): Promise<void> {
  await prisma.providerConnection.updateMany({ where: { userId, provider, slot }, data: { rejectedAt: new Date() } });
}

/** `honoursExpiry`: past its expiry, the secret is expired too, where the site won't take it after. */
export function connectionState(connection: Connection<unknown> | null, honoursExpiry = false): ConnectionState {
  if (!connection?.secret) return "disconnected";
  if (connection.rejectedAt) return "expired";
  const expired = honoursExpiry && connection.expiresAt && connection.expiresAt.getTime() <= Date.now();
  return expired ? "expired" : "connected";
}

/** The secret while it may be used: given, not turned down, and with `honoursExpiry` not past its expiry. */
export function usableSecret<S>(connection: Connection<S> | null, honoursExpiry = false): S | null {
  return connectionState(connection, honoursExpiry) === "connected" ? connection!.secret : null;
}

/** SQL for whether the user `user` (an alias of "User") has a usable secret for the provider, for queries that rank by
 *  it. */
export function hasUsableSecretSql(provider: ProviderId, user: string, slot: UserSlot = "default"): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "ProviderConnection" pc WHERE pc."userId" = ${Prisma.raw(user)}.id
    AND pc.provider = ${provider} AND pc.slot = ${slot} AND pc.secret IS NOT NULL AND pc."rejectedAt" IS NULL)`;
}
