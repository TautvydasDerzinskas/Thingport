import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { MigrateError } from "./errors";

// Every release's database changes are this instance's too, in the same order, and none is ever edited once released:
// so the old instance's record of the changes it applied says how far behind it is, and running this instance's
// changes on its copy brings it level. One it applied that this instance doesn't have means it's newer (or something
// else altogether), and nothing can bring it level.

export type SourceHistory = {
  /** The release it last ran, as it recorded it; null for one from before 1.2.0, which didn't. */
  version: string | null;
  /** Its database changes, and this instance's that it lacks. */
  applied: number;
  missing: number;
};

let ours: Promise<Set<string>> | null = null;

/** This instance's database changes, by name. */
export function ourMigrations(): Promise<Set<string>> {
  ours ??= fs
    .readdir(path.resolve("prisma/migrations"), { withFileTypes: true })
    .then((entries) => new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)));
  return ours;
}

type Row = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

/** This instance's own database changes that an upgrade of the working copy started and never finished, stopped or
 *  failed, marked rolled back as `prisma migrate resolve --rolled-back` marks one: Prisma runs no more on a database
 *  that has one, and Postgres took back all the change did when it stopped, so the next upgrade runs it again. Only the
 *  working copy's: one the old instance never finished stopped its preparing (readSourceHistory). How many. */
export async function settleStoppedUpgrade(copy: PrismaClient): Promise<number> {
  const names = [...(await ourMigrations())];
  return copy.$executeRaw`
    UPDATE "_prisma_migrations" SET rolled_back_at = now()
    WHERE finished_at IS NULL AND rolled_back_at IS NULL AND migration_name = ANY(${names})`;
}

/** What the working copy says of the instance it came from, read before anything changes it. Throws when it isn't a
 *  Thingport database, or one this instance can't bring level. */
export async function readSourceHistory(source: PrismaClient): Promise<SourceHistory> {
  const tables = new Set(
    (await source.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map(
      (row) => row.tablename,
    ),
  );
  if (!tables.has("_prisma_migrations") || !tables.has("User") || !tables.has("Print")) {
    throw new MigrateError("not_thingport", "The dump isn't of a Thingport instance's database.");
  }
  const rows = await source.$queryRaw<Row[]>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
  const known = await ourMigrations();
  const failed = rows.filter((row) => !row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
  if (failed.length) {
    throw new MigrateError(
      "failed_change",
      `A database change failed on the old instance and was never finished: ${failed[0]}. Fix it there first.`,
      { name: failed[0] },
    );
  }
  const applied = new Set(
    rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name),
  );
  const unknown = [...applied].filter((name) => !known.has(name));
  if (unknown.length) {
    throw new MigrateError(
      "source_newer",
      `The old instance has ${unknown.length} database change${unknown.length === 1 ? "" : "s"} this one doesn't, so it's newer. Update this instance first.`,
      { count: unknown.length },
    );
  }
  let version: string | null = null;
  if (tables.has("Setting")) {
    const setting = await source.$queryRaw<{ value: unknown }[]>`
      SELECT value FROM "Setting" WHERE key = 'last_run_version'`;
    const value = setting[0]?.value;
    if (typeof value === "string" && /^\d+\.\d+\.\d+/.test(value)) version = value;
  }
  return { version, applied: applied.size, missing: [...known].filter((name) => !applied.has(name)).length };
}
