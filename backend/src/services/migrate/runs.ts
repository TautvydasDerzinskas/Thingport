import fs from "node:fs/promises";
import path from "node:path";
import { type MigrationRun, Prisma, type PrismaClient } from "@prisma/client";
import { STORAGE } from "../../config";
import { prisma } from "../../db";
import { createLogger } from "../../logger";
import { HttpError } from "../../utils/fileUtils";
import { createLog } from "../auditLog";
import { createNotification } from "../notificationService";
import { currentStorageMove } from "../storageMoveService";
import { setMigrationBusy } from "./busy";
import { MigrateError, MigrateHttpError, storedError } from "./errors";
import { readSourceHistory } from "./history";
import { fileRunModels, Merge, MIGRATE_FOLDER, type MergePhase, type MigrateOptions } from "./merge";
import { countMissingFiles, readPlan, type MigratePlan } from "./plan";
import {
  createStaging,
  dropStaging,
  dumpFormat,
  restoreDump,
  stagingClient,
  stagingName,
  upgradeStaging,
} from "./postgres";
import { checkDumpFile, checkFolder, folderSource } from "./sourceFiles";

// Administration > Migrate's runs: one at a time, in the background, followed by the page. A run is prepared first --
// the dump restored into a working copy, checked, brought up to this release and read -- and waits as "ready" for the
// admin's choices. Started, it merges; a failure keeps the working copy, so starting again goes on from there.

const log = createLogger("migrate");

export type RunStatus = "preparing" | "ready" | "running" | "done" | "failed";
export type PrepareStep = "restoring" | "checking" | "upgrading" | "files";
export type RunProgress = { step: PrepareStep | MergePhase; done: number; total: number };

/** Where uploaded dumps wait while they're restored. */
export const UPLOADS = path.join(STORAGE, MIGRATE_FOLDER, "uploads");

type Active = { id: string; progress: RunProgress; abort: AbortController };
let active: Active | null = null;

export type RunOut = {
  id: string;
  source: string;
  status: RunStatus;
  plan: MigratePlan;
  options: MigrateOptions | null;
  report: unknown;
  error: unknown;
  progress: RunProgress | null;
  /** Failed part-way with its working copy kept: starting it again goes on from what came. */
  can_resume: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

function out(run: MigrationRun): RunOut {
  return {
    id: run.id,
    source: run.source,
    status: run.status as RunStatus,
    plan: run.plan as MigratePlan,
    options: (run.options as MigrateOptions | null) ?? null,
    report: run.report ?? null,
    error: run.error ?? null,
    progress: active?.id === run.id ? { ...active.progress } : null,
    can_resume: run.status === "failed" && Boolean(run.stagingDb) && Boolean(run.startedAt),
    created_at: run.createdAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

const asHttp = (err: unknown) => (err instanceof MigrateError ? new MigrateHttpError(err) : (err as Error));

function assertFree() {
  if (active) throw new HttpError(409, "A migration is under way already.", "busy");
  if (currentStorageMove()?.running) {
    throw new HttpError(409, "Model files are being moved. Start the migration once that's done.", "storage_move");
  }
}

export async function listRuns(): Promise<RunOut[]> {
  const runs = await prisma.migrationRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return runs.map(out);
}

export async function getRun(id: string): Promise<RunOut> {
  const run = await prisma.migrationRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "No such migration");
  return out(run);
}

export type DumpInput = {
  /** The dump on this server: an upload, or a file the admin named. */
  file: string;
  name: string;
  /** An upload, removed once it's restored. */
  uploaded: boolean;
  folder: string;
};

/** Starts preparing a migration from another instance's database dump and its storage folder. */
export async function prepareFromDump(adminId: string, given: DumpInput): Promise<RunOut> {
  const dropUpload = () => (given.uploaded ? fs.rm(given.file, { force: true }).catch(() => undefined) : undefined);
  let folder: string;
  let size: number;
  let input: DumpInput;
  try {
    assertFree();
    // Told at once, before anything is made: a typo in the folder, or the wrong kind of file.
    folder = await checkFolder(given.folder);
    // A dump on the server is read from the migrate folder too.
    input = given.uploaded ? given : { ...given, file: await checkDumpFile(given.file) };
    const stat = await fs.stat(input.file).catch(() => null);
    if (!stat?.isFile()) throw new MigrateError("dump_missing", `There's no file at ${input.file} on this server.`);
    size = stat.size;
    const format = await dumpFormat(input.file);
    if (format === "plain") {
      throw new MigrateError(
        "plain_dump",
        "This is a plain SQL dump. Make one with pg_dump's custom format instead: pg_dump -Fc.",
      );
    }
    if (format === "unknown") throw new MigrateError("not_a_dump", "This file isn't a pg_dump archive.");
  } catch (err) {
    await dropUpload();
    throw asHttp(err);
  }
  const plan: MigratePlan = { dump: { name: input.name, size }, folder };
  const run = await prisma.migrationRun.create({
    data: { source: "thingport", status: "preparing", plan, createdById: adminId },
  });
  const name = stagingName(run.id);
  await prisma.migrationRun.update({ where: { id: run.id }, data: { stagingDb: name } });
  const state: Active = {
    id: run.id,
    progress: { step: "restoring", done: 0, total: 0 },
    abort: new AbortController(),
  };
  active = state;
  setMigrationBusy(true);
  void prepare(state, name, input, folder, plan);
  void createLog({
    userId: adminId,
    action: "migration_prepared",
    targetId: run.id,
    details: { dump: input.name, folder },
  });
  return getRun(run.id);
}

async function prepare(
  state: Active,
  name: string,
  input: DumpInput,
  folder: string,
  plan: MigratePlan,
): Promise<void> {
  let source: PrismaClient | null = null;
  try {
    await createStaging(name);
    await restoreDump(input.file, name, state.abort.signal);
    if (input.uploaded) await fs.rm(input.file, { force: true }).catch(() => undefined);
    state.progress = { step: "checking", done: 0, total: 0 };
    source = stagingClient(name);
    const history = await readSourceHistory(source);
    await source.$disconnect();
    source = null;
    state.progress = { step: "upgrading", done: 0, total: history.missing };
    if (history.missing) await upgradeStaging(name, state.abort.signal);
    state.progress = { step: "files", done: 0, total: 0 };
    source = stagingClient(name);
    const found = await readPlan(source, await folderSource(folder), (done, total) => {
      state.progress = { step: "files", done, total };
    });
    if (state.abort.signal.aborted) throw new Error("discarded");
    await prisma.migrationRun.update({
      where: { id: state.id },
      data: {
        status: "ready",
        plan: {
          ...plan,
          version: history.version,
          changes: { applied: history.applied, added: history.missing },
          ...found,
        },
      },
    });
  } catch (err) {
    await source?.$disconnect().catch(() => undefined);
    source = null;
    await dropStaging(name).catch((dropErr) => log.warn("couldn't drop a working copy", { name, error: dropErr }));
    if (input.uploaded) await fs.rm(input.file, { force: true }).catch(() => undefined);
    if (state.abort.signal.aborted) {
      // The admin discarded it while it was being prepared.
      await prisma.migrationRun.deleteMany({ where: { id: state.id } });
    } else {
      log.warn("preparing a migration failed", { error: err });
      await prisma.migrationRun.update({
        where: { id: state.id },
        data: { status: "failed", error: storedError(err), stagingDb: null, finishedAt: new Date() },
      });
    }
  } finally {
    await source?.$disconnect().catch(() => undefined);
    if (active === state) active = null;
    setMigrationBusy(false);
  }
}

/** Starts merging a prepared migration with the admin's choices; also starts one that failed part-way again. */
export async function startRun(id: string, adminId: string, options: MigrateOptions): Promise<RunOut> {
  assertFree();
  const run = await prisma.migrationRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "No such migration");
  if (!run.stagingDb || !(run.status === "ready" || (run.status === "failed" && run.startedAt))) {
    throw new HttpError(409, "This migration can't be started.", "not_ready");
  }
  const plan = run.plan as MigratePlan;
  const known = new Set((plan.people ?? []).map((person) => person.id));
  const chosen: MigrateOptions = {
    ...options,
    people: [...new Set(options.people)].filter((person) => known.has(person)),
  };
  if (!chosen.people.length) throw new HttpError(400, "Pick someone to bring over.", "no_people");
  await prisma.migrationRun.update({
    where: { id },
    data: { status: "running", options: chosen, error: Prisma.DbNull, startedAt: new Date(), finishedAt: null },
  });
  const state: Active = { id, progress: { step: "people", done: 0, total: 0 }, abort: new AbortController() };
  active = state;
  setMigrationBusy(true);
  void execute(state, run.stagingDb, plan, chosen, adminId);
  void createLog({
    userId: adminId,
    action: "migration_started",
    targetId: id,
    details: { people: chosen.people.length },
  });
  return getRun(id);
}

async function execute(state: Active, name: string, plan: MigratePlan, options: MigrateOptions, adminId: string) {
  const source = stagingClient(name);
  let merge: Merge | null = null;
  try {
    merge = new Merge(source, await folderSource(plan.folder), state.id, options, (progress) => {
      state.progress = { step: progress.phase, done: progress.done, total: progress.total };
    });
    const report = await merge.run();
    await source.$disconnect();
    await dropStaging(name).catch((err) => log.warn("couldn't drop a working copy", { name, error: err }));
    await prisma.migrationRun.update({
      where: { id: state.id },
      data: { status: "done", report, stagingDb: null, finishedAt: new Date() },
    });
    const people = options.people.length;
    await createNotification(adminId, {
      type: "general",
      title: "Migration finished",
      message: { key: "migrateDone", values: { count: report.models.brought, people } },
      body: `${report.models.brought} models came over for ${people} ${people === 1 ? "person" : "people"}.`,
      internalPath: "/admin-migrate",
    }).catch(() => undefined);
  } catch (err) {
    log.error("a migration failed", { error: err });
    await source.$disconnect().catch(() => undefined);
    // The working copy stays: starting again skips what came and goes on.
    await prisma.migrationRun.update({
      where: { id: state.id },
      data: {
        status: "failed",
        error: storedError(err),
        report: merge ? merge.report : Prisma.DbNull,
        finishedAt: new Date(),
      },
    });
    await createNotification(adminId, {
      type: "general",
      title: "Migration stopped",
      message: { key: "migrateFailed" },
      body: "Open Administration > Migrate to see why, and start it again to finish.",
      internalPath: "/admin-migrate",
    }).catch(() => undefined);
  } finally {
    if (active === state) active = null;
    setMigrationBusy(false);
  }
}

/** Gives a prepared migration another storage folder, and counts its files there again: for a folder given wrong,
 *  without restoring the dump again. */
export async function changeFolder(id: string, given: string): Promise<RunOut> {
  assertFree();
  const run = await prisma.migrationRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "No such migration");
  if (run.status !== "ready" || !run.stagingDb)
    throw new HttpError(409, "This migration can't change now.", "not_ready");
  let folder: string;
  try {
    folder = await checkFolder(given);
  } catch (err) {
    throw asHttp(err);
  }
  const plan = run.plan as MigratePlan;
  const state: Active = { id, progress: { step: "files", done: 0, total: 0 }, abort: new AbortController() };
  active = state;
  setMigrationBusy(true);
  const source = stagingClient(run.stagingDb);
  try {
    const missingFiles = await countMissingFiles(
      source,
      await folderSource(folder),
      plan.counts?.files ?? 0,
      (done, total) => {
        state.progress = { step: "files", done, total };
      },
    );
    await prisma.migrationRun.update({ where: { id }, data: { plan: { ...plan, folder, missingFiles } } });
  } finally {
    await source.$disconnect().catch(() => undefined);
    if (active === state) active = null;
    setMigrationBusy(false);
  }
  return getRun(id);
}

/** Discards a migration that's being prepared or waiting, or takes one that's over off the list. Files a run that
 *  stopped part-way left in its folder go where they belong first. */
export async function removeRun(id: string): Promise<void> {
  const run = await prisma.migrationRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, "No such migration");
  if (run.status === "running") throw new HttpError(409, "It's running. Wait for it to finish.", "running");
  if (active?.id === id) {
    // Preparing: it stops, cleans up and goes.
    active.abort.abort();
    return;
  }
  if (run.stagingDb) await dropStaging(run.stagingDb);
  if (run.startedAt) await fileRunModels(id);
  await prisma.migrationRun.delete({ where: { id } });
}

/** At startup: what the last process was doing is over. A run being prepared failed; one merging failed too, with its
 *  working copy kept to start again. Uploads nothing reads any more go. */
export async function recoverMigrations(): Promise<void> {
  const stale = await prisma.migrationRun.findMany({ where: { status: { in: ["preparing", "running"] } } });
  for (const run of stale) {
    const preparing = run.status === "preparing";
    if (preparing && run.stagingDb) {
      await dropStaging(run.stagingDb).catch((err) => log.warn("couldn't drop a working copy", { error: err }));
    }
    await prisma.migrationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: {
          code: "interrupted",
          message: preparing
            ? "The server restarted while it was being prepared."
            : "The server restarted while it ran. Start it again to finish.",
        },
        ...(preparing ? { stagingDb: null } : {}),
        finishedAt: new Date(),
      },
    });
  }
  await fs.rm(UPLOADS, { recursive: true, force: true }).catch(() => undefined);
}
