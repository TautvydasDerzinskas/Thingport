import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { STORAGE } from "../../config";
import { prisma } from "../../db";
import { createLog } from "../auditLog";
import { liveDatabaseServer } from "../databaseSettingsService";
import { sslEnv } from "./postgres";
import { isAbsent } from "./sourceFiles";

// Letting another Thingport instance copy this one online; services/migrate/remote.ts is the other side. An admin makes
// a token here and gives it to the other instance's admin. With it, that instance may read this one's database, as a
// dump, and the files in its storage, for a day or until the token is revoked. It's kept only as a hash, and shown
// once.

const KEY = "migration_export";
const LIFETIME_MS = 24 * 60 * 60 * 1000;
const FOLDER_LIMIT = 10_000;

type Stored = { tokenHash: string; createdAt: string; expiresAt: string; createdById: string; usedAt: string | null };

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function stored(): Promise<Stored | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const value = row?.value as Stored | undefined;
  if (!value?.tokenHash || !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()) return null;
  return value;
}

export type ExportTokenState = { active: boolean; expires_at: string | null; used_at: string | null };

export async function exportTokenState(): Promise<ExportTokenState> {
  const value = await stored();
  return { active: Boolean(value), expires_at: value?.expiresAt ?? null, used_at: value?.usedAt ?? null };
}

/** A new token, replacing any other: shown to the admin now, and never again. */
export async function createExportToken(adminId: string): Promise<{ token: string; expires_at: string }> {
  const token = `tpm_${crypto.randomBytes(24).toString("base64url")}`;
  const now = Date.now();
  const value: Stored = {
    tokenHash: hash(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + LIFETIME_MS).toISOString(),
    createdById: adminId,
    usedAt: null,
  };
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  void createLog({ userId: adminId, action: "migration_export_created" });
  return { token, expires_at: value.expiresAt };
}

export async function revokeExportToken(adminId: string): Promise<void> {
  const { count } = await prisma.setting.deleteMany({ where: { key: KEY } });
  if (count) void createLog({ userId: adminId, action: "migration_export_revoked" });
}

/** The live token's record when `header` carries it, compared by its hash in constant time; null otherwise. */
export async function exportTokenOf(header: string | undefined): Promise<Stored | null> {
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  const value = await stored();
  if (!value) return null;
  const given = Buffer.from(hash(token), "hex");
  const kept = Buffer.from(value.tokenHash, "hex");
  return given.length === kept.length && crypto.timingSafeEqual(given, kept) ? value : null;
}

/** When it was last read from, for the Migrate page to say; the audit log says who made it. */
export async function markExportRead(value: Stored): Promise<void> {
  const next: Stored = { ...value, usedAt: new Date().toISOString() };
  // Only the record that was read: a token made since then isn't overwritten by the one it replaced.
  await prisma.setting.updateMany({
    where: { key: KEY, value: { path: ["tokenHash"], equals: value.tokenHash } },
    data: { value: next },
  });
  void createLog({ userId: value.createdById, action: "migration_export_read" });
}

/** A file of this instance's storage by the path its database gives it: inside storage, through no link out of it. */
export async function storageFile(relative: string): Promise<string | null> {
  if (!relative || path.isAbsolute(relative)) return null;
  const root = await fs.realpath(STORAGE);
  const joined = path.resolve(root, relative);
  if (!joined.startsWith(root + path.sep)) return null;
  try {
    const real = await fs.realpath(joined);
    if (!real.startsWith(root + path.sep)) return null;
    return (await fs.stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** A folder with more files than one listing gives: copying only some of them would lose the rest unsaid. */
export class FolderTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`The folder has more than ${limit} files.`);
    this.name = "FolderTooLargeError";
  }
}

/** The files under a folder of storage, relative to it, as Studio's assets for a design: inside storage, through no
 *  link out of it. Throws FolderTooLargeError past FOLDER_LIMIT files rather than leave some out. */
export async function storageFolder(relative: string, limit = FOLDER_LIMIT): Promise<string[]> {
  if (!relative || path.isAbsolute(relative)) return [];
  const root = await fs.realpath(STORAGE);
  const joined = path.resolve(root, relative);
  if (!joined.startsWith(root + path.sep)) return [];
  // The folder itself, or one above it, may be a link out of storage. One that isn't there has nothing in it; one that
  // can't be read fails the request, rather than list only some of its files.
  const start = await fs.realpath(joined).catch((err: unknown) => {
    if (isAbsent(err)) return null;
    throw err;
  });
  if (!start?.startsWith(root + path.sep)) return [];
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Checked again right before it's read: one swapped for a link since its parent was read isn't followed out.
    const real = await fs.realpath(dir).catch((err: unknown) => {
      if (isAbsent(err)) return null;
      throw err;
    });
    if (real !== start && !real?.startsWith(start + path.sep)) return;
    const entries = await fs.readdir(real, { withFileTypes: true }).catch((err: unknown) => {
      if (isAbsent(err)) return [];
      throw err;
    });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        if (found.length >= limit) throw new FolderTooLargeError(limit);
        found.push(path.relative(start, full).split(path.sep).join("/"));
      }
    }
  };
  await walk(start);
  return found;
}

/** Streams this instance's database as a pg_dump custom-format archive. The answer starts with the dump's first bytes,
 *  so a pg_dump that can't start says why instead of sending an empty file. */
export function streamDump(res: Response): void {
  const live = liveDatabaseServer();
  if (!live) {
    res.status(500).json({ detail: "This instance's database connection isn't set.", code: "no_database" });
    return;
  }
  const env: NodeJS.ProcessEnv = {
    // As safely as the live connection reaches it.
    ...sslEnv(),
    PGHOST: live.host.replace(/^\[|\]$/g, ""),
    PGPORT: String(live.port),
    PGUSER: live.user,
    PGPASSWORD: live.password,
    PGDATABASE: live.database,
    PGAPPNAME: "thingport-migrate-export",
  };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const child = spawn(process.env.PG_DUMP_PATH || "pg_dump", ["-Fc"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let started = false;
  let answered = false;
  const errors: string[] = [];
  const fail = (status: number, detail: string, code: string) => {
    if (answered) return;
    answered = true;
    if (started) res.destroy(new Error(detail));
    else res.status(status).json({ detail, code });
  };
  child.stderr.on("data", (chunk: Buffer) => {
    errors.push(chunk.toString("utf8"));
    if (errors.length > 20) errors.shift();
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (!started) {
      started = true;
      res.status(200);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", 'attachment; filename="thingport.dump"');
      res.setHeader("Cache-Control", "no-store");
    }
    if (!res.write(chunk)) {
      child.stdout.pause();
      res.once("drain", () => child.stdout.resume());
    }
  });
  child.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") fail(500, "pg_dump isn't installed on this server.", "no_dump_tool");
    else fail(500, err.message, "dump_failed");
  });
  child.on("close", (code) => {
    if (code === 0 && started && !answered) {
      answered = true;
      res.end();
      return;
    }
    fail(500, errors.join("").trim().split("\n").slice(-6).join("\n") || `pg_dump exited with ${code}`, "dump_failed");
  });
  // The other instance went away: no need to finish the dump.
  res.on("close", () => {
    if (child.exitCode === null) child.kill();
  });
}
