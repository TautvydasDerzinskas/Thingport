import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { AUTH_SECRET } from "../../config";
import { prisma } from "../../db";
import { liveDatabaseServer, type DatabaseServer } from "../databaseSettingsService";
import { MigrateError } from "./errors";

// The old instance's database becomes a database of its own on this instance's Postgres server, the working copy a
// migration reads from. A dump is SQL, run as whoever restores it, so it's restored as a role made for it that can
// reach nothing but that database: an uploaded file is trusted no more than any other upload. Whatever reads the copy
// afterwards -- the database changes bringing it up to date, the check, the merge -- connects as that role too, since
// what a dump defines (a view, a function) runs as whoever reads it.

const NAME = /^tp_migrate_[a-z0-9]{8,40}$/;
const TAIL_LINES = 30;

/** The working copy's database, and the role that owns what's in it, are both named after the migration. */
export function stagingName(runId: string): string {
  const name = `tp_migrate_${runId.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  if (!NAME.test(name)) throw new Error(`Not a migration's id: ${runId}`);
  return name;
}

/** Made again from the instance's secret whenever it's needed, so it's kept nowhere. */
function stagingPassword(name: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(`migrate:${name}`).digest("hex");
}

function server(): DatabaseServer {
  const live = liveDatabaseServer();
  if (!live)
    throw new MigrateError("no_database", "DATABASE_URL isn't set, so there's no server to make a working copy on.");
  return live;
}

/** As the live connection reaches the server, sslmode included. */
function sslMode(): string | null {
  try {
    return new URL(process.env.DATABASE_URL ?? "").searchParams.get("sslmode");
  } catch {
    return null;
  }
}

function url(user: string, password: string, database: string, extra = ""): string {
  const { host, port } = server();
  const ssl = sslMode();
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${auth}@${host}:${port}/${database}?schema=public${ssl ? `&sslmode=${ssl}` : ""}${extra}`;
}

export function stagingUrl(name: string): string {
  return url(name, stagingPassword(name), name, "&connection_limit=3");
}

/** A client of the working copy, as its role. Disconnect it when done: the copy can't be dropped while it's open. */
export function stagingClient(name: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: stagingUrl(name) } } });
}

const isPermissionDenied = (err: unknown) => /permission denied|must be superuser|42501/i.test(String(err));

/** A new, empty working copy, after dropping one an earlier try left. */
export async function createStaging(name: string): Promise<void> {
  if (!NAME.test(name)) throw new Error(`Not a working copy's name: ${name}`);
  await dropStaging(name);
  try {
    await prisma.$executeRawUnsafe(
      `CREATE ROLE "${name}" LOGIN PASSWORD '${stagingPassword(name)}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10`,
    );
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } catch (err) {
    await dropStaging(name).catch(() => undefined);
    if (isPermissionDenied(err)) {
      throw new MigrateError(
        "no_rights",
        "This instance's database user can't create databases and roles, which the working copy needs. Give it CREATEDB and CREATEROLE, or connect as the server's superuser.",
      );
    }
    throw err;
  }
  await prisma.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
  await prisma.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE "${name}" TO "${name}"`);
  // The schema the dump's tables go in belongs to this instance's user, who made the database.
  const live = server();
  const owner = new PrismaClient({ datasources: { db: { url: url(live.user, live.password, name) } } });
  try {
    await owner.$executeRawUnsafe(`GRANT USAGE, CREATE ON SCHEMA public TO "${name}"`);
  } finally {
    await owner.$disconnect().catch(() => undefined);
  }
}

/** The working copy and its role, gone; nothing if there's none. Whatever is still connected to it is cut off. */
export async function dropStaging(name: string): Promise<void> {
  if (!NAME.test(name)) return;
  await prisma.$queryRawUnsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
  );
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${name}"`);
}

/** The working copies some migration made, by name: what's left when one ended without cleaning up. */
export async function listStagingDatabases(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE 'tp\\_migrate\\_%'`;
  return rows.map((row) => row.datname).filter((name) => NAME.test(name));
}

export type DumpFormat = "custom" | "tar" | "plain" | "unknown";

/** pg_dump's custom (-Fc) and tar (-Ft) archives are what pg_restore reads. A plain SQL dump is a psql script, which
 *  can run commands on the server it's restored on, so it's turned away rather than run. */
export async function dumpFormat(file: string): Promise<DumpFormat> {
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(512);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (head.subarray(0, 5).toString("latin1") === "PGDMP") return "custom";
    if (bytesRead >= 262 && head.subarray(257, 262).toString("latin1") === "ustar") return "tar";
    // gzip: in practice a compressed plain dump, as `pg_dump | gzip` makes.
    if (head[0] === 0x1f && head[1] === 0x8b) return "plain";
    if (/^(--|SET |\\restrict |CREATE |BEGIN;)/m.test(head.subarray(0, bytesRead).toString("utf8"))) return "plain";
    return "unknown";
  } finally {
    await handle.close();
  }
}

type ToolRun = { code: number | null; lines: string[] };

/** Runs a tool to the end, keeping the last lines it printed. `env` is all it gets: nothing of this process's own,
 *  where the live database's password and the instance's secret are. */
function runTool(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ToolRun> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        if (lines.length > TAIL_LINES) lines.shift();
      }
    };
    const child = spawn(command, args, { env, signal, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, lines }));
  });
}

/** What a tool needs to run at all, and nothing else. */
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

/** Restores `file` into the working copy, as its role. pg_restore's own complaints about things the copy doesn't
 *  need (an owner, a comment) don't stop it; what was restored is checked afterwards. */
export async function restoreDump(file: string, name: string, signal?: AbortSignal): Promise<string[]> {
  const format = await dumpFormat(file);
  if (format === "plain") {
    throw new MigrateError(
      "plain_dump",
      "This is a plain SQL dump. Make one with pg_dump's custom format instead: pg_dump -Fc.",
    );
  }
  if (format === "unknown") throw new MigrateError("not_a_dump", "This file isn't a pg_dump archive.");
  const { host, port } = server();
  const ssl = sslMode();
  const env: NodeJS.ProcessEnv = {
    ...baseEnv(),
    PGHOST: host.replace(/^\[|\]$/g, ""),
    PGPORT: String(port),
    PGUSER: name,
    PGPASSWORD: stagingPassword(name),
    PGAPPNAME: "thingport-migrate",
    PGCONNECT_TIMEOUT: "15",
    ...(ssl ? { PGSSLMODE: ssl } : {}),
  };
  const args = [
    "--no-owner",
    "--no-privileges",
    "--no-comments",
    "--no-publications",
    "--no-subscriptions",
    "--no-security-labels",
    "--no-tablespaces",
    "--dbname",
    name,
    file,
  ];
  let result: ToolRun;
  try {
    result = await runTool(process.env.PG_RESTORE_PATH || "pg_restore", args, env, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new MigrateError("no_restore_tool", "pg_restore isn't installed on this server.");
    }
    throw err;
  }
  if (result.code === 0) return [];
  // 1 with "errors ignored on restore" is pg_restore carrying on past them.
  if (result.code === 1 && result.lines.some((line) => /errors ignored on restore/i.test(line))) return result.lines;
  throw new MigrateError(
    "restore_failed",
    result.lines.slice(-8).join("\n") || `pg_restore exited with ${result.code}`,
  );
}

/** Brings the working copy up to this instance's release with its own database changes, as an upgrade would. */
export async function upgradeStaging(name: string, signal?: AbortSignal): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv(),
    DATABASE_URL: stagingUrl(name),
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    CHECKPOINT_DISABLE: "1",
  };
  // An instance that points Prisma at engines of its own keeps them.
  for (const [key, value] of Object.entries(process.env))
    if (key.startsWith("PRISMA_") && !(key in env)) env[key] = value;
  const cli = path.resolve("node_modules/prisma/build/index.js");
  const schema = path.resolve("prisma/schema.prisma");
  const result = await runTool(process.execPath, [cli, "migrate", "deploy", "--schema", schema], env, signal);
  if (result.code !== 0) {
    throw new MigrateError(
      "upgrade_failed",
      result.lines.slice(-12).join("\n") || `prisma migrate deploy exited with ${result.code}`,
    );
  }
}
