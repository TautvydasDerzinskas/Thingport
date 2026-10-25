import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => ({ active: 0, maximum: 0, calls: [] as string[] }));
vi.mock("../src/services/singleImport", () => ({
  prepareSingleImport: async (_userId: string, body: { url: string }) => ({ url: body.url, body }),
  importAndDescribe: async (_userId: string, url: string) => {
    run.active++;
    run.maximum = Math.max(run.maximum, run.active);
    run.calls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 30));
    run.active--;
    if (url.endsWith("failure")) throw new Error("provider failed");
    return { id: null, import_outcome: "created" };
  },
}));

import { prisma } from "../src/db";
import { drainImportQueue, storedImportBody } from "../src/services/importScheduler";
import { startLinksJob, pauseLinksJob } from "../src/services/importQueueService";
import { getPersistentImportTask } from "../src/services/importTaskService";

let userId: string;
const urls = (name: string) => `https://example.com/${name}`;
async function job(name: string, status: "QUEUED" | "RUNNING" | "PAUSED" = "QUEUED") {
  return prisma.importJob.create({ data: { userId, type: "SINGLE", sourceUrl: urls(name), status, total: 1 } });
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
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: interrupted.id } })).status).toBe("DONE");
    expect(await getPersistentImportTask(failure.id, userId)).toMatchObject({ status: "error", http_status: 500 });
    expect(await getPersistentImportTask(next.id, userId)).toMatchObject({ status: "done" });
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

  it("does not put browser session secrets into persisted job payloads", () => {
    expect(storedImportBody({ url: urls("model"), makerworld_cookie: "secret", tags: ["one"] })).toEqual({
      url: urls("model"),
      tags: ["one"],
    });
  });
});
