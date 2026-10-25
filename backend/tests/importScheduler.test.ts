import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ active: 0, maximum: 0, calls: [] as string[], hold: null as Promise<void> | null }));
vi.mock("../src/services/singleImport", () => ({
  prepareSingleImport: async (_userId: string, body: { url: string }) => ({ url: body.url, body }),
  importAndDescribe: async (_userId: string, url: string) => {
    run.active++;
    run.maximum = Math.max(run.maximum, run.active);
    run.calls.push(url);
    await (run.hold ?? new Promise((resolve) => setTimeout(resolve, 30)));
    run.active--;
    if (url.endsWith("failure")) throw new Error("provider failed");
    return { id: null, import_outcome: "created" };
  },
}));

import { prisma } from "../src/db";
import {
  drainImportQueue,
  storedImportBody,
  withImportSchedulerStopped,
  IMPORT_WORKER_LOCK,
} from "../src/services/importScheduler";
import { startLinksJob, pauseLinksJob, pauseAll, deleteQueueJob } from "../src/services/importQueueService";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Client } from "pg";
import { testAndSwitchDatabase } from "../src/services/databaseSettingsService";
import { reserveSync, releaseSync } from "../src/services/collectionSyncRunner";
import { isDatabaseSwitching } from "../src/services/databaseSwitchGate";
import { getPersistentImportTask } from "../src/services/importTaskService";

let userId: string;
const urls = (name: string) => `https://example.com/${name}`;
async function job(name: string, status: "QUEUED" | "RUNNING" | "PAUSED" = "QUEUED") {
  return prisma.importJob.create({
    data: { userId, type: "SINGLE", sourceUrl: urls(name), status, total: 1, payload: {} },
  });
}

describe("durable import scheduler (PostgreSQL)", () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `scheduler-${Date.now()}@example.com`,
        displayName: "Scheduler",
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("claims queued jobs once across simultaneous workers and leaves paused jobs alone", async () => {
    const first = await job("first");
    const second = await job("second");
    const paused = await job("paused", "PAUSED");
    expect(await getPersistentImportTask(first.id, userId)).toEqual({ status: "queued" });
    await Promise.all([drainImportQueue(), drainImportQueue()]);
    expect(run.maximum).toBe(1);
    expect(run.calls).toEqual([urls("first"), urls("second")]);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("DONE");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: second.id } })).processed).toBe(1);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe("PAUSED");
    expect(await getPersistentImportTask(first.id, "someone-else")).toBeNull();
  });

  it("recovers interrupted work, persists failure, then continues to the next job", async () => {
    const interrupted = await job("interrupted", "RUNNING");
    const failure = await job("failure");
    const next = await job("after-failure");
    // Distinguish the success URL from the failure suffix in the fake provider.
    await prisma.importJob.update({ where: { id: next.id }, data: { sourceUrl: urls("last") } });
    await drainImportQueue();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: interrupted.id } })).status).toBe("ERROR");
    expect(run.calls).not.toContain(urls("interrupted"));
    expect(await getPersistentImportTask(interrupted.id, userId)).toMatchObject({
      status: "error",
      http_status: 409,
      detail: expect.stringContaining("check the library"),
    });
    expect(await getPersistentImportTask(failure.id, userId)).toMatchObject({ status: "error", http_status: 500 });
    expect(await getPersistentImportTask(next.id, userId)).toMatchObject({ status: "done" });
  });

  it("does not replay batches without committed per-model checkpoints", async () => {
    for (const type of ["COLLECTION", "ZIP", "PROFILES"] as const) {
      const batch = await prisma.importJob.create({
        data: {
          userId,
          type,
          status: "RUNNING",
          sourceUrl: urls(type),
          payload: {},
        },
      });
      await drainImportQueue();
      const recovered = await prisma.importJob.findUniqueOrThrow({ where: { id: batch.id } });
      expect(recovered.status).toBe("ERROR");
      expect(recovered.errorMessage).toContain("check the library");
    }
  });

  it("marks an interrupted link uncertain instead of downloading it again", async () => {
    const batch = await prisma.importJob.create({
      data: {
        userId,
        type: "LINKS",
        status: "RUNNING",
        sourceUrl: urls("uncertain"),
        payload: {},
        total: 1,
        items: { create: [{ url: urls("uncertain"), status: "RUNNING" }] },
      },
    });
    await drainImportQueue();
    const recovered = await prisma.importJobItem.findFirstOrThrow({ where: { jobId: batch.id } });
    expect(recovered.status).toBe("FAILED");
    expect(recovered.errorMessage).toContain("may already be imported");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: batch.id } })).failedCount).toBe(1);
  });

  it("pauses a waiting single import and manually retries a failed one", async () => {
    const waiting = await job("waiting-to-pause");
    await pauseLinksJob(waiting);
    await drainImportQueue();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("PAUSED");
    const failed = await prisma.importJob.create({
      data: {
        userId,
        type: "SINGLE",
        sourceUrl: urls("retried"),
        payload: {},
        status: "ERROR",
        total: 1,
        failedCount: 1,
      },
    });
    await startLinksJob(failed, { retryFailed: true });
    for (let i = 0; i < 100; i++) {
      const current = await prisma.importJob.findUniqueOrThrow({ where: { id: failed.id } });
      if (current.status === "DONE") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const finished = await prisma.importJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(finished.status).toBe("DONE");
    expect(finished.failedCount).toBe(0);
  });

  it("refuses pause, delete and retry while a SINGLE is executing, including pause-all", async () => {
    const active = await job("active-pause");
    let release!: () => void;
    run.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const draining = drainImportQueue();
    try {
      await vi.waitFor(() => expect(run.calls).toContain(urls("active-pause")));
      // Deliberately pass the stale QUEUED snapshot: the update predicate must catch the claim.
      await expect(pauseLinksJob(active)).rejects.toMatchObject({ status: 409 });
      await pauseAll();
      const running = await prisma.importJob.findUniqueOrThrow({ where: { id: active.id } });
      expect(running.status).toBe("RUNNING");
      await expect(deleteQueueJob(active.id)).rejects.toMatchObject({ status: 409 });
      await expect(startLinksJob(running, { retryFailed: true })).rejects.toMatchObject({ status: 409 });
    } finally {
      release();
      run.hold = null;
      await draining;
    }
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("DONE");
  });

  it("does not delete a paused SINGLE that was claimed after the idle check", async () => {
    const paused = await job("delete-race", "PAUSED");
    const remove = prisma.importJob.deleteMany.bind(prisma.importJob);
    const spy = vi.spyOn(prisma.importJob, "deleteMany").mockImplementationOnce(async (args) => {
      await prisma.importJob.update({ where: { id: paused.id }, data: { status: "RUNNING" } });
      return remove(args);
    });
    try {
      await expect(deleteQueueJob(paused.id)).rejects.toMatchObject({ status: 409 });
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe("RUNNING");
    } finally {
      spy.mockRestore();
      await prisma.importJob.delete({ where: { id: paused.id } });
    }
  });

  it("settles the current import before switching and leaves the next job unclaimed", async () => {
    await job("before-switch");
    const waiting = await job("after-switch");
    let release!: () => void;
    run.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const draining = drainImportQueue();
    await vi.waitFor(() => expect(run.calls).toContain(urls("before-switch")));
    let switched = false;
    const switchDatabase = withImportSchedulerStopped(async () => {
      expect(run.active).toBe(0);
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("QUEUED");
      switched = true;
      // Independent calls cannot acquire work while the switch owns the suspension.
      await drainImportQueue();
      expect(run.calls).not.toContain(urls("after-switch"));
    });
    expect(switched).toBe(false);
    release();
    run.hold = null;
    await Promise.all([draining, switchDatabase]);
    expect(switched).toBe(true);
    await vi.waitFor(async () => {
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("DONE");
    });
  });

  it("refuses a database switch while a collection sync may await the import queue", async () => {
    expect(reserveSync("switch-test")).toBe(true);
    const database = new URL(process.env.DATABASE_URL!);
    try {
      await expect(
        testAndSwitchDatabase({
          database: database.pathname.slice(1),
          user: decodeURIComponent(database.username),
          password: decodeURIComponent(database.password),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(isDatabaseSwitching()).toBe(false);
    } finally {
      releaseSync("switch-test");
    }
  });

  it("switches the database client only after a running import commits its result", async () => {
    const active = await job("actual-switch");
    let release!: () => void;
    run.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const draining = drainImportQueue();
    await vi.waitFor(() => expect(run.calls).toContain(urls("actual-switch")));
    const database = new URL(process.env.DATABASE_URL!);
    let switched = false;
    const changing = testAndSwitchDatabase({
      database: database.pathname.slice(1),
      user: decodeURIComponent(database.username),
      password: decodeURIComponent(database.password),
    }).then(() => {
      switched = true;
    });
    try {
      await vi.waitFor(() => expect(isDatabaseSwitching()).toBe(true));
      expect(switched).toBe(false);
      expect(reserveSync("during-switch")).toBe(false);
    } finally {
      release();
      run.hold = null;
      await Promise.all([draining, changing]);
    }
    expect(switched).toBe(true);
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("DONE");
  });

  it("leaves immediate sessions and payload-less legacy jobs alone", async () => {
    const immediate = await prisma.importJob.create({
      data: {
        userId,
        type: "LINKS",
        status: "RUNNING",
        sourceUrl: urls("immediate"),
        payload: { immediate: true },
        items: { create: [{ url: urls("immediate"), status: "RUNNING" }] },
      },
    });
    const legacy = await prisma.importJob.create({
      data: {
        userId,
        type: "COLLECTION",
        status: "RUNNING",
        sourceUrl: urls("legacy"),
      },
    });
    await drainImportQueue();
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: immediate.id } })).status).toBe("RUNNING");
    expect((await prisma.importJobItem.findFirstOrThrow({ where: { jobId: immediate.id } })).status).toBe("RUNNING");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe("RUNNING");
    await prisma.importJob.deleteMany({ where: { id: { in: [immediate.id, legacy.id] } } });
  });

  it.each(["immediate", "legacy"] as const)("refuses to switch away from an active %s import", async (kind) => {
    const direct = await prisma.importJob.create({
      data: {
        userId,
        type: kind === "immediate" ? "LINKS" : "COLLECTION",
        status: "RUNNING",
        sourceUrl: urls(kind),
        ...(kind === "immediate" ? { payload: { immediate: true } } : {}),
      },
    });
    const database = new URL(process.env.DATABASE_URL!);
    try {
      await expect(
        testAndSwitchDatabase({
          database: database.pathname.slice(1),
          user: decodeURIComponent(database.username),
          password: decodeURIComponent(database.password),
        }),
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("direct imports") });
      expect(isDatabaseSwitching()).toBe(false);
    } finally {
      await prisma.importJob.delete({ where: { id: direct.id } });
    }
  });

  it("exits the worker process when its lock connection dies during a claimed job", async () => {
    const active = await job("lock-loss");
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/importLockWorker.ts"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    const exited = once(child, "exit");
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.connect();
      await vi.waitFor(() => expect(output).toContain("CLAIMED"), { timeout: 10000 });
      const { rows } = await admin.query("SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = $1::oid", [
        IMPORT_WORKER_LOCK,
      ]);
      expect(rows).toHaveLength(1);
      await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      const [code] = await exited;
      expect(code).toBe(1);
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("RUNNING");
      await drainImportQueue();
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: active.id } })).status).toBe("ERROR");
    } finally {
      child.kill();
      await admin.end();
    }
  });

  it("does not exit or claim work when the lock is lost while idle", async () => {
    const waiting = await job("idle-lock-loss");
    const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/importLockWorker.ts", "--idle"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString();
    });
    const exited = once(child, "exit");
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await admin.connect();
      await vi.waitFor(() => expect(output).toContain("IDLE"), { timeout: 10000 });
      const { rows } = await admin.query("SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND objid = $1::oid", [
        IMPORT_WORKER_LOCK,
      ]);
      expect(rows).toHaveLength(1);
      await admin.query("SELECT pg_terminate_backend($1)", [rows[0].pid]);
      await vi.waitFor(() => expect(errors).toContain("Import worker lock connection failed"));
      expect(child.exitCode).toBeNull();
      child.stdin.write("continue");
      const [code] = await exited;
      expect(code).toBe(0);
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe("QUEUED");
    } finally {
      child.kill();
      await admin.end();
      await prisma.importJob.delete({ where: { id: waiting.id } });
    }
  });

  it("does not put browser session secrets into persisted job payloads", () => {
    expect(storedImportBody({ url: urls("model"), makerworld_cookie: "secret", tags: ["one"] })).toEqual({
      url: urls("model"),
      tags: ["one"],
    });
  });
});
