import fs from "node:fs/promises";
import path from "node:path";
import { type MigrationRun, Prisma, type PrismaClient } from "@prisma/client";
import { STORAGE } from "../../config";
import { prisma } from "../../db";
import { createLogger } from "../../logger";
import { HttpError } from "../../utils/fileUtils";
import { createLog } from "../auditLog";
import { createNotification } from "../notificationService";
import { discardPrint } from "../printCreation";
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
import {
  filePathOf,
  type ManyfoldConnection,
  ManyfoldClient,
  manyfoldAddress,
  type ManyfoldFile,
  type ManyfoldModel,
} from "./manyfold/api";
import { ManyfoldImport, type ManyfoldOptions, type ManyfoldProgress } from "./manyfold/import";
import { downloadDump, httpSource, normalizeAddress, type Remote, remoteInfo } from "./remote";
import { checkDumpFile, checkFolder, folderSource, type SourceFiles } from "./sourceFiles";

// Administration > Migrate's runs: one at a time, in the background, followed by the page. A run is prepared first --
// the dump restored into a working copy, checked, brought up to this release and read -- and waits as "ready" for the
// admin's choices. Started, it merges; a failure keeps the working copy, so starting again goes on from there.

const log = createLogger("migrate");

export type RunStatus = "preparing" | "ready" | "running" | "done" | "failed";
export type PrepareStep = "downloading" | "restoring" | "checking" | "upgrading" | "files";
export type RunProgress = { step: PrepareStep | MergePhase | ManyfoldProgress["phase"]; done: number; total: number };

/** Where uploaded dumps wait while they're restored. */
export const UPLOADS = path.join(STORAGE, MIGRATE_FOLDER, "uploads");

/** The one slot's holder: a dump being prepared (which Discard stops), or a run being started or given another
 *  folder (which Discard turns away until it is over: stopping one part-way would leave it going on regardless). */
type Active = { id: string; kind: "prepare" | "start" | "folder"; progress: RunProgress; abort: AbortController };
let active: Active | null = null;
/** Runs Discard is removing: Start and Change folder turn them away until Discard is done, so neither reads a run
 *  whose working copy and record are going. Only that run is held; another one can still start meanwhile. */
const discarding = new Set<string>();

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
    can_resume:
      run.status === "failed" && Boolean(run.startedAt) && (Boolean(run.stagingDb) || run.source === "manyfold"),
    created_at: run.createdAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

const asHttp = (err: unknown) => (err instanceof MigrateError ? new MigrateHttpError(err) : (err as Error));

/** Takes the one slot for a run, at once and before anything is awaited, so two requests can't both find it free;
 *  `release` gives it back. */
function claim(id: string, kind: Active["kind"], step: RunProgress["step"]): Active {
  if (active) throw new HttpError(409, "A migration is under way already.", "busy");
  if (discarding.has(id)) throw new HttpError(409, "A migration is under way already.", "busy");
  if (currentStorageMove()?.running) {
    throw new HttpError(409, "Model files are being moved. Start the migration once that's done.", "storage_move");
  }
  const state: Active = { id, kind, progress: { step, done: 0, total: 0 }, abort: new AbortController() };
  active = state;
  setMigrationBusy(true);
  return state;
}

/** Says whether the slot is free, without taking it: for a check that holds nothing while it waits. */
function assertFree(): void {
  if (active) throw new HttpError(409, "A migration is under way already.", "busy");
  if (currentStorageMove()?.running) {
    throw new HttpError(409, "Model files are being moved. Start the migration once that's done.", "storage_move");
  }
}

/** Gives the slot back, if it's still this run's. Called as soon as the run's status says it's over, so whoever sees
 *  that can go on at once. */
function release(state: Active): void {
  if (active !== state) return;
  active = null;
  setMigrationBusy(false);
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
  let state: Active;
  try {
    // Its id once the run is made.
    state = claim("", "prepare", "restoring");
  } catch (err) {
    await dropUpload();
    throw err;
  }
  try {
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
    release(state);
    await dropUpload();
    throw asHttp(err);
  }
  const plan: MigratePlan = { dump: { name: input.name, size }, folder };
  let run: MigrationRun;
  let name: string;
  try {
    run = await prisma.migrationRun.create({
      data: { source: "thingport", status: "preparing", plan, createdById: adminId },
    });
    state.id = run.id;
    name = stagingName(run.id);
    await prisma.migrationRun.update({ where: { id: run.id }, data: { stagingDb: name } });
  } catch (err) {
    release(state);
    await dropUpload();
    throw err;
  }
  void prepare(state, name, { kind: "dump", file: input.file, uploaded: input.uploaded, folder }, plan);
  void createLog({
    userId: adminId,
    action: "migration_prepared",
    targetId: run.id,
    details: { dump: input.name, folder },
  });
  return getRun(run.id);
}

/** Starts preparing a migration from another instance online, with the token its admin made there. */
export async function prepareOnline(adminId: string, given: { address: string; token: string }): Promise<RunOut> {
  let remote: Remote;
  let state: Active;
  try {
    // Its id once the run is made.
    state = claim("", "prepare", "downloading");
  } catch (err) {
    throw asHttp(err);
  }
  try {
    remote = { address: normalizeAddress(given.address), token: given.token.trim() };
    if (!remote.token) {
      throw new MigrateError("online_token", "The old instance turned the token down. Create a new one there.");
    }
    // Told at once: an address this server can't reach, a wrong token, or an instance without this.
    await remoteInfo(remote);
  } catch (err) {
    release(state);
    throw asHttp(err);
  }
  const plan: MigratePlan = { dump: null, folder: "", address: remote.address };
  let run: MigrationRun;
  let name: string;
  try {
    run = await prisma.migrationRun.create({
      data: { source: "thingport-online", status: "preparing", plan, remote, createdById: adminId },
    });
    state.id = run.id;
    name = stagingName(run.id);
    await prisma.migrationRun.update({ where: { id: run.id }, data: { stagingDb: name } });
  } catch (err) {
    release(state);
    throw err;
  }
  void prepare(state, name, { kind: "online", remote }, plan);
  void createLog({
    userId: adminId,
    action: "migration_prepared",
    targetId: run.id,
    details: { address: remote.address },
  });
  return getRun(run.id);
}

/** Where a run's dump comes from: a file here, or the old instance online. */
type WayIn = { kind: "dump"; file: string; uploaded: boolean; folder: string } | { kind: "online"; remote: Remote };

/** The old instance's files, as the run reads them: from the folder here, or from the old instance online. */
async function filesOf(run: Pick<MigrationRun, "source" | "plan" | "remote">): Promise<SourceFiles> {
  if (run.source === "thingport-online") {
    const remote = run.remote as Remote | null;
    if (!remote?.token) {
      throw new MigrateError("online_token", "The old instance turned the token down. Create a new one there.");
    }
    return httpSource(remote);
  }
  return folderSource((run.plan as MigratePlan).folder);
}

async function prepare(state: Active, name: string, way: WayIn, plan: MigratePlan): Promise<void> {
  let source: PrismaClient | null = null;
  // A dump that's this run's own to remove afterwards: an upload, or one downloaded.
  let ownDump: string | null = way.kind === "dump" && way.uploaded ? way.file : null;
  try {
    let file: string;
    if (way.kind === "online") {
      file = path.join(UPLOADS, `${state.id}.dump`);
      ownDump = file;
      await downloadDump(
        way.remote,
        file,
        (bytes) => {
          state.progress = { step: "downloading", done: bytes, total: 0 };
        },
        state.abort.signal,
      );
      if ((await dumpFormat(file)) !== "custom") {
        throw new MigrateError("online_dump", "The old instance's dump didn't come as a pg_dump archive.");
      }
    } else {
      file = way.file;
    }
    state.progress = { step: "restoring", done: 0, total: 0 };
    await createStaging(name);
    const skipped = await restoreDump(file, name, state.abort.signal);
    if (skipped.length) log.info("the dump restored without what the working copy doesn't need", { lines: skipped });
    if (ownDump) await fs.rm(ownDump, { force: true }).catch(() => undefined);
    state.progress = { step: "checking", done: 0, total: 0 };
    source = stagingClient(name);
    const history = await readSourceHistory(source);
    await source.$disconnect();
    source = null;
    state.progress = { step: "upgrading", done: 0, total: history.missing };
    if (history.missing) await upgradeStaging(name, state.abort.signal);
    state.progress = { step: "files", done: 0, total: 0 };
    source = stagingClient(name);
    const files = way.kind === "online" ? httpSource(way.remote, state.abort.signal) : await folderSource(way.folder);
    const found = await readPlan(source, files, (done, total) => {
      state.progress = { step: "files", done, total };
    });
    if (state.abort.signal.aborted) throw new Error("discarded");
    await source.$disconnect();
    source = null;
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
    release(state);
  } catch (err) {
    await source?.$disconnect().catch(() => undefined);
    source = null;
    await dropStaging(name).catch((dropErr) => log.warn("couldn't drop a working copy", { name, error: dropErr }));
    if (ownDump) await fs.rm(ownDump, { force: true }).catch(() => undefined);
    if (state.abort.signal.aborted) {
      // The admin discarded it while it was being prepared.
      await prisma.migrationRun.deleteMany({ where: { id: state.id } });
      release(state);
    } else {
      log.warn("preparing a migration failed", { error: err });
      await prisma.migrationRun.update({
        where: { id: state.id },
        // The token isn't needed any more.
        data: {
          status: "failed",
          error: storedError(err),
          stagingDb: null,
          finishedAt: new Date(),
          ...(way.kind === "online" ? { remote: { address: way.remote.address } } : {}),
        },
      });
      release(state);
    }
  } finally {
    await source?.$disconnect().catch(() => undefined);
    release(state);
  }
}

/** Starts merging a prepared migration with the admin's choices; also starts one that failed part-way again. */
export async function startRun(id: string, adminId: string, options: MigrateOptions): Promise<RunOut> {
  const state = claim(id, "start", "people");
  let stagingDb: string;
  let started: MigrationRun;
  let chosen: MigrateOptions;
  try {
    const run = await prisma.migrationRun.findUnique({ where: { id } });
    if (!run) throw new HttpError(404, "No such migration");
    const notReady = new HttpError(409, "This migration can't be started.", "not_ready");
    if (!run.stagingDb || !(run.status === "ready" || (run.status === "failed" && run.startedAt))) throw notReady;
    stagingDb = run.stagingDb;
    started = run;
    const plan = run.plan as MigratePlan;
    const known = new Set((plan.people ?? []).map((person) => person.id));
    chosen = { ...options, people: [...new Set(options.people)].filter((person) => known.has(person)) };
    if (!chosen.people.length) throw new HttpError(400, "Pick someone to bring over.", "no_people");
    // Only from the status it was read in: a run another process started meanwhile isn't started twice.
    const { count } = await prisma.migrationRun.updateMany({
      where: { id, status: run.status, stagingDb, ...(run.status === "failed" ? { startedAt: { not: null } } : {}) },
      data: { status: "running", options: chosen, error: Prisma.DbNull, startedAt: new Date(), finishedAt: null },
    });
    if (count !== 1) throw notReady;
  } catch (err) {
    release(state);
    throw err;
  }
  void execute(state, stagingDb, started, chosen, adminId);
  void createLog({
    userId: adminId,
    action: "migration_started",
    targetId: id,
    details: { people: chosen.people.length },
  });
  return getRun(id);
}

async function execute(state: Active, name: string, run: MigrationRun, options: MigrateOptions, adminId: string) {
  const source = stagingClient(name);
  let merge: Merge | null = null;
  try {
    merge = new Merge(source, await filesOf(run), state.id, options, (progress) => {
      state.progress = { step: progress.phase, done: progress.done, total: progress.total };
    });
    const report = await merge.run();
    await source.$disconnect();
    await dropStaging(name).catch((err) => log.warn("couldn't drop a working copy", { name, error: err }));
    await prisma.migrationRun.update({
      where: { id: state.id },
      // An online run's token isn't needed any more.
      data: {
        status: "done",
        report,
        stagingDb: null,
        finishedAt: new Date(),
        ...(run.remote ? { remote: { address: (run.remote as Remote).address } } : {}),
      },
    });
    release(state);
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
    release(state);
    await createNotification(adminId, {
      type: "general",
      title: "Migration stopped",
      message: { key: "migrateFailed" },
      body: "Open Administration > Migrate to see why, and start it again to finish.",
      internalPath: "/admin-migrate",
    }).catch(() => undefined);
  } finally {
    release(state);
  }
}

/** Gives a prepared migration another storage folder, and counts its files there again: for a folder given wrong,
 *  without restoring the dump again. */
export async function changeFolder(id: string, given: string): Promise<RunOut> {
  const state = claim(id, "folder", "files");
  let source: PrismaClient | null = null;
  try {
    const run = await prisma.migrationRun.findUnique({ where: { id } });
    if (!run) throw new HttpError(404, "No such migration");
    if (run.status !== "ready" || !run.stagingDb || run.source !== "thingport") {
      throw new HttpError(409, "This migration can't change now.", "not_ready");
    }
    let folder: string;
    try {
      folder = await checkFolder(given);
    } catch (err) {
      throw asHttp(err);
    }
    const plan = run.plan as MigratePlan;
    source = stagingClient(run.stagingDb);
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
    await source?.$disconnect().catch(() => undefined);
    release(state);
  }
  return getRun(id);
}

// --- Manyfold ---

/** `half`: the model here a run the server stopped was making, to discard when it's started again. */
type ManyfoldRemote = ManyfoldConnection & { done?: string[]; half?: string | null };

/** Each migration's client, with the token it signed in with: Manyfold lets a key sign in only ten times in three
 *  minutes, which looking up owners one by one would use up. */
const manyfoldClients = new Map<string, ManyfoldClient>();

function manyfoldClient(id: string, remote: ManyfoldConnection): ManyfoldClient {
  let client = manyfoldClients.get(id);
  if (!client) {
    client = new ManyfoldClient(remote);
    manyfoldClients.set(id, client);
  }
  return client;
}

/** The Manyfold models earlier migrations from the same address brought, so another one skips them. */
async function broughtBefore(address: string): Promise<Set<string>> {
  const runs = await prisma.migrationRun.findMany({ where: { source: "manyfold" }, select: { remote: true } });
  const done = new Set<string>();
  for (const run of runs) {
    const remote = run.remote as ManyfoldRemote | null;
    if (remote?.address === address) for (const id of remote.done ?? []) done.add(id);
  }
  return done;
}

/** Whether this Manyfold says where its files are, as 0.149 and newer do: its first few models' first file is
 *  enough. One that doesn't would bring every file into one folder, under names it doesn't give. */
async function assertManyfoldNewEnough(client: ManyfoldClient): Promise<void> {
  for (const ref of (await client.firstModels()).slice(0, 3)) {
    const model = await client.json<ManyfoldModel>(ref["@id"]);
    const part = model.hasPart?.[0];
    if (!part) continue;
    const file = await client.json<ManyfoldFile>(part["@id"]);
    if (filePathOf(file.contentUrl)) return;
    throw new MigrateError("manyfold_old", "This Manyfold is older than 0.149. Update it, then migrate.");
  }
}

/** A migration from Manyfold: its address and API key are tried, and what it has counted, before it's kept. */
export async function prepareManyfold(
  adminId: string,
  given: { address: string; clientId: string; clientSecret: string },
): Promise<RunOut> {
  let connection: ManyfoldConnection;
  let client: ManyfoldClient;
  let counts: { models: number; collections: number; creators: number };
  try {
    assertFree();
    connection = {
      address: manyfoldAddress(given.address),
      clientId: given.clientId.trim(),
      clientSecret: given.clientSecret.trim(),
    };
    client = new ManyfoldClient(connection);
    const [models, collections, creators] = await Promise.all([
      client.count("/models"),
      client.count("/collections"),
      client.count("/creators"),
    ]);
    counts = { models, collections, creators };
    await assertManyfoldNewEnough(client);
  } catch (err) {
    throw asHttp(err);
  }
  const before = await broughtBefore(connection.address);
  const plan: MigratePlan = {
    dump: null,
    folder: "",
    address: connection.address,
    manyfold: { ...counts, before: before.size },
  };
  const run = await prisma.migrationRun.create({
    data: { source: "manyfold", status: "ready", plan, remote: connection, createdById: adminId },
  });
  manyfoldClients.set(run.id, client);
  void createLog({
    userId: adminId,
    action: "migration_prepared",
    targetId: run.id,
    details: { address: connection.address },
  });
  return getRun(run.id);
}

/** How many models someone owns on the Manyfold a migration reads, by their username there. */
export async function manyfoldOwner(id: string, username: string): Promise<{ username: string; models: number }> {
  const run = await prisma.migrationRun.findUnique({ where: { id } });
  if (!run || run.source !== "manyfold") throw new HttpError(404, "No such migration");
  const remote = run.remote as ManyfoldRemote | null;
  if (!remote?.clientSecret) throw new HttpError(409, "This migration can't do that now.", "not_ready");
  const name = username.trim();
  try {
    return { username: name, models: await manyfoldClient(id, remote).ownedCount(name) };
  } catch (err) {
    throw asHttp(err);
  }
}

/** Starts a migration from Manyfold with the admin's choices; also starts one that stopped part-way again. */
export async function startManyfold(id: string, adminId: string, options: ManyfoldOptions): Promise<RunOut> {
  const state = claim(id, "start", "owners");
  let remote: ManyfoldRemote;
  let chosen: ManyfoldOptions;
  try {
    const run = await prisma.migrationRun.findUnique({ where: { id } });
    if (!run || run.source !== "manyfold") throw new HttpError(404, "No such migration");
    const notReady = new HttpError(409, "This migration can't be started.", "not_ready");
    const kept = run.remote as ManyfoldRemote | null;
    if (!kept?.clientSecret || !(run.status === "ready" || (run.status === "failed" && run.startedAt))) throw notReady;
    remote = kept;
    // Only people here: a username Manyfold's models go to names someone who exists.
    const known = new Set(
      (
        await prisma.user.findMany({
          where: { id: { in: options.owners.map((owner) => owner.userId) } },
          select: { id: true },
        })
      ).map((user) => user.id),
    );
    chosen = {
      owners: options.owners.filter((owner) => owner.username.trim() && known.has(owner.userId)),
      collections: options.collections,
    };
    // Only from the status it was read in: a run another process started meanwhile isn't started twice.
    const { count } = await prisma.migrationRun.updateMany({
      where: { id, status: run.status },
      data: { status: "running", options: chosen, error: Prisma.DbNull, startedAt: new Date(), finishedAt: null },
    });
    if (count !== 1) throw notReady;
  } catch (err) {
    release(state);
    throw err;
  }
  void executeManyfold(state, remote, chosen, adminId);
  void createLog({ userId: adminId, action: "migration_started", targetId: id, details: { source: "manyfold" } });
  return getRun(id);
}

async function executeManyfold(state: Active, remote: ManyfoldRemote, options: ManyfoldOptions, adminId: string) {
  let job: ManyfoldImport | null = null;
  try {
    // Made before the server stopped, without all its files: brought again whole. Its Manyfold id isn't in `done`,
    // which is kept in the same write as this is cleared.
    if (remote.half) await discardPrint(remote.half);
    const done = await broughtBefore(remote.address);
    for (const earlier of remote.done ?? []) done.add(earlier);
    job = new ManyfoldImport(
      manyfoldClient(state.id, remote),
      state.id,
      options,
      adminId,
      done,
      (progress) => {
        state.progress = { step: progress.phase, done: progress.done, total: progress.total };
      },
      async () => {
        await prisma.migrationRun.update({
          where: { id: state.id },
          data: { remote: { ...remote, done: [...done], half: job?.half ?? null } },
        });
      },
    );
    const report = await job.run();
    // The key isn't needed any more; what came is kept, so a later migration skips it.
    manyfoldClients.delete(state.id);
    await prisma.migrationRun.update({
      where: { id: state.id },
      data: {
        status: "done",
        report,
        remote: { address: remote.address, done: [...job.done] },
        finishedAt: new Date(),
      },
    });
    await createNotification(adminId, {
      type: "general",
      title: "Migration finished",
      message: { key: "migrateDone", values: { count: report.models.brought } },
      body: `${report.models.brought} models came over from Manyfold.`,
      internalPath: "/admin-migrate",
    }).catch(() => undefined);
  } catch (err) {
    log.error("a migration from Manyfold failed", { error: err });
    await prisma.migrationRun.update({
      where: { id: state.id },
      data: {
        status: "failed",
        error: storedError(err),
        ...(job ? { report: job.report } : {}),
        remote: {
          ...remote,
          done: [...(job?.done ?? remote.done ?? [])],
          half: job ? job.half : (remote.half ?? null),
        },
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
    release(state);
  }
}

/** Discards a migration that's being prepared or waiting, or takes one that's over off the list. Files a run that
 *  stopped part-way left in its folder go where they belong first. */
export async function removeRun(id: string): Promise<void> {
  if (discarding.has(id)) throw new HttpError(409, "A migration is under way already.", "busy");
  // Held before the first await and through the cleanup: a Start that came in meanwhile would otherwise find the run
  // still "ready" and merge from a working copy that's being dropped.
  discarding.add(id);
  try {
    const run = await prisma.migrationRun.findUnique({ where: { id } });
    if (!run) throw new HttpError(404, "No such migration");
    if (run.status === "running") throw new HttpError(409, "It's running. Wait for it to finish.", "running");
    if (active?.id === id && active.kind !== "prepare") {
      throw new HttpError(409, "A migration is under way already.", "busy");
    }
    if (active?.id === id) {
      // Preparing: it stops, cleans up and goes.
      active.abort.abort();
      return;
    }
    if (run.stagingDb) await dropStaging(run.stagingDb);
    if (run.startedAt) await fileRunModels(id);
    manyfoldClients.delete(id);
    await prisma.migrationRun.delete({ where: { id } });
  } finally {
    discarding.delete(id);
  }
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
