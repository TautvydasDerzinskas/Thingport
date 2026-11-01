import { PrismaClient } from "@prisma/client";
import { setActiveClient } from "../db";
import { createLogger } from "../logger";
import { hasActiveCollectionSync } from "./collectionSyncRunner";
import { liveRunnerIds } from "./importJobRunner";
import { hasRunningImportTasks } from "./importTaskService";
import {
  beginDatabaseSwitch,
  countRunningRows,
  endDatabaseSwitch,
  forgetJobsOfLastDatabase,
  importWorkerIdle,
  importWorkerStatus,
  recoverAfterDatabaseSwitch,
} from "./importWorker";

const log = createLogger("import");
const POLL_WAIT_MS = 2_000;

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

async function connectCandidate(url: string): Promise<PrismaClient> {
  const candidate = new PrismaClient({ datasources: { db: { url } } });
  try {
    await candidate.$connect();
    await candidate.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1');
    return candidate;
  } catch (err) {
    await candidate.$disconnect().catch(() => undefined);
    throw new Error(friendlyConnectionError(err), { cause: err });
  }
}

/** A read of the line that was already out comes back and sees the gate. A job the worker is on won't be done in time,
 *  which the check after this will see. */
async function pollSettled(): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    importWorkerIdle(),
    new Promise((resolve) => {
      timer = setTimeout(resolve, POLL_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
}

/** Direct ZIP, list and profile imports can only be told by their rows. A database that can't answer has none to
 *  protect: leaving a dead one is what this switch is for. */
async function runningRows(): Promise<number> {
  try {
    return await countRunningRows();
  } catch (err) {
    log.warn("couldn't count running imports before a database switch", { error: err });
    return 0;
  }
}

const inMemoryImportWork = () =>
  importWorkerStatus().currentJobId !== null ||
  liveRunnerIds().length > 0 ||
  hasRunningImportTasks() ||
  hasActiveCollectionSync();

/** Hot-swaps the live connection only after the candidate credentials pass a test, and only with no import running:
 *  a job's next write would land in the new database. Refused rather than waited for, as an import can run for hours. */
export async function testAndSwitchDatabase(creds: PostgresCredentials): Promise<DatabaseInfo> {
  const url = buildCandidateUrl(creds);
  if (!url) throw new Error("DATABASE_URL is not set for this instance -- nothing to switch relative to.");
  if (!beginDatabaseSwitch()) throw new Error("Another database switch is under way.");
  try {
    const candidate = await connectCandidate(url);
    await pollSettled();
    const rows = await runningRows();
    // Nothing awaited from this check to the swap, so nothing can start in between.
    if (rows > 0 || inMemoryImportWork()) {
      await candidate.$disconnect().catch(() => undefined);
      throw new Error("Imports are running. Pause them or let them finish, then try again.");
    }
    setActiveClient(candidate);
    active = creds;
    forgetJobsOfLastDatabase();
    await recoverAfterDatabaseSwitch();
    return getDatabaseInfo();
  } finally {
    endDatabaseSwitch();
  }
}
