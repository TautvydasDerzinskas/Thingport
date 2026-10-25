import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Client } from "pg";

vi.mock("../src/services/importJobExecution", () => ({
  executeQueuedImport: async (job: { id: string }) => {
    const { prisma } = await import("../src/db");
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "DONE" } });
  },
}));

import { prisma } from "../src/db";
import { drainImportQueue, withImportSchedulerStopped } from "../src/services/importScheduler";
import { startLinksJob } from "../src/services/importQueueService";

let userId: string;
async function childImport() {
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/immediateImportWorker.ts", userId], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  await vi.waitFor(() => expect(output.trim()).toMatch(/^[0-9a-f-]{36}$/), { timeout: 10000 });
  return { child, id: output.trim() };
}

describe("immediate LINKS ownership across processes", () => {
  beforeAll(async () => {
    userId = (
      await prisma.user.create({ data: { email: `immediate-${Date.now()}@example.com`, displayName: "Immediate" } })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  it("does not recover a live runner in another process or resume its paused job", async () => {
    const { child, id } = await childImport();
    try {
      await drainImportQueue();
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id } })).status).toBe("RUNNING");
      const paused = await prisma.importJob.update({ where: { id }, data: { status: "PAUSED" } });
      await expect(startLinksJob(paused)).rejects.toMatchObject({ status: 409 });
      expect((await prisma.importJobItem.findFirstOrThrow({ where: { jobId: id } })).status).toBe("RUNNING");
    } finally {
      const stopped = once(child, "exit");
      child.kill("SIGKILL");
      await stopped;
      await prisma.importJob.delete({ where: { id } });
    }
  });

  it("recovers a killed runner, then retries through the durable scheduler", async () => {
    const { child, id } = await childImport();
    const stopped = once(child, "exit");
    child.kill("SIGKILL");
    await stopped;
    await drainImportQueue();
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe("ERROR");
    expect(job.failedCount).toBe(1);
    expect((await prisma.importJobItem.findFirstOrThrow({ where: { jobId: id } })).status).toBe("FAILED");
    await withImportSchedulerStopped(async () => {
      await startLinksJob(job, { retryFailed: true });
      const queued = await prisma.importJob.findUniqueOrThrow({ where: { id } });
      expect(queued.status).toBe("QUEUED");
      expect(queued.payload).toEqual({});
    });
    await vi.waitFor(async () =>
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id } })).status).toBe("DONE"),
    );
  });

  it("strips request-only markers and cookies when retrying a completed immediate job", async () => {
    const job = await prisma.importJob.create({
      data: {
        userId,
        type: "LINKS",
        status: "DONE",
        sourceUrl: "https://example.com/retry",
        failedCount: 1,
        payload: { immediate: true, makerworld_cookie: "must-not-persist", tags: ["saved"] },
        items: { create: [{ url: "https://example.com/retry", status: "FAILED" }] },
      },
    });
    await withImportSchedulerStopped(async () => {
      await startLinksJob(job, { retryFailed: true });
      const queued = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(queued.status).toBe("QUEUED");
      expect(queued.payload).toEqual({ tags: ["saved"] });
    });
    await vi.waitFor(async () =>
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE"),
    );
  });

  it("terminates a live runner on lock connection loss before recovery can overlap it", async () => {
    const { child, id } = await childImport();
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await db.connect();
      const stopped = once(child, "exit");
      const result = await db.query(
        "SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND classid = 174830220 AND objid = (hashtext($1)::bigint & 4294967295)::oid AND granted",
        [id],
      );
      expect(result.rowCount).toBe(1);
      expect((await stopped)[0]).toBe(1);
      await drainImportQueue();
      expect((await prisma.importJob.findUniqueOrThrow({ where: { id } })).status).toBe("ERROR");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await db.end();
    }
  });
});
