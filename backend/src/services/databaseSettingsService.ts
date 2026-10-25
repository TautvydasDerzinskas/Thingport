import { PrismaClient } from "@prisma/client";
import { setActiveClient } from "../db";

export type PostgresCredentials = {
  database: string;
  user: string;
  password: string;
};

export type DatabaseInfo = {
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
};

type ParsedUrl = { host: string; port: string; database: string; user: string; password: string };

function parseDatabaseUrl(raw: string): ParsedUrl | null {
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port,
      database: url.pathname.replace(/^\//, ""),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

// Host/port are fixed at startup; reaching another server means changing DATABASE_URL.
const original = parseDatabaseUrl(process.env.DATABASE_URL || "");

// In-memory only: a restart boots from DATABASE_URL again, since there's nowhere to read a
// persisted override from before connecting. To make a switch stick, update DATABASE_URL.
let active: PostgresCredentials | null = original
  ? { database: original.database, user: original.user, password: original.password }
  : null;

export function getDatabaseInfo(): DatabaseInfo {
  return {
    host: original?.host ?? null,
    port: original?.port ? Number(original.port) : null,
    database: active?.database ?? null,
    user: active?.user ?? null,
  };
}

function buildCandidateUrl(creds: PostgresCredentials): string | null {
  if (!original) return null;
  const auth = `${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.password)}`;
  return `postgresql://${auth}@${original.host}:${original.port}/${creds.database}?schema=public`;
}

function friendlyConnectionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/password authentication failed/i.test(message)) return "Authentication failed for that user/password.";
  if (/database .* does not exist/i.test(message)) return "That database does not exist.";
  if (/relation .?"?User"?.? does not exist/i.test(message)) {
    return "Connected, but that database has no Thingport tables yet -- run migrations against it first.";
  }
  return `Could not connect: ${message}`;
}

/** Hot-swaps the live connection only after the candidate credentials pass a test. */
export async function testAndSwitchDatabase(creds: PostgresCredentials): Promise<DatabaseInfo> {
  const url = buildCandidateUrl(creds);
  if (!url) throw new Error("DATABASE_URL is not set for this instance -- nothing to switch relative to.");

  const candidate = new PrismaClient({ datasources: { db: { url } } });
  try {
    await candidate.$connect();
    await candidate.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
  } catch (err) {
    await candidate.$disconnect().catch(() => undefined);
    throw new Error(friendlyConnectionError(err), { cause: err });
  }

  setActiveClient(candidate, url);
  active = creds;
  return getDatabaseInfo();
}
